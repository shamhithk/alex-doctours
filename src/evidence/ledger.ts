import type { ToolRecord } from "../tools/executor.js";

/**
 * Evidence ledger for one turn. Every fact the writer may state and every URL
 * it may send is registered here with the tool call that produced it. The
 * writer references facts as {{F#}} and links as L#; code renders the values.
 */
export interface Fact {
  id: string;
  key: string;
  entity: { clinicId?: string; clinicName?: string; packageId?: string; packageName?: string };
  label: string;
  render: string;
  source: string;
  /** Names that must appear in the same sentence when the fact is used (attribution check). */
  anchors: string[];
  money?: number;
}

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

const money = (n: number, withCurrency: boolean, currency = "USD") =>
  `$${n.toLocaleString("en-US")}${withCurrency ? ` ${currency}` : ""}`;

export class Ledger {
  facts: Fact[] = [];
  links: LinkRef[] = [];
  attachments: AttachmentRef[] = [];
  notes: string[] = [];
  private seen = new Set<string>();

  private addFact(f: Omit<Fact, "id">) {
    const k = `${f.key}|${f.entity.clinicId ?? ""}|${f.entity.packageId ?? ""}|${f.render}`;
    if (this.seen.has(k)) return;
    this.seen.add(k);
    this.facts.push({ ...f, id: `F${this.facts.length + 1}` });
  }

  addLink(url: string, label: string, source: string) {
    if (this.links.some((l) => l.url === url)) return;
    this.links.push({ id: `L${this.links.length + 1}`, url, label, source });
  }

  private addAttachment(url: string, label: string, source: string) {
    if (this.attachments.some((a) => a.url === url)) return;
    this.attachments.push({ id: `A${this.attachments.length + 1}`, url, label, source });
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
        const clinicName: string = r.clinicName;
        const clinicId = (r.packages?.[0]?.clinicId as string) ?? undefined;
        for (const flag of r.clinic_flags ?? []) {
          this.addFact({
            key: `clinic.flag.${flag.name}`,
            entity: { clinicId, clinicName },
            label: `${clinicName} · ${flag.name}`,
            render: String(flag.value),
            source: src,
            anchors: [clinicName],
          });
        }
        this.addFact({
          key: "clinic.packageCount",
          entity: { clinicId, clinicName },
          label: `${clinicName} · number of packages`,
          render: String(r.packages?.length ?? 0),
          source: src,
          anchors: [clinicName],
        });
        for (const p of r.packages ?? []) {
          const e = { clinicId: p.clinicId, clinicName, packageId: p.id, packageName: p.name };
          const anchors = [p.name];
          this.addFact({ key: "package.name", entity: e, label: `${clinicName} · package name`, render: p.name, source: src, anchors: [clinicName] });
          this.addFact({
            key: "package.basePrice",
            entity: e,
            label: `${clinicName} · ${p.name} · price`,
            render: money(p.basePrice, true, p.currency),
            money: p.basePrice,
            source: src,
            anchors,
          });
          this.addFact({
            key: "package.depositAmount",
            entity: e,
            label: `${clinicName} · ${p.name} · deposit`,
            render: money(p.depositAmount, false, p.currency),
            money: p.depositAmount,
            source: src,
            anchors,
          });
          this.addFact({
            key: "package.bookableWeekdays",
            entity: e,
            label: `${clinicName} · ${p.name} · bookable weekdays`,
            render: (p.bookableWeekdays ?? []).join(", "),
            source: src,
            anchors,
          });
          for (const a of p.includedAddons ?? []) {
            this.addFact({
              key: "package.includedAddon",
              entity: e,
              label: `${clinicName} · ${p.name} · included`,
              render: `${a.includedQuantity} ${a.name.toLowerCase()} ${a.unitDescription}${a.includedQuantity === 1 ? "" : "s"} included`,
              source: src,
              anchors,
            });
          }
          if (p.aiContext) {
            this.addFact({
              key: "package.aiContext",
              entity: e,
              label: `${clinicName} · ${p.name} · package-specific note (paraphrase, applies to this package only)`,
              render: p.aiContext,
              source: src,
              anchors,
            });
          }
        }
        break;
      }
      case "getAllClinics":
      case "getSavedClinics": {
        const list = rec.tool === "getAllClinics" ? r.clinics : r.savedClinics.map((s: any) => ({ ...s.clinic, ranking: s.ranking }));
        for (const c of list ?? []) {
          const e = { clinicId: c.id, clinicName: c.name };
          this.addFact({ key: "clinic.location", entity: e, label: `${c.name} · location`, render: `${c.address?.city}, ${c.address?.country === "TR" ? "Turkey" : c.address?.country}`, source: src, anchors: [c.name] });
          for (const flag of c.clinic_flags ?? []) {
            this.addFact({ key: `clinic.flag.${flag.name}`, entity: e, label: `${c.name} · ${flag.name}`, render: String(flag.value), source: src, anchors: [c.name] });
          }
          if (c.ai_context?.patientFacingSummary) {
            this.addFact({ key: "clinic.summary", entity: e, label: `${c.name} · summary`, render: c.ai_context.patientFacingSummary, source: src, anchors: [c.name] });
          }
          if (c.ai_context?.bestFor?.length) {
            this.addFact({ key: "clinic.bestFor", entity: e, label: `${c.name} · best for`, render: c.ai_context.bestFor.join("; "), source: src, anchors: [c.name] });
          }
          if (c.ranking) {
            this.addFact({ key: "clinic.ranking", entity: e, label: `${c.name} · assessment recommendation rank`, render: String(c.ranking), source: src, anchors: [c.name] });
          }
          if (c.slug) this.addLink(`https://www.doctours.com/clinic/${c.slug}`, `Doctours clinic page for ${c.name}`, src);
        }
        break;
      }
      case "getClinicDoctors": {
        for (const d of r.doctors ?? []) {
          this.addFact({
            key: "clinic.doctor",
            entity: { clinicId: r.clinicId, clinicName: r.clinicName },
            label: `${r.clinicName} · doctor`,
            render: `${d.name} (${d.title})`,
            source: src,
            anchors: [r.clinicName],
          });
        }
        break;
      }
      case "getLatestAssessment": {
        if (r.assessmentUrl && r.shareStatus !== "not_ready") this.addLink(r.assessmentUrl, "Patient's personal assessment (has a Book button that opens deposit checkout)", src);
        if (r.graftRange) {
          this.addFact({ key: "assessment.graftRange", entity: {}, label: "Assessment graft estimate range", render: `${r.graftRange.low.toLocaleString("en-US")} to ${r.graftRange.high.toLocaleString("en-US")} grafts`, source: src, anchors: [] });
        }
        this.addFact({ key: "assessment.shareStatus", entity: {}, label: "Assessment status", render: String(r.shareStatus), source: src, anchors: [] });
        break;
      }
      case "getPaymentLink": {
        if (r.status === "ready" && r.url) {
          const what = r.linkType === "payment" ? `deposit payment link for ${r.clinicName} · ${r.clinicPackageName}` : `deposit checkout link for ${r.clinicName}`;
          this.addLink(r.url, what, src);
        } else {
          this.notes.push(`getPaymentLink did not return a link (${r.reason ?? r.status}). Do not write a payment URL.`);
        }
        break;
      }
      case "getPatientImages": {
        for (const [angle, v] of Object.entries<any>(r.angles ?? {})) {
          for (const url of v.urls ?? []) this.addAttachment(url, `${angle} photo`, src);
        }
        this.addFact({ key: "images.uploadedAngles", entity: {}, label: "Uploaded photo angles", render: (r.uploadedAngles ?? []).join(", ") || "none", source: src, anchors: [] });
        break;
      }
      case "getPatientContext": {
        const s = r.clinicSelectionPreferences ?? {};
        this.addFact({ key: "patient.selectedClinicId", entity: {}, label: "Saved selected clinic id", render: String(s.selectedClinicId ?? "none"), source: src, anchors: [] });
        this.addFact({ key: "patient.selectedPackageId", entity: {}, label: "Saved selected package id", render: String(s.selectedPackageId ?? "none"), source: src, anchors: [] });
        if (r.tentativeProcedureDates?.text) {
          this.addFact({ key: "patient.tentativeDates", entity: {}, label: "Tentative procedure timing", render: r.tentativeProcedureDates.text, source: src, anchors: [] });
        }
        break;
      }
      case "getConsultationRescheduleLink": {
        this.addFact({ key: "consultation.status", entity: {}, label: "Consultation on file", render: r.status === "no_consultation" ? "none scheduled" : String(r.status), source: src, anchors: [] });
        if (r.url) this.addLink(r.url, "Consultation reschedule link", src);
        break;
      }
      case "getFullCalls": {
        for (const c of r.calls ?? []) {
          this.addFact({ key: "call.summary", entity: {}, label: `Call on ${String(c.createdAt).slice(0, 10)} (context only, never a source of price or policy)`, render: c.summary, source: src, anchors: [] });
        }
        break;
      }
      default:
        break;
    }
  }

  factsBlock(): string {
    if (!this.facts.length) return "(no facts fetched this turn)";
    return this.facts.map((f) => `${f.id}: ${f.label} = ${f.render}`).join("\n");
  }

  linksBlock(): string {
    return this.links.length ? this.links.map((l) => `${l.id}: ${l.label}`).join("\n") : "(no links available this turn)";
  }

  attachmentsBlock(): string {
    return this.attachments.length ? this.attachments.map((a) => `${a.id}: ${a.label}`).join("\n") : "(none)";
  }

  fact(id: string) {
    return this.facts.find((f) => f.id === id);
  }
  link(id: string) {
    return this.links.find((l) => l.id === id);
  }
  attachment(id: string) {
    return this.attachments.find((a) => a.id === id);
  }
}
