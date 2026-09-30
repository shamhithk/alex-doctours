/**
 * Deterministic input guards. They never answer the patient; they normalise the
 * text, find data that must never be echoed back, and flag clear signals.
 * Everything here scans the FULL message (no truncation).
 */
export interface GuardResult {
  text: string;
  redacted: string;
  /** Separator-free digit strings that must never appear in any output. */
  neverEcho: string[];
  cardDataPresent: boolean;
  humanFastPath: boolean;
  injectionHeuristic: boolean;
  chars: number;
}

/** Messages longer than this are refused as a whole (documented deliberate handoff). */
export const HARD_INPUT_LIMIT = 50_000;

const SEP = "[ \\-.\\u00A0\\u2007\\u202F]";
const CARD_WORDS = /\b(?:card|visa|mastercard|master\s*card|amex|american\s+express|discover|debit|credit|cc|cvv|cvc)\b/i;

/** Fragment patterns: the captured group is the sensitive part (the `d` flag gives its span). */
const FRAGMENT_PATTERNS: RegExp[] = [
  /\b(?:ending|ends)\s+(?:in|with)\s+(\d{4})\b/dgi,
  /\blast\s+(?:four|4)(?:\s+digits)?(?:\s+(?:are|is|of\s+my\s+card))?\s*[:#-]?\s*(\d{4})\b/dgi,
  /\b(?:card|visa|mastercard|amex|debit|credit)(?:\s+(?:number|no\.?|#))?\s*[:#-]?\s*(\d{4,6})\b(?![ \-. ]?\d)/dgi,
  /\b(?:cvv|cvc|security\s+code)\s*[:#-]?\s*(\d{3,4})\b/dgi,
];
/** 12–19 digits, optionally grouped by spaces, hyphens, dots or non-breaking spaces. */
const LONG_DIGITS = new RegExp(`\\d(?:${SEP}?\\d){11,18}`, "g");

const HUMAN_PATTERNS: RegExp[] = [
  /\b(?:talk|speak|chat)\s+(?:to|with)\s+(?:a|an|some|your)?\s*(?:real\s+|live\s+|actual\s+)?(?:human|person|agent|representative|rep|manager|supervisor|someone\s+real|staff\s+member)\b/i,
  /\b(?:get|connect|transfer|put)\s+me\s+(?:through\s+)?(?:to|with)?\s*(?:a|an|some|your)?\s*(?:real\s+|live\s+|actual\s+)?(?:human|person|agent|representative|manager|supervisor|someone)\b/i,
  /\b(?:i\s+)?(?:want|need|demand|request)\s+(?:a|an|to\s+talk\s+to\s+a|to\s+speak\s+(?:to|with)\s+a)?\s*(?:real\s+|live\s+|actual\s+)?(?:human|person|agent|representative|manager)\b(?!\s+(?:hair|transplant))/i,
  /^\s*(?:human|agent|representative|operator|real\s+person)\s*(?:please|pls|now)?\s*[!.?]*\s*$/i,
];
const NEGATION_NEAR_HUMAN =
  /\b(?:don'?t|do\s+not|no\s+need|not|never|without|instead\s+of)\b[^.?!]{0,30}\b(?:human|person|agent|representative|manager|someone)\b/i;
const IDENTITY_QUESTION = /\bare\s+you\s+(?:a\s+)?(?:real|human|bot|person|ai|robot)\b/i;
const INJECTION_PATTERNS: RegExp[] = [
  /\bignore\s+(?:all\s+|any\s+|your\s+|the\s+)?(?:previous\s+|prior\s+|above\s+|earlier\s+)?(?:instructions|rules|guidelines|prompt)\b/i,
  /\byou\s+are\s+now\b/i,
  /\b(?:system|developer)\s+(?:prompt|message|mode)\b/i,
  /\bdisregard\s+(?:your|the|all)\b/i,
];

export function luhn(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return digits.length >= 12 && sum % 10 === 0;
}

/** Remove separators between digits so "4539 1488-0343" compares as "453914880343". */
export const collapseDigits = (s: string) => s.normalize("NFKC").replace(new RegExp(`(?<=\\d)${SEP}(?=\\d)`, "g"), "");

export function guardInput(raw: string): GuardResult {
  const text = raw.normalize("NFKC").replace(/[\t\r\n]+/g, " ").replace(/ {2,}/g, " ").trim();
  const spans: [number, number][] = [];
  const neverEcho = new Set<string>();

  for (const re of FRAGMENT_PATTERNS) {
    for (const m of text.matchAll(re)) {
      const [s, e] = m.indices![1]!;
      spans.push([s, e]);
      neverEcho.add(m[1]);
    }
  }
  for (const m of text.matchAll(LONG_DIGITS)) {
    const digits = m[0].replace(/\D/g, "");
    const near = CARD_WORDS.test(text.slice(Math.max(0, m.index! - 40), m.index! + m[0].length + 40));
    if (luhn(digits) || (near && digits.length >= 13)) {
      spans.push([m.index!, m.index! + m[0].length]);
      neverEcho.add(digits);
      neverEcho.add(digits.slice(-4));
    }
  }
  // Redact spans right-to-left so earlier indices stay valid; merge overlaps.
  spans.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const sp of spans) {
    const last = merged[merged.length - 1];
    if (last && sp[0] <= last[1]) last[1] = Math.max(last[1], sp[1]);
    else merged.push([...sp]);
  }
  let redacted = text;
  for (const [s, e] of merged.reverse()) redacted = `${redacted.slice(0, s)}[card number removed]${redacted.slice(e)}`;

  // Per sentence, so a negation in one sentence cannot hide a request in another.
  const unquoted = text.replace(/"[^"]*"|“[^”]*”/g, " ");
  const humanFastPath = unquoted
    .split(/(?<=[.!?])\s+/)
    .some((s) => !IDENTITY_QUESTION.test(s) && !NEGATION_NEAR_HUMAN.test(s) && HUMAN_PATTERNS.some((re) => re.test(s)));

  return {
    text,
    redacted,
    neverEcho: [...neverEcho],
    cardDataPresent: neverEcho.size > 0,
    humanFastPath,
    injectionHeuristic: INJECTION_PATTERNS.some((re) => re.test(text)),
    chars: text.length,
  };
}
