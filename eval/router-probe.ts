/**
 * Print raw router decisions (Jev and the LLM classifier side by side) for messages.
 *   npx tsx eval/router-probe.ts "message one" "message two"
 */
import { buildDeps, DEFAULT_OPTIONS, loadEnv } from "../src/deps.js";
import { buildQuestions, routerState } from "../src/decision/questions.js";
import { SystemOneAdapter } from "../src/decision/systemone.js";
import { LlmDecisionAdapter } from "../src/decision/llm.js";
import { createClient } from "../src/llm/client.js";
import { getModel } from "../src/models/registry.js";
import { choiceP } from "../src/decision/adapter.js";
import type { Decision } from "../src/contracts.js";

loadEnv();
const deps = buildDeps({ ...DEFAULT_OPTIONS, outputBattery: false });
const qs = buildQuestions(deps.domain, deps.ctx);
const adapters = [
  new SystemOneAdapter("jev", "https://api.typesafe.ai", process.env.TYPESAFE_API_KEY),
  new LlmDecisionAdapter(createClient(getModel(process.env.CLASSIFIER_MODEL ?? "deepseek"))),
];
const show = (d: Decision) =>
  `human=${d.needsHuman.toFixed(2)} action=${d.unsupportedAction.choice}:${choiceP(d.unsupportedAction).toFixed(2)} pay=${d.paymentMode.choice}:${choiceP(d.paymentMode).toFixed(2)} inj=${d.promptInjection.toFixed(2)} med=${d.medicalUrgent.toFixed(2)} skills=${Object.entries(d.skills)
    .filter(([, p]) => p >= 0.5)
    .map(([k, p]) => `${k}:${p.toFixed(2)}`)
    .join(",")}`;
for (const text of process.argv.slice(2)) {
  console.log(`\n# ${text}`);
  for (const a of adapters) {
    try {
      console.log(`  ${a.name.padEnd(14)} ${show(await a.decide({ text, state: routerState(deps.ctx, text), qs }))}`);
    } catch (e) {
      console.log(`  ${a.name} ERROR ${(e as Error).message}`);
    }
  }
}
