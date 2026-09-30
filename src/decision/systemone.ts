import type { Decision } from "../contracts.js";
import { AdapterError, checkAnswers, toDecision, type DecisionAdapter, type DecisionInput, type RawAnswers } from "./adapter.js";

/**
 * TypeSafe "System One" API client. Works for hosted Jev (api.typesafe.ai) and
 * for self-hosted Laya (same /v1/systemone request/response schema).
 */
export class SystemOneAdapter implements DecisionAdapter {
  constructor(
    readonly name: "jev" | "laya",
    private readonly baseUrl: string,
    private readonly apiKey: string | undefined,
    private readonly model = "jev-latest",
    private readonly timeoutMs = 10_000,
  ) {}

  async decide({ state, qs }: DecisionInput): Promise<Decision> {
    const started = Date.now();
    const { answers, model, usage, attempts } = await this.ask(state, qs.questions);
    const problems = checkAnswers(answers, qs);
    if (problems.length) throw new AdapterError(`malformed answers (${problems.length}): ${problems.slice(0, 4).join("; ")}`, usage, attempts);
    return toDecision(`${this.name}:${model}`, answers, qs, Date.now() - started, { usage, attempts });
  }

  /** Raw typed questions against a state (also used for the output battery). */
  async ask(state: unknown, questions: Record<string, unknown>): Promise<{ answers: RawAnswers; model: string; usage: unknown; attempts: number }> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`${this.baseUrl}/v1/systemone`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
          },
          body: JSON.stringify({ model: this.model, state, questions }),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        const body = await res.text();
        if (!res.ok) {
          lastErr = new Error(`${this.name} ${res.status}: ${body.slice(0, 300)}`);
          if (res.status < 500 && res.status !== 429) break;
          await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
          continue;
        }
        const data = JSON.parse(body);
        const answers: RawAnswers = {};
        for (const [k, a] of Object.entries<any>(data.answers ?? {})) {
          if (a.type === "noul") answers[k] = { p: a.noul ?? a.probability };
          else if (a.type === "boolean") answers[k] = { p: a.probability };
          else answers[k] = { choice: a.choice, probabilities: a.probabilities };
        }
        return { answers, model: data.model ?? this.model, usage: data.usage, attempts: attempt + 1 };
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      }
    }
    const err = lastErr instanceof Error ? lastErr : new Error(String(lastErr));
    (err as Error & { attempts?: number }).attempts = 3;
    throw err;
  }
}
