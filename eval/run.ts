/**
 * Live evaluation. Scores every requirement per case, repeats k times (pass^k),
 * and writes a JSON report to eval/results/.
 *
 *   npx tsx eval/run.ts --writer deepseek --router auto --k 1 [--set packet|dev|holdout|all] [--tag escalation]
 *                       [--concurrency 3] [--max-usd 1.00]   # spend cap: no new cases start once reached
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { THRESHOLDS } from "../src/policy/gate.js";
import { getModel } from "../src/models/registry.js";
import { buildDeps, getDefaultOptions, loadEnv, type Options } from "../src/deps.js";
import { respond } from "../src/workflow.js";
import { buildQuestions } from "../src/decision/questions.js";
import { mapLimit } from "../src/util.js";
import { PACKET_CASES } from "./packet.cases.js";
import { DEV_CASES } from "./dev.cases.js";
import { HOLDOUT_CASES } from "./holdout.cases.js";
import type { EvalCase } from "./types.js";
import { score } from "./lib.js";
import { otelFromEnv } from "../src/observability/otel.js";
import type { Trace } from "../src/workflow.js";

loadEnv();
const arg = (k: string, d?: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const k = Number(arg("k", "1"));
const set = arg("set", "all");
const tag = arg("tag");
const opts: Options = {
  ...getDefaultOptions(),
  writer: arg("writer", getDefaultOptions().writer)!,
  router: (arg("router", "auto") as Options["router"]) ?? "auto",
  outputBattery: arg("battery", "1") === "1",
};
const deps = buildDeps(opts);
// For model comparisons, failover would hide which model answered: --failover 0 disables it.
if (arg("failover", "1") === "0") deps.writerFallback = undefined;
const qs = buildQuestions(deps.domain, deps.ctx);

const pickSet = (s: string) => (s === "packet" ? PACKET_CASES : s === "dev" ? DEV_CASES : s === "holdout" ? HOLDOUT_CASES : [...PACKET_CASES, ...DEV_CASES]);
let cases: EvalCase[] = pickSet(set ?? "all");
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
  costComplete: boolean;
  costEstimated: boolean;
  skipped?: boolean;
  inputTokens: number;
  outputTokens: number;
  promptTokens?: number;
  writerOutcome?: string;
  skills?: string[];
  outputBattery?: Record<string, number>;
  failover?: string;
  error?: string;
}

const otel = otelFromEnv();
const traces: Trace[] = [];
const started = Date.now();
console.error(`eval: writer=${opts.writer} router=${deps.routerName} cases=${cases.length} k=${k}`);
const jobs = cases.flatMap((c) => Array.from({ length: k }, (_, run) => ({ c, run })));
const MAX_USD = Number(arg("max-usd", "1"));
let spent = 0;
const rows = await mapLimit(jobs, Number(arg("concurrency", "3")), async ({ c, run }): Promise<RunRow> => {
  if (spent >= MAX_USD) {
    process.stderr.write("$");
    return { id: c.id, run, pass: false, failed: ["skipped: spend cap reached"], route: "skipped", escalate: false, response: "", latencyMs: 0, costUsd: 0, costComplete: true, costEstimated: false, skipped: true, inputTokens: 0, outputTokens: 0 };
  }
  const { reply, trace } = await respond({ id: `${c.id}#${run}`, text: c.text }, deps, qs);
  otel?.export(trace);
  traces.push(trace);
  spent += trace.usage.costUsd;
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
    costComplete: trace.usage.costComplete,
    costEstimated: trace.usage.costEstimated,
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

// ---- aggregate (skipped rows, if the spend cap was hit, are excluded and reported)
const skippedRows = rows.filter((r) => r.skipped).length;
const rowsRun = rows.filter((r) => !r.skipped);
const byCase = new Map<string, RunRow[]>();
for (const r of rowsRun) byCase.set(r.id, [...(byCase.get(r.id) ?? []), r]);
const caseMeta = new Map(cases.map((c) => [c.id, c]));
const passK = [...byCase.values()].filter((rs) => rs.every((r) => r.pass)).length;
const passAny = [...byCase.values()].filter((rs) => rs.some((r) => r.pass)).length;
const escCases = cases.filter((c) => c.expect.escalate);
const nonEsc = cases.filter((c) => !c.expect.escalate);
const escExpectedRows = rowsRun.filter((r) => caseMeta.get(r.id)!.expect.escalate);
const escRecall = escExpectedRows.filter((r) => r.escalate).length / Math.max(1, escExpectedRows.length);
const falseEsc = rowsRun.filter((r) => !caseMeta.get(r.id)!.expect.escalate && r.escalate).length;
const escPrecision = (() => {
  const esc = rowsRun.filter((r) => r.escalate);
  return esc.length ? esc.filter((r) => caseMeta.get(r.id)!.expect.escalate).length / esc.length : 1;
})();
const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
const q = (arr: number[], p: number) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0;
};
const answered = rowsRun.filter((r) => !r.escalate);
const summary = {
  writer: opts.writer,
  router: deps.routerName,
  k,
  cases: cases.length,
  runs: rowsRun.length,
  passRate: pct(rowsRun.filter((r) => r.pass).length / rowsRun.length),
  passK: `${passK}/${cases.length}`,
  passAny: `${passAny}/${cases.length}`,
  escalationRecall: pct(escRecall),
  escalationPrecision: pct(escPrecision),
  falseEscalations: falseEsc,
  nonEscalationCases: nonEsc.length,
  writerOutcomes: answered.reduce<Record<string, number>>((a, r) => ((a[r.writerOutcome ?? "none"] = (a[r.writerOutcome ?? "none"] ?? 0) + 1), a), {}),
  promptTokensP50: q(answered.map((r) => r.promptTokens ?? 0), 0.5),
  latencyP50ms: q(rowsRun.map((r) => r.latencyMs), 0.5),
  latencyP95ms: q(rowsRun.map((r) => r.latencyMs), 0.95),
  costTotalUsd: Number(rowsRun.reduce((a, r) => a + r.costUsd, 0).toFixed(5)),
  costPerAnsweredUsd: Number((answered.reduce((a, r) => a + r.costUsd, 0) / Math.max(1, answered.length)).toFixed(5)),
  // All costs include routing (both adapters), gather/draft/repair, completed calls before failover and the output battery.
  costPerInputUsd: Number((rowsRun.reduce((a, r) => a + r.costUsd, 0) / Math.max(1, rowsRun.length)).toFixed(5)),
  costPerSuccessfulAnswerUsd: Number((rowsRun.reduce((a, r) => a + r.costUsd, 0) / Math.max(1, rowsRun.filter((r) => r.pass && !r.escalate).length)).toFixed(5)),
  rowsWithUnknownCost: rowsRun.filter((r) => !r.costComplete).length,
  costIncludesEstimates: rowsRun.some((r) => r.costEstimated),
  spendCapUsd: MAX_USD,
  skippedAtSpendCap: skippedRows,
  outputBatteryFlags: Object.fromEntries(
    ["promises_offchannel_action", "leaves_question_unanswered", "pressure_or_upsell", "unprompted_financing", "asks_multiple_questions"].map((key) => [
      key,
      answered.filter((r) => (r.outputBattery?.[key] ?? 0) >= 0.7).length,
    ]),
  ),
  providerFailovers: rowsRun.filter((r) => r.failover).length,
  internalErrors: rowsRun.filter((r) => r.error).length,
  wallMs: Date.now() - started,
};
console.log(JSON.stringify(summary, null, 2));
const failures = rowsRun.filter((r) => !r.pass);
for (const f of failures) console.log(`FAIL ${f.id}#${f.run} [${f.route}] ${f.failed.join("; ")}\n     → ${JSON.stringify(f.response).slice(0, 260)}${f.error ? `\n     error: ${f.error}` : ""}`);
mkdirSync("eval/results", { recursive: true });
const file = `eval/results/${opts.writer}-${opts.router}-${set}-k${k}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(file, JSON.stringify({ summary, rows }, null, 2));
writeFileSync(file.replace(/\.json$/, ".traces.jsonl"), traces.map((t) => JSON.stringify(t)).join("\n") + "\n");

// --publish: a self-describing, committed benchmark artifact (README tables are generated from these).
if (process.argv.includes("--publish")) {
  const sh = (c: string) => {
    try {
      return execSync(c, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch {
      return "unknown";
    }
  };
  const commit = sh("git rev-parse --short HEAD");
  const dirty = sh("git status --porcelain -- src domains eval") !== "";
  // Content hash of everything that affects behaviour, so a run is identifiable even from an uncommitted tree.
  const codeHash = sh("git ls-files -co --exclude-standard src domains eval/*.cases.ts eval/lib.ts | sort | xargs cat | shasum -a 256").split(" ")[0];
  const dir = `benchmarks/${new Date().toISOString().slice(0, 10)}-${commit}${dirty ? "-dirty" : ""}-${opts.writer}-${opts.router}-${set}-k${k}`;
  mkdirSync(dir, { recursive: true });
  const config = {
    commit,
    dirtyWorkingTree: dirty,
    codeHash,
    date: new Date().toISOString(),
    set,
    k,
    writer: getModel(opts.writer),
    router: deps.routerName,
    classifier: opts.classifier,
    thresholds: THRESHOLDS,
    skills: Object.fromEntries([...deps.domain.skills.values()].map((s) => [s.id, s.version])),
    spendCapUsd: MAX_USD,
    node: process.version,
  };
  writeFileSync(`${dir}/config.json`, JSON.stringify(config, null, 2));
  writeFileSync(`${dir}/summary.json`, JSON.stringify(summary, null, 2));
  // Per-case results: responses are patient-facing text (card data is redacted on input and blocked on output).
  writeFileSync(`${dir}/results.jsonl`, rows.map((r) => JSON.stringify({ id: r.id, run: r.run, pass: r.pass, failed: r.failed, route: r.route, escalate: r.escalate, response: r.response, latencyMs: r.latencyMs, costUsd: r.costUsd, costComplete: r.costComplete, writerOutcome: r.writerOutcome, skills: r.skills })).join("\n") + "\n");
  console.error(`published ${dir}`);
}
await otel?.shutdown();
console.error(`saved ${file}`);
