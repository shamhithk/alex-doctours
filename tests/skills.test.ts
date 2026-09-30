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

describe("policy facts are bound to their rules (review 2, finding 1)", () => {
  const ruleText = (id: string) => {
    const bodies = [domain.core.body, ...[...domain.skills.values()].map((s) => s.body)].join("\n");
    const line = bodies.split("\n").find((l) => l.includes(`[${id}]`));
    if (!line) return null;
    // A rule includes its indented continuation lines.
    const all = bodies.split("\n");
    const i = all.indexOf(line);
    const out = [line];
    for (let j = i + 1; j < all.length && /^\s{2,}\S/.test(all[j]); j++) out.push(all[j]);
    return out.join("\n");
  };
  it.each(domain.facts.map((f) => [f.id, f] as const))("%s: its rule exists, its skills exist, and every figure appears in that rule", (_id, f) => {
    const text = ruleText(f.rule);
    expect(text, `rule ${f.rule}`).not.toBeNull();
    for (const s of f.skills) expect(s === "core" || domain.skills.has(s), s).toBe(true);
    const figures = f.text.match(/\$?\d[\d,]*|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/gi) ?? [];
    for (const fig of figures) expect(text!.toLowerCase(), `${f.id}: "${fig}" not in ${f.rule}`).toContain(fig.toLowerCase());
  });
  it("the writer sees the loaded facts as {{R:...}} tokens and nothing else", async () => {
    const { Ledger } = await import("../src/evidence/ledger.js");
    const { factsFor } = await import("../src/skills/loader.js");
    const l = new Ledger();
    l.addPolicyFacts(factsFor(domain, ["consultation"]));
    expect(l.factsBlock()).toContain('{{R:consultation}} → "the consultation is free');
    expect(l.factsBlock()).not.toContain("{{R:refund}}");
    expect(l.factsBlock()).toContain("{{R:head-covering}}"); // core facts are always available
  });
});
