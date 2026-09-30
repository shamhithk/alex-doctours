import type { Decision, WorkingMemoryUpdates } from "./contracts.js";
import type { ToolExecutor, ToolRecord } from "./tools/executor.js";
import { clinicExists, packageBelongsToClinic } from "./tools/executor.js";
import { choiceP } from "./decision/adapter.js";
import { PACKAGES } from "./packet/tools.js";

export interface CommitResult {
  receipts: ToolRecord[];
  skipped: string[];
}

/**
 * Words that state a preference or decision. A lean from the router is saved only when the
 * message also contains one: a question that merely names a package or clinic is never a choice.
 * A missed save costs a later turn; a wrong save puts a choice in the patient's record they never made.
 */
export const PREFERENCE_CUE =
  /\b(?:go(?:ing)?\s+with|lean(?:ing)?|choos(?:e|ing)|chose|chosen|pick(?:ed|ing)?|prefer(?:red)?|decided|decide\s+on|settled?\s+on|let'?s\s+(?:do|go)|i'?ll\s+(?:take|do|go)|i'?d\s+(?:like|rather|go)|sounds\s+(?:good|great|perfect|right)|i\s+(?:really\s+)?(?:like|love|want)|wanna|it\s+is|that\s+one|sign\s+me\s+up|ready\s+to|book(?:ing)?\s+(?:with|the|it)|torn|between)\b/i;

/** The selection write this turn would make, decided from typed router leans only (no side effects). */
export function planSelection(d: Decision, ctxClinicIds: string[], text?: string): { selection: Record<string, unknown>; skipped: string[] } {
  const skipped: string[] = [];
  if (text !== undefined && !PREFERENCE_CUE.test(text)) {
    const leaned = (d.clinicLean.choice !== "none" && choiceP(d.clinicLean) >= 0.6) || (d.packageLean.choice !== "none" && choiceP(d.packageLean) >= 0.6);
    if (leaned) skipped.push("router lean without any preference wording in the message; nothing saved");
    return { selection: {}, skipped };
  }
  const clinicLean = d.clinicLean.choice;
  const pkg = PACKAGES.find((p) => p.id === d.packageLean.choice && choiceP(d.packageLean) >= 0.6);

  let selectedClinicId: string | undefined;
  if (ctxClinicIds.includes(clinicLean) && choiceP(d.clinicLean) >= 0.6 && clinicExists(clinicLean)) selectedClinicId = clinicLean;
  if (pkg && !selectedClinicId) selectedClinicId = pkg.clinicId;

  const selection: Record<string, unknown> = {};
  if (selectedClinicId) selection.selectedClinicId = selectedClinicId;
  if (pkg) {
    if (selectedClinicId && packageBelongsToClinic(pkg.id, selectedClinicId)) selection.selectedPackageId = pkg.id;
    else skipped.push(`package ${pkg.id} does not belong to clinic ${selectedClinicId}; not saved`);
  }
  if (d.clinicLean.choice === "torn" && choiceP(d.clinicLean) >= 0.6) selection.softClinicInterestIds = ctxClinicIds;
  if (d.packageLean.choice === "torn" && choiceP(d.packageLean) >= 0.6) skipped.push("torn between packages: no package saved without a clinic-scoped list");
  return { selection, skipped };
}

/**
 * Writes happen once, after the reply is validated, and never after a handoff.
 * Selection writes come from typed router decisions (not from model prose),
 * with clinic/package membership checked here because the stub does not.
 */
export function commitWrites(d: Decision, memoryPatch: WorkingMemoryUpdates | null, exec: ToolExecutor, ctxClinicIds: string[], text?: string): CommitResult {
  const receipts: ToolRecord[] = [];
  const { selection, skipped } = planSelection(d, ctxClinicIds, text);

  if (Object.keys(selection).length) {
    const rec = exec.run("updateUserClinicPreferences", { clinicSelection: selection }, "commit");
    receipts.push(rec);
    if (!rec.ok || rec.result === null) skipped.push("preference write returned no receipt; no persistence claimed");
  }
  if (memoryPatch && Object.keys(memoryPatch).length) {
    receipts.push(exec.run("updateWorkingMemory", { memory: memoryPatch }, "commit"));
  }
  return { receipts, skipped };
}
