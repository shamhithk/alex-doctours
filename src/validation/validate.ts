import type { Ledger } from "../evidence/ledger.js";

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
const TOKEN_RE = /\{\{\s*(F\d+)\s*\}\}/g;

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
  let body = out.reply.replace(TOKEN_RE, (_m, id: string) => {
    const f = ledger.fact(id);
    if (!f) {
      v.push({ code: "UNKNOWN_FACT", severity: "hard", detail: `{{${id}}} is not in FACTS.` });
      return "";
    }
    return f.render;
  });
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

  // Money must come from fact tokens (or a figure stated verbatim in a loaded rule, e.g. a $25 fee).
  const typedMoney = raw.replace(TOKEN_RE, "").match(/\$\s?\d[\d,]*(?:\.\d+)?/g) ?? [];
  for (const m of typedMoney) {
    if (!c.loadedRulesText.includes(m.replace(/\s/g, ""))) {
      v.push({ code: "UNSOURCED_MONEY", severity: "hard", detail: `Typed ${m}; use a {{F#}} token.` });
    }
  }
  // Attribution: a fact token must share a sentence with its package/clinic name.
  for (const sentence of raw.split(/(?<=[.!?])\s+/)) {
    for (const m of sentence.matchAll(TOKEN_RE)) {
      const f = c.ledger.fact(m[1]);
      if (f && f.anchors.length && !f.anchors.some((a) => sentence.toLowerCase().includes(a.toLowerCase()))) {
        v.push({ code: "ATTRIBUTION", severity: "hard", detail: `{{${m[1]}}} (${f.label}) is not named in its sentence.` });
      }
    }
  }
  for (const d of c.neverEcho) {
    if (r.text.includes(d)) v.push({ code: "ECHOED_SENSITIVE", severity: "hard", detail: "Repeated card digits." });
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
