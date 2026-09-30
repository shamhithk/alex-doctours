/**
 * Regenerate the README results tables from committed benchmark artifacts
 * (benchmarks/<run>/{config,summary}.json). No hand-typed numbers.
 *   npm run bench:table            # prints the tables
 *   npm run bench:table -- --write # replaces the block between the README markers
 *
 * benchmarks/superseded.json maps a run-name prefix to the reason it no longer describes
 * the current code; those runs are listed separately and labelled.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const read = (d: string, f: string) => JSON.parse(readFileSync(join("benchmarks", d, f), "utf8"));
const dirs = existsSync("benchmarks") ? readdirSync("benchmarks").filter((d) => existsSync(join("benchmarks", d, "summary.json"))).sort() : [];
const superseded: Record<string, string> = existsSync("benchmarks/superseded.json") ? JSON.parse(readFileSync("benchmarks/superseded.json", "utf8")) : {};
const supersededReason = (d: string) => Object.entries(superseded).find(([prefix]) => d.startsWith(prefix))?.[1];

const usd = (n: number | undefined | null) => (n === undefined || n === null ? "–" : `$${n.toFixed(5)}`);
const ms = (n: number | undefined) => (n === undefined ? "–" : `${(n / 1000).toFixed(1)} s`);
/** Earlier frozen sets under their names at the time; both are regression data now. */
const setLabel = (set: string) => (set === "holdout" ? "holdout-v1 (then frozen)" : set === "holdout-v2" ? "holdout-v2 (then frozen)" : set);

const runs = dirs.map((d) => ({ d, c: read(d, "config.json"), s: read(d, "summary.json") }));
const pipeline = runs.filter((r) => r.c.variant !== "monolith-baseline");
const baselines = runs.filter((r) => r.c.variant === "monolith-baseline");
const current = pipeline.filter((r) => !supersededReason(r.d));
const old = pipeline.filter((r) => supersededReason(r.d));

function resultsTable(rs: typeof runs): string[] {
  const lines = [
    "| Run | Set | Writer | Router | Runs | Pass | pass^k | Esc. recall / precision | Latency p50 / p95 | Cost per input | Cost per successful answer | Cost complete |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const { d, c, s } of rs) {
    lines.push(
      `| \`${d}\` | ${setLabel(c.set)} | ${c.writer?.model ?? s.writer} | ${c.router} | ${s.runs} | ${s.passRate} | ${s.passK} | ${s.escalationRecall} / ${s.escalationPrecision} | ${ms(s.latencyP50ms)} / ${ms(s.latencyP95ms)} | ${usd(s.costPerInputUsd)} | ${usd(s.costPerSuccessfulAnswerUsd)} | ${s.rowsWithUnknownCost ? `no (${s.rowsWithUnknownCost} unknown)` : "yes"}${s.costIncludesEstimates ? " (Jev estimated)" : ""}${s.haltReason ? `; halted: ${s.haltReason}` : ""} |`,
    );
  }
  return lines;
}

function reliabilityTable(rs: typeof runs): string[] {
  const withRel = rs.filter((r) => r.s.reliability);
  if (!withRel.length) return [];
  const lines = [
    "| Run | First draft accepted | Repaired | Fallback | False escalations (runs · cases) | Missed escalations | Router retries · fallbacks · failures | Second opinion | Guards fired (hard, all attempts) |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  for (const { d, s } of withRel) {
    const r = s.reliability;
    const guards = Object.entries(r.guardViolations as Record<string, number>).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ") || "none";
    const fe = r.falseEscalations.runs ? `${r.falseEscalations.runs} · ${r.falseEscalations.cases.join(", ")}` : "0";
    const me = r.missedEscalations.runs ? `${r.missedEscalations.runs} · ${r.missedEscalations.cases.join(", ")}` : "0";
    lines.push(`| \`${d}\` | ${r.firstDraftAcceptRate} | ${r.repairRate} | ${r.fallbackRate} | ${fe} | ${me} | ${r.routerRetries} · ${r.routerFallbacks} · ${r.routerFailures} | ${r.secondOpinionRate} | ${guards} |`);
  }
  return lines;
}

/** Stage names look like router:jev:jev-1.13.0, router:llm:deepseek:failed-call, writer:deepseek:draft, output-battery. */
function stageGroup(stage: string): string {
  if (stage.startsWith("router:")) return stage.includes(":llm:") ? "router (LLM)" : "router (Jev)";
  if (stage.startsWith("writer:")) {
    const phase = stage.split(":").at(-1)!;
    return phase === "failed-call" ? "writer (failed call)" : `writer ${phase}`;
  }
  if (stage.startsWith("output-battery")) return "output battery (Jev)";
  return stage;
}

function stageCostTable(rs: typeof runs): string[] {
  const withStages = rs.filter((r) => r.s.costByStage);
  if (!withStages.length) return [];
  const groups = new Set<string>();
  const perRun = withStages.map(({ d, s }) => {
    const g: Record<string, { cost: number; calls: number; unknown: number }> = {};
    for (const [stage, v] of Object.entries(s.costByStage as Record<string, { calls: number; costUsd: number; unknownCalls: number }>)) {
      const k = stageGroup(stage);
      groups.add(k);
      const x = (g[k] ??= { cost: 0, calls: 0, unknown: 0 });
      x.cost += v.costUsd;
      x.calls += v.calls;
      x.unknown += v.unknownCalls;
    }
    return { d, runs: s.runs as number, g };
  });
  const cols = [...groups].sort();
  const lines = [`| Run | ${cols.join(" | ")} |`, `|---|${cols.map(() => "---").join("|")}|`];
  for (const { d, runs: n, g } of perRun) {
    const cell = (k: string) => (g[k] ? `${usd(g[k].cost / Math.max(1, n))} (${g[k].calls} calls${g[k].unknown ? `, ${g[k].unknown} unknown` : ""})` : "–");
    lines.push(`| \`${d}\` | ${cols.map(cell).join(" | ")} |`);
  }
  return lines;
}

function baselineTable(rs: typeof runs): string[] {
  if (!rs.length) return [];
  const lines = ["| Run | Set | Writer | Cases | Pass | Esc. recall / precision | Invalid replies | Input tokens p50 | Latency p50 | Total cost |", "|---|---|---|---|---|---|---|---|---|---|"];
  for (const { d, c, s } of rs) {
    lines.push(`| \`${d}\` | ${setLabel(c.set)} | ${c.writer?.model ?? s.writer} | ${s.cases} | ${s.passRate} | ${s.escalationRecall} / ${s.escalationPrecision} | ${s.invalidReplies} | ${s.inputTokensP50} | ${ms(s.latencyP50ms)} | $${Number(s.costTotalUsd).toFixed(4)} |`);
  }
  return lines;
}

const out: string[] = [];
if (current.length) {
  out.push("**Results** (cost per input and per successful answer include every stage):", "", ...resultsTable(current));
  const rel = reliabilityTable(current);
  if (rel.length) out.push("", "**Reliability** (rates over answered runs; guards fired counts hard violations across draft and repair attempts):", "", ...rel);
  const st = stageCostTable(current);
  if (st.length) out.push("", "**Cost by stage** (average per input; calls counted across all runs):", "", ...st);
} else out.push("_No current measurements yet: the runs below predate the latest fixes._");
if (baselines.length) out.push("", "**Original monolithic prompt, same scorer:**", "", ...baselineTable(baselines));
// Superseded runs, newest first, one table per reason.
for (const reason of [...new Set(old.map((r) => supersededReason(r.d)))].reverse()) {
  out.push("", `**Superseded runs** (${reason}):`, "", ...resultsTable(old.filter((r) => supersededReason(r.d) === reason)));
}
const block = dirs.length ? out.join("\n") : "_No published benchmarks yet. Run `npx tsx eval/run.ts ... --publish`._";

if (process.argv.includes("--write")) {
  const readme = readFileSync("README.md", "utf8");
  const start = "<!-- bench:start -->";
  const end = "<!-- bench:end -->";
  if (!readme.includes(start)) throw new Error("README markers not found");
  writeFileSync("README.md", readme.replace(new RegExp(`${start}[\\s\\S]*?${end}`), `${start}\n${block}\n${end}`));
  console.error(`README updated from ${dirs.length} benchmark runs`);
} else console.log(block);
