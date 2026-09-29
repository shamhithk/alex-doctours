import type { Reply } from "../src/contracts.js";
import type { EvalCase } from "./types.js";

/** The subset of a trace the scorer needs (so the baseline can be scored too). */
export interface ScoreTrace {
  tools: { tool: string; ok: boolean; args: unknown }[];
  commits?: { tool: string; ok: boolean; args: unknown }[];
}

export interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

export function score(c: EvalCase, reply: Reply, trace: ScoreTrace): Check[] {
  const e = c.expect;
  const checks: Check[] = [];
  const text = reply.response;
  checks.push({ name: "escalate", ok: reply.escalate === e.escalate, detail: `got ${reply.escalate}` });
  checks.push({ name: "templateId-null", ok: reply.templateId === null });
  checks.push({ name: "reason-rule", ok: reply.escalate ? !!reply.escalationReason : reply.escalationReason === null });
  const urls = text.match(/https?:\/\/\S+/g) ?? [];
  const lines = text.split("\n");
  const trailing = lines.slice(-urls.length || lines.length);
  checks.push({ name: "url-last", ok: urls.every((u) => trailing.includes(u)), detail: urls.join(" ") });
  checks.push({ name: "attachments<=3", ok: (reply.attachmentUrls?.length ?? 0) <= 3 });
  for (const re of e.facts ?? []) checks.push({ name: `fact ${re}`, ok: re.test(text) });
  for (const re of e.forbid ?? []) checks.push({ name: `forbid ${re}`, ok: !re.test(text) });
  if (e.lastLine) checks.push({ name: "last-line", ok: lines.at(-1) === e.lastLine, detail: lines.at(-1) });
  if (e.maxSentences) {
    const n = text.split(/(?<=[.!?])\s+/).filter(Boolean).length;
    checks.push({ name: `sentences<=${e.maxSentences}`, ok: n <= e.maxSentences, detail: String(n) });
  }
  const f = e.fields ?? {};
  if (f.shouldFollowUp !== undefined) checks.push({ name: "shouldFollowUp", ok: reply.shouldFollowUp === f.shouldFollowUp });
  if (f.followUpTiming) checks.push({ name: "followUpTiming", ok: f.followUpTiming.test(reply.followUpTiming ?? ""), detail: String(reply.followUpTiming) });
  if (f.attachmentsMin !== undefined) checks.push({ name: "attachmentsMin", ok: (reply.attachmentUrls?.length ?? 0) >= f.attachmentsMin });
  for (const t of e.tools ?? []) {
    checks.push({
      name: `tool ${t.tool}`,
      ok: trace.tools.some((x) => x.tool === t.tool && x.ok && (!t.argsMatch || t.argsMatch.test(JSON.stringify(x.args)))),
    });
  }
  for (const cm of e.commits ?? []) {
    checks.push({
      name: `commit ${cm.tool}`,
      ok: (trace.commits ?? []).some((x) => x.tool === cm.tool && x.ok && (!cm.argsMatch || cm.argsMatch.test(JSON.stringify(x.args)))),
    });
  }
  if (e.noCommits) checks.push({ name: "no-business-writes", ok: !(trace.commits ?? []).some((x) => x.tool === "updateUserClinicPreferences") });
  return checks;
}

