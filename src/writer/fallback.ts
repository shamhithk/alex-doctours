import type { Decision } from "../contracts.js";
import type { ClinicEntity, Ledger, PackageEntity } from "../evidence/ledger.js";
import type { WriterOutput } from "../validation/validate.js";
import { THRESHOLDS } from "../policy/gate.js";

/**
 * Deterministic replacement for a SUPPORTED informational request whose drafts
 * failed validation twice. It is a complete WriterOutput built from clause tokens
 * and ledger link ids only, chosen by what the patient asked, and it goes through
 * the same render + validate path as a model draft before anything is committed.
 * The rejected draft contributes nothing (no text, memory, follow-up or claims).
 *
 * Returns { escalate } when the request looks like an ACTION (any adapter flagged
 * one): an unfulfillable action is a handoff, not a missing detail.
 */
export function buildFallback(skills: string[], ledger: Ledger, text: string, d: Decision): { out: WriterOutput } | { escalate: string } {
  const a = d.unsupportedAction;
  if (a.choice !== "none" && (a.probabilities[a.choice] ?? 0) >= THRESHOLDS.uncertainLow) return { escalate: `possible action request (${a.choice})` };

  const t = text.toLowerCase();
  const clinics = ledger.allEntities().filter((e): e is ClinicEntity => e.kind === "clinic");
  const scoped = scopeClinics(clinics, d, t);
  const pkgs = scoped.flatMap((c) => c.packageRefs.map((r) => ledger.entity(r) as PackageEntity)).filter(Boolean);
  const named = pkgs.filter((p) => t.includes(p.name.toLowerCase()));
  const pkgScope = named.length ? named : pkgs;
  const parts: string[] = [];
  const sources: string[] = [];
  const links: string[] = [];
  const add = (token: string) => {
    const [ref, kind] = token.slice(2, -2).split(":");
    if (ledger.renderClause(ref, kind) === null) return false;
    parts.push(`${token}.`);
    sources.push(`${ref}:${kind}`);
    return true;
  };

  if (/\b(?:doctors?|surgeons?|who\s+(?:does|performs))\b/.test(t)) for (const c of scoped) add(`{{${c.ref}:doctors}}`);
  if (/\b(?:includ|hotel|nights?|come with|what'?s in)\w*/.test(t)) for (const p of pkgScope) add(`{{${p.ref}:inclusions}}`);
  if (/\b(?:which days?|weekdays?|monday|tuesday|wednesday|thursday|friday|saturday|sunday|book on)\b/.test(t)) for (const p of pkgScope) add(`{{${p.ref}:weekdays}}`);
  if (/\b(?:afro|4c|curl\w*|textured|special\w*)\b/.test(t)) for (const c of scoped) add(`{{${c.ref}:specialty}}`);
  if (/\b(?:what|which|how many)\s+packages?\b/.test(t)) for (const c of scoped) add(`{{${c.ref}:packages}}`);
  // Price only for an actual price question: a "$500" or "deposit" inside another question (splitting
  // the deposit, paying it with Klarna) must not turn into a price list.
  const priceQuestion = /\b(?:cost|costs|price|prices|pricing|how much|expensive|cheap)\b/.test(t) || /\b(?:how much|what)\b[^?.!]{0,25}\bdeposit\b/.test(t);
  const paymentMethodQuestion = /\b(?:klarna|paypal|layaway|financ\w*|monthly|installments?|instalments?|split|break\s+(?:it|the))\b/.test(t);
  if (priceQuestion && !paymentMethodQuestion) for (const p of pkgScope) add(`{{${p.ref}:price+deposit}}`);
  if (skills.includes("payment") && (d.paymentMode.choice === "link_request" || /\b(?:pay|book|checkout)\b/.test(t))) {
    const link = ledger.links.find((l) => /payment link|checkout link/.test(l.label)) ?? ledger.links.find((l) => l.label.startsWith("Patient's personal assessment"));
    if (link) {
      parts.push(link.label.startsWith("Patient's personal assessment") ? "You can book and pay your deposit from your assessment using the link below." : "You can pay the deposit using the link below.");
      links.push(link.id);
      sources.push(link.id, "payment.assessment-book");
    }
  }
  if (skills.includes("consultation") && /\bconsult/.test(t)) {
    const link = ledger.links.find((l) => l.url.endsWith("/consultation"));
    if (ledger.renderClause("R", "consultation") !== null) {
      parts.push("{{R:consultation}}." + (link ? " You can book it using the link below." : ""));
      sources.push("R:consultation");
    } else if (link) parts.push("You can book the consultation using the link below.");
    if (link) links.push(link.id);
  }
  const reply = parts.length ? parts.join(" ") : "I don't have that exact detail.";
  return {
    out: {
      reply,
      link_ids: links,
      attachment_ids: [],
      claims: parts.length ? [{ text: "deterministic fallback from verified facts", sources }] : [],
      intent: parts.length ? "answer from verified facts" : "state missing detail",
      should_follow_up: false,
      follow_up_timing: null,
      memory: null,
      unsupported: null,
    },
  };
}

function scopeClinics(clinics: ClinicEntity[], d: Decision, t: string): ClinicEntity[] {
  const ids = new Set([d.clinicMentioned.choice, d.clinicLean.choice]);
  const byRouter = clinics.filter((c) => ids.has(c.id));
  if (byRouter.length) return byRouter;
  const byName = clinics.filter((c) => t.includes(c.name.toLowerCase().replace(/ clinic$/, "")));
  return byName.length ? byName : clinics;
}
