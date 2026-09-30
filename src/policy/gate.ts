import type { Decision, Route, UnsupportedAction } from "../contracts.js";
import type { GuardResult } from "../guards/input.js";
import { choiceP } from "../decision/adapter.js";

/** Thresholds, tuned on the held-out router set and documented in the README. */
export const THRESHOLDS = {
  act: 0.6,
  uncertainLow: 0.35,
  skill: 0.6,
  policyOverride: 0.7,
};

export type EscalationCategory =
  | "medical"
  | "human"
  | Exclude<UnsupportedAction, "none">
  | "abuse"
  | "writer_unsupported"
  | "oversized_input"
  | "internal_error";

/** One short sentence per category. Rendered by code; the writer never produces a handoff. */
export const HANDOFF: Record<EscalationCategory, { response: string; reason: string }> = {
  medical: {
    response: "If this is urgent, please contact local emergency services now, and I'm bringing in a person from our team.",
    reason: "Possible medical urgency",
  },
  human: { response: "I'm bringing in a person from our team to help you.", reason: "Patient asked for a human" },
  charge_card: { response: "I can't take card payments here, so I'm bringing in a person from our team.", reason: "Asked us to charge a card" },
  move_paid_money: {
    response: "I can't move money that's already been paid, so I'm bringing in a person from our team.",
    reason: "Asked to move money already paid",
  },
  contact_clinic: { response: "I can't contact the clinic for you, so I'm bringing in a person from our team.", reason: "Asked us to contact the clinic" },
  hold_date: { response: "I can't hold dates at the clinic, so I'm bringing in a person from our team.", reason: "Asked to hold or check clinic dates" },
  change_booking: { response: "I can't change a booking myself, so I'm bringing in a person from our team.", reason: "Asked to change a booking" },
  offchannel_call: { response: "I can't set up that call myself, so I'm bringing in a person from our team.", reason: "Asked for a call outside the consultation" },
  honor_claimed_discount: {
    response: "I can't apply that discount myself, so I'm bringing in a person from our team.",
    reason: "Asked to honor a claimed discount",
  },
  other_offchannel: { response: "I can't do that myself, so I'm bringing in a person from our team.", reason: "Asked for an action outside my tools" },
  abuse: { response: "I'm bringing in a person from our team to help you.", reason: "Abusive or legal message" },
  writer_unsupported: { response: "I'm bringing in a person from our team to help with this.", reason: "Request not covered by tools or rules" },
  oversized_input: {
    response: "That message is too long for me to handle properly, so I'm bringing in a person from our team.",
    reason: "Message exceeds the input limit",
  },
  internal_error: { response: "I'm bringing in a person from our team to help with this.", reason: "Could not produce a verified reply" },
};

export interface GateResult {
  route: Route;
  category?: EscalationCategory;
  rulesFired: string[];
  clarifyQuestion?: string;
}

const MONEY_ACTIONS: UnsupportedAction[] = ["move_paid_money", "charge_card"];

/**
 * @param actionConsensus how the two adapters agreed on an unsupported action
 *   ("disagree" never escalates on its own; nothing can be executed or promised anyway,
 *   because tools are read-only and validators block off-channel promises).
 */
export function gate(d: Decision, g: GuardResult, clinicNames: string[], actionConsensus: "single" | "agree" | "disagree" | "confirmation_unavailable" = "single"): GateResult {
  const fired: string[] = [];
  const t = THRESHOLDS;

  if (d.medicalUrgent >= t.act || d.selfHarm >= t.act) {
    fired.push("gate.safety-first");
    return { route: "handoff", category: "medical", rulesFired: fired };
  }
  if (g.humanFastPath) {
    fired.push("gate.human-fast-path");
    return { route: "handoff", category: "human", rulesFired: fired };
  }
  if (d.needsHuman >= t.act) {
    fired.push("gate.human-request");
    return { route: "handoff", category: "human", rulesFired: fired };
  }

  const action = d.unsupportedAction.choice;
  const actionP = choiceP(d.unsupportedAction);
  const policyQ = d.paymentMode.choice === "policy_question" && choiceP(d.paymentMode) >= t.policyOverride;
  if (action !== "none" && actionP >= t.act) {
    if (actionConsensus === "disagree") {
      fired.push("gate.action-disagreement-no-escalation");
    } else if (MONEY_ACTIONS.includes(action) && policyQ && actionP < 0.85) {
      fired.push("gate.policy-question-not-execution");
    } else {
      fired.push(`gate.unsupported.${action}`);
      return { route: "handoff", category: action as EscalationCategory, rulesFired: fired };
    }
  }
  if (g.cardDataPresent && d.paymentMode.choice === "execution_request") {
    fired.push("gate.card-data-with-execution");
    return { route: "handoff", category: "charge_card", rulesFired: fired };
  }
  if (d.abuseOrLegal >= t.act) {
    fired.push("gate.abuse-or-legal");
    return { route: "handoff", category: "abuse", rulesFired: fired };
  }
  if (d.clinicMentioned.choice === "ambiguous" && choiceP(d.clinicMentioned) >= t.act && d.clinicLean.choice === "none") {
    fired.push("gate.clarify-ambiguous-clinic");
    const names = clinicNames.join(" or ");
    return { route: "clarify", rulesFired: fired, clarifyQuestion: `Which clinic do you mean, ${names}?` };
  }
  fired.push("gate.answer");
  return { route: "answer", rulesFired: fired };
}
