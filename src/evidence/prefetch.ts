import type { Decision } from "../contracts.js";
import type { PatientContext } from "../context.js";
import type { ToolExecutor } from "../tools/executor.js";
import type { Ledger } from "./ledger.js";
import { choiceP } from "../decision/adapter.js";
import { PACKAGES } from "../packet/tools.js";

/**
 * Code-first evidence: for the intents the router found, call the supplied
 * tools deterministically and register their results in the ledger. The
 * writer may still request other read tools (bounded), but the common paths
 * never depend on the model choosing the right tool.
 */
export function prefetch(skills: string[], d: Decision, ctx: PatientContext, text: string, exec: ToolExecutor, ledger: Ledger) {
  const has = (id: string) => skills.includes(id);
  const clinicIds = clinicsInScope(skills, d, ctx);
  const run = (tool: string, args: Record<string, unknown> = {}) => ledger.ingest(exec.run(tool, args, "code"));

  if (has("clinic-selection")) {
    run("getSavedClinics");
    run("getAllClinics");
  }
  if (["clinic-packages", "payment", "what-matters", "promo-discount"].some(has)) {
    for (const id of clinicIds) run("getClinicPackages", { clinicId: id });
  }
  if (/\b(?:doctors?|surgeons?|who\s+(?:does|performs)|dr\.?\s+\w+\s+(?:himself|herself|personally))\b/i.test(text)) {
    for (const id of clinicIds) run("getClinicDoctors", { clinicId: id });
  }
  if (has("payment") || has("assessment")) run("getLatestAssessment");
  if (has("payment")) {
    run("getPatientContext");
    const pkg = resolvedPackage(d);
    const leanClinic = ctx.clinics.find((c) => c.id === d.clinicLean.choice && choiceP(d.clinicLean) >= 0.6);
    if (d.paymentMode.choice === "link_request") {
      // Decided package -> payment link; clinic decided but not package -> checkout link.
      if (pkg) run("getPaymentLink", { type: "payment", clinicPackageId: pkg });
      else if (leanClinic) run("getPaymentLink", { type: "checkout", clinicId: leanClinic.id });
    }
  }
  if (has("images")) run("getPatientImages");
  if (has("consultation")) run("getConsultationRescheduleLink");
  if (has("call-context")) run("getFullCalls", { chatId: ctx.chatId, limit: 3 });
}

export function clinicsInScope(skills: string[], d: Decision, ctx: PatientContext): string[] {
  const ids = new Set<string>();
  const known = new Set(ctx.clinics.map((c) => c.id));
  const cm = d.clinicMentioned.choice;
  if (known.has(cm)) ids.add(cm);
  if (cm === "both") ctx.clinics.forEach((c) => ids.add(c.id));
  if (known.has(d.clinicLean.choice)) ids.add(d.clinicLean.choice);
  const pkg = PACKAGES.find((p) => p.id === d.packageLean.choice);
  if (pkg) ids.add(pkg.clinicId);
  // No clinic resolved: the patient has 2 saved clinics, so fetch both (cheap, exact, lets the writer compare).
  if (!ids.size) ctx.clinics.forEach((c) => ids.add(c.id));
  return [...ids];
}

export function resolvedPackage(d: Decision): string | undefined {
  const pkg = PACKAGES.find((p) => p.id === d.packageLean.choice);
  return pkg && choiceP(d.packageLean) >= 0.5 ? pkg.id : undefined;
}
