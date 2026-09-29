/**
 * Tool-calling eval: can each model choose the right packet tool, with valid
 * arguments, when nothing was prefetched? Includes a two-step chain
 * (look up the package id, then request its payment link).
 *
 *   npx tsx eval/toolcalling.ts [--models deepseek,gemini,qwen]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { loadEnv } from "../src/deps.js";
import { createClient, type Msg } from "../src/llm/client.js";
import { getModel } from "../src/models/registry.js";
import { ToolExecutor } from "../src/tools/executor.js";
import { READ_TOOLS, toolSpecs } from "../src/tools/registry.js";

loadEnv();
const i = process.argv.indexOf("--models");
const models = (i >= 0 ? process.argv[i + 1] : "deepseek,gemini,qwen").split(",");
const USER = "7c2e1a40-6b8f-4d3a-9e15-2f0a8b6c4d11";
const GOLD = "44444444-4444-4444-8444-444444444442";

interface TCase {
  id: string;
  text: string;
  /** Tool that must be called (in any round) with args matching. */
  expect: { tool: string; args?: RegExp }[];
  /** Tools that must not be called. */
  forbid?: string[];
}

const CASES: TCase[] = [
  { id: "packages", text: "What packages does Heva Clinic have?", expect: [{ tool: "getClinicPackages", args: /heva|11111111/i }] },
  { id: "doctors", text: "Who are the doctors at Dr. Hakan Clinic?", expect: [{ tool: "getClinicDoctors", args: /hakan|22222222/i }], forbid: ["getClinicPackages"] },
  { id: "photos", text: "Can you send me back my photos?", expect: [{ tool: "getPatientImages" }] },
  { id: "assessment", text: "Where can I find my assessment again?", expect: [{ tool: "getLatestAssessment" }] },
  { id: "reschedule", text: "I need to reschedule my consultation call.", expect: [{ tool: "getConsultationRescheduleLink" }] },
  { id: "saved", text: "Which clinics did you recommend for me?", expect: [{ tool: "getSavedClinics" }] },
  { id: "call", text: "What did we cover on our phone call last week?", expect: [{ tool: "getFullCalls" }] },
  {
    id: "payment-chain",
    text: "Send me the payment link for the Gold package at Heva Clinic.",
    expect: [{ tool: "getClinicPackages", args: /heva|11111111/i }, { tool: "getPaymentLink", args: new RegExp(`payment.*${GOLD}|${GOLD}.*payment`) }],
  },
  { id: "no-tool-needed", text: "Thanks, that's all for now!", expect: [], forbid: READ_TOOLS },
];

const SYSTEM =
  "You are a patient coordinator for a medical tourism company. Use the tools to look up any fact or link you need before answering; never invent ids or URLs. The patient's userId is " +
  USER +
  ". When you have what you need, answer briefly in plain text.";

const results: Record<string, unknown>[] = [];
for (const key of models) {
  const client = createClient(getModel(key));
  let pass = 0;
  let validArgs = 0;
  let totalCalls = 0;
  let hallucinated = 0;
  const lat: number[] = [];
  for (const c of CASES) {
    const exec = new ToolExecutor(USER);
    const msgs: Msg[] = [{ role: "user", content: c.text }];
    const called: { name: string; args: unknown; ok: boolean }[] = [];
    let error: string | undefined;
    try {
      for (let round = 0; round < 3; round++) {
        const res = await client.chat({ system: SYSTEM, messages: msgs, tools: toolSpecs(READ_TOOLS), maxTokens: 1500, timeoutMs: 60_000 });
        lat.push(res.latencyMs);
        if (!res.toolCalls.length) break;
        msgs.push({ role: "assistant", content: res.text || null, toolCalls: res.toolCalls, providerData: res.providerData });
        for (const tc of res.toolCalls) {
          const rec = exec.run(tc.name, tc.args, "model");
          called.push({ name: rec.tool, args: rec.args, ok: rec.ok });
          if (!rec.ok && /unknown_tool/.test(rec.error ?? "")) hallucinated++;
          msgs.push({ role: "tool", toolCallId: tc.id, name: tc.name, content: JSON.stringify(rec.ok ? rec.result : { error: rec.error }) });
        }
      }
    } catch (e) {
      error = (e as Error).message.slice(0, 200);
    }
    totalCalls += called.length;
    validArgs += called.filter((x) => x.ok).length;
    const expOk = c.expect.every((e) => called.some((x) => x.name === e.tool && x.ok && (!e.args || e.args.test(JSON.stringify(x.args)))));
    const forbidOk = !(c.forbid ?? []).some((f) => called.some((x) => x.name === f));
    const ok = !error && expOk && forbidOk;
    if (ok) pass++;
    console.log(`${key.padEnd(9)} ${c.id.padEnd(15)} ${ok ? "PASS" : "FAIL"} calls=${JSON.stringify(called.map((x) => `${x.name}${x.ok ? "" : "!"}`))}${error ? ` error=${error}` : ""}`);
    results.push({ model: key, case: c.id, ok, called, error });
  }
  const s = [...lat].sort((a, b) => a - b);
  console.log(
    `== ${key}: ${pass}/${CASES.length} cases, valid-arg rate ${totalCalls ? ((100 * validArgs) / totalCalls).toFixed(0) : "n/a"}% of ${totalCalls} calls, hallucinated tools ${hallucinated}, p50 call ${s[Math.floor(s.length / 2)] ?? 0}ms\n`,
  );
}
mkdirSync("eval/results", { recursive: true });
writeFileSync(`eval/results/toolcalling-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, JSON.stringify(results, null, 2));
