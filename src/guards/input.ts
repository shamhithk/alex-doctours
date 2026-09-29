/**
 * Deterministic input guards. They never answer the patient; they normalise the
 * text, find data that must never be echoed back, and flag clear signals.
 */
export interface GuardResult {
  text: string;
  redacted: string;
  neverEcho: string[];
  cardDataPresent: boolean;
  humanFastPath: boolean;
  injectionHeuristic: boolean;
}

const MAX_CHARS = 2000;

const CARD_FRAGMENT_PATTERNS: RegExp[] = [
  /\b(?:ending|ends)\s+(?:in|with)\s+(\d{4})\b/gi,
  /\blast\s+(?:four|4)(?:\s+digits)?(?:\s+(?:are|is|of\s+my\s+card))?\s*[:#-]?\s*(\d{4})\b/gi,
  /\b(?:card|visa|mastercard|amex|debit|credit)(?:\s+(?:number|no\.?|#))?\s*[:#-]?\s*(\d{4,19})\b/gi,
  /\b(?:cvv|cvc|security\s+code)\s*[:#-]?\s*(\d{3,4})\b/gi,
];

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

function luhn(digits: string): boolean {
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

export function guardInput(raw: string): GuardResult {
  const text = raw.normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, MAX_CHARS);
  const neverEcho = new Set<string>();
  for (const re of CARD_FRAGMENT_PATTERNS) {
    for (const m of text.matchAll(re)) neverEcho.add(m[1]);
  }
  for (const m of text.matchAll(/\b(?:\d[ -]?){12,19}\b/g)) {
    const digits = m[0].replace(/\D/g, "");
    if (luhn(digits)) {
      neverEcho.add(digits);
      neverEcho.add(digits.slice(-4));
    }
  }
  let redacted = text;
  for (const d of neverEcho) redacted = redacted.split(d).join("█".repeat(Math.min(d.length, 4)));

  const unquoted = text.replace(/"[^"]*"|“[^”]*”/g, " ");
  const humanFastPath =
    !IDENTITY_QUESTION.test(unquoted) &&
    !NEGATION_NEAR_HUMAN.test(unquoted) &&
    HUMAN_PATTERNS.some((re) => re.test(unquoted));

  return {
    text,
    redacted,
    neverEcho: [...neverEcho],
    cardDataPresent: neverEcho.size > 0,
    humanFastPath,
    injectionHeuristic: INJECTION_PATTERNS.some((re) => re.test(text)),
  };
}
