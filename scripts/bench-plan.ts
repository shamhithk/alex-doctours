/**
 * Run the benchmark plan under one overall budget, in priority order.
 *   npx tsx scripts/bench-plan.ts --budget 2.50 --headroom 0.30 [--dry-run]
 *
 * Conservative by construction:
 *  - each run's --max-usd is min(its own cap, budget - headroom - spent so far);
 *  - a run is skipped if less than half its cap would remain;
 *  - runs use low concurrency, and eval/run.ts reserves spend for in-flight cases;
 *  - the whole plan stops if any run reports incomplete cost or halts early,
 *    because reported spend can no longer bound actual spend.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const BUDGET = Number(arg("budget", "2.50"));
const HEADROOM = Number(arg("headroom", "0.30"));
const dry = process.argv.includes("--dry-run");

interface Step {
  name: string;
  script: "eval/run.ts" | "eval/baseline.ts";
  args: string[];
  cap: number;
}
const common = ["--failover", "0", "--publish", "--concurrency", "2"];
const PLAN: Step[] = [
  { name: "deepseek · holdout-v2 · k3", script: "eval/run.ts", args: ["--writer", "deepseek", "--set", "holdout-v2", "--k", "3", ...common], cap: 0.2 },
  { name: "gemini · holdout-v2 · k3", script: "eval/run.ts", args: ["--writer", "gemini", "--set", "holdout-v2", "--k", "3", ...common], cap: 0.75 },
  { name: "deepseek · packet+dev · k3", script: "eval/run.ts", args: ["--writer", "deepseek", "--set", "all", "--k", "3", ...common], cap: 0.2 },
  { name: "deepseek · regression-v1 · k3", script: "eval/run.ts", args: ["--writer", "deepseek", "--set", "regression-v1", "--k", "3", ...common], cap: 0.2 },
  { name: "deepseek · holdout-v2 · jev-only · k1", script: "eval/run.ts", args: ["--writer", "deepseek", "--set", "holdout-v2", "--k", "1", "--router", "jev-only", ...common], cap: 0.06 },
  { name: "deepseek · holdout-v2 · llm-only · k1", script: "eval/run.ts", args: ["--writer", "deepseek", "--set", "holdout-v2", "--k", "1", "--router", "llm-only", ...common], cap: 0.1 },
  { name: "monolith baseline · deepseek · holdout-v2", script: "eval/baseline.ts", args: ["--writer", "deepseek", "--set", "holdout-v2", "--concurrency", "2", "--publish"], cap: 0.2 },
  { name: "gemini · packet+dev · k1", script: "eval/run.ts", args: ["--writer", "gemini", "--set", "all", "--k", "1", ...common], cap: 0.25 },
  { name: "gemini · regression-v1 · k1", script: "eval/run.ts", args: ["--writer", "gemini", "--set", "regression-v1", "--k", "1", ...common], cap: 0.25 },
];

mkdirSync("eval/results", { recursive: true });
let spent = 0;
const log: string[] = [];
for (const [i, step] of PLAN.entries()) {
  const available = BUDGET - HEADROOM - spent;
  const cap = Math.min(step.cap, available);
  if (cap < step.cap / 2) {
    log.push(`SKIP  ${step.name}: only $${available.toFixed(3)} left under the budget`);
    continue;
  }
  const out = `eval/results/plan-step-${i + 1}.summary.json`;
  const args = [step.script, ...step.args, "--max-usd", cap.toFixed(3), "--summary-out", out];
  console.error(`\n===== [${i + 1}/${PLAN.length}] ${step.name} (cap $${cap.toFixed(3)}, spent so far $${spent.toFixed(4)}) =====`);
  if (dry) {
    log.push(`DRY   npx tsx ${args.join(" ")}`);
    continue;
  }
  try {
    execFileSync("npx", ["tsx", ...args], { stdio: ["ignore", "inherit", "inherit"] });
  } catch (e) {
    log.push(`STOP  ${step.name}: the run failed (${(e as Error).message.slice(0, 120)})`);
    break;
  }
  const s = JSON.parse(readFileSync(out, "utf8"));
  const cost = Number(s.costTotalUsd ?? 0);
  spent += cost;
  log.push(`DONE  ${step.name}: $${cost.toFixed(4)} (total $${spent.toFixed(4)}), pass ${s.passRate}${s.haltReason ? `, halted: ${s.haltReason}` : ""}`);
  const unknown = Number(s.rowsWithUnknownCost ?? 0);
  if (unknown > 0 || s.haltReason) {
    log.push(`STOP  plan halted: ${unknown > 0 ? `${unknown} runs with incomplete cost` : s.haltReason}`);
    break;
  }
}
console.error(`\n===== plan summary (budget $${BUDGET}, headroom $${HEADROOM}) =====\n${log.join("\n")}\nreported spend: $${spent.toFixed(4)}`);
