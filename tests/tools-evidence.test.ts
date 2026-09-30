import { describe, expect, it } from "vitest";
import { ToolExecutor, packageBelongsToClinic } from "../src/tools/executor.js";
import { resolveToolName, toolSpecs, READ_TOOLS } from "../src/tools/registry.js";
import { Ledger } from "../src/evidence/ledger.js";
import { render, validate, coerceWriterOutput, hard } from "../src/validation/validate.js";
import { HAKAN, HEVA, SAPPHIRE, SILVER, writerJson } from "./helpers.js";
import { factsFor, loadDomain } from "../src/skills/loader.js";

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
const refOf = (l: Ledger, name: string) => l.allEntities().find((e) => e.kind === "package" && e.name === name)!.ref;

describe("evidence ledger (typed entities + clause tokens)", () => {
  it("renders entity name and value together from one record", () => {
    const l = ledgerWithHeva();
    const silver = refOf(l, "Silver");
    const gold = refOf(l, "Gold");
    expect(l.renderClause(silver, "price+deposit")).toBe("Silver is $3,000 USD with a $500 deposit");
    expect(l.renderClause(gold, "inclusions")).toBe("Gold includes 4 hotel nights");
    expect(l.renderClause(gold, "note")).toBe("on Gold, the doctor makes every incision and extracts every graft");
    const heva = l.refFor(HEVA)!;
    expect(l.renderClause(heva, "specialty")).toBe("Heva Clinic specializes in Afro hair");
    expect(l.renderClause(heva, "packages")).toBe("Heva Clinic has two packages: Silver and Gold");
    expect(l.renderClause("AS", "graft-range")).toBe("your assessment estimates 2,500 to 3,200 grafts");
    expect(l.links.map((x) => x.url)).toContain("https://www.doctours.com/assessment/c3d4e5f6-3333-4333-8333-333333333333");
  });
  it("records a null tool result as 'no data', never as an entity", () => {
    const ex = new ToolExecutor(USER);
    const l = new Ledger();
    l.ingest(ex.run("getClinicPackages", { clinicName: "Nonexistent Clinic" }, "model"));
    expect(l.allEntities()).toHaveLength(0);
    expect(l.notes[0]).toMatch(/no data/);
  });
  it("renders doctors for a clinic", () => {
    const ex = new ToolExecutor(USER);
    const l = new Ledger();
    l.ingest(ex.run("getClinicDoctors", { clinicId: HAKAN }, "code"));
    expect(l.renderClause(l.refFor(HAKAN)!, "doctors")).toBe("Dr. Hakan is the hair transplant surgeon at Dr. Hakan Clinic");
  });
});

describe("render + validate", () => {
  const vctx = (l: Ledger, over = {}) => ({
    ledger: l,
    patientText: "What packages does Heva have? You quoted me $100 for Gold.",
    neverEcho: ["4242"],
    loadedRulesText: "- [payment.refund] The deposit is refundable less a $25 cancellation fee. Clinics confirm within 24 hours.",
    linksAlreadySent: [],
    paymentSkillLoaded: true,
    ...over,
  });
  const run = (l: Ledger, json: string, over = {}) => {
    const { out } = coerceWriterOutput(JSON.parse(json));
    const r = render(out!, l);
    return { r: r.rendered, v: [...r.violations, ...validate(out!, r.rendered, vctx(l, over))] };
  };
  const codes = (v: { code: string }[]) => v.map((x) => x.code);

  it("renders clause tokens exactly, capitalises at sentence start, and puts links last", () => {
    const l = ledgerWithHeva();
    const { r, v } = run(l, writerJson({ reply: `{{${l.refFor(HEVA)}:packages}}. {{${refOf(l, "Silver")}:price+deposit}}. You can pay using the link below.`, link_ids: ["L1"] }));
    expect(hard(v)).toEqual([]);
    expect(r.text).toContain("Heva Clinic has two packages: Silver and Gold. Silver is $3,000 USD with a $500 deposit.");
    expect(r.text.split("\n").at(-1)).toBe("https://www.doctours.com/assessment/c3d4e5f6-3333-4333-8333-333333333333");
  });
  // Review finding 1: each of these was previously accepted.
  it.each([
    ["typed swapped prices", "Silver costs $4,500 USD and Gold costs $3,000 USD."],
    ["invented inclusion", "Gold includes 20 hotel nights."],
    ["price without a dollar sign", "Gold costs 100 USD."],
    ["patient-quoted number is not authority", "Yes, Gold is $100 as you were quoted."],
    ["invented package count", "Heva has 3 packages."],
    ["invented percentage", "Gold saves you 10% overall."],
  ])("rejects %s", (_label, reply) => {
    const l = ledgerWithHeva();
    expect(codes(run(l, writerJson({ reply })).v)).toContain("UNSOURCED_QUANTITY");
  });
  it("swapping is structurally impossible: a token always carries its own package name", () => {
    const l = ledgerWithHeva();
    const { r } = run(l, writerJson({ reply: `Silver: {{${refOf(l, "Gold")}:price}}.` }));
    expect(r.text).toBe("Silver: Gold is $4,500 USD.");
  });
  it("rejects rule figures typed by the writer; policy figures come from rule-bound {{R:...}} tokens (review 2, finding 1)", () => {
    const l = ledgerWithHeva();
    const typed = run(l, writerJson({ reply: "The deposit is refundable less a $25 cancellation fee, and the clinic confirms within 24 hours." }));
    expect(codes(typed.v)).toEqual(expect.arrayContaining(["UNSOURCED_QUANTITY", "UNSOURCED_POLICY"]));
    l.addPolicyFacts(factsFor(loadDomain(), ["payment"]));
    const tokens = run(l, writerJson({ reply: "{{R:refund}}, and {{R:date-confirmation}}." }));
    expect(hard(tokens.v)).toEqual([]);
    expect(tokens.r.text).toContain("The deposit is refundable, minus a $25 cancellation fee, until the lock-in date");
  });
  it("rejects unknown clause tokens, typed URLs and unknown link ids", () => {
    const l = ledgerWithHeva();
    const { v } = run(l, writerJson({ reply: "{{P9:price}} at https://evil.example.com/pay", link_ids: ["L99"] }));
    expect(codes(v)).toEqual(expect.arrayContaining(["UNKNOWN_FACT", "URL_IN_TEXT", "UNKNOWN_LINK"]));
  });
  it("flags claim sources that do not exist (soft)", () => {
    const l = ledgerWithHeva();
    const { v } = run(l, writerJson({ reply: "Heva works with 4C hair.", claims: [{ text: "x", sources: ["F99", "payment.refund"] }] }));
    const bad = v.filter((x) => x.code === "UNKNOWN_CLAIM_SOURCE");
    expect(bad).toHaveLength(1);
    expect(bad[0].severity).toBe("soft");
  });
  it.each([
    ["I'll send you the driver details soon.", "OFF_CHANNEL"],
    ["Let me check with the clinic and get back to you.", "OFF_CHANNEL"],
    ["Someone from our team will reach out.", "OFF_CHANNEL"],
    ["Bring a loose hat for after the procedure.", "HEAD_COVERING"],
    ["Your assessment will be ready within 24 hours.", "ASSESSMENT_TURNAROUND"],
    ["With Klarna the monthly amount is lower at 0% APR.", "FINANCING_MATH"],
    ["Your card ending 4242 is noted.", "ECHOED_SENSITIVE"],
    ["Your card ending 4 2 4 2 is noted.", "ECHOED_SENSITIVE"],
  ])("lints %s", (reply, code) => {
    const l = ledgerWithHeva();
    expect(codes(run(l, writerJson({ reply })).v)).toContain(code);
  });
  it("allows the dated pause check-in when a follow-up is scheduled (by the draft or by code)", () => {
    const l = ledgerWithHeva();
    const reply = "Take the time you need. I'll check in next month if I don't hear from you, and if you'd like more or less time, tell me and I'll adjust.";
    expect(hard(run(l, writerJson({ reply, should_follow_up: true, follow_up_timing: "1 month" })).v)).toEqual([]);
    expect(hard(run(l, writerJson({ reply }), { codeFollowUp: "1 month" }).v)).toEqual([]);
    expect(codes(run(l, writerJson({ reply })).v)).toContain("UNSCHEDULED_FOLLOW_UP");
  });
  it("caps attachments at 3", () => {
    const ex = new ToolExecutor(USER);
    const l = new Ledger();
    l.ingest(ex.run("getPatientImages", {}, "code"));
    const { r } = run(l, writerJson({ reply: "Here are your photos.", attachment_ids: ["IMG1", "IMG2", "IMG3", "IMG4", "IMG5"] }));
    expect(r.attachments).toHaveLength(3);
  });
});

describe("redundant clause tokens", () => {
  const vctx = (l: Ledger) => ({ ledger: l, patientText: "x", neverEcho: [], loadedRulesText: "", linksAlreadySent: [], paymentSkillLoaded: false });
  const codes = (l: Ledger, reply: string) => {
    const { out } = coerceWriterOutput(JSON.parse(writerJson({ reply })));
    const r = render(out!, l);
    return validate(out!, r.rendered, vctx(l)).map((x) => x.code);
  };
  it.each([
    ["count + list", (c: string) => `{{${c}:package-count}}: {{${c}:packages}}.`],
    ["list as a lead-in to prices", (c: string, p: string) => `{{${c}:packages}}: {{${p}:price+deposit}}.`],
    ["same token twice", (_c: string, p: string) => `{{${p}:price}}. Again, {{${p}:price}}.`],
    ["price with price+deposit", (_c: string, p: string) => `{{${p}:price}}, and {{${p}:price+deposit}}.`],
  ])("flags %s", (_label, build) => {
    const l = ledgerWithHeva();
    const c = l.refFor(HEVA)!;
    const p = l.allEntities().find((e) => e.kind === "package")!.ref;
    expect(codes(l, build(c, p))).toContain("REDUNDANT_TOKENS");
  });
  it("accepts the recommended price-list shape", () => {
    const l = ledgerWithHeva();
    const c = l.refFor(HEVA)!;
    const [p1, p2] = l.allEntities().filter((e) => e.kind === "package").map((e) => e.ref);
    expect(codes(l, `{{${c}:package-count}}: {{${p1}:price+deposit}}, and {{${p2}:price+deposit}}.`)).not.toContain("REDUNDANT_TOKENS");
  });
});

describe("claim guards on the writer's own prose (review 2, finding 1)", () => {
  const vctx = (l: Ledger, over = {}) => ({ ledger: l, patientText: "Tell me about Gold", neverEcho: ["4242"], loadedRulesText: "", linksAlreadySent: [], paymentSkillLoaded: true, ...over });
  const check = (reply: string, extra: Record<string, unknown> = {}, over = {}) => {
    const l = ledgerWithHeva();
    l.addPolicyFacts(factsFor(loadDomain(), ["payment", "consultation"]));
    const { out } = coerceWriterOutput(JSON.parse(writerJson({ reply, ...extra })));
    const r = render(out!, l);
    return [...r.violations, ...validate(out!, r.rendered, vctx(l, over))].filter((v) => v.severity === "hard").map((v) => v.code);
  };

  it.each([
    ["Gold costs $25.", "UNSOURCED_QUANTITY"],
    ["Gold includes flights.", "UNSOURCED_INCLUSION"],
    ["Gold includes thirteen hotel nights.", "UNSOURCED_QUANTITY"],
    ["Gold has a lifetime refund guarantee.", "UNSOURCED_POLICY"],
    ["Gold gets you an airport pickup.", "UNSOURCED_INCLUSION"],
    ["Gold is non-refundable.", "UNSOURCED_POLICY"],
    ["The consultation is free.", "UNSOURCED_POLICY"],
    ["Your deposit has been charged.", "FALSE_ACTION"],
    ["I've booked your date with the clinic.", "FALSE_ACTION"],
    ["I contacted Heva for you.", "FALSE_ACTION"],
    ["I've saved Gold as your package.", "UNBACKED_PERSISTENCE"],
    ["I'll check in with you next week.", "UNSCHEDULED_FOLLOW_UP"],
  ])("rejects %j", (reply, code) => {
    expect(check(reply)).toContain(code);
  });

  it("allows the same facts through tokens, and ordinary non-claims", () => {
    expect(check("{{R:refund}}.")).toEqual([]);
    expect(check("{{R:consultation}}. Feel free to ask anything else.")).toEqual([]);
    expect(check("I can't guarantee a specific surgeon, and insurance doesn't cover hair transplants.")).toEqual([]);
    expect(check("Heva Clinic works with 4C hair, and there's interest-free layaway for the balance.")).toEqual([]);
    expect(check("Once the deposit is placed, the clinic confirms your date.")).toEqual([]);
    expect(check("Which one would you like?")).toEqual([]);
  });

  it("a follow-up interval may be typed only when it is the interval being scheduled", () => {
    const reply = "No rush. I'll check in after 2 weeks.";
    expect(check(reply, { should_follow_up: true, follow_up_timing: "two weeks" })).toEqual([]);
    expect(check(reply, { should_follow_up: true, follow_up_timing: "1 month" })).toContain("UNSOURCED_QUANTITY");
  });

  it("'noted' needs a write this turn (memory or a planned selection)", () => {
    expect(check("Noted, you prefer texts.")).toContain("UNBACKED_PERSISTENCE");
    expect(check("Noted, you prefer texts.", { memory: { communicationStyle: "casual" } })).toEqual([]);
    expect(check("Noted, Heva it is.", {}, { selectionWritePlanned: true })).toEqual([]);
  });

  it("validates memory separately: no completed actions, promises only as scheduled check-ins, no card digits", () => {
    expect(check("Okay.", { memory: { promisesMade: "I charged your card" } })).toEqual(expect.arrayContaining(["MEMORY_FALSE_ACTION", "MEMORY_PROMISE_UNSCHEDULED"]));
    expect(check("Okay.", { memory: { promisesMade: "Send the payment link tomorrow" }, should_follow_up: true, follow_up_timing: "1 day" })).toContain("MEMORY_PROMISE_UNSUPPORTED");
    expect(check("Okay.", { memory: { keyConcerns: "card ending 4242" } })).toContain("MEMORY_SENSITIVE");
    expect(check("Okay.", { memory: { promisesMade: "Check in after 1 month if no reply" }, should_follow_up: true, follow_up_timing: "1 month" })).toEqual([]);
  });
});
