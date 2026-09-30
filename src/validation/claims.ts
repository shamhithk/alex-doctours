/**
 * Claim guards for the writer's OWN prose (the reply with clause tokens removed).
 *
 * Clause tokens protect their own contents; these checks constrain the prose around
 * them. Numbers, inclusions and policy terms are facts, so they may only be stated by
 * code-rendered tokens ({{P2:price+deposit}}, {{P2:inclusions}}, {{R:refund}}). Claims
 * that an action was completed need a receipt: a planned write this turn, or a
 * scheduled follow-up. This is a lexicon guard, not semantic entailment: it blocks the
 * listed claim types in any wording it recognises, and the README states the gap.
 */
import { TOKEN_RE, type Violation, type WriterOutput } from "./validate.js";

const NUMBER_WORD =
  "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|dozen";
const WORD_VALUE: Record<string, number> = Object.fromEntries(NUMBER_WORD.split("|").slice(0, 20).map((w, i) => [w, i + 1]));
/** Digits anywhere, or a number word other than "one" (checked separately with a unit). */
const DIGITS = /(?<![A-Za-z])\d[\d,]*(?:\.\d+)?(?![A-Za-z\d])/g; // "4C" (hair type) is not a quantity
const NUMBER_WORDS = new RegExp(String.raw`\b(?:${NUMBER_WORD.replace("one|", "")})\b`, "gi");
// "one payment" / "a single payment" means paying in full, not a figure; payments are not units here.
const UNITS = String.raw`(?:nights?|grafts?|days?|weeks?|months?|years?|hours?|miles?|minutes?|packages?|clinics?|doctors?|surgeons?)`;
const ONE_UNIT = new RegExp(String.raw`\b(?:one|a single)\s+(?:\w+\s+)?${UNITS}\b`, "gi");
/** A follow-up interval phrase ("in 2 weeks", "after one month"). */
const INTERVAL = new RegExp(String.raw`\b(\d+|${NUMBER_WORD.split("|").slice(0, 20).join("|")})\s+(day|week|month)s?\b`, "gi");

const NEGATION = /\b(?:not|never|no|none|neither|nor|without|cannot|can't|don't|doesn't|won't|isn't|aren't|wasn't|unable)\b|n't\b/i;
const INCLUDE_VERB = /\b(?:includ(?:e|es|ed|ing)|comes?\s+with|covers?|covered|bundled|complimentary|thrown\s+in)\b/i;
const AMENITY = /\b(?:flights?|hotels?|accommodations?|lodging|transfers?|pick-?ups?|airports?|meals?|breakfast|translators?|interpreters?|drivers?|chauffeurs?|prp|medications?|meds|shampoos?|nights?|tours?|spa|visas?)\b/i;
const POLICY = /\b(?:refund\w*|guarantee\w*|money[- ]back|warrant(?:y|ies)|discount\w*|waive\w*|price[- ]lock\w*|locks?\s+(?:in\s+)?(?:the\s+|your\s+)?price|cancell?ation\s+fees?|transferable|transferred|free\s+of\s+charge|no\s+(?:extra\s+)?(?:charge|fee|cost)|at\s+no\s+(?:extra\s+)?cost|lifetime|forever)\b/i;
/** Negative policy statements are claims too ("Gold is non-refundable"). */
const NEGATIVE_POLICY = /\b(?:non-?refundable|not\s+refundable|no\s+longer\s+refundable)\b/i;
const OWN_BEFORE = /\b(?:your|my|own|buy|buying|bought|book|booking|booked|purchase|purchased|purchasing)\b/;
const OWN_AFTER = /\b(?:purchased|booked|bought)\b/;
const FREE = /\bfree\b/i;
const FREE_OK = /\b(?:feel\s+free|free\s+to|interest-free|hands-free)\b/gi;

const DONE_VERB =
  "charged|booked|scheduled|rescheduled|reserved|confirmed|refunded|cancell?ed|processed|submitted|transferred|moved|held|locked|contacted|emailed|called|messaged|forwarded|placed|paid|arranged|applied|approved|changed";
// Completion only: perfect or past passives, "now/already" states, and "your X is <done>".
// A general present-tense statement ("the balance is paid through Doctours", "the first payment is
// charged when you start") describes how things work, not something that happened.
const ACTION_DONE = [
  new RegExp(String.raw`\b(?:I|we)(?:'ve|\s+have)?\s+(?:just\s+|already\s+|now\s+|gone\s+ahead\s+and\s+)?(?:${DONE_VERB})\b`, "i"),
  new RegExp(String.raw`\b(?:has|have|had|'s|'ve)\s+(?:now\s+|already\s+|just\s+)?been\s+(?:${DONE_VERB})\b`, "i"),
  new RegExp(String.raw`\b(?:was|were)\s+(?:just\s+|already\s+)?(?:${DONE_VERB})\b`, "i"),
  new RegExp(String.raw`\b(?:is|are|it's|that's|'s)\s+(?:now|already|all)\s+(?:${DONE_VERB})\b`, "i"),
  new RegExp(String.raw`\byour\s+(?:\w+\s+){1,2}(?:is|are|'s)\s+(?:${DONE_VERB})\b`, "i"),
];
const CONDITIONAL = /\b(?:once|after|when|if|until|before|as\s+soon\s+as|whether)\b/i;
const PERSISTENCE = /\b(?:noted|saved|recorded|logged|made\s+a\s+note|got\s+(?:that|it)\s+down|all\s+set(?!\s+to)|taken\s+care\s+of|(?:I've|I\s+have|I|been)\s+updated)\b/i;
const FOLLOW_UP_PROMISE = /\bI(?:'ll|\s+will)\s+(?:check\s+in|follow\s+up|reach\s+out|remind\s+you|text\s+you|message\s+you|touch\s+base|circle\s+back|be\s+in\s+touch)\b/i;
const PROMISE_KIND = /\b(?:check[- ]?in|follow[- ]?up|remind|reach\s+out|touch\s+base)\b/i;

export interface ClaimContext {
  /** Package and clinic names in the ledger (a sentence naming one is a claim about the offer). */
  offerNames: string[];
  /** Add-on names from package data (hotel, PRP...), treated like amenities. */
  addonNames?: string[];
  /** A selection write will be attempted this turn (receipt checked after commit). */
  selectionWritePlanned: boolean;
  /** A follow-up code schedules regardless of the draft (the pause rule's default), e.g. "1 month". */
  codeFollowUp?: string | null;
  /** Renders a clause token (to check an amenity against the inclusions token in the same sentence). */
  renderClause?: (ref: string, kind: string) => string | null;
  /** How many clinics and packages are in FACTS: a typed count is allowed only if it matches. */
  counts?: { clinics: number; packages: number };
}

/** The follow-up interval that will actually be scheduled: the draft's own, else the one code sets. */
function scheduledFollowUp(out: WriterOutput, codeFollowUp?: string | null): string | null {
  if (out.should_follow_up && out.follow_up_timing) return out.follow_up_timing;
  return codeFollowUp ?? null;
}

/** A negation within the few words before the matched term ("I can't guarantee", "insurance doesn't cover"). */
function negatedBefore(text: string, re: RegExp): boolean {
  const m = text.match(re);
  if (!m || m.index === undefined) return false;
  const before = text.slice(0, m.index).split(/\s+/).slice(-6).join(" ");
  return NEGATION.test(before);
}

const sentences = (s: string) => s.split(/(?<=[.!?])(?<!\bDr\.)\s+|\n+/).filter((x) => x.trim());
const normInterval = (s: string) => {
  const m = s.toLowerCase().match(/(\d+|[a-z]+)\s+(day|week|month)s?/);
  if (!m) return s.toLowerCase().trim();
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : WORD_VALUE[m[1]];
  return `${n} ${m[2]}`;
};

/** True if the memory patch has any non-empty field. */
export const memoryWritten = (m: Record<string, unknown> | null) => !!m && Object.values(m).some((v) => v !== null && v !== undefined && v !== "");

export function claimViolations(out: WriterOutput, c: ClaimContext): Violation[] {
  const v: Violation[] = [];
  const scheduled = scheduledFollowUp(out, c.codeFollowUp);
  const followUp = scheduled ? normInterval(scheduled) : null;
  const names = [...new Set(c.offerNames.flatMap((n) => [n, n.replace(/\s+clinic$/i, "")]).map((n) => n.toLowerCase().trim()))].filter((n) => n.length > 2);
  const addons = (c.addonNames ?? []).map((a) => a.toLowerCase()).filter((a) => a.length > 2);
  const persistenceReceipt = c.selectionWritePlanned || memoryWritten(out.memory);

  for (const sentence of sentences(out.reply)) {
    const tokens = [...sentence.matchAll(TOKEN_RE)].map((m) => ({ ref: m[1], kind: m[2] }));
    let own = sentence.replace(TOKEN_RE, " ");
    const lower = own.toLowerCase();
    // Package (P) and clinic (C) tokens make a sentence about the offer; policy (R) and assessment (AS) tokens don't.
    const aboutOffer = tokens.some((t) => /^[PC]\d/.test(t.ref)) || /\bpackages?\b/.test(lower) || names.some((n) => lower.includes(n));
    // Amenities stated by an inclusions token in this same sentence are sourced ("the hotel is part of it: {{P1:inclusions}}").
    const tokenText = tokens
      .filter((t) => t.kind === "inclusions")
      .map((t) => c.renderClause?.(t.ref, t.kind) ?? "")
      .join(" ")
      .toLowerCase();
    // The patient's own travel ("your flights", "once you buy flights") is not a claim about the offer.
    const patientsOwn = (idx: number, len: number) =>
      OWN_BEFORE.test(lower.slice(0, idx).split(/\s+/).slice(-3).join(" ")) || OWN_AFTER.test(lower.slice(idx + len).split(/\s+/).slice(0, 4).join(" "));
    const amenities = [...lower.matchAll(new RegExp(AMENITY.source, "gi"))]
      .filter((m) => !patientsOwn(m.index!, m[0].length))
      .map((m) => m[0])
      .concat(addons.filter((a) => lower.includes(a)));
    const unsourcedAmenity = amenities.find((a) => !tokenText.includes(a.replace(/s$/, "")));
    // A count of clinics or packages is allowed when it matches FACTS ("your two saved clinics").
    if (c.counts) {
      own = own.replace(new RegExp(String.raw`\b(${NUMBER_WORD}|\d+)\s+(?:saved\s+|partner\s+)?(clinics?|packages?)\b`, "gi"), (m, n: string, unit: string) => {
        const value = /^\d+$/.test(n) ? Number(n) : WORD_VALUE[n.toLowerCase()];
        const actual = unit.toLowerCase().startsWith("clinic") ? c.counts!.clinics : c.counts!.packages;
        return value === actual ? " " : m;
      });
    }

    // Numbers: only from tokens. The one exception is the follow-up interval the reply schedules.
    own = own.replace(INTERVAL, (m) => (followUp && normInterval(m) === followUp ? " " : m));
    for (const re of [DIGITS, NUMBER_WORDS, ONE_UNIT]) {
      for (const m of own.matchAll(re)) v.push({ code: "UNSOURCED_QUANTITY", severity: "hard", detail: `Typed "${m[0].trim()}"; numbers come only from clause tokens in FACTS.` });
    }
    // Inclusion wording matters only about the offer ("Klarna can cover it" and "stay covered up" are fine).
    if (aboutOffer && INCLUDE_VERB.test(own) && !tokenText) {
      v.push({ code: "UNSOURCED_INCLUSION", severity: "hard", detail: `"${sentence.trim()}" states what something includes; use a {{P#:inclusions}} token.` });
    } else if (aboutOffer && unsourcedAmenity) {
      v.push({ code: "UNSOURCED_INCLUSION", severity: "hard", detail: `"${sentence.trim()}" attributes an add-on or travel item to a package or clinic; use a clause token.` });
    }
    const freeOwn = own.replace(FREE_OK, " ");
    if (NEGATIVE_POLICY.test(own) || (POLICY.test(own) && !negatedBefore(own, POLICY)) || (FREE.test(freeOwn) && !negatedBefore(freeOwn, FREE))) {
      v.push({ code: "UNSOURCED_POLICY", severity: "hard", detail: `"${sentence.trim()}" states a policy term; use an {{R:...}} token from FACTS.` });
    }
    for (const re of ACTION_DONE) {
      const m = own.match(re);
      if (m && !CONDITIONAL.test(own.slice(0, m.index))) {
        v.push({ code: "FALSE_ACTION", severity: "hard", detail: `"${m[0]}" claims an action was completed; no tool can do it.` });
        break;
      }
    }
    if (PERSISTENCE.test(own) && !persistenceReceipt) {
      v.push({ code: "UNBACKED_PERSISTENCE", severity: "hard", detail: `"${own.match(PERSISTENCE)![0]}" claims something was saved, but nothing is written this turn.` });
    }
    if (FOLLOW_UP_PROMISE.test(own) && !followUp) {
      v.push({ code: "UNSCHEDULED_FOLLOW_UP", severity: "hard", detail: "Promises a check-in without setting should_follow_up and follow_up_timing." });
    }
  }
  return v;
}

/** Memory is validated separately: it persists, so a false note outlives the reply. */
export function memoryViolations(out: WriterOutput, neverEcho: string[], collapse: (s: string) => string, codeFollowUp?: string | null): Violation[] {
  const v: Violation[] = [];
  const m = out.memory ?? {};
  for (const [k, val] of Object.entries(m)) {
    if (typeof val !== "string" || !val.trim()) continue;
    if (neverEcho.some((d) => collapse(val).includes(d))) v.push({ code: "MEMORY_SENSITIVE", severity: "hard", detail: `memory.${k} repeats card digits.` });
    if (ACTION_DONE.some((re) => re.test(val))) v.push({ code: "MEMORY_FALSE_ACTION", severity: "hard", detail: `memory.${k} records an action no tool performed.` });
  }
  const promise = m.promisesMade;
  if (typeof promise === "string" && promise.trim()) {
    if (!scheduledFollowUp(out, codeFollowUp)) {
      v.push({ code: "MEMORY_PROMISE_UNSCHEDULED", severity: "hard", detail: "promisesMade is set but no follow-up is scheduled." });
    } else if (!PROMISE_KIND.test(promise)) {
      v.push({ code: "MEMORY_PROMISE_UNSUPPORTED", severity: "hard", detail: "promisesMade may only record a scheduled check-in." });
    }
  }
  return v;
}

/** Used after commit: does the final text claim something was saved? */
export const claimsPersistence = (text: string) => PERSISTENCE.test(text.replace(TOKEN_RE, " "));
