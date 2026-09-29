import * as K from "./packet/constants.js";
import { CLINICS, PACKAGES } from "./packet/tools.js";

/**
 * The fixed patient context every message is answered against. Each input item
 * gets its own frozen copy (fresh turn state, same history), so nothing one
 * message does can leak into another.
 */
export interface PatientContext {
  now: string;
  coordinatorName: string;
  patientName: string;
  userId: string;
  chatId: string;
  stage: string;
  tier: string;
  financing: "yes" | "no" | "unknown";
  imagesOnFile: boolean;
  promo: "none" | "active" | "used";
  patientSummary: string;
  clinicFlags: string;
  collectionStatus: string;
  workingMemory: Record<string, unknown>;
  recentCalls: string;
  recentConversationSummary: string;
  chatList: string;
  clinics: { id: string; name: string; slug: string }[];
  packages: { id: string; clinicId: string; name: string }[];
  linksAlreadySent: string[];
}

const URL_RE = /https?:\/\/[^\s)]+/g;

export function buildContext(): PatientContext {
  const linksAlreadySent = [...new Set(K.CHAT_LIST.match(URL_RE) ?? [])];
  return Object.freeze({
    // The packet's system prompt fixes "now"; never use the wall clock.
    now: "September 27, 2026 at 07:37 PM UTC",
    coordinatorName: K.COORDINATOR_DISPLAY_NAME,
    patientName: K.PATIENT_NAME,
    userId: K.USER_ID,
    chatId: K.SUPABASE_CHAT_ID,
    stage: K.PIPELINE_STATUS,
    tier: K.TIER,
    financing: K.KLARNA_PAYPAL_FINANCING_ELIGIBLE === true ? "yes" : "no",
    imagesOnFile: K.HAS_PATIENT_IMAGES,
    promo: K.PROMO_OFFER === null ? "none" : "active",
    patientSummary: K.PATIENT_SUMMARY,
    clinicFlags: K.CLINIC_FLAGS,
    collectionStatus: K.COLLECTION_STATUS,
    workingMemory: JSON.parse(K.WORKING_MEMORY),
    recentCalls: K.RECENT_CALLS,
    recentConversationSummary: K.RECENT_CONVERSATION_SUMMARY,
    chatList: K.CHAT_LIST,
    clinics: CLINICS.map((c) => ({ id: c.id, name: c.name, slug: c.slug })),
    packages: PACKAGES.map((p) => ({ id: p.id, clinicId: p.clinicId, name: p.name })),
    linksAlreadySent,
  }) as PatientContext;
}

/** The packet's user-message template, filled exactly as the Flow section specifies. */
export function renderUserMessage(ctx: PatientContext, text: string): string {
  return [
    "Incoming thread message:",
    `"${text}"`,
    "Incoming image count: 0",
    `Chat kind: ${K.CHAT_KIND}`,
    `Triggering sender: ${K.SENDER_DISPLAY_NAME}`,
    "",
    "Recent conversation summary:",
    ctx.recentConversationSummary,
  ].join("\n");
}

export function flags(ctx: PatientContext): Record<string, string> {
  return {
    financing: ctx.financing,
    stage: ctx.stage,
    images: ctx.imagesOnFile ? "yes" : "no",
    promo: ctx.promo,
  };
}
