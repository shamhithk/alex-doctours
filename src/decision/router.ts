import type { Decision } from "../contracts.js";
import type { DecisionAdapter, DecisionInput } from "./adapter.js";
import { isUncertain, THRESHOLDS } from "../policy/gate.js";

export interface RouterResult {
  decision: Decision;
  primary: string;
  fallbackUsed: boolean;
  adjudicated: string[];
  second?: Decision;
  errors: string[];
}

/**
 * Primary adapter answers everything in one call. Escalation-critical answers
 * in the uncertain band get one second opinion from the other adapter; the
 * two probabilities are averaged. If the primary fails, the secondary answers.
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
    let decision: Decision;
    try {
      decision = await this.primary.decide(input);
    } catch (e) {
      errors.push(`${this.primary.name}: ${(e as Error).message}`);
      if (!this.secondary) throw e;
      decision = await this.secondary.decide(input);
      return { decision, primary: this.primary.name, fallbackUsed: true, adjudicated: [], errors };
    }
    const uncertain = isUncertain(decision);
    // Confirmation: an escalation driven by unsupported_action needs the second adapter to agree.
    const a0 = decision.unsupportedAction;
    const confirmAction = a0.choice !== "none" && (a0.probabilities[a0.choice] ?? 0) >= THRESHOLDS.act;
    if (confirmAction) uncertain.push("unsupported_action");
    if (!uncertain.length || !this.secondary) {
      return { decision, primary: this.primary.name, fallbackUsed: false, adjudicated: [], errors };
    }
    let second: Decision | undefined;
    try {
      second = await this.secondary.decide(input);
    } catch (e) {
      errors.push(`${this.secondary.name}: ${(e as Error).message}`);
      return { decision, primary: this.primary.name, fallbackUsed: false, adjudicated: [], errors };
    }
    const merged: Decision = { ...decision };
    for (const field of uncertain) {
      if (field === "needs_human") merged.needsHuman = (decision.needsHuman + second.needsHuman) / 2;
      if (field === "medical_urgent") merged.medicalUrgent = (decision.medicalUrgent + second.medicalUrgent) / 2;
      if (field === "unsupported_action") {
        const a = decision.unsupportedAction;
        const b = second.unsupportedAction;
        const pa = a.probabilities[a.choice] ?? 0;
        // Probability the second adapter assigns to "some unsupported action" (any category).
        // Agreement rule: if the second adapter says "none", it vetoes an action-driven escalation.
        const pb = b.choice === "none" ? 0 : (b.probabilities[b.choice] ?? 0);
        merged.unsupportedAction = { choice: a.choice, probabilities: { ...a.probabilities, [a.choice]: (pa + pb) / 2 } };
      }
    }
    return { decision: merged, primary: this.primary.name, fallbackUsed: false, adjudicated: uncertain, second, errors };
  }
}
