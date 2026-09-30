/**
 * Per-stage usage and cost. Every model or classifier call is recorded with the
 * stage that made it. Costs are either provider-reported/computed from the
 * published price table, ESTIMATED (flagged), or UNKNOWN (null) — never a
 * silent zero. A trace's total is complete only if no stage is unknown.
 */
export interface StageUsage {
  stage: string;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  estimated?: boolean;
}

/** TypeSafe Jev published rate (Sep 2026): $0.042 per 1M input tokens, output free. */
export const JEV_PRICE_PER_M_INPUT = 0.042;

export function fromLlmUsage(stage: string, u: any): StageUsage {
  if (!u) return { stage, inputTokens: null, outputTokens: null, costUsd: null };
  return { stage, inputTokens: u.inputTokens ?? null, outputTokens: u.outputTokens ?? null, costUsd: typeof u.costUsd === "number" ? u.costUsd : null };
}

export function fromJevUsage(stage: string, u: any): StageUsage {
  const input = u?.input_tokens ?? u?.inputTokens;
  if (typeof input !== "number") return { stage, inputTokens: null, outputTokens: null, costUsd: null };
  return { stage, inputTokens: input, outputTokens: u?.output_tokens ?? u?.outputTokens ?? 0, costUsd: (input * JEV_PRICE_PER_M_INPUT) / 1_000_000, estimated: true };
}

/** Router usages come from either adapter type; Jev reports snake_case tokens without cost. */
export function fromRouterUsage(stage: string, u: any): StageUsage {
  if (u && typeof u.costUsd === "number") return fromLlmUsage(stage, u);
  return fromJevUsage(stage, u);
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedInputTokens: number;
  costUsd: number;
  /** False if any stage's cost is unknown (then costUsd is a lower bound). */
  costComplete: boolean;
  /** True if any stage's cost is an estimate. */
  costEstimated: boolean;
}

export function totals(stages: StageUsage[]): UsageTotals {
  return {
    inputTokens: stages.reduce((a, s) => a + (s.inputTokens ?? 0), 0),
    outputTokens: stages.reduce((a, s) => a + (s.outputTokens ?? 0), 0),
    reasoningTokens: 0,
    cachedInputTokens: 0,
    costUsd: stages.reduce((a, s) => a + (s.costUsd ?? 0), 0),
    costComplete: stages.every((s) => s.costUsd !== null),
    costEstimated: stages.some((s) => s.estimated),
  };
}
