import { z } from "zod";

// ---- Input -----------------------------------------------------------------

export const InputItemSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
});
export const InputSchema = z.array(InputItemSchema);
export type InputItem = z.infer<typeof InputItemSchema>;

// ---- Reply (mirrors the packet's TypeScript interfaces exactly) ------------

export const WorkingMemoryUpdatesSchema = z
  .object({
    collectionState: z
      .object({
        areaAskCount: z.number().nullable().optional(),
        lastAskedItem: z.enum(["area", "name", "photos", "none"]).nullable().optional(),
        nameAskCount: z.number().nullable().optional(),
        photoAskCount: z.number().nullable().optional(),
      })
      .strict()
      .nullable()
      .optional(),
    communicationStyle: z
      .enum(["detailed", "concise", "casual", "formal", "unknown"])
      .nullable()
      .optional(),
    escalationFlags: z.string().nullable().optional(),
    keyConcerns: z.string().nullable().optional(),
    patientName: z.string().nullable().optional(),
    preferredPaymentMethod: z
      .enum(["financing", "layaway", "pay_in_full", "cash_preference", "unknown"])
      .nullable()
      .optional(),
    procedureArea: z.string().nullable().optional(),
    promisesMade: z.string().nullable().optional(),
    targetProcedureWindow: z
      .enum([
        "within_3_months",
        "within_6_months",
        "within_8_months",
        "within_12_months",
        "over_12_months",
        "unknown",
      ])
      .nullable()
      .optional(),
  })
  .strict();
export type WorkingMemoryUpdates = z.infer<typeof WorkingMemoryUpdatesSchema>;

export const ReplySchema = z
  .object({
    response: z.string().min(1),
    escalate: z.boolean(),
    escalationReason: z.string().nullable(),
    templateId: z.null(),
    intent: z.string().min(1),
    shouldFollowUp: z.boolean(),
    followUpTiming: z.string().nullable(),
    attachmentUrls: z.array(z.string().url()).max(3).nullable(),
    highEngagement: z.boolean(),
    workingMemoryUpdates: WorkingMemoryUpdatesSchema.nullable(),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (r.escalate && !r.escalationReason) {
      ctx.addIssue({ code: "custom", message: "escalate=true requires escalationReason" });
    }
    if (!r.escalate && r.escalationReason !== null) {
      ctx.addIssue({ code: "custom", message: "escalationReason must be null when escalate=false" });
    }
    if (r.shouldFollowUp !== (r.followUpTiming !== null)) {
      ctx.addIssue({ code: "custom", message: "followUpTiming must be set iff shouldFollowUp" });
    }
  });
export type Reply = z.infer<typeof ReplySchema>;

// ---- Internal decision object (produced by a DecisionAdapter) --------------

export const UNSUPPORTED_ACTIONS = [
  "none",
  "charge_card",
  "move_paid_money",
  "contact_clinic",
  "hold_date",
  "change_booking",
  "offchannel_call",
  "honor_claimed_discount",
  "other_offchannel",
] as const;
export type UnsupportedAction = (typeof UNSUPPORTED_ACTIONS)[number];

export const PAYMENT_MODES = ["none", "policy_question", "link_request", "execution_request"] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export interface ChoiceAnswer<T extends string = string> {
  choice: T;
  probabilities: Record<string, number>;
}

export interface Decision {
  adapter: string;
  needsHuman: number;
  medicalUrgent: number;
  selfHarm: number;
  abuseOrLegal: number;
  promptInjection: number;
  pausing: number;
  highEngagement: number;
  unsupportedAction: ChoiceAnswer<UnsupportedAction>;
  paymentMode: ChoiceAnswer<PaymentMode>;
  clinicMentioned: ChoiceAnswer; // clinic id | "both" | "none" | "ambiguous"
  clinicLean: ChoiceAnswer; // clinic id | "torn" | "none"
  packageLean: ChoiceAnswer; // package id | "torn" | "none"
  communicationStyle: ChoiceAnswer;
  targetWindow: ChoiceAnswer;
  skills: Record<string, number>;
  latencyMs: number;
  raw?: unknown;
}

export type Route = "handoff" | "clarify" | "answer";
