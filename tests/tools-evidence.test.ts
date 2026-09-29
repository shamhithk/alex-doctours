import { describe, expect, it } from "vitest";
import { ToolExecutor, packageBelongsToClinic } from "../src/tools/executor.js";
import { resolveToolName, toolSpecs, READ_TOOLS } from "../src/tools/registry.js";
import { Ledger } from "../src/evidence/ledger.js";
import { render, validate, coerceWriterOutput, hard } from "../src/validation/validate.js";
import { HAKAN, HEVA, SAPPHIRE, SILVER, writerJson } from "./helpers.js";

const USER = "7c2e1a40-6b8f-4d3a-9e15-2f0a8b6c4d11";

describe("tool registry and executor", () => {
  it("exposes exactly the 14 packet tools; read tools only to the model", () => {
    expect(READ_TOOLS.sort()).toEqual(
      ["getAllClinics", "getClinicDoctors", "getClinicPackages", "getConsultationRescheduleLink", "getFullCalls", "getLatestAssessment", "getPatientContext", "getPatientImages", "getPaymentLink", "getSavedClinics"].sort(),
    );
    expect(toolSpecs(["updateUserClinicPreferences", "getClinicPackages"]).map((t) => t.name)).toEqual(["getClinicPackages"]);
  });
  it("maps the old prompt's Tool-suffixed aliases and rejects phantom tools", () => {
    expect(resolveToolName("getClinicPackagesTool")).toBe("getClinicPackages");
    expect(resolveToolName("getTripRecommendationsTool")).toBeUndefined();
    const ex = new ToolExecutor(USER);
    expect(ex.run("searchAirportsTool", {}, "model")).toMatchObject({ ok: false, error: expect.stringMatching(/unknown_tool/) });
  });
  it("blocks write tools requested by the model", () => {
    const ex = new ToolExecutor(USER);
    const r = ex.run("updateUserClinicPreferences", { clinicSelection: { selectedClinicId: HEVA } }, "model");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/write_tool_not_allowed/);
  });
  it("validates arguments", () => {
    const ex = new ToolExecutor(USER);
    expect(ex.run("getPaymentLink", { type: "wire" }, "model").ok).toBe(false);
    expect(ex.run("getClinicPackages", { clinicName: "Heva", extra: 1 }, "model").ok).toBe(false);
  });
  it("de-duplicates identical reads and injects the patient userId", () => {
    const ex = new ToolExecutor(USER);
    const a = ex.run("getClinicPackages", { clinicName: "Heva Clinic" }, "code");
    const b = ex.run("getClinicPackages", { clinicName: "Heva Clinic" }, "model");
    expect(a.result).toBe(b.result);
    expect(ex.run("getSavedClinics", {}, "code").ok).toBe(true);
  });
  it("enforces package membership the stub does not", () => {
    expect(packageBelongsToClinic(SILVER, HEVA)).toBe(true);
    expect(packageBelongsToClinic(SAPPHIRE, HEVA)).toBe(false);
  });
  it("returns a real payment URL only for a real package id", () => {
    const ex = new ToolExecutor(USER);
    const ok = ex.run("getPaymentLink", { type: "payment", clinicPackageId: SAPPHIRE }, "model");
    expect((ok.result as any).url).toBe(`https://www.doctours.com/payment/${SAPPHIRE}`);
    const bad = ex.run("getPaymentLink", { type: "payment", clinicPackageId: "heva-silver" }, "model");
    expect((bad.result as any).status).toBe("missing_input");
  });
});

function ledgerWithHeva() {
  const ex = new ToolExecutor(USER);
  const l = new Ledger();
  l.ingest(ex.run("getClinicPackages", { clinicId: HEVA }, "code"));
  l.ingest(ex.run("getLatestAssessment", {}, "code"));
  return l;
}

describe("evidence ledger", () => {
  it("turns package results into attributed facts with exact rendering", () => {
    const l = ledgerWithHeva();
    const silver = l.facts.find((f) => f.key === "package.basePrice" && f.entity.packageName === "Silver")!;
    const gold = l.facts.find((f) => f.key === "package.depositAmount" && f.entity.packageName === "Gold")!;
    expect(silver.render).toBe("$3,000 USD");
    expect(gold.render).toBe("$600");
    expect(l.facts.find((f) => f.key === "clinic.flag.Speciality")?.render).toBe("Afro Hair");
    expect(l.links.map((x) => x.url)).toContain("https://www.doctours.com/assessment/c3d4e5f6-3333-4333-8333-333333333333");
  });
  it("records a null tool result as 'no data', never as a fact", () => {
    const ex = new ToolExecutor(USER);
    const l = new Ledger();
    l.ingest(ex.run("getClinicPackages", { clinicName: "Nonexistent Clinic" }, "model"));
    expect(l.facts).toHaveLength(0);
    expect(l.notes[0]).toMatch(/no data/);
  });
});

describe("render + validate", () => {
  const vctx = (l: Ledger, over = {}) => ({
    ledger: l,
    patientText: "What packages does Heva have?",
    neverEcho: ["4242"],
    loadedRulesText: "refundable less a $25 cancellation fee",
    linksAlreadySent: [],
    paymentSkillLoaded: true,
    ...over,
  });
  const run = (l: Ledger, json: string, over = {}) => {
    const { out } = coerceWriterOutput(JSON.parse(json));
    const r = render(out!, l);
    return { r: r.rendered, v: [...r.violations, ...validate(out!, r.rendered, vctx(l, over))] };
  };
  const ids = (l: Ledger) => ({
    sp: l.facts.find((f) => f.key === "package.basePrice" && f.entity.packageName === "Silver")!.id,
    sd: l.facts.find((f) => f.key === "package.depositAmount" && f.entity.packageName === "Silver")!.id,
    gp: l.facts.find((f) => f.key === "package.basePrice" && f.entity.packageName === "Gold")!.id,
    link: l.links[0].id,
  });

  it("renders tokens exactly and puts links on the last line", () => {
    const l = ledgerWithHeva();
    const { sp, sd, link } = ids(l);
    const { r, v } = run(l, writerJson({ reply: `Silver is {{${sp}}} with a {{${sd}}} deposit. You can pay using the link below.`, link_ids: [link] }));
    expect(hard(v)).toEqual([]);
    expect(r.text.split("\n").at(-1)).toBe("https://www.doctours.com/assessment/c3d4e5f6-3333-4333-8333-333333333333");
    expect(r.text).toContain("Silver is $3,000 USD with a $500 deposit.");
  });
  it("catches cross-package attribution (Gold's price next to Silver)", () => {
    const l = ledgerWithHeva();
    const { gp } = ids(l);
    const { v } = run(l, writerJson({ reply: `Silver is {{${gp}}}.` }));
    expect(v.map((x) => x.code)).toContain("ATTRIBUTION");
  });
  it("rejects typed dollar amounts, typed URLs and unknown ids", () => {
    const l = ledgerWithHeva();
    const { v } = run(l, writerJson({ reply: "Silver is $2,999 at https://evil.example.com/pay", link_ids: ["L99"] }));
    const codes = v.map((x) => x.code);
    expect(codes).toEqual(expect.arrayContaining(["UNSOURCED_MONEY", "URL_IN_TEXT", "UNKNOWN_LINK"]));
  });
  it("allows a dollar figure stated verbatim in a loaded rule", () => {
    const l = ledgerWithHeva();
    const { v } = run(l, writerJson({ reply: "The deposit is refundable less a $25 cancellation fee until your lock-in date." }));
    expect(v.map((x) => x.code)).not.toContain("UNSOURCED_MONEY");
  });
  it.each([
    ["I'll send you the driver details soon.", "OFF_CHANNEL"],
    ["Let me check with the clinic and get back to you.", "OFF_CHANNEL"],
    ["Someone from our team will reach out.", "OFF_CHANNEL"],
    ["Bring a loose hat for after the procedure.", "HEAD_COVERING"],
    ["Your assessment will be ready within 24 hours.", "ASSESSMENT_TURNAROUND"],
    ["With Klarna that's about $400/month at 0% APR.", "FINANCING_MATH"],
    ["Your card ending 4242 is noted.", "ECHOED_SENSITIVE"],
  ])("lints %s", (reply, code) => {
    const l = ledgerWithHeva();
    const { v } = run(l, writerJson({ reply }));
    expect(v.map((x) => x.code)).toContain(code);
  });
  it("allows the dated pause check-in", () => {
    const l = ledgerWithHeva();
    const { v } = run(l, writerJson({ reply: "Take the time you need. I'll check in next month if I don't hear from you, and if you'd like more or less time, tell me and I'll adjust." }));
    expect(hard(v)).toEqual([]);
  });
  it("caps attachments at 3", () => {
    const ex = new ToolExecutor(USER);
    const l = new Ledger();
    l.ingest(ex.run("getPatientImages", {}, "code"));
    const { r } = run(l, writerJson({ reply: "Here are your photos.", attachment_ids: ["A1", "A2", "A3", "A4", "A5"] }));
    expect(r.attachments).toHaveLength(3);
  });
});
