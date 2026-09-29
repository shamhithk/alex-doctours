import type { Decision } from "../contracts.js";
import { extractJson, type LlmClient } from "../llm/client.js";
import { toDecision, type DecisionAdapter, type DecisionInput, type RawAnswers } from "./adapter.js";

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
    const res = await this.client.chat({
      system,
      messages: [{ role: "user", content: `STATE (json):\n${JSON.stringify(state, null, 2)}` }],
      json: { name: "decision", schema: decisionSchema(qs.questions) },
      reasoning: "off",
      maxTokens: 2000,
      timeoutMs: 45_000,
    });
    const parsed = extractJson(res.text)?.answers ?? {};
    const answers: RawAnswers = {};
    for (const [k, q] of Object.entries(qs.questions)) {
      const a = parsed[k] ?? {};
      if (q.type === "noul") answers[k] = { p: Number(a.p ?? a.probability ?? 0) };
      else {
        const ch = String(a.choice ?? "");
        const valid = ch in q.criteria ? ch : q.type === "choice" && "none" in q.criteria ? "none" : Object.keys(q.criteria)[0];
        const conf = Number(a.confidence ?? 0.5);
        answers[k] = { choice: valid, probabilities: { [valid]: conf } };
      }
    }
    return toDecision(this.name, answers, qs, Date.now() - started, { usage: res.usage });
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
