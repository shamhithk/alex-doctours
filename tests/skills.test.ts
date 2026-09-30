import { describe, expect, it } from "vitest";
import { applyConditions, loadDomain, selectSkills } from "../src/skills/loader.js";
import { TOOLS } from "../src/tools/registry.js";

const domain = loadDomain();

describe("skill files", () => {
  it("loads a core and a set of skills", () => {
    expect(domain.core.body.length).toBeGreaterThan(500);
    expect(domain.skills.size).toBeGreaterThanOrEqual(12);
  });
  it.each([...domain.skills.values()].map((s) => [s.id, s] as const))("%s is well-formed", (_id, s) => {
    expect(s.description.length).toBeGreaterThan(20);
    expect(["hard", "stage", "guideline"]).toContain(s.precedence);
    for (const t of s.tools) {
      expect(TOOLS.has(t), `${s.id} lists unknown tool ${t}`).toBe(true);
      expect(TOOLS.get(t)!.kind, `${s.id} lists write tool ${t}`).toBe("read");
    }
    for (const dep of [...s.dependsOn, ...s.suppresses]) expect(domain.skills.has(dep), `${s.id} -> ${dep}`).toBe(true);
    for (const url of s.links) expect(url).toMatch(/^https:\/\/www\.doctours\.com\/(consultation|image-upload)$/);
    expect(s.ruleIds.length).toBeGreaterThan(0);
  });
  it("rule ids are unique across core and skills", () => {
    const all = [...domain.core.ruleIds, ...[...domain.skills.values()].flatMap((s) => s.ruleIds)];
    const dupes = all.filter((id, i) => all.indexOf(id) !== i);
    expect(dupes).toEqual([]);
  });
  it("skills never mention tools that do not exist in the packet", () => {
    const text = [domain.core.body, ...[...domain.skills.values()].map((s) => s.body)].join("\n");
    for (const phantom of ["getTripRecommendations", "searchAirports", "updateUserAirport", "updateFlightPreferences", "getTripDetails", "getBookingPackageDetails"]) {
      expect(text).not.toContain(phantom);
    }
  });
});

describe("conditional sections", () => {
  const body = "## Rules\n- [a.all] always\n### [when financing=yes]\n- [a.yes] yes rule\n### [when financing=no]\n- [a.no] no rule\n## Examples\n- ex";
  it("keeps only the matching branch", () => {
    const out = applyConditions(body, { financing: "yes" });
    expect(out).toContain("yes rule");
    expect(out).not.toContain("no rule");
    expect(out).toContain("## Examples");
  });
  it("drops all branches when the flag is unknown to the section", () => {
    expect(applyConditions(body, {})).not.toMatch(/yes rule|no rule/);
  });
});

describe("skill selection", () => {
  it("adds dependencies and orders hard > stage > guideline deterministically", () => {
    const a = selectSkills(domain, ["insurance-carecredit"]);
    expect(a.ids).toContain("financing");
    expect(a.selectedBy.financing).toBe("dependency");
    const b = selectSkills(domain, ["insurance-carecredit"]);
    expect(a.ids).toEqual(b.ids);
  });
  it("falls back to general-faq when nothing matched", () => {
    expect(selectSkills(domain, []).ids).toEqual(["general-faq"]);
  });
  it("pause suppresses funnel skills", () => {
    const pause = domain.skills.get("pause")!;
    const sel = selectSkills(domain, ["pause", ...pause.suppresses]);
    for (const s of pause.suppresses) expect(sel.ids).not.toContain(s);
  });
});

describe("configuration (review finding 7)", () => {
  it("reads defaults at call time, so values loaded from .env apply", async () => {
    const { getDefaultOptions } = await import("../src/deps.js");
    expect(getDefaultOptions({ WRITER_MODEL: "gemini", ROUTER: "llm-only", OUTPUT_BATTERY: "0" } as any)).toMatchObject({ writer: "gemini", router: "llm-only", outputBattery: false });
    expect(getDefaultOptions({} as any)).toMatchObject({ writer: "deepseek", router: "auto", outputBattery: true });
  });
});
