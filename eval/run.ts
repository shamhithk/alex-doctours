/**
 * Live evaluation. Scores every requirement per case, repeats k times (pass^k),
 * and writes a JSON report to eval/results/.
 *
 *   npx tsx eval/run.ts --writer deepseek --router auto --k 1 [--set packet|heldout|all] [--tag escalation] [--concurrency 3]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { buildDeps, DEFAULT_OPTIONS, loadEnv, type Options } from "../src/deps.js";
import { respond } from "../src/workflow.js";
import { buildQuestions } from "../src/decision/questions.js";
import { mapLimit } from "../src/util.js";
import { PACKET_CASES } from "./packet.cases.js";
import { HELDOUT_CASES } from "./heldout.cases.js";
import type { EvalCase } from "./types.js";
import { score } from "./lib.js";

loadEnv();
const arg = (k: string, d?: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const k = Number(arg("k", "1"));
const set = arg("set", "all");
const tag = arg("tag");
const opts: Options = {
  ...DEFAULT_OPTIONS,
  writer: arg("writer", DEFAULT_OPTIONS.writer)!,
  router: (arg("router", "auto") as Options["router"]) ?? "auto",
  outputBattery: arg("battery", "1") === "1",
};
const deps = buildDeps(opts);
// For model comparisons, failover would hide which model answered: --failover 0 disables it.
if (arg("failover", "1") === "0") deps.writerFallback = undefined;
const qs = buildQuestions(deps.domain, deps.ctx);

let cases: EvalCase[] = set === "packet" ? PACKET_CASES : set === "heldout" ? HELDOUT_CASES : [...PACKET_CASES, ...HELDOUT_CASES];
if (tag) cases = cases.filter((c) => c.tags.includes(tag));

interface RunRow {
  id: string;
  run: number;
  pass: boolean;
  failed: string[];
  route: string;
  escalate: boolean;
  response: string;
  latencyMs: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  promptTokens?: number;
  writerOutcome?: string;
  skills?: string[];
  outputBattery?: Record<string, number>;
  failover?: string;
  error?: string;
}

const started = Date.now();
console.error(`eval: writer=${opts.writer} router=${deps.routerName} cases=${cases.length} k=${k}`);
const jobs = cases.flatMap((c) => Array.from({ length: k }, (_, run) => ({ c, run })));
const rows = await mapLimit(jobs, Number(arg("concurrency", "3")), async ({ c, run }): Promise<RunRow> => {
  const { reply, trace } = await respond({ id: c.id, text: c.text }, deps, qs);
  const checks = score(c, reply, trace);
  const failed = checks.filter((x) => !x.ok).map((x) => `${x.name}${x.detail ? ` (${x.detail})` : ""}`);
  process.stderr.write(failed.length ? "x" : ".");
  return {
    id: c.id,
    run,
    pass: !failed.length,
    failed,
    route: trace.route + (trace.category ? `/${trace.category}` : ""),
    escalate: reply.escalate,
    response: reply.response,
    latencyMs: trace.latencyMs,
    costUsd: trace.usage.costUsd,
    inputTokens: trace.usage.inputTokens,
    outputTokens: trace.usage.outputTokens,
    promptTokens: trace.prompt?.approxTokens,
    writerOutcome: trace.writer?.outcome,
    skills: trace.skills?.loaded,
    outputBattery: trace.outputBattery,
    failover: trace.writer?.providerFailover,
    error: trace.error,
  };
});
process.stderr.write("\n");

// ---- aggregate
const byCase = new Map<string, RunRow[]>();
for (const r of rows) byCase.set(r.id, [...(byCase.get(r.id) ?? []), r]);
const caseMeta = new Map(cases.map((c) => [c.id, c]));
const passK = [...byCase.values()].filter((rs) => rs.every((r) => r.pass)).length;
const passAny = [...byCase.values()].filter((rs) => rs.some((r) => r.pass)).length;
const escCases = cases.filter((c) => c.expect.escalate);
const nonEsc = cases.filter((c) => !c.expect.escalate);
const escRecall = rows.filter((r) => caseMeta.get(r.id)!.expect.escalate).filter((r) => r.escalate).length / Math.max(1, escCases.length * k);
const falseEsc = rows.filter((r) => !caseMeta.get(r.id)!.expect.escalate && r.escalate).length;
const escPrecision = (() => {
  const esc = rows.filter((r) => r.escalate);
  return esc.length ? esc.filter((r) => caseMeta.get(r.id)!.expect.escalate).length / esc.length : 1;
})();
const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
const q = (arr: number[], p: number) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0;
};
const answered = rows.filter((r) => !r.escalate);
const summary = {
  writer: opts.writer,
  router: deps.routerName,
  k,
  cases: cases.length,
  runs: rows.length,
  passRate: pct(rows.filter((r) => r.pass).length / rows.length),
  passK: `${passK}/${cases.length}`,
  passAny: `${passAny}/${cases.length}`,
  escalationRecall: pct(escRecall),
  escalationPrecision: pct(escPrecision),
  falseEscalations: falseEsc,
  nonEscalationCases: nonEsc.length,
  writerOutcomes: answered.reduce<Record<string, number>>((a, r) => ((a[r.writerOutcome ?? "none"] = (a[r.writerOutcome ?? "none"] ?? 0) + 1), a), {}),
  promptTokensP50: q(answered.map((r) => r.promptTokens ?? 0), 0.5),
  latencyP50ms: q(rows.map((r) => r.latencyMs), 0.5),
  latencyP95ms: q(rows.map((r) => r.latencyMs), 0.95),
  costTotalUsd: Number(rows.reduce((a, r) => a + r.costUsd, 0).toFixed(5)),
  costPerAnsweredUsd: Number((answered.reduce((a, r) => a + r.costUsd, 0) / Math.max(1, answered.length)).toFixed(5)),
  outputBatteryFlags: Object.fromEntries(
    ["promises_offchannel_action", "leaves_question_unanswered", "pressure_or_upsell", "unprompted_financing", "asks_multiple_questions"].map((key) => [
      key,
      answered.filter((r) => (r.outputBattery?.[key] ?? 0) >= 0.7).length,
    ]),
  ),
  providerFailovers: rows.filter((r) => r.failover).length,
  internalErrors: rows.filter((r) => r.error).length,
  wallMs: Date.now() - started,
};
console.log(JSON.stringify(summary, null, 2));
const failures = rows.filter((r) => !r.pass);
for (const f of failures) console.log(`FAIL ${f.id}#${f.run} [${f.route}] ${f.failed.join("; ")}\n     → ${JSON.stringify(f.response).slice(0, 260)}${f.error ? `\n     error: ${f.error}` : ""}`);
mkdirSync("eval/results", { recursive: true });
const file = `eval/results/${opts.writer}-${opts.router}-${set}-k${k}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(file, JSON.stringify({ summary, rows }, null, 2));
console.error(`saved ${file}`);
