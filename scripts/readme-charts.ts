/**
 * Generate the README's SVG charts from committed benchmark artifacts and the prompt files.
 * No hand-typed numbers: every value is read from benchmarks/ or measured from the files.
 *   npx tsx scripts/readme-charts.ts [--set holdout-v4] [--include-superseded]
 * Writes docs/img/{scorecard,prompt-size,results}.svg. Colours follow GitHub light/dark mode.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const SET = arg("set", "holdout-v4");
const includeSuperseded = process.argv.includes("--include-superseded");

// ---------- data ----------
const superseded: Record<string, string> = existsSync("benchmarks/superseded.json") ? JSON.parse(readFileSync("benchmarks/superseded.json", "utf8")) : {};
const isSuperseded = (d: string) => Object.keys(superseded).some((p) => d.startsWith(p));
const runs = readdirSync("benchmarks")
  .filter((d) => existsSync(join("benchmarks", d, "summary.json")) && (includeSuperseded || !isSuperseded(d)))
  .sort()
  .map((d) => ({
    d,
    c: JSON.parse(readFileSync(join("benchmarks", d, "config.json"), "utf8")),
    s: JSON.parse(readFileSync(join("benchmarks", d, "summary.json"), "utf8")),
    rows: readFileSync(join("benchmarks", d, "results.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)),
  }));
const onSet = runs.filter((r) => r.c.set === SET);
const latest = <T,>(xs: T[]) => xs[xs.length - 1];
const baseline = latest(onSet.filter((r) => r.c.variant === "monolith-baseline"));
const pipeline = (writer: string) => latest(onSet.filter((r) => r.c.variant !== "monolith-baseline" && r.s.writer === writer && /auto/.test(r.d)));
const ds = pipeline("deepseek");
const gm = pipeline("gemini");
if (!baseline || !ds) throw new Error(`need a monolith baseline and a deepseek auto run on --set ${SET}`);

const pctNum = (s: string) => Number(String(s).replace("%", ""));
const tokens = (text: string) => Math.round(text.length / 4);
const monolithTokens = tokens(readFileSync("fixtures/original-system-prompt.txt", "utf8"));
const coreTokens = tokens(readFileSync("domains/hair/core.md", "utf8"));
const skillTokens: Record<string, number> = Object.fromEntries(
  readdirSync("domains/hair/skills").filter((f) => f.endsWith(".md")).map((f) => [f.replace(/\.md$/, ""), tokens(readFileSync(join("domains/hair/skills", f), "utf8"))]),
);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
const answeredRows = ds.rows.filter((r: any) => !r.escalate && Array.isArray(r.skills));
const skillsPerTurn = median(answeredRows.map((r: any) => r.skills.length));
const skillTokensPerTurn = median(answeredRows.map((r: any) => r.skills.reduce((a: number, id: string) => a + (skillTokens[id] ?? 0), 0)));
const promptP50 = ds.s.promptTokensP50 as number;
const contextTokens = Math.max(0, promptP50 - coreTokens - skillTokensPerTurn);
const monolithCostPerMsg = baseline.s.costTotalUsd / baseline.s.cases;

// ---------- svg helpers ----------
const FONT = `-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif`;
const STYLE = `<style>
  .t { font-family: ${FONT}; fill: #1f2328; } .m { fill: #59636e; } .card { fill: #f6f8fa; stroke: #d1d9e0; }
  .old { fill: #cf222e; } .new { fill: #1a7f37; } .new2 { fill: #0969da; } .grid { stroke: #d1d9e0; }
  .seg1 { fill: #1a7f37; } .seg2 { fill: #4ac26b; } .seg3 { fill: #aceebb; } .mono { fill: #cf222e; }
  @media (prefers-color-scheme: dark) {
    .t { fill: #f0f6fc; } .m { fill: #9198a1; } .card { fill: #151b23; stroke: #3d444d; }
    .old { fill: #f85149; } .new { fill: #3fb950; } .new2 { fill: #4493f8; } .grid { stroke: #3d444d; }
    .seg1 { fill: #3fb950; } .seg2 { fill: #2ea043; } .seg3 { fill: #196c2e; } .mono { fill: #f85149; }
  }
</style>`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const text = (x: number, y: number, s: string, size = 14, cls = "t", extra = "") => `<text x="${x}" y="${y}" class="${cls}" font-size="${size}" ${extra}>${esc(s)}</text>`;
const svg = (w: number, h: number, body: string, title: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title>${STYLE}${body}</svg>\n`;
const fmt = (n: number) => n.toLocaleString("en-US");
const usd = (n: number) => `$${n < 0.01 ? n.toFixed(4) : n.toFixed(3)}`;

mkdirSync("docs/img", { recursive: true });

// ---------- 1. scorecard ----------
{
  const tiles = [
    { label: "Pass rate, blind test set", now: ds.s.passRate, was: baseline.s.passRate, note: `${ds.s.cases} cases · DeepSeek · k=${ds.c.k}` },
    { label: "Handoffs caught (recall)", now: ds.s.escalationRecall, was: baseline.s.escalationRecall, note: "messages that need a person" },
    { label: "Prompt per message", now: `${(promptP50 / 1000).toFixed(1)}k`, was: `${(monolithTokens / 1000).toFixed(1)}k`, note: "tokens, median" },
    { label: "Cost per message", now: usd(ds.s.costPerInputUsd), was: usd(monolithCostPerMsg), note: "all stages included" },
  ];
  const W = 880, tileW = 205, gap = 10;
  const body = tiles
    .map((t, i) => {
      const x = i * (tileW + gap);
      return [
        `<rect x="${x + 0.5}" y="0.5" width="${tileW}" height="118" rx="10" class="card"/>`,
        text(x + 16, 28, t.label, 13, "t m"),
        text(x + 16, 68, t.now, 32, "t", 'font-weight="600"'),
        text(x + 16, 92, `original prompt: ${t.was}`, 12, "t m"),
        text(x + 16, 108, t.note, 11, "t m"),
      ].join("");
    })
    .join("");
  writeFileSync("docs/img/scorecard.svg", svg(W, 120, body, "Scorecard: blind test set results versus the original prompt"));
}

// ---------- 2. prompt size ----------
{
  const W = 880, H = 190, left = 150, right = 30, barH = 34;
  const scale = (W - left - right) / monolithTokens;
  const before = `<rect x="${left}" y="40" width="${monolithTokens * scale}" height="${barH}" rx="4" class="mono"/>`;
  const segs = [
    { v: coreTokens, cls: "seg1", label: `core rules ${fmt(coreTokens)}` },
    { v: skillTokensPerTurn, cls: "seg2", label: `${skillsPerTurn} skills ${fmt(skillTokensPerTurn)}` },
    { v: contextTokens, cls: "seg3", label: `patient context + facts ${fmt(contextTokens)}` },
  ];
  let x = left;
  const after = segs
    .map((s) => {
      const w = s.v * scale;
      const r = `<rect x="${x}" y="110" width="${w}" height="${barH}" class="${s.cls}"/>`;
      x += w;
      return r;
    })
    .join("");
  const legend = segs.map((s, i) => `<rect x="${left + i * 230}" y="162" width="12" height="12" class="${s.cls}"/>${text(left + i * 230 + 18, 173, s.label, 12, "t m")}`).join("");
  const body = [
    text(0, 62, "Before", 15, "t", 'font-weight="600"'),
    text(0, 80, "every message", 12, "t m"),
    before,
    text(left + monolithTokens * scale - 8, 62, `${fmt(monolithTokens)} tokens`, 13, "t", 'text-anchor="end" fill="#fff" style="fill:#fff"'),
    text(0, 132, "After", 15, "t", 'font-weight="600"'),
    text(0, 150, "median message", 12, "t m"),
    after,
    text(x + 8, 132, `${fmt(promptP50)} tokens`, 13, "t", 'font-weight="600"'),
    text(left, 22, `System prompt tokens. After: core rules + only the skills this message needs (of ${Object.keys(skillTokens).length}).`, 12, "t m"),
    legend,
  ].join("");
  writeFileSync("docs/img/prompt-size.svg", svg(W, H, body, "System prompt size before and after"));
}

// ---------- 3. results ----------
{
  const systems = [
    { name: "Original prompt (DeepSeek)", s: baseline.s, cls: "old" },
    { name: "This system · DeepSeek", s: ds.s, cls: "new" },
    ...(gm ? [{ name: "This system · Gemini", s: gm.s, cls: "new2" }] : []),
  ];
  const metrics = [
    { label: "Pass rate", get: (s: any) => pctNum(s.passRate) },
    { label: "Handoffs caught", get: (s: any) => pctNum(s.escalationRecall) },
    { label: "Handoffs justified", get: (s: any) => pctNum(s.escalationPrecision) },
  ];
  const W = 880, left = 170, right = 60, barH = 16, groupGap = 22;
  const H = 40 + metrics.length * (systems.length * (barH + 4) + groupGap) + 30;
  const scale = (W - left - right) / 100;
  let y = 36;
  const parts: string[] = [text(0, 18, `Blind test set: ${ds.s.cases} messages written independently of the code (k=${ds.c.k} runs each for this system)`, 12, "t m")];
  for (const g of [0, 25, 50, 75, 100]) parts.push(`<line x1="${left + g * scale}" x2="${left + g * scale}" y1="28" y2="${H - 28}" class="grid" stroke-dasharray="2 3"/>`, text(left + g * scale, H - 12, `${g}%`, 11, "t m", 'text-anchor="middle"'));
  for (const m of metrics) {
    parts.push(text(0, y + 12, m.label, 14, "t", 'font-weight="600"'));
    for (const sys of systems) {
      const v = m.get(sys.s);
      parts.push(`<rect x="${left}" y="${y}" width="${Math.max(1, v * scale)}" height="${barH}" rx="3" class="${sys.cls}"/>`, text(left + v * scale + 6, y + 13, `${v.toFixed(1)}%`, 12, "t"));
      y += barH + 4;
    }
    y += groupGap;
  }
  const legend = systems.map((sys, i) => `<rect x="${left + i * 230}" y="${H - 50}" width="12" height="12" class="${sys.cls}"/>${text(left + i * 230 + 18, H - 40, sys.name, 12, "t m")}`).join("");
  writeFileSync("docs/img/results.svg", svg(W, H, parts.join("") + legend, "Results on the blind test set"));
}

// ---------- 4. prompt stats table (README block between <!-- prompt:start --> and <!-- prompt:end -->) ----------
{
  const monolith = readFileSync("fixtures/original-system-prompt.txt", "utf8");
  const sections = (monolith.match(/^# /gm) ?? []).length;
  const table = [
    "| | Before: one prompt | After: core + skills |",
    "|---|---|---|",
    `| Prompt sent per message | **${fmt(monolithTokens)} tokens**, always | **${fmt(promptP50)} tokens** (median), of which ${fmt(coreTokens)} core rules + ${skillsPerTurn} skills |`,
    `| Rules the model sees | all ${sections} sections, every time | core + the ${skillsPerTurn} skills this message needs (of ${Object.keys(skillTokens).length}) |`,
    "| Who decides to hand off to a person | nobody (no handoff existed) | code, from typed router answers; one fixed sentence |",
    "| Who writes prices, deposits, links | the model, from memory of the prompt and tools | code, from tool data (`{{P2:price+deposit}}` → \"Gold is $4,500 USD with a $600 deposit\") |",
    "| What is checked before sending | nothing | numbers, inclusions, policy terms, claimed actions, links, card digits, length |",
    `| Input tokens per message (median) | ${fmt(baseline.s.inputTokensP50)} billed (the prompt is resent on every tool round) | about ${fmt(promptP50)} for the writer prompt, plus one router call |`,
  ].join("\n");
  if (process.argv.includes("--write")) {
    const readme = readFileSync("README.md", "utf8");
    if (!readme.includes("<!-- prompt:start -->")) throw new Error("README prompt markers not found");
    writeFileSync("README.md", readme.replace(/<!-- prompt:start -->[\s\S]*?<!-- prompt:end -->/, `<!-- prompt:start -->\n${table}\n<!-- prompt:end -->`));
  } else console.log(table);
}

console.error(
  `charts written for set ${SET}: deepseek=${ds.d} gemini=${gm?.d ?? "none"} baseline=${baseline.d} | prompt p50 ${promptP50}, core ${coreTokens}, skills/turn ${skillsPerTurn} (${skillTokensPerTurn} tokens)`,
);
