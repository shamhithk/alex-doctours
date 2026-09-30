import type { Ledger } from "../evidence/ledger.js";
import { collapseDigits } from "../guards/input.js";
import { claimViolations, memoryViolations } from "./claims.js";

export interface WriterOutput {
  reply: string;
  link_ids: string[];
  attachment_ids: string[];
  claims: { text: string; sources: string[] }[];
  intent: string;
  should_follow_up: boolean;
  follow_up_timing: string | null;
  memory: Record<string, unknown> | null;
  unsupported: string | null;
}

export interface Violation {
  code: string;
  severity: "hard" | "soft";
  detail: string;
}

export interface Rendered {
  text: string;
  body: string;
  links: string[];
  attachments: string[];
}

const URL_RE = /https?:\/\/\S+|www\.\S+|\b[a-z0-9-]+\.(?:com|net|org|io)\/\S*/gi;
/** Clause tokens: {{P2:price+deposit}}, {{C1:specialty}}, {{AS:graft-range}}. */
export const TOKEN_RE = /\{\{\s*([A-Z]{1,3}\d*)\s*:\s*([a-z+-]+)\s*\}\}/g;
const ANY_BRACES = /\{\{[^}]*\}\}/g;

export function coerceWriterOutput(raw: any): { out?: WriterOutput; violations: Violation[] } {
  if (!raw || typeof raw !== "object") return { violations: [{ code: "WRITER_JSON", severity: "hard", detail: "Output was not a json object." }] };
  const out: WriterOutput = {
    reply: typeof raw.reply === "string" ? raw.reply : "",
    link_ids: Array.isArray(raw.link_ids) ? raw.link_ids.map(String) : [],
    attachment_ids: Array.isArray(raw.attachment_ids) ? raw.attachment_ids.map(String) : [],
    claims: Array.isArray(raw.claims) ? raw.claims.filter((c: any) => c && typeof c.text === "string").map((c: any) => ({ text: c.text, sources: Array.isArray(c.sources) ? c.sources.map(String) : [] })) : [],
    intent: typeof raw.intent === "string" && raw.intent.trim() ? raw.intent.trim() : "answer patient question",
    should_follow_up: raw.should_follow_up === true,
    follow_up_timing: typeof raw.follow_up_timing === "string" && raw.follow_up_timing.trim() ? raw.follow_up_timing.trim() : null,
    memory: raw.memory && typeof raw.memory === "object" ? raw.memory : null,
    unsupported: typeof raw.unsupported === "string" && raw.unsupported.trim() ? raw.unsupported.trim() : null,
  };
  const v: Violation[] = [];
  if (!out.unsupported && !out.reply.trim()) v.push({ code: "EMPTY_REPLY", severity: "hard", detail: "reply is empty." });
  return { out, violations: v };
}

export function render(out: WriterOutput, ledger: Ledger): { rendered: Rendered; violations: Violation[] } {
  const v: Violation[] = [];
  let body = out.reply.replace(TOKEN_RE, (_m, ref: string, kind: string, offset: number, whole: string) => {
    const clause = ledger.renderClause(ref, kind);
    if (clause === null) {
      v.push({ code: "UNKNOWN_FACT", severity: "hard", detail: `{{${ref}:${kind}}} is not an available clause.` });
      return "";
    }
    const before = whole.slice(0, offset);
    const startsSentence = /(^|[.!?]\s+|\n\s*)$/.test(before);
    return startsSentence ? clause.charAt(0).toUpperCase() + clause.slice(1) : clause;
  });
  if (ANY_BRACES.test(body)) v.push({ code: "UNKNOWN_FACT", severity: "hard", detail: "Malformed fact token." });
  ANY_BRACES.lastIndex = 0;
  // Light markdown clean-up (SMS is plain text).
  const md = /\*\*|__|^#+\s|^\s*[-*]\s+/m.test(body);
  if (md) v.push({ code: "MARKDOWN", severity: "soft", detail: "Markdown removed." });
  body = body.replace(/\*\*(.*?)\*\*/g, "$1").replace(/__(.*?)__/g, "$1").replace(/^#+\s*/gm, "");
  body = body.replace(/[ \t]+\n/g, "\n").trim();

  const links: string[] = [];
  for (const id of out.link_ids) {
    const l = ledger.link(id);
    if (!l) v.push({ code: "UNKNOWN_LINK", severity: "hard", detail: `${id} is not in LINKS.` });
    else if (!links.includes(l.url)) links.push(l.url);
  }
  const attachments: string[] = [];
  for (const id of out.attachment_ids) {
    const a = ledger.attachment(id);
    if (!a) v.push({ code: "UNKNOWN_ATTACHMENT", severity: "hard", detail: `${id} is not in ATTACHMENTS.` });
    else if (!attachments.includes(a.url)) attachments.push(a.url);
  }
  if (attachments.length > 3) {
    v.push({ code: "TOO_MANY_ATTACHMENTS", severity: "soft", detail: "Trimmed to 3 attachments." });
    attachments.length = 3;
  }
  const text = links.length ? `${body}\n${links.join("\n")}` : body;
  return { rendered: { text, body, links, attachments }, violations: v };
}

export interface ValidateContext {
  ledger: Ledger;
  patientText: string;
  neverEcho: string[];
  loadedRulesText: string;
  linksAlreadySent: string[];
  paymentSkillLoaded: boolean;
  /** True when the router saw a payment-link request. */
  linkRequested?: boolean;
  /** A clinic/package selection write is planned this turn (so "noted"/"saved" has a receipt pending). */
  selectionWritePlanned?: boolean;
  /** Follow-up code will schedule even if the draft doesn't (pause default), e.g. "1 month". */
  codeFollowUp?: string | null;
}

const ASKS_FOR_LINK = /\b(?:links?|website|site|web\s?page|page|url|where\s+(?:can|do)\s+i|how\s+(?:can|do)\s+i\s+(?:pay|book|see)|pay\s+(?:from|through|via|online)|book)\b/i;

const OFF_CHANNEL: [RegExp, string][] = [
  [/\bI(?:'ll| will)\s+(?:send|email|forward|pass)\b/i, "promises to send something later"],
  [/\bI(?:'ll| will)\s+get\s+back\s+to\s+you\b/i, "promises to get back later"],
  [/\blet\s+me\s+(?:check|look\s+into|find\s+out|confirm)\b/i, "stalls with a check it cannot do"],
  [/\bI(?:'ll| will)\s+(?:check|look\s+into|find\s+out)\b(?!\s+in\b)/i, "promises a check it cannot do"],
  [/\bI(?:'ll| will)\s+(?:contact|call|reach\s+out\s+to|message)\s+(?:the\s+)?(?:clinic|doctor|hotel|team)\b/i, "promises to contact a third party"],
  [/\b(?:someone|a\s+(?:team\s+member|specialist|coordinator))\s+(?:from\s+(?:our|the)\s+team\s+)?will\b/i, "hands off to another person"],
  [/\b(?:from|over|through)\s+(?:this\s+)?(?:chat|text|thread)\b/i, "blames the channel"],
  [/\bI\s+(?:checked|looked\s+in)\s+(?:our|the)\s+system\b/i, "claims an internal lookup"],
  [/\bavailability\s+is\s+live\b/i, "claims live availability"],
];
const HAT = /\b(?:hat|cap|beanie|hood|headband|scarf|bandana|head\s*wrap|hijab)s?\b/i;
const TURNAROUND = /\b(?:assessment|plan)\b[^.?!]{0,80}\b(?:\d+\s*(?:-\s*\d+\s*)?(?:hours?|days?)|tomorrow|later\s+today|by\s+tonight)\b/i;
const FIN_MATH = /\bAPR\b|\d+(?:\.\d+)?\s?%|\/\s?mo(?:nth)?\b|\bper\s+month\b|\ba\s+month\s+for\b/i;

export function validate(out: WriterOutput, r: Rendered, c: ValidateContext): Violation[] {
  const v: Violation[] = [];
  const raw = out.reply;
  if (URL_RE.test(raw)) v.push({ code: "URL_IN_TEXT", severity: "hard", detail: "Typed a URL; use link_ids instead." });
  URL_RE.lastIndex = 0;

  // Claim guards on the writer's own prose: numbers, inclusions and policy terms only via
  // clause tokens; completed actions and saves need a receipt; memory is checked separately.
  const pkgs = c.ledger.allEntities().filter((e) => e.kind === "package") as { name: string; included: { name: string }[] }[];
  v.push(
    ...claimViolations(out, {
      offerNames: c.ledger.allEntities().flatMap((e) => ("name" in e && e.name ? [e.name] : [])),
      addonNames: pkgs.flatMap((p) => p.included.map((a) => a.name)),
      selectionWritePlanned: c.selectionWritePlanned === true,
      codeFollowUp: c.codeFollowUp,
      renderClause: (ref, kind) => c.ledger.renderClause(ref, kind),
      counts: {
        clinics: c.ledger.allEntities().filter((e) => e.kind === "clinic").length,
        packages: pkgs.length,
      },
    }),
    ...memoryViolations(out, c.neverEcho, collapseDigits, c.codeFollowUp),
  );
  // Redundant tokens: two clauses that state the same fact, or a list clause used as a lead-in.
  const used = [...raw.matchAll(TOKEN_RE)].map((m) => `${m[1]}:${m[2]}`);
  const has = (t: string) => used.includes(t);
  const seen = new Set<string>();
  for (const t of used) {
    const [ref, kind] = t.split(":");
    const clash =
      seen.has(t) ||
      (kind === "packages" && has(`${ref}:package-count`)) ||
      ((kind === "price" || kind === "deposit") && has(`${ref}:price+deposit`));
    if (clash) v.push({ code: "REDUNDANT_TOKENS", severity: "hard", detail: `{{${t}}} repeats a fact another token already states.` });
    seen.add(t);
  }
  if (/\{\{[A-Z]+\d*:packages\}\}\s*:/.test(raw)) {
    v.push({ code: "REDUNDANT_TOKENS", severity: "hard", detail: "packages already lists the names; to list prices use package-count followed by price clauses." });
  }
  // Claim sources must exist (soft: tokens already guarantee the rendered facts).
  const known = new Set<string>([
    ...c.ledger.allEntities().map((e) => e.ref),
    ...c.ledger.availableClauses().flatMap((x) => [x.token.slice(2, -2), `${x.ref}:${x.kind}`]),
    ...c.ledger.links.map((l) => l.id),
    ...c.ledger.attachments.map((a) => a.id),
    ...[...c.loadedRulesText.matchAll(/\[([a-z0-9][a-z0-9.\-_]*)\]/g)].map((m) => m[1]),
    "core",
  ]);
  for (const claim of out.claims) {
    for (const src of claim.sources) {
      const norm = src.replace(/^\{\{|\}\}$/g, "").replace(/^\[|\]$/g, "");
      if (!known.has(norm)) v.push({ code: "UNKNOWN_CLAIM_SOURCE", severity: "soft", detail: `Claim source "${src}" does not exist this turn.` });
    }
  }
  const flat = collapseDigits(r.text);
  for (const d of c.neverEcho) {
    if (flat.includes(d)) v.push({ code: "ECHOED_SENSITIVE", severity: "hard", detail: "Repeated card digits." });
  }
  for (const [re, why] of OFF_CHANNEL) {
    if (re.test(r.body)) v.push({ code: "OFF_CHANNEL", severity: "hard", detail: `Reply ${why}.` });
  }
  if (HAT.test(r.body) && !HAT.test(c.patientText)) v.push({ code: "HEAD_COVERING", severity: "hard", detail: "Head-covering advice is banned." });
  if (TURNAROUND.test(r.body)) v.push({ code: "ASSESSMENT_TURNAROUND", severity: "hard", detail: "No assessment turnaround times." });
  if (FIN_MATH.test(r.body)) v.push({ code: "FINANCING_MATH", severity: "hard", detail: "No financing math, rates or monthly amounts." });
  if (r.links.length && !/\blinks?\b/i.test(r.body)) v.push({ code: "LINK_NOT_INTRODUCED", severity: "soft", detail: "Link sent without saying 'using the link below'." });

  for (const url of r.links) {
    const ref = c.ledger.links.find((l) => l.url === url);
    const asked = ASKS_FOR_LINK.test(c.patientText) || c.linkRequested === true;
    if (ref?.label.startsWith("Doctours clinic page") && !asked) {
      v.push({ code: "UNREQUESTED_LINK", severity: "hard", detail: `Sent ${ref.label} although the patient did not ask for a page or link.` });
    }
    if (c.linksAlreadySent.includes(url) && !c.paymentSkillLoaded && !/\blink\b/i.test(c.patientText)) {
      v.push({ code: "RESENT_LINK", severity: "soft", detail: `Resent ${url} without being asked.` });
    }
  }
  const words = r.body.split(/\s+/).filter(Boolean).length;
  const budget = c.patientText.split(/\s+/).length <= 12 ? 70 : 140;
  if (words > budget) v.push({ code: "LENGTH", severity: "soft", detail: `${words} words (budget ${budget}).` });
  if ((r.body.match(/\?/g) ?? []).length > 1) v.push({ code: "MULTI_QUESTION", severity: "soft", detail: "More than one question." });
  if (out.should_follow_up !== (out.follow_up_timing !== null)) v.push({ code: "FOLLOW_UP_FIELDS", severity: "soft", detail: "Follow-up fields inconsistent; normalised." });
  return v;
}

export const hard = (v: Violation[]) => v.filter((x) => x.severity === "hard");
