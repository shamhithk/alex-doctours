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
  reply: "Clinic A has two packages. Basic is {{F2}} with a {{F3}} deposit, and Plus is {{F5}} with a {{F6}} deposit. You can see both on the clinic page using the link below.",
  link_ids: ["L1"],
  attachment_ids: [],
  claims: [
    { text: "Basic price and deposit", sources: ["F2", "F3"] },
    { text: "Plus price and deposit", sources: ["F5", "F6"] },
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
    "# FACTS (verified by tools this turn; the ONLY source for prices, deposits, package contents and clinic facts)",
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
    "- Money: write every price or deposit ONLY as a fact token like {{F4}}; never type a dollar amount yourself. Put the package or clinic name in the same sentence as its token.",
    "- Links: never type a URL. When sending a link, say \"using the link below\" and put its id (e.g. \"L2\") in link_ids; links are appended as the last lines automatically.",
    "- Attachments: ids from ATTACHMENTS in attachment_ids (max 3), only when the patient asks for their photos.",
    "- claims: every factual statement in reply with its sources (F#, L#, or rule ids such as payment.assessment-pay).",
    "- should_follow_up / follow_up_timing: true with a human-readable interval (e.g. \"1 month\") only when a concrete check-in was set; otherwise false and null.",
    "- memory: only fields that changed this turn; null for the rest.",
    "- unsupported: null normally. If the patient asks you to do something that no loaded rule, fact or link can accomplish, set a short reason and leave reply empty.",
    "Example of the shape (content is illustrative only):",
    JSON.stringify(EXAMPLE),
  ].join("\n");
  return { system, approxTokens: Math.round(system.length / 4) };
}
