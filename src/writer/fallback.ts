import type { Ledger } from "../evidence/ledger.js";

/**
 * Deterministic minimal reply for a SUPPORTED request whose drafts failed
 * validation twice. Built only from ledger facts and links, so it cannot state
 * anything unverified. Returns null when nothing safe can be composed.
 */
export function minimalReply(skills: string[], ledger: Ledger): { text: string; intent: string } | null {
  const parts: string[] = [];
  const links: string[] = [];
  const byClinic = new Map<string, { name: string; pkgs: Map<string, { name: string; price?: string; deposit?: string }> }>();
  for (const f of ledger.facts) {
    if (!f.entity.packageId || !f.entity.clinicName) continue;
    const c = byClinic.get(f.entity.clinicName) ?? { name: f.entity.clinicName, pkgs: new Map() };
    const p = c.pkgs.get(f.entity.packageId) ?? { name: f.entity.packageName ?? "" };
    if (f.key === "package.basePrice") p.price = f.render;
    if (f.key === "package.depositAmount") p.deposit = f.render;
    c.pkgs.set(f.entity.packageId, p);
    byClinic.set(f.entity.clinicName, c);
  }
  if (["clinic-packages", "payment", "what-matters", "promo-discount"].some((s) => skills.includes(s))) {
    for (const c of byClinic.values()) {
      const list = [...c.pkgs.values()].filter((p) => p.price && p.deposit).map((p) => `${p.name} is ${p.price} with a ${p.deposit} deposit`);
      if (list.length) parts.push(`${c.name}: ${list.join("; ")}.`);
    }
  }
  const assessment = ledger.links.find((l) => l.label.startsWith("Patient's personal assessment"));
  if (skills.includes("payment") && assessment) {
    parts.push("You can book and pay your deposit from your assessment using the link below.");
    links.push(assessment.url);
  }
  if (!parts.length) return null;
  return { text: [parts.join(" "), ...links].join("\n"), intent: "answer from verified facts" };
}
