import { z } from "zod";
import * as T from "../packet/tools.js";
import type { ToolSpec } from "../llm/client.js";

/**
 * The only operational surface: the 14 functions supplied in the packet.
 * Prose in the old prompt names other tools (trip, booking, airport tools);
 * they do not exist here and are rejected by name.
 */
export type ToolKind = "read" | "write";

interface ToolDef {
  name: string;
  kind: ToolKind;
  description: string;
  input: z.ZodType<Record<string, unknown>>;
  parameters: Record<string, unknown>;
  fn: (args: any) => unknown;
}

const clinicRef = z.object({ clinicId: z.string().optional(), clinicName: z.string().optional() }).strict();
const userRef = z.object({ userId: z.string().optional() }).strict();
const clinicRefSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    clinicId: { type: "string", description: "Canonical clinic id from getAllClinics / getSavedClinics." },
    clinicName: { type: "string", description: "Clinic name, e.g. \"Heva Clinic\"." },
  },
};
const userRefSchema = { type: "object", additionalProperties: false, properties: { userId: { type: "string" } } };

const defs: ToolDef[] = [
  {
    name: "getAllClinics",
    kind: "read",
    description: "List all partner clinics with ids, slugs (for the Doctours clinic page), city/country, clinic_flags and ai_context.",
    input: z.object({}).strict(),
    parameters: { type: "object", additionalProperties: false, properties: {} },
    fn: () => T.getAllClinics(),
  },
  {
    name: "getSavedClinics",
    kind: "read",
    description: "The patient's assessment clinic recommendations (saved clinics) with ranking.",
    input: userRef,
    parameters: userRefSchema,
    fn: (a) => T.getSavedClinics(a),
  },
  {
    name: "getClinicPackages",
    kind: "read",
    description: "Packages for ONE clinic: names, basePrice, depositAmount, currency, bookableWeekdays, includedAddons, aiContext.",
    input: clinicRef,
    parameters: clinicRefSchema,
    fn: (a) => T.getClinicPackages(a),
  },
  {
    name: "getClinicDoctors",
    kind: "read",
    description: "Doctors (name, title) for ONE clinic.",
    input: clinicRef,
    parameters: clinicRefSchema,
    fn: (a) => T.getClinicDoctors(a),
  },
  {
    name: "getLatestAssessment",
    kind: "read",
    description: "The patient's personal assessment link (assessmentUrl), graft range and share status.",
    input: userRef,
    parameters: userRefSchema,
    fn: (a) => T.getLatestAssessment(a),
  },
  {
    name: "getPatientContext",
    kind: "read",
    description: "Profile, pipeline status, saved clinic/package selection and tentative procedure dates.",
    input: userRef,
    parameters: userRefSchema,
    fn: (a) => T.getPatientContext(a),
  },
  {
    name: "getPatientImages",
    kind: "read",
    description: "Which intake photo angles are uploaded, with hosted URLs.",
    input: userRef,
    parameters: userRefSchema,
    fn: (a) => T.getPatientImages(a),
  },
  {
    name: "getPaymentLink",
    kind: "read",
    description:
      "Exact Doctours deposit link. type=\"payment\" needs clinicPackageId (a package id from getClinicPackages); type=\"checkout\" needs clinicId.",
    input: z
      .object({
        type: z.enum(["payment", "checkout"]),
        clinicPackageId: z.string().optional(),
        clinicId: z.string().optional(),
      })
      .strict(),
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["type"],
      properties: {
        type: { type: "string", enum: ["payment", "checkout"] },
        clinicPackageId: { type: "string" },
        clinicId: { type: "string" },
      },
    },
    fn: (a) => T.getPaymentLink(a),
  },
  {
    name: "getConsultationRescheduleLink",
    kind: "read",
    description: "Reschedule link for the patient's free consultation call (consultation only, never procedure dates).",
    input: userRef,
    parameters: userRefSchema,
    fn: (a) => T.getConsultationRescheduleLink(a),
  },
  {
    name: "getFullCalls",
    kind: "read",
    description: "Full records (summary + transcript) of recent calls. Use only when the message depends on a recent call.",
    input: z.object({ chatId: z.string().optional(), limit: z.number().int().positive().optional() }).strict(),
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { chatId: { type: "string" }, limit: { type: "integer" } },
    },
    fn: (a) => T.getFullCalls(a),
  },
  {
    name: "issuePromoCode",
    kind: "write",
    description: "Cuts a promo code when an active promo exists. Never called for a patient with no promo.",
    input: userRef,
    parameters: userRefSchema,
    fn: (a) => T.issuePromoCode(a),
  },
  {
    name: "updateUser",
    kind: "write",
    description: "Save the patient's first/last name (only if none is on file).",
    input: z.object({ firstName: z.string().optional(), lastName: z.string().optional(), userId: z.string().optional() }).strict(),
    parameters: {},
    fn: (a) => T.updateUser(a),
  },
  {
    name: "updateUserClinicPreferences",
    kind: "write",
    description: "Save clinic/package selection state.",
    input: z.object({ clinicSelection: z.record(z.string(), z.unknown()).optional(), userId: z.string().optional() }).strict(),
    parameters: {},
    fn: (a) => T.updateUserClinicPreferences(a),
  },
  {
    name: "updateWorkingMemory",
    kind: "write",
    description: "Merge a partial working-memory patch.",
    input: z.object({ memory: z.record(z.string(), z.unknown()).optional() }).strict(),
    parameters: {},
    fn: (a) => T.updateWorkingMemory(a),
  },
];

export const TOOLS: ReadonlyMap<string, ToolDef> = new Map(defs.map((d) => [d.name, d]));

/** The old prompt calls tools "<name>Tool"; accept that alias, nothing else. */
export function resolveToolName(name: string): string | undefined {
  if (TOOLS.has(name)) return name;
  const stripped = name.replace(/Tool$/, "");
  return TOOLS.has(stripped) ? stripped : undefined;
}

export function toolSpecs(names: string[]): ToolSpec[] {
  return names
    .map((n) => TOOLS.get(n))
    .filter((d): d is ToolDef => !!d && d.kind === "read")
    .map((d) => ({ name: d.name, description: d.description, parameters: d.parameters }));
}

export const READ_TOOLS = defs.filter((d) => d.kind === "read").map((d) => d.name);
