import type { ChoiceAnswer, Decision } from "../contracts.js";
import type { DecisionAdapter, DecisionInput } from "./adapter.js";
import { THRESHOLDS } from "../policy/gate.js";

/** Escalation signals merged conservatively (max) whenever a second adapter answered. */
export const TERMINAL_SIGNALS = ["needsHuman", "medicalUrgent", "selfHarm", "abuseOrLegal"] as const;
type Terminal = (typeof TERMINAL_SIGNALS)[number];

export type ActionConsensus = "single" | "agree" | "disagree" | "confirmation_unavailable";

export interface RouterResult {
  decision: Decision;
  primary: string;
  fallbackUsed: boolean;
  /** Why the second adapter was called (empty if it was not). */
  secondOpinion: string[];
  /** For each terminal signal: both scores and the merged value (a max score, not a calibrated probability). */
  merged: Partial<Record<Terminal, { primary: number; secondary: number; merged: number }>>;
  actionConsensus: ActionConsensus;
  second?: Decision;
  usages: { stage: string; usage: unknown }[];
  errors: string[];
}

const pOf = (c: ChoiceAnswer) => c.probabilities[c.choice] ?? 0;

/** Signals whose value deserves a second opinion. */
export function secondOpinionReasons(d: Decision): string[] {
  const band = (p: number) => p >= THRESHOLDS.uncertainLow && p < THRESHOLDS.act;
  const out: string[] = [];
  for (const k of TERMINAL_SIGNALS) if (band(d[k])) out.push(`uncertain:${k}`);
  const a = d.unsupportedAction;
  if (a.choice !== "none" && pOf(a) >= THRESHOLDS.uncertainLow) out.push(pOf(a) >= THRESHOLDS.act ? "confirm:unsupportedAction" : "uncertain:unsupportedAction");
  return out;
}

/**
 * The primary adapter answers everything in one call. A second adapter is consulted
 * for uncertain terminal signals and to confirm any unsupported-action signal.
 * Merge rules (explicit, recorded in the trace):
 *  - terminal signals (human, medical, self-harm, abuse): max of both adapters, whenever the second ran;
 *  - unsupported action: both flag an action -> "agree"; second says none -> "disagree";
 *    second unavailable -> "confirmation_unavailable" (the gate escalates conservatively).
 */
export class Router {
  constructor(
    private readonly primary: DecisionAdapter,
    private readonly secondary?: DecisionAdapter,
  ) {}

  get name() {
    return this.primary.name + (this.secondary ? ` (+${this.secondary.name})` : "");
  }

  async decide(input: DecisionInput): Promise<RouterResult> {
    const errors: string[] = [];
    const usages: RouterResult["usages"] = [];
    let decision: Decision;
    try {
      decision = await this.primary.decide(input);
      usages.push({ stage: `router:${this.primary.name}`, usage: (decision.raw as any)?.usage });
    } catch (e) {
      errors.push(`${this.primary.name}: ${(e as Error).message}`);
      usages.push({ stage: `router:${this.primary.name}:failed-call`, usage: undefined });
      if (!this.secondary) throw e;
      decision = await this.secondary.decide(input);
      usages.push({ stage: `router:${this.secondary.name}`, usage: (decision.raw as any)?.usage });
      return base(decision, this.primary.name, true, errors, usages, "single");
    }
    const reasons = secondOpinionReasons(decision);
    const actionFlagged = decision.unsupportedAction.choice !== "none" && pOf(decision.unsupportedAction) >= THRESHOLDS.uncertainLow;
    if (!reasons.length) return base(decision, this.primary.name, false, errors, usages, "single");
    if (!this.secondary) {
      return base(decision, this.primary.name, false, errors, usages, actionFlagged ? "confirmation_unavailable" : "single", reasons);
    }
    let second: Decision;
    try {
      second = await this.secondary.decide(input);
      usages.push({ stage: `router:${this.secondary.name}`, usage: (second.raw as any)?.usage });
    } catch (e) {
      errors.push(`${this.secondary.name}: ${(e as Error).message}`);
      usages.push({ stage: `router:${this.secondary.name}:failed-call`, usage: undefined });
      return base(decision, this.primary.name, false, errors, usages, actionFlagged ? "confirmation_unavailable" : "single", reasons);
    }
    const out: Decision = { ...decision };
    const merged: RouterResult["merged"] = {};
    for (const k of TERMINAL_SIGNALS) {
      out[k] = Math.max(decision[k], second[k]);
      merged[k] = { primary: decision[k], secondary: second[k], merged: out[k] };
    }
    let actionConsensus: ActionConsensus = "single";
    if (actionFlagged) {
      const b = second.unsupportedAction;
      actionConsensus = b.choice !== "none" && pOf(b) >= THRESHOLDS.uncertainLow ? "agree" : "disagree";
      if (actionConsensus === "agree") {
        // Keep the primary's category; the score is the max of the two (not a probability).
        out.unsupportedAction = {
          choice: decision.unsupportedAction.choice,
          probabilities: { ...decision.unsupportedAction.probabilities, [decision.unsupportedAction.choice]: Math.max(pOf(decision.unsupportedAction), pOf(b)) },
        };
      }
    }
    return { decision: out, primary: this.primary.name, fallbackUsed: false, secondOpinion: reasons, merged, actionConsensus, second, usages, errors };
  }
}

function base(
  decision: Decision,
  primary: string,
  fallbackUsed: boolean,
  errors: string[],
  usages: RouterResult["usages"],
  actionConsensus: ActionConsensus,
  secondOpinion: string[] = [],
): RouterResult {
  return { decision, primary, fallbackUsed, secondOpinion, merged: {}, actionConsensus, usages, errors };
}

/** Merge per-chunk decisions for long messages: terminal signals and skills by max, choices by highest-confidence non-default. */
export function mergeChunks(results: RouterResult[]): RouterResult {
  if (results.length === 1) return results[0];
  const ds = results.map((r) => r.decision);
  const first: Decision = { ...ds[0], skills: { ...ds[0].skills } };
  for (const k of [...TERMINAL_SIGNALS, "promptInjection", "pausing", "highEngagement"] as const) first[k] = Math.max(...ds.map((d) => d[k]));
  for (const skill of Object.keys(first.skills)) first.skills[skill] = Math.max(...ds.map((d) => d.skills[skill] ?? 0));
  const pick = <K extends "unsupportedAction" | "paymentMode" | "clinicMentioned" | "clinicLean" | "packageLean">(key: K): Decision[K] => {
    const cands = ds.map((d) => d[key]).filter((c) => c.choice !== "none");
    return (cands.length ? [...cands].sort((a, b) => pOf(b) - pOf(a))[0] : ds[0][key]) as Decision[K];
  };
  first.unsupportedAction = pick("unsupportedAction");
  first.paymentMode = pick("paymentMode");
  first.clinicMentioned = pick("clinicMentioned");
  first.clinicLean = pick("clinicLean");
  first.packageLean = pick("packageLean");
  const flagged = results.find((r) => r.decision.unsupportedAction === first.unsupportedAction);
  return {
    decision: first,
    primary: results[0].primary,
    fallbackUsed: results.some((r) => r.fallbackUsed),
    secondOpinion: [...new Set(results.flatMap((r) => r.secondOpinion))],
    merged: results.reduce((a, r) => ({ ...a, ...r.merged }), {}),
    actionConsensus: flagged?.actionConsensus ?? "single",
    usages: results.flatMap((r) => r.usages),
    errors: results.flatMap((r) => r.errors),
  };
}
