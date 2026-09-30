/**
 * Live evaluation. Scores every requirement per case, repeats k times (pass^k),
 * and writes a JSON report to eval/results/.
 *
 *   npx tsx eval/run.ts --writer deepseek --router auto --k 1 [--set packet|dev|regression-v1|holdout-v2|all] [--tag escalation]
 *                       [--concurrency 2] [--max-usd 1.00] [--summary-out file.json]
 *
 * Spend safety: a case starts only if (spent + reserve) stays under --max-usd, where the reserve
 * covers every case still in flight (concurrency x the most expensive case seen, at least
 * --min-case-usd). The run halts as soon as any case reports incomplete cost, since the cap
 * can no longer be enforced from reported spend.
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
import { HOLDOUT_CASES as REGRESSION_V1_CASES } from "./holdout-v1.cases.js";
import { HOLDOUT_V2_CASES } from "./holdout-v2.cases.js";
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

// holdout-v1 was exposed by the second review, so it is regression data now; holdout-v2 is the frozen set.
const SETS: Record<string, EvalCase[]> = {
  packet: PACKET_CASES,
  dev: DEV_CASES,
  "regression-v1": REGRESSION_V1_CASES,
  "holdout-v2": HOLDOUT_V2_CASES,
  all: [...PACKET_CASES, ...DEV_CASES],
};
if (!SETS[set ?? "all"]) throw new Error(`unknown --set ${set}; use ${Object.keys(SETS).join(" | ")}`);
let cases: EvalCase[] = SETS[set ?? "all"];
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
  /** Hard violation codes across writer attempts (which guards fired). */
  violations?: string[];
  routerRetries?: number;
  routerFallback?: boolean;
  routerFailed?: boolean;
  secondOpinion?: boolean;
  unconfirmed?: string[];
  stages?: { stage: string; costUsd: number | null; estimated?: boolean }[];
}

const otel = otelFromEnv();
const traces: Trace[] = [];
const started = Date.now();
console.error(`eval: writer=${opts.writer} router=${deps.routerName} cases=${cases.length} k=${k}`);
const jobs = cases.flatMap((c) => Array.from({ length: k }, (_, run) => ({ c, run })));
const MAX_USD = Number(arg("max-usd", "1"));
const CONCURRENCY = Number(arg("concurrency", "2"));
const MIN_CASE_USD = Number(arg("min-case-usd", "0.01"));
let spent = 0;
let maxCaseCost = 0;
let haltReason: string | null = null;
const rows = await mapLimit(jobs, CONCURRENCY, async ({ c, run }): Promise<RunRow> => {
  const reserve = CONCURRENCY * Math.max(maxCaseCost, MIN_CASE_USD);
  if (!haltReason && spent + reserve > MAX_USD) haltReason = `spend cap: $${spent.toFixed(4)} spent + $${reserve.toFixed(4)} reserved for in-flight cases would exceed $${MAX_USD}`;
  if (haltReason) {
    process.stderr.write("$");
    return { id: c.id, run, pass: false, failed: [`skipped: ${haltReason}`], route: "skipped", escalate: false, response: "", latencyMs: 0, costUsd: 0, costComplete: true, costEstimated: false, skipped: true, inputTokens: 0, outputTokens: 0 };
  }
  const { reply, trace } = await respond({ id: `${c.id}#${run}`, text: c.text }, deps, qs);
  otel?.export(trace);
  traces.push(trace);
  spent += trace.usage.costUsd;
  maxCaseCost = Math.max(maxCaseCost, trace.usage.costUsd);
  if (!trace.usage.costComplete && !haltReason) haltReason = `cost became incomplete on ${c.id}#${run}; stopping so the cap stays enforceable`;
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
    violations: ((trace.writer?.attempts ?? []) as { violations?: { code: string; severity: string }[] }[]).flatMap((a) => (a.violations ?? []).filter((v) => v.severity === "hard").map((v) => v.code)),
    routerRetries: trace.router?.retries ?? trace.routerFailure?.retries ?? 0,
    routerFallback: trace.router?.fallbackUsed ?? false,
    routerFailed: !!trace.routerFailure,
    secondOpinion: (trace.router?.secondOpinion?.length ?? 0) > 0,
    unconfirmed: trace.router?.unconfirmed ?? [],
    stages: trace.usageByStage.map((u) => ({ stage: u.stage, costUsd: u.costUsd, ...(u.estimated ? { estimated: true } : {}) })),
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
  haltReason,
  // Reliability: did stricter guards keep useful answers? (rates are over answered rows)
  reliability: (() => {
    const writerRows = answered.filter((r) => r.writerOutcome);
    const n = Math.max(1, writerRows.length);
    const ids = (rs: RunRow[]) => [...new Set(rs.map((r) => r.id))];
    const falseEscRows = rowsRun.filter((r) => !caseMeta.get(r.id)!.expect.escalate && r.escalate);
    const missedRows = rowsRun.filter((r) => caseMeta.get(r.id)!.expect.escalate && !r.escalate);
    const count = (xs: string[]) => xs.reduce<Record<string, number>>((a, x) => ((a[x] = (a[x] ?? 0) + 1), a), {});
    return {
      firstDraftAcceptRate: pct(writerRows.filter((r) => r.writerOutcome === "ok").length / n),
      repairRate: pct(writerRows.filter((r) => r.writerOutcome === "repaired").length / n),
      fallbackRate: pct(writerRows.filter((r) => r.writerOutcome === "fallback").length / n),
      falseEscalations: { runs: falseEscRows.length, cases: ids(falseEscRows) },
      missedEscalations: { runs: missedRows.length, cases: ids(missedRows) },
      routerRetries: rowsRun.reduce((a, r) => a + (r.routerRetries ?? 0), 0),
      routerFallbacks: rowsRun.filter((r) => r.routerFallback).length,
      routerFailures: rowsRun.filter((r) => r.routerFailed).length,
      secondOpinionRate: pct(rowsRun.filter((r) => r.secondOpinion).length / Math.max(1, rowsRun.length)),
      unconfirmedEscalations: rowsRun.filter((r) => (r.unconfirmed ?? []).length).length,
      guardViolations: count(rowsRun.flatMap((r) => r.violations ?? [])),
    };
  })(),
  // Complete stage costs: every call, grouped by stage (model-specific suffixes kept).
  costByStage: (() => {
    const out: Record<string, { calls: number; costUsd: number; unknownCalls: number; estimated: boolean }> = {};
    for (const st of rowsRun.flatMap((r) => r.stages ?? [])) {
      const g = (out[st.stage] ??= { calls: 0, costUsd: 0, unknownCalls: 0, estimated: false });
      g.calls++;
      if (st.costUsd === null) g.unknownCalls++;
      else g.costUsd = Number((g.costUsd + st.costUsd).toFixed(6));
      if (st.estimated) g.estimated = true;
    }
    return out;
  })(),
  wallMs: Date.now() - started,
};
const summaryOut = arg("summary-out");
if (summaryOut) writeFileSync(summaryOut, JSON.stringify(summary, null, 2));
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
    concurrency: CONCURRENCY,
    minCaseReserveUsd: MIN_CASE_USD,
    writerFailover: !!deps.writerFallback,
    node: process.version,
  };
  writeFileSync(`${dir}/config.json`, JSON.stringify(config, null, 2));
  writeFileSync(`${dir}/summary.json`, JSON.stringify(summary, null, 2));
  // Per-case results: responses are patient-facing text (card data is redacted on input and blocked on output).
  writeFileSync(`${dir}/results.jsonl`, rows.map((r) => JSON.stringify({ id: r.id, run: r.run, pass: r.pass, failed: r.failed, route: r.route, escalate: r.escalate, response: r.response, latencyMs: r.latencyMs, costUsd: r.costUsd, costComplete: r.costComplete, writerOutcome: r.writerOutcome, violations: r.violations, routerRetries: r.routerRetries, routerFallback: r.routerFallback, routerFailed: r.routerFailed, secondOpinion: r.secondOpinion, unconfirmed: r.unconfirmed, skills: r.skills, stages: r.stages, error: r.error })).join("\n") + "\n");
  console.error(`published ${dir}`);
}
await otel?.shutdown();
console.error(`saved ${file}`);
