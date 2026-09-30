/**
 * Regenerate the README results table from committed benchmark artifacts
 * (benchmarks/<run>/{config,summary}.json). No hand-typed numbers.
 *   npm run bench:table            # prints the table
 *   npm run bench:table -- --write # replaces the block between the README markers
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dirs = existsSync("benchmarks") ? readdirSync("benchmarks").filter((d) => existsSync(join("benchmarks", d, "summary.json"))).sort() : [];
const usd = (n: number | undefined) => (n === undefined ? "–" : `$${n.toFixed(5)}`);
const ms = (n: number | undefined) => (n === undefined ? "–" : `${(n / 1000).toFixed(1)} s`);
const lines = [
  "| Run | Set | Writer | Router | Runs | Pass | pass^k | Esc. recall / precision | Latency p50 / p95 | Cost per input | Cost per successful answer | Cost complete |",
  "|---|---|---|---|---|---|---|---|---|---|---|---|",
];
for (const d of dirs) {
  const c = JSON.parse(readFileSync(join("benchmarks", d, "config.json"), "utf8"));
  const s = JSON.parse(readFileSync(join("benchmarks", d, "summary.json"), "utf8"));
  lines.push(
    `| \`${d}\` | ${c.set} | ${c.writer?.model ?? s.writer} | ${c.router} | ${s.runs} | ${s.passRate} | ${s.passK} | ${s.escalationRecall} / ${s.escalationPrecision} | ${ms(s.latencyP50ms)} / ${ms(s.latencyP95ms)} | ${usd(s.costPerInputUsd)} | ${usd(s.costPerSuccessfulAnswerUsd)} | ${s.rowsWithUnknownCost ? `no (${s.rowsWithUnknownCost} unknown)` : "yes"}${s.costIncludesEstimates ? " (Jev estimated)" : ""} |`,
  );
}
const table = dirs.length ? lines.join("\n") : "_No published benchmarks yet. Run `npx tsx eval/run.ts ... --publish`._";
if (process.argv.includes("--write")) {
  const readme = readFileSync("README.md", "utf8");
  const start = "<!-- bench:start -->";
  const end = "<!-- bench:end -->";
  if (!readme.includes(start)) throw new Error("README markers not found");
  writeFileSync("README.md", readme.replace(new RegExp(`${start}[\\s\\S]*?${end}`), `${start}\n${table}\n${end}`));
  console.error(`README updated from ${dirs.length} benchmark runs`);
} else console.log(table);
