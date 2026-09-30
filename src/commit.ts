import type { Decision, WorkingMemoryUpdates } from "./contracts.js";
import type { ToolExecutor, ToolRecord } from "./tools/executor.js";
import { clinicExists, packageBelongsToClinic } from "./tools/executor.js";
import { choiceP } from "./decision/adapter.js";
import { PACKAGES } from "./packet/tools.js";

export interface CommitResult {
  receipts: ToolRecord[];
  skipped: string[];
}

/** The selection write this turn would make, decided from typed router leans only (no side effects). */
export function planSelection(d: Decision, ctxClinicIds: string[]): { selection: Record<string, unknown>; skipped: string[] } {
  const skipped: string[] = [];
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
export function commitWrites(d: Decision, memoryPatch: WorkingMemoryUpdates | null, exec: ToolExecutor, ctxClinicIds: string[]): CommitResult {
  const receipts: ToolRecord[] = [];
  const { selection, skipped } = planSelection(d, ctxClinicIds);

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
