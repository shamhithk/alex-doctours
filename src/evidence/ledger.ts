import type { ToolRecord } from "../tools/executor.js";

/**
 * Evidence ledger for one turn: typed entities built from tool results.
 * The writer never states a commercial fact in its own words. It references a
 * CLAUSE TOKEN bound to an entity, e.g. {{P2:price+deposit}}, and code renders
 * the entity name and the value together ("Gold is $4,500 USD with a $600
 * deposit"). A price cannot be attached to the wrong package because the name
 * and the number are produced by the same function from the same record.
 */

export interface PackageEntity {
  id: string;
  kind: "package";
  ref: string; // P1, P2 ...
  name: string;
  clinicId: string;
  clinicName: string;
  price: number;
  deposit: number;
  currency: string;
  included: { name: string; qty: number; unit: string }[];
  weekdays: string[];
  note: string | null;
  source: string;
}

export interface ClinicEntity {
  id: string;
  kind: "clinic";
  ref: string; // C1, C2 ...
  name: string;
  location?: string;
  specialty?: string;
  practiceType?: string;
  bestFor?: string[];
  packageRefs: string[];
  doctors?: { name: string; title: string }[];
  ranking?: number;
  sources: string[];
}

export interface AssessmentEntity {
  kind: "assessment";
  ref: "AS";
  graftLow?: number;
  graftHigh?: number;
  shareStatus?: string;
  source: string;
}

export type Entity = PackageEntity | ClinicEntity | AssessmentEntity;

export interface LinkRef {
  id: string;
  url: string;
  label: string;
  source: string;
}

export interface AttachmentRef {
  id: string;
  url: string;
  label: string;
  source: string;
}

export interface ContextFact {
  key: string;
  text: string;
  source: string;
}

const WEEKDAY: Record<string, string> = { MON: "Monday", TUE: "Tuesday", WED: "Wednesday", THU: "Thursday", FRI: "Friday", SAT: "Saturday", SUN: "Sunday" };
const NUM_WORD = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const money = (n: number, currency = "USD", withCode = true) =>
  `${currency === "USD" ? "$" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : ""}${n.toLocaleString("en-US")}${withCode ? ` ${currency}` : ""}`;
const count = (n: number) => NUM_WORD[n] ?? String(n);
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const plural = (n: number, unit: string) => `${unit}${n === 1 ? "" : "s"}`;
const sentenceCase = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Clause kinds available per entity kind: kind -> renderer. */
const PACKAGE_CLAUSES: Record<string, (p: PackageEntity) => string | null> = {
  name: (p) => p.name,
  price: (p) => `${p.name} is ${money(p.price, p.currency)}`,
  deposit: (p) => `the ${p.name} deposit is ${money(p.deposit, p.currency, false)}`,
  "price+deposit": (p) => `${p.name} is ${money(p.price, p.currency)} with a ${money(p.deposit, p.currency, false)} deposit`,
  inclusions: (p) => (p.included.length ? `${p.name} includes ${list(p.included.map((a) => `${a.qty} ${a.name.toLowerCase()} ${plural(a.qty, a.unit)}`))}` : null),
  weekdays: (p) => (p.weekdays.length ? `${p.name} can be booked on ${list(p.weekdays.map((d) => WEEKDAY[d] ?? d))}` : null),
  note: (p) => (p.note ? `on ${p.name}, ${sentenceCase(p.note.replace(/\.$/, ""))}` : null),
};
const CLINIC_CLAUSES: Record<string, (c: ClinicEntity, l: Ledger) => string | null> = {
  name: (c) => c.name,
  location: (c) => (c.location ? `${c.name} is in ${c.location}` : null),
  specialty: (c) => (c.specialty ? `${c.name} specializes in ${c.specialty.toLowerCase().replace(/^afro/, "Afro")}` : null),
  "practice-type": (c) => (c.practiceType ? `${c.name} is ${sentenceCase(c.practiceType)}` : null),
  "best-for": (c) => (c.bestFor?.length ? `${c.name} is best for ${list(c.bestFor)}` : null),
  "package-count": (c) => (c.packageRefs.length ? `${c.name} has ${count(c.packageRefs.length)} ${plural(c.packageRefs.length, "package")}` : null),
  packages: (c, l) =>
    c.packageRefs.length
      ? `${c.name} has ${count(c.packageRefs.length)} ${plural(c.packageRefs.length, "package")}: ${list(c.packageRefs.map((r) => (l.entity(r) as PackageEntity).name))}`
      : null,
  doctors: (c) =>
    c.doctors?.length
      ? c.doctors.length === 1
        ? `${c.doctors[0].name} is the ${c.doctors[0].title.toLowerCase()} at ${c.name}`
        : `${c.name}'s doctors are ${list(c.doctors.map((d) => `${d.name} (${d.title.toLowerCase()})`))}`
      : null,
};
const ASSESSMENT_CLAUSES: Record<string, (a: AssessmentEntity) => string | null> = {
  "graft-range": (a) =>
    a.graftLow && a.graftHigh ? `your assessment estimates ${a.graftLow.toLocaleString("en-US")} to ${a.graftHigh.toLocaleString("en-US")} grafts` : null,
};

export class Ledger {
  private entities = new Map<string, Entity>();
  private byId = new Map<string, string>();
  links: LinkRef[] = [];
  attachments: AttachmentRef[] = [];
  context: ContextFact[] = [];
  notes: string[] = [];

  entity(ref: string): Entity | undefined {
    return this.entities.get(ref);
  }
  allEntities(): Entity[] {
    return [...this.entities.values()];
  }
  refFor(id: string): string | undefined {
    return this.byId.get(id);
  }

  private clinic(id: string, name: string, source: string): ClinicEntity {
    const ref = this.byId.get(id);
    if (ref) {
      const c = this.entities.get(ref) as ClinicEntity;
      if (!c.sources.includes(source)) c.sources.push(source);
      return c;
    }
    const c: ClinicEntity = { id, kind: "clinic", ref: `C${[...this.entities.values()].filter((e) => e.kind === "clinic").length + 1}`, name, packageRefs: [], sources: [source] };
    this.entities.set(c.ref, c);
    this.byId.set(id, c.ref);
    return c;
  }

  addLink(url: string, label: string, source: string) {
    if (this.links.some((l) => l.url === url)) return;
    this.links.push({ id: `L${this.links.length + 1}`, url, label, source });
  }

  private addAttachment(url: string, label: string, source: string) {
    if (this.attachments.some((a) => a.url === url)) return;
    this.attachments.push({ id: `IMG${this.attachments.length + 1}`, url, label, source });
  }

  ingest(rec: ToolRecord) {
    if (!rec.ok) {
      this.notes.push(`${rec.tool} failed (${rec.error}); no data from it.`);
      return;
    }
    const r: any = rec.result;
    const src = rec.callId;
    if (r === null || r === undefined) {
      this.notes.push(`${rec.tool}(${JSON.stringify(rec.args)}) returned no data. Do not fill the gap.`);
      return;
    }
    switch (rec.tool) {
      case "getClinicPackages": {
        const clinicId = r.packages?.[0]?.clinicId as string | undefined;
        if (!clinicId) {
          this.notes.push(`getClinicPackages returned no packages for ${r.clinicName}.`);
          break;
        }
        const c = this.clinic(clinicId, r.clinicName, src);
        for (const flag of r.clinic_flags ?? []) {
          if (flag.name === "Speciality") c.specialty = flag.value;
          if (flag.name === "Practice type") c.practiceType = flag.value;
        }
        for (const p of r.packages ?? []) {
          if (this.byId.has(p.id)) continue;
          const ref = `P${[...this.entities.values()].filter((e) => e.kind === "package").length + 1}`;
          const pkg: PackageEntity = {
            id: p.id,
            kind: "package",
            ref,
            name: p.name,
            clinicId: p.clinicId,
            clinicName: r.clinicName,
            price: p.basePrice,
            deposit: p.depositAmount,
            currency: p.currency ?? r.currency ?? "USD",
            included: (p.includedAddons ?? []).map((a: any) => ({ name: a.name, qty: a.includedQuantity, unit: a.unitDescription })),
            weekdays: p.bookableWeekdays ?? [],
            note: p.aiContext ?? null,
            source: src,
          };
          this.entities.set(ref, pkg);
          this.byId.set(p.id, ref);
          c.packageRefs.push(ref);
        }
        break;
      }
      case "getAllClinics":
      case "getSavedClinics": {
        const items = rec.tool === "getAllClinics" ? r.clinics : r.savedClinics.map((s: any) => ({ ...s.clinic, ranking: s.ranking }));
        for (const x of items ?? []) {
          const c = this.clinic(x.id, x.name, src);
          const country = x.address?.country === "TR" ? "Turkey" : x.address?.country;
          if (x.address?.city) c.location = `${x.address.city}, ${country}`;
          for (const flag of x.clinic_flags ?? []) {
            if (flag.name === "Speciality") c.specialty = flag.value;
            if (flag.name === "Practice type") c.practiceType = flag.value;
          }
          if (x.ai_context?.bestFor?.length) c.bestFor = x.ai_context.bestFor;
          if (x.ranking) c.ranking = x.ranking;
          if (x.slug) this.addLink(`https://www.doctours.com/clinic/${x.slug}`, `Doctours clinic page for ${x.name}`, src);
        }
        break;
      }
      case "getClinicDoctors": {
        const c = this.clinic(r.clinicId, r.clinicName, src);
        c.doctors = (r.doctors ?? []).map((d: any) => ({ name: d.name, title: d.title }));
        break;
      }
      case "getLatestAssessment": {
        if (r.assessmentUrl && r.shareStatus !== "not_ready") this.addLink(r.assessmentUrl, "Patient's personal assessment (has a Book button that opens deposit checkout)", src);
        this.entities.set("AS", { kind: "assessment", ref: "AS", graftLow: r.graftRange?.low, graftHigh: r.graftRange?.high, shareStatus: r.shareStatus, source: src });
        break;
      }
      case "getPaymentLink": {
        if (r.status === "ready" && r.url) {
          const what = r.linkType === "payment" ? `deposit payment link for ${r.clinicName} · ${r.clinicPackageName}` : `deposit checkout link for ${r.clinicName}`;
          this.addLink(r.url, what, src);
        } else this.notes.push(`getPaymentLink did not return a link (${r.reason ?? r.status}). Do not write a payment URL.`);
        break;
      }
      case "getPatientImages": {
        for (const [angle, v] of Object.entries<any>(r.angles ?? {})) for (const url of v.urls ?? []) this.addAttachment(url, `${angle} photo`, src);
        this.context.push({ key: "images.uploadedAngles", text: `Uploaded photo angles: ${(r.uploadedAngles ?? []).join(", ") || "none"}`, source: src });
        break;
      }
      case "getPatientContext": {
        const s = r.clinicSelectionPreferences ?? {};
        const sel = s.selectedClinicId ? (this.entities.get(this.byId.get(s.selectedClinicId) ?? "") as ClinicEntity | undefined)?.name ?? "a saved clinic" : "none";
        this.context.push({ key: "patient.selection", text: `Saved clinic selection: ${sel}; saved package selection: ${s.selectedPackageId ? "yes" : "none"}`, source: src });
        if (r.tentativeProcedureDates?.text) this.context.push({ key: "patient.tentativeDates", text: `Patient's tentative timing: ${r.tentativeProcedureDates.text}`, source: src });
        break;
      }
      case "getConsultationRescheduleLink": {
        this.context.push({ key: "consultation.status", text: `Consultation on file: ${r.status === "no_consultation" ? "none scheduled" : r.status}`, source: src });
        if (r.url) this.addLink(r.url, "Consultation reschedule link", src);
        break;
      }
      case "getFullCalls": {
        for (const c of r.calls ?? []) this.context.push({ key: "call.summary", text: `Call on ${String(c.createdAt).slice(0, 10)} (context only, never a source of price or policy): ${c.summary}`, source: src });
        break;
      }
      default:
        break;
    }
  }

  /** Render one clause token; null if the entity or clause does not exist or has no data. */
  renderClause(ref: string, kind: string): string | null {
    const e = this.entities.get(ref);
    if (!e) return null;
    if (e.kind === "package") return PACKAGE_CLAUSES[kind]?.(e) ?? null;
    if (e.kind === "clinic") return CLINIC_CLAUSES[kind]?.(e, this) ?? null;
    return ASSESSMENT_CLAUSES[kind]?.(e) ?? null;
  }

  /** All clause tokens that render, with previews (what the writer sees). */
  availableClauses(): { token: string; ref: string; kind: string; preview: string }[] {
    const out: { token: string; ref: string; kind: string; preview: string }[] = [];
    for (const e of this.entities.values()) {
      const kinds = Object.keys(e.kind === "package" ? PACKAGE_CLAUSES : e.kind === "clinic" ? CLINIC_CLAUSES : ASSESSMENT_CLAUSES);
      for (const kind of kinds) {
        const preview = this.renderClause(e.ref, kind);
        if (preview) out.push({ token: `{{${e.ref}:${kind}}}`, ref: e.ref, kind, preview });
      }
    }
    return out;
  }

  factsBlock(): string {
    const lines: string[] = [];
    for (const e of this.entities.values()) {
      const header =
        e.kind === "package" ? `${e.ref} = package "${e.name}" at ${e.clinicName}` : e.kind === "clinic" ? `${e.ref} = clinic "${e.name}"` : `AS = the patient's assessment`;
      lines.push(header);
      for (const c of this.availableClauses().filter((x) => x.ref === e.ref)) lines.push(`  ${c.token} → "${c.preview}"`);
    }
    for (const c of this.context) lines.push(`(context) ${c.text}`);
    return lines.length ? lines.join("\n") : "(no facts fetched this turn)";
  }

  linksBlock(): string {
    return this.links.length ? this.links.map((l) => `${l.id}: ${l.label}`).join("\n") : "(no links available this turn)";
  }

  attachmentsBlock(): string {
    return this.attachments.length ? this.attachments.map((a) => `${a.id}: ${a.label}`).join("\n") : "(none)";
  }

  link(id: string) {
    return this.links.find((l) => l.id === id);
  }
  attachment(id: string) {
    return this.attachments.find((a) => a.id === id);
  }
  /** Number of renderable facts (for traces). */
  get factCount() {
    return this.availableClauses().length;
  }
}
