import type { ChoiceAnswer, Decision, PaymentMode, UnsupportedAction } from "../contracts.js";
import type { QuestionSet } from "./questions.js";

export interface DecisionInput {
  text: string;
  state: Record<string, unknown>;
  qs: QuestionSet;
}

export interface DecisionAdapter {
  name: string;
  decide(input: DecisionInput): Promise<Decision>;
}

/** Answers normalised to { noul probability } or { choice + probabilities }. */
export type RawAnswers = Record<string, { p?: number; choice?: string; probabilities?: Record<string, number> }>;

const choice = <T extends string>(a: RawAnswers[string] | undefined, fallback: T, map?: Record<string, string>): ChoiceAnswer<T> => {
  const raw = a?.choice ?? fallback;
  const mapped = (map?.[raw] ?? raw) as T;
  const probabilities: Record<string, number> = {};
  for (const [k, v] of Object.entries(a?.probabilities ?? { [raw]: 1 })) probabilities[map?.[k] ?? k] = v;
  return { choice: mapped, probabilities };
};

export function toDecision(adapter: string, answers: RawAnswers, qs: QuestionSet, latencyMs: number, raw?: unknown): Decision {
  const p = (k: string) => clamp01(answers[k]?.p ?? 0);
  const skills: Record<string, number> = {};
  for (const key of Object.keys(qs.questions)) {
    if (key.startsWith("skill_")) skills[key.slice(6).replace(/_/g, "-")] = p(key);
  }
  return {
    adapter,
    needsHuman: p("needs_human"),
    medicalUrgent: p("medical_urgent"),
    selfHarm: p("self_harm"),
    abuseOrLegal: p("abuse_or_legal"),
    promptInjection: p("prompt_injection"),
    pausing: p("pausing"),
    highEngagement: p("high_engagement"),
    unsupportedAction: choice<UnsupportedAction>(answers.unsupported_action, "none"),
    paymentMode: choice<PaymentMode>(answers.payment_mode, "none"),
    clinicMentioned: choice(answers.clinic_mentioned, "none", qs.optionIds),
    clinicLean: choice(answers.clinic_lean, "none", qs.optionIds),
    packageLean: choice(answers.package_lean, "none", qs.optionIds),
    communicationStyle: choice(answers.communication_style, "unknown"),
    targetWindow: choice(answers.target_window, "unknown"),
    skills,
    latencyMs,
    raw,
  };
}

/** An adapter call that returned no usable decision. Carries the call's usage when it was billed. */
export class AdapterError extends Error {
  constructor(message: string, readonly usage?: unknown, readonly attempts = 1) {
    super(message);
    this.name = "AdapterError";
  }
}

const isProb = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x >= -1e-6 && x <= 1 + 1e-6;

/**
 * Runtime check of a complete answer set. Every question must be answered: a missing or
 * invalid safety field is an error, never a negative answer. Returns the problems found.
 */
export function checkAnswers(answers: RawAnswers, qs: QuestionSet): string[] {
  const problems: string[] = [];
  for (const [k, q] of Object.entries(qs.questions)) {
    const a = answers[k];
    if (!a) problems.push(`${k}: missing`);
    else if (q.type === "noul") {
      if (!isProb(a.p)) problems.push(`${k}: probability ${JSON.stringify(a.p)} is not a number in [0, 1]`);
    } else {
      if (typeof a.choice !== "string" || !(a.choice in q.criteria)) problems.push(`${k}: choice ${JSON.stringify(a.choice)} is not an option`);
      else if (!Object.values(a.probabilities ?? {}).every(isProb) || !isProb(a.probabilities?.[a.choice])) problems.push(`${k}: confidence is not a number in [0, 1]`);
    }
  }
  return problems;
}

export const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** Probability of the selected choice. */
export const choiceP = (c: ChoiceAnswer) => c.probabilities[c.choice] ?? 0;
