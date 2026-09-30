/**
 * Baseline: the ORIGINAL monolithic system prompt (~41k tokens), filled exactly
 * as the packet's Flow section says, with all 14 packet tools, and the packet's
 * Reply contract appended. Scored with the same cases and scorer as the
 * workflow, on the same writer model.
 *
 *   npx tsx eval/baseline.ts --writer deepseek [--set all|packet|dev|regression-v1|regression-v2|holdout-v3] [--concurrency 2] [--max-usd 0.5]
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import * as K from "../src/packet/constants.js";
import { loadEnv } from "../src/deps.js";
import { createClient, extractJson, type Msg } from "../src/llm/client.js";
import { getModel } from "../src/models/registry.js";
import { ToolExecutor } from "../src/tools/executor.js";
import { TOOLS } from "../src/tools/registry.js";
import { buildContext, renderUserMessage } from "../src/context.js";
import { ReplySchema, type Reply } from "../src/contracts.js";
import { mapLimit } from "../src/util.js";
import { PACKET_CASES } from "./packet.cases.js";
import { DEV_CASES } from "./dev.cases.js";
import { HOLDOUT_CASES as REGRESSION_V1_CASES } from "./holdout-v1.cases.js";
import { HOLDOUT_V2_CASES as REGRESSION_V2_CASES } from "./holdout-v2.cases.js";
import { HOLDOUT_V3_CASES } from "./holdout-v3.cases.js";
import { score } from "./lib.js";

loadEnv();
const arg = (k: string, d?: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const writer = arg("writer", "deepseek")!;
const set = arg("set", "all");
const SETS: Record<string, typeof PACKET_CASES> = { packet: PACKET_CASES, dev: DEV_CASES, "regression-v1": REGRESSION_V1_CASES, "regression-v2": REGRESSION_V2_CASES,
  "holdout-v3": HOLDOUT_V3_CASES, all: [...PACKET_CASES, ...DEV_CASES] };
if (!SETS[set ?? "all"]) throw new Error(`unknown --set ${set}`);
const cases = SETS[set ?? "all"];
const client = createClient(getModel(writer));
const ctx = buildContext();

// Fill {{NAME}} with the constant of the same name (Flow section). Unknown placeholders stay as-is.
const consts = K as unknown as Record<string, unknown>;
const system = readFileSync("fixtures/original-system-prompt.txt", "utf8").replace(/\{\{([A-Z_]+)\}\}/g, (m, name: string) =>
  name in consts ? (typeof consts[name] === "string" ? (consts[name] as string) : JSON.stringify(consts[name])) : m,
);
const OUTPUT_CONTRACT = `

# OUTPUT CONTRACT
Return ONE json object (the Reply) with exactly these fields:
{"response": string, "escalate": boolean, "escalationReason": string|null, "templateId": null, "intent": string, "shouldFollowUp": boolean, "followUpTiming": string|null, "attachmentUrls": string[]|null, "highEngagement": boolean, "workingMemoryUpdates": object|null}
response is the reply in plain text; if it includes a URL, that URL is the last line. attachmentUrls holds at most 3 URLs, only URLs a tool returned on this turn. escalate is true only when a person must take over (the patient asks for a human, or no tool and no rule can do what they asked); then response is one short sentence and escalationReason is a short reason, otherwise null.`;

// Tools exposed with the prompt's own "<name>Tool" names; the executor maps the alias back.
const tools = [...TOOLS.values()].map((d) => ({
  name: `${d.name}Tool`,
  description: d.description,
  parameters: Object.keys(d.parameters).length ? d.parameters : { type: "object", properties: {} },
}));

const MAX_USD = Number(arg("max-usd", "0.5"));
const CONCURRENCY = Number(arg("concurrency", "2"));
let spent = 0;
let maxCaseCost = 0.01; // reserve per in-flight case (the monolith costs ~$0.003 per case)
const rows = await mapLimit(cases, CONCURRENCY, async (c) => {
  if (spent + CONCURRENCY * maxCaseCost > MAX_USD) {
    process.stderr.write("$");
    return { id: c.id, escalateExpected: c.expect.escalate, escalate: false, pass: false, failed: ["skipped: spend cap"], error: "skipped", response: "", latencyMs: 0, cost: 0, inputTokens: 0 };
  }
  const exec = new ToolExecutor(ctx.userId);
  const msgs: Msg[] = [{ role: "user", content: renderUserMessage(ctx, c.text) + OUTPUT_CONTRACT }];
  const started = Date.now();
  let cost = 0;
  let inputTokens = 0;
  let reply: Reply | undefined;
  let error: string | undefined;
  try {
    for (let round = 0; round < 6; round++) {
      const res = await client.chat({ system, messages: msgs, tools, maxTokens: 3000, timeoutMs: 120_000 });
      cost += res.usage.costUsd;
      inputTokens += res.usage.inputTokens;
      if (res.toolCalls.length) {
        msgs.push({ role: "assistant", content: res.text || null, toolCalls: res.toolCalls, providerData: res.providerData });
        for (const tc of res.toolCalls) {
          const rec = exec.run(tc.name, tc.args, "commit"); // the monolith may call write tools directly
          msgs.push({ role: "tool", toolCallId: tc.id, name: tc.name, content: JSON.stringify(rec.ok ? rec.result : { error: rec.error }) });
        }
        continue;
      }
      const parsed = extractJson(res.text);
      const r = ReplySchema.safeParse({ templateId: null, attachmentUrls: null, workingMemoryUpdates: null, ...parsed });
      if (r.success) reply = r.data;
      else {
        error = `invalid Reply: ${r.error.issues.map((i) => i.message).join("; ").slice(0, 200)}`;
        reply = {
          response: String(parsed?.response ?? res.text ?? ""),
          escalate: parsed?.escalate === true,
          escalationReason: parsed?.escalate === true ? String(parsed?.escalationReason ?? "unspecified") : null,
          templateId: null,
          intent: String(parsed?.intent ?? "unknown"),
          shouldFollowUp: parsed?.shouldFollowUp === true && !!parsed?.followUpTiming,
          followUpTiming: parsed?.shouldFollowUp === true && parsed?.followUpTiming ? String(parsed.followUpTiming) : null,
          attachmentUrls: null,
          highEngagement: parsed?.highEngagement === true,
          workingMemoryUpdates: null,
        };
      }
      break;
    }
  } catch (e) {
    error = (e as Error).message.slice(0, 200);
  }
  const finalReply = reply ?? ({ response: "", escalate: false, escalationReason: null, templateId: null, intent: "none", shouldFollowUp: false, followUpTiming: null, attachmentUrls: null, highEngagement: false, workingMemoryUpdates: null } as Reply);
  const trace = {
    tools: exec.records.map((r) => ({ tool: r.tool, ok: r.ok, args: r.args })),
    commits: exec.records.filter((r) => TOOLS.get(r.tool)?.kind === "write").map((r) => ({ tool: r.tool, ok: r.ok, args: r.args })),
  };
  spent += cost;
  maxCaseCost = Math.max(maxCaseCost, cost);
  const checks = score(c, finalReply, trace);
  const failed = checks.filter((x) => !x.ok).map((x) => x.name);
  process.stderr.write(failed.length || error ? "x" : ".");
  return { id: c.id, escalateExpected: c.expect.escalate, escalate: finalReply.escalate, pass: !failed.length && !error, failed, error, response: finalReply.response, latencyMs: Date.now() - started, cost, inputTokens };
});
process.stderr.write("\n");
const esc = rows.filter((r) => r.escalate);
const summary = {
  variant: "monolith-baseline",
  writer,
  cases: rows.length,
  passRate: `${((100 * rows.filter((r) => r.pass).length) / rows.length).toFixed(1)}%`,
  escalationRecall: `${((100 * rows.filter((r) => r.escalateExpected && r.escalate).length) / Math.max(1, rows.filter((r) => r.escalateExpected).length)).toFixed(1)}%`,
  escalationPrecision: `${esc.length ? ((100 * esc.filter((r) => r.escalateExpected).length) / esc.length).toFixed(1) : "100.0"}%`,
  invalidReplies: rows.filter((r) => r.error).length,
  inputTokensP50: [...rows.map((r) => r.inputTokens)].sort((a, b) => a - b)[Math.floor(rows.length / 2)],
  latencyP50ms: [...rows.map((r) => r.latencyMs)].sort((a, b) => a - b)[Math.floor(rows.length / 2)],
  costTotalUsd: Number(rows.reduce((a, r) => a + r.cost, 0).toFixed(4)),
  skippedAtSpendCap: rows.filter((r) => r.error === "skipped").length,
};
console.log(JSON.stringify(summary, null, 2));
for (const r of rows.filter((x) => !x.pass)) console.log(`FAIL ${r.id}: ${r.failed.join("; ")}${r.error ? ` | ${r.error}` : ""}\n   → ${JSON.stringify(r.response).slice(0, 200)}`);
mkdirSync("eval/results", { recursive: true });
writeFileSync(`eval/results/baseline-${writer}-${set}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, JSON.stringify({ summary, rows }, null, 2));
const summaryOut = arg("summary-out");
if (summaryOut) writeFileSync(summaryOut, JSON.stringify(summary, null, 2));
if (process.argv.includes("--publish")) {
  const sh = (c: string) => {
    try {
      return execSync(c, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch {
      return "unknown";
    }
  };
  const commit = sh("git rev-parse --short HEAD");
  const dirty = sh("git status --porcelain -- src domains eval fixtures") !== "";
  const dir = `benchmarks/${new Date().toISOString().slice(0, 10)}-${commit}${dirty ? "-dirty" : ""}-baseline-${writer}-${set}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/config.json`, JSON.stringify({ variant: "monolith-baseline", commit, dirtyWorkingTree: dirty, date: new Date().toISOString(), set, writer: getModel(writer), spendCapUsd: MAX_USD, concurrency: CONCURRENCY, node: process.version }, null, 2));
  writeFileSync(`${dir}/summary.json`, JSON.stringify(summary, null, 2));
  writeFileSync(`${dir}/results.jsonl`, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.error(`published ${dir}`);
}
