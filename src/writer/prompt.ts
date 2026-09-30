import type { PatientContext } from "../context.js";
import { flags } from "../context.js";
import type { Ledger } from "../evidence/ledger.js";
import { applyConditions, type Domain, type Selection } from "../skills/loader.js";

export const WRITER_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "link_ids", "attachment_ids", "claims", "intent", "should_follow_up", "follow_up_timing", "memory", "unsupported"],
  properties: {
    reply: { type: "string" },
    link_ids: { type: "array", items: { type: "string" } },
    attachment_ids: { type: "array", items: { type: "string" } },
    claims: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "sources"],
        properties: { text: { type: "string" }, sources: { type: "array", items: { type: "string" } } },
      },
    },
    intent: { type: "string" },
    should_follow_up: { type: "boolean" },
    follow_up_timing: { type: ["string", "null"] },
    memory: {
      type: "object",
      additionalProperties: false,
      required: ["keyConcerns", "promisesMade", "preferredPaymentMethod", "communicationStyle", "procedureArea"],
      properties: {
        keyConcerns: { type: ["string", "null"] },
        promisesMade: { type: ["string", "null"] },
        preferredPaymentMethod: {
          type: ["string", "null"],
          enum: ["financing", "layaway", "pay_in_full", "cash_preference", "unknown", null],
        },
        communicationStyle: { type: ["string", "null"], enum: ["detailed", "concise", "casual", "formal", "unknown", null] },
        procedureArea: { type: ["string", "null"] },
      },
    },
    unsupported: { type: ["string", "null"] },
  },
};

const EXAMPLE = {
  reply: "{{C9:package-count}}. {{P8:price+deposit}}, and {{P9:price+deposit}}. You can see both on the clinic page using the link below.",
  link_ids: ["L1"],
  attachment_ids: [],
  claims: [
    { text: "package count", sources: ["C9:package-count"] },
    { text: "prices and deposits", sources: ["P8:price+deposit", "P9:price+deposit"] },
  ],
  intent: "answer package pricing",
  should_follow_up: false,
  follow_up_timing: null,
  memory: { keyConcerns: null, promisesMade: null, preferredPaymentMethod: null, communicationStyle: null, procedureArea: null },
  unsupported: null,
};

export interface BuiltPrompt {
  system: string;
  approxTokens: number;
}

export function buildWriterSystem(domain: Domain, sel: Selection, ctx: PatientContext, ledger: Ledger): BuiltPrompt {
  const f = flags(ctx);
  const core = domain.core.body.replaceAll("{{COORDINATOR_DISPLAY_NAME}}", ctx.coordinatorName);
  const loaded = sel.ids.map((id) => {
    const s = domain.skills.get(id)!;
    return `## ${s.title} [${s.id} v${s.version} · ${s.precedence}]\n${applyConditions(s.body, f).trim()}`;
  });
  const others = [...domain.skills.values()]
    .filter((s) => !sel.ids.includes(s.id))
    .map((s) => `- ${s.id}: ${s.title}`);

  const system = [
    core,
    "",
    "# CURRENT SITUATION",
    `Current date/time: ${ctx.now}. You are ${ctx.coordinatorName}, replying in a direct SMS thread. Triggering sender: ${ctx.patientName} (patient).`,
    "## Patient summary",
    ctx.patientSummary,
    "## Clinic flags (source of truth for Speciality / Practice type; hair type such as afro/4C/curly is a Speciality question)",
    ctx.clinicFlags,
    "## Collection status",
    ctx.collectionStatus,
    "## Working memory",
    JSON.stringify(ctx.workingMemory),
    "## Recent calls",
    ctx.recentCalls,
    "## Links already sent earlier in this conversation",
    ...ctx.linksAlreadySent.map((u) => `- ${u}`),
    "",
    "# LOADED RULES (apply all; on conflict: hard > stage > guideline)",
    ...loaded,
    "",
    "# OTHER TOPICS (rules not loaded this turn; if the message needs one of these, answer only what the loaded rules and FACTS support)",
    ...others,
    "",
    "# FACTS (verified by tools this turn). Each line is a clause token and exactly what it renders to.",
    ledger.factsBlock(),
    "",
    "# LINKS (the ONLY URLs you may send)",
    ledger.linksBlock(),
    "",
    "# ATTACHMENTS (hosted files you may attach, at most 3)",
    ledger.attachmentsBlock(),
    ...(ledger.notes.length ? ["", "# TOOL NOTES", ...ledger.notes.map((n) => `- ${n}`)] : []),
    "",
    "# OUTPUT (json only)",
    "Return one json object with exactly these keys: reply, link_ids, attachment_ids, claims, intent, should_follow_up, follow_up_timing, memory, unsupported.",
    "- reply: the SMS text, plain text, first person as the coordinator. Answer every question the patient asked, then stop.",
    "- Use only the FACTS needed to answer what was asked. Do not add package extras, hotel nights, doctor notes, opinions ('a strong pick') or links the patient did not ask about, unless a loaded rule requires them.",
    "- Send a link only when the patient asked for one, asked where or how to pay or book, or a loaded rule says to include it.",
    "- Facts: state prices, deposits, how many packages a clinic has, what a package includes, bookable days, doctors, clinic specialty/location and graft estimates ONLY with clause tokens from FACTS, e.g. {{P2:price+deposit}}. A token renders a complete clause INCLUDING the package or clinic name (see the preview after the arrow), so do not repeat the name around it. Never type a number, amount or quantity for these facts yourself, not even one the patient quoted.",
    "- Policy facts (refund and cancellation fee, lock-in date, deposit transfer, price lock, balance due date, date confirmation, the consultation's cost and format) ONLY with the {{R:...}} tokens in FACTS. Each renders the rule's exact wording.",
    "- Your own words must not contain: any digit or number word; 'includes', 'comes with' or 'covers'; add-ons or travel items (hotel, flights, transfers, meals) said about a package or clinic; policy terms (refund, guarantee, discount, free, price lock, transferable, cancellation fee). The one number you may type is the check-in interval you set in follow_up_timing (e.g. \"I'll check in after 2 weeks\").",
    "- Never say an action was done (charged, booked, scheduled, confirmed, reserved, refunded, contacted the clinic): no tool here can do those. Say you've \"noted\" something only when you record it in memory this turn. Promise a check-in only when you set should_follow_up.",
    "- Use each fact once: don't combine tokens that say the same thing (package-count with packages; price or deposit with price+deposit), and don't restate a token's clause in your own words. To list prices, write e.g. \"{{C1:package-count}}: {{P1:price+deposit}}, and {{P2:price+deposit}}.\"",
    "- Links: never type a URL. When sending a link, say \"using the link below\" and put its id (e.g. \"L2\") in link_ids; links are appended as the last lines automatically.",
    "- Attachments: ids from ATTACHMENTS in attachment_ids (max 3), only when the patient asks for their photos.",
    "- claims: every factual statement in reply with its sources (clause tokens like P2:price+deposit, link ids like L1, or rule ids such as payment.assessment-book). Claims are recorded for review; they do not make an otherwise blocked statement allowed.",
    "- should_follow_up / follow_up_timing: true with a human-readable interval (e.g. \"1 month\") only when a concrete check-in was set; otherwise false and null.",
    "- memory: only fields that changed this turn; null for the rest. promisesMade records only a scheduled check-in (and needs should_follow_up true). Never record an action as done.",
    "- unsupported: null normally. If the patient asks you to do something that no loaded rule, fact or link can accomplish, set a short reason and leave reply empty.",
    "Example of the shape (entity ids and content are illustrative only; use the ids in FACTS):",
    JSON.stringify(EXAMPLE),
  ].join("\n");
  return { system, approxTokens: Math.round(system.length / 4) };
}
