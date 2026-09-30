import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import matter from "gray-matter";

export type Precedence = "hard" | "stage" | "guideline";
const PRECEDENCE_ORDER: Record<Precedence, number> = { hard: 0, stage: 1, guideline: 2 };

export interface Skill {
  id: string;
  version: number;
  title: string;
  description: string;
  tools: string[];
  links: string[];
  dependsOn: string[];
  precedence: Precedence;
  suppresses: string[];
  body: string;
  ruleIds: string[];
}

export interface Domain {
  core: { version: number; body: string; ruleIds: string[] };
  skills: Map<string, Skill>;
  /** Policy facts rendered by code as {{R:<id>}}; each is bound to the rule that states it. */
  facts: PolicyFact[];
}

export interface PolicyFact {
  id: string;
  rule: string;
  skills: string[];
  text: string;
}

const RULE_ID_RE = /^\s*-\s*\[([a-z0-9.\-_]+)\]/gim;

function ruleIds(body: string): string[] {
  return [...body.matchAll(RULE_ID_RE)].map((m) => m[1]);
}

export function loadDomain(dir = resolve("domains/hair")): Domain {
  const corePath = join(dir, "core.md");
  if (!existsSync(corePath)) throw new Error(`Missing ${corePath}`);
  const core = matter(readFileSync(corePath, "utf8"));
  const skills = new Map<string, Skill>();
  const skillDir = join(dir, "skills");
  for (const file of readdirSync(skillDir).filter((f) => f.endsWith(".md")).sort()) {
    const parsed = matter(readFileSync(join(skillDir, file), "utf8"));
    const d = parsed.data as Record<string, any>;
    const skill: Skill = {
      id: String(d.id),
      version: Number(d.version ?? 1),
      title: String(d.title ?? d.id),
      description: String(d.description ?? ""),
      tools: asList(d.tools),
      links: asList(d.links),
      dependsOn: asList(d.depends_on),
      precedence: (d.precedence ?? "guideline") as Precedence,
      suppresses: asList(d.suppresses),
      body: parsed.content.trim(),
      ruleIds: ruleIds(parsed.content),
    };
    if (!skill.id || !skill.description) throw new Error(`Skill ${file} needs id and description`);
    if (skills.has(skill.id)) throw new Error(`Duplicate skill id ${skill.id}`);
    skills.set(skill.id, skill);
  }
  const factsPath = join(dir, "policy-facts.md");
  const facts: PolicyFact[] = existsSync(factsPath)
    ? ((matter(readFileSync(factsPath, "utf8")).data.facts ?? []) as any[]).map((f) => ({ id: String(f.id), rule: String(f.rule), skills: asList(f.skills), text: String(f.text) }))
    : [];
  return { core: { version: Number(core.data.version ?? 1), body: core.content.trim(), ruleIds: ruleIds(core.content) }, skills, facts };
}

/** Policy facts available for a set of loaded skills ("core" facts are always available). */
export function factsFor(domain: Domain, skillIds: string[]): PolicyFact[] {
  return domain.facts.filter((f) => f.skills.some((s) => s === "core" || skillIds.includes(s)));
}

function asList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string" && v.trim()) return [v.trim()];
  return [];
}

/**
 * Keep only `### [when flag=value]` sections that match the patient's flags.
 * A conditional section runs until the next heading of the same or higher level.
 */
export function applyConditions(body: string, flags: Record<string, string>): string {
  const lines = body.split("\n");
  const out: string[] = [];
  let skipping = false;
  let skipLevel = 0;
  for (const line of lines) {
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      if (skipping && level <= skipLevel) skipping = false;
      const cond = h[2].match(/^\[when\s+([a-z_]+)\s*=\s*([A-Za-z0-9_|]+)\]\s*$/);
      if (cond) {
        const allowed = cond[2].split("|");
        const actual = flags[cond[1]];
        if (actual === undefined || !allowed.includes(actual)) {
          skipping = true;
          skipLevel = level;
          continue;
        }
        out.push(line.replace(/\[when[^\]]*\]/, `(applies: ${cond[1]}=${actual})`));
        continue;
      }
    }
    if (!skipping) out.push(line);
  }
  return out.join("\n");
}

export interface Selection {
  ids: string[];
  selectedBy: Record<string, "router" | "dependency" | "fallback">;
  suppressed: { id: string; by: string }[];
}

/**
 * Router-selected skills + transitive dependencies, minus suppressed skills,
 * ordered hard → stage → guideline, then by id. Deterministic for a given input.
 */
export function selectSkills(domain: Domain, requested: string[], fallback = "general-faq"): Selection {
  const selectedBy: Selection["selectedBy"] = {};
  const queue = requested.filter((id) => domain.skills.has(id));
  for (const id of queue) selectedBy[id] = "router";
  if (!queue.length && domain.skills.has(fallback)) {
    queue.push(fallback);
    selectedBy[fallback] = "fallback";
  }
  for (let i = 0; i < queue.length; i++) {
    for (const dep of domain.skills.get(queue[i])!.dependsOn) {
      if (domain.skills.has(dep) && !selectedBy[dep]) {
        selectedBy[dep] = "dependency";
        queue.push(dep);
      }
    }
  }
  const suppressed: Selection["suppressed"] = [];
  const kept = queue.filter((id) => {
    const by = queue.find((other) => other !== id && domain.skills.get(other)!.suppresses.includes(id));
    if (by) suppressed.push({ id, by });
    return !by;
  });
  kept.sort((a, b) => {
    const pa = PRECEDENCE_ORDER[domain.skills.get(a)!.precedence] ?? 9;
    const pb = PRECEDENCE_ORDER[domain.skills.get(b)!.precedence] ?? 9;
    return pa - pb || a.localeCompare(b);
  });
  return { ids: kept, selectedBy, suppressed };
}
