import type { Decision } from "../contracts.js";
import { addUsage, extractJson, type LlmClient, type Usage } from "../llm/client.js";
import { AdapterError, checkAnswers, toDecision, type DecisionAdapter, type DecisionInput, type RawAnswers } from "./adapter.js";

/**
 * The same typed questions answered by a language model with JSON output.
 * Used as the default router when no Jev key is configured, and as the
 * second opinion for answers in the uncertain band.
 */
export class LlmDecisionAdapter implements DecisionAdapter {
  readonly name: string;
  constructor(private readonly client: LlmClient) {
    this.name = `llm:${client.profile.key}`;
  }

  async decide({ state, qs }: DecisionInput): Promise<Decision> {
    const started = Date.now();
    const lines: string[] = [];
    for (const [key, q] of Object.entries(qs.questions)) {
      if (q.type === "noul") {
        lines.push(`- ${key} (probability 0..1): ${q.instructions}${q.criteria ? ` TRUE if: ${q.criteria.true} FALSE if: ${q.criteria.false}` : ""}`);
      } else {
        const opts = Object.entries(q.criteria).map(([k, v]) => `"${k}" = ${v}`).join("; ");
        lines.push(`- ${key} (choose one option key): ${q.instructions} Options: ${opts}`);
      }
    }
    const system = [
      "You classify one incoming patient SMS for a medical-tourism coordinator. Answer every question independently about the INCOMING message (use the recent conversation only to resolve references).",
      "Return json only, shaped exactly like:",
      '{"answers": {"<noul question>": {"p": 0.0}, "<choice question>": {"choice": "<option key>", "confidence": 0.0}}}',
      "Questions:",
      ...lines,
    ].join("\n");
    // One retry on malformed output; both calls' usage is kept (sum), never dropped.
    let usage: Usage | undefined;
    let lastProblem = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.client.chat({
        system,
        messages: [{ role: "user", content: `STATE (json):\n${JSON.stringify(state, null, 2)}` }],
        json: { name: "decision", schema: decisionSchema(qs.questions) },
        reasoning: "off",
        maxTokens: 2000,
        timeoutMs: 45_000,
      });
      usage = usage ? addUsage(usage, res.usage) : res.usage;
      const parsed = extractJson(res.text)?.answers;
      if (!parsed || typeof parsed !== "object") {
        lastProblem = "response was not the answers json";
        continue;
      }
      // No coercion or defaults: a missing or malformed answer is an error (the router then
      // falls back to the other adapter or hands off), never a silent "no".
      const answers: RawAnswers = {};
      for (const [k, q] of Object.entries(qs.questions)) {
        const a = parsed[k];
        if (!a || typeof a !== "object") continue;
        if (q.type === "noul") answers[k] = { p: a.p ?? a.probability };
        else answers[k] = { choice: a.choice, probabilities: { [String(a.choice)]: a.confidence } };
      }
      const problems = checkAnswers(answers, qs);
      if (!problems.length) return toDecision(this.name, answers, qs, Date.now() - started, { usage, attempts: attempt + 1 });
      lastProblem = `malformed answers (${problems.length}): ${problems.slice(0, 4).join("; ")}`;
    }
    throw new AdapterError(lastProblem, usage, 2);
  }
}

function decisionSchema(questions: Record<string, any>): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const [k, q] of Object.entries(questions)) {
    props[k] =
      q.type === "noul"
        ? { type: "object", additionalProperties: false, required: ["p"], properties: { p: { type: "number" } } }
        : {
            type: "object",
            additionalProperties: false,
            required: ["choice", "confidence"],
            properties: { choice: { type: "string", enum: Object.keys(q.criteria) }, confidence: { type: "number" } },
          };
  }
  return {
    type: "object",
    additionalProperties: false,
    required: ["answers"],
    properties: { answers: { type: "object", additionalProperties: false, required: Object.keys(props), properties: props } },
  };
}
