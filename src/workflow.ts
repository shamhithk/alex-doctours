import { ReplySchema, WorkingMemoryUpdatesSchema, type InputItem, type Reply, type WorkingMemoryUpdates } from "./contracts.js";
import { renderUserMessage, type PatientContext } from "./context.js";
import { guardInput, HARD_INPUT_LIMIT } from "./guards/input.js";
import { buildQuestions, routerState, type QuestionSet } from "./decision/questions.js";
import { mergeChunks, RouterFailure, type Router, type RouterResult } from "./decision/router.js";
import { choiceP } from "./decision/adapter.js";
import { gate, HANDOFF, THRESHOLDS, type EscalationCategory } from "./policy/gate.js";
import { selectSkills, applyConditions, factsFor, type Domain, type Selection } from "./skills/loader.js";
import { flags } from "./context.js";
import { Ledger } from "./evidence/ledger.js";
import { prefetch } from "./evidence/prefetch.js";
import { ToolExecutor } from "./tools/executor.js";
import { READ_TOOLS } from "./tools/registry.js";
import { buildWriterSystem } from "./writer/prompt.js";
import { runWriter, type WriterResult } from "./writer/writer.js";
import { buildFallback } from "./writer/fallback.js";
import { hard, render, validate, type Rendered, type WriterOutput } from "./validation/validate.js";
import { commitWrites, planSelection } from "./commit.js";
import { claimsPersistence } from "./validation/claims.js";
import { type LlmClient } from "./llm/client.js";
import { fromJevUsage, fromLlmUsage, fromRouterUsage, totals, type StageUsage, type UsageTotals } from "./usage.js";
import type { SystemOneAdapter } from "./decision/systemone.js";

export interface Deps {
  domain: Domain;
  ctx: PatientContext;
  router: Router;
  writer: LlmClient;
  /** Used when the primary writer's provider fails after retries (outage, rate limit). */
  writerFallback?: LlmClient;
  outputBattery?: SystemOneAdapter;
  gatherMode?: "auto" | "always" | "never";
}

export interface Trace {
  id: string;
  /** Epoch ms when processing started. */
  startedAt: number;
  /** Step timings for waterfalls: { step, start, end } in epoch ms. */
  timeline: { step: string; start: number; end: number }[];
  message: string;
  route: string;
  category?: string;
  rulesFired: string[];
  router?: {
    adapter: string;
    fallbackUsed: boolean;
    secondOpinion: string[];
    merged: RouterResult["merged"];
    actionConsensus: RouterResult["actionConsensus"];
    chunks: number;
    errors: string[];
    unconfirmed?: string[];
    retries?: number;
    latencyMs: number;
    signals: Record<string, unknown>;
  };
  skills?: { loaded: string[]; selectedBy: Selection["selectedBy"]; suppressed: Selection["suppressed"]; versions: Record<string, number> };
  prompt?: { approxTokens: number; system?: string; user?: string };
  tools: { callId: string; tool: string; args: unknown; ok: boolean; error?: string; origin: string; at: number; ms: number; result?: string }[];
  facts?: number;
  writer?: { model: string; outcome: WriterResult["outcome"] | "fallback"; attempts: unknown[]; claims: unknown[]; providerFailover?: string };
  violations?: unknown[];
  outputBattery?: Record<string, number>;
  commits?: { tool: string; ok: boolean; args: unknown }[];
  commitSkipped?: string[];
  usage: UsageTotals;
  /** Every model/classifier call by stage; unknown costs are null, estimates are flagged. */
  usageByStage: StageUsage[];
  /** Set when every router adapter failed (the turn then hands off). */
  routerFailure?: { errors: string[]; retries: number };
  latencyMs: number;
  reply: Reply;
  error?: string;
}

/** pause.interval: a pausing patient gets a 1-month check-in unless they named another window. */
const PAUSE_FOLLOW_UP = { threshold: 0.7, timing: "1 month" };

export async function respond(item: InputItem, deps: Deps, qs = buildQuestions(deps.domain, deps.ctx)): Promise<{ reply: Reply; trace: Trace }> {
  const started = Date.now();
  const { domain, ctx } = deps;
  const exec = new ToolExecutor(ctx.userId);
  const g = guardInput(item.text);
  const trace: Trace = {
    id: item.id,
    startedAt: started,
    timeline: [],
    message: g.redacted,
    route: "",
    rulesFired: [],
    tools: [],
    usage: totals([]),
    usageByStage: [],
    latencyMs: 0,
    reply: undefined as unknown as Reply,
  };
  const finish = (reply: Reply) => {
    trace.usage = totals(trace.usageByStage);
    trace.reply = ReplySchema.parse(reply);
    trace.tools = exec.records.map((r) => ({
      callId: r.callId,
      tool: r.tool,
      args: r.args,
      ok: r.ok,
      error: r.error,
      origin: r.origin,
      at: r.at,
      ms: r.ms,
      result: r.ok ? maskPII(JSON.stringify(r.result)).slice(0, 3000) : undefined,
    }));
    trace.latencyMs = Date.now() - started;
    return { reply: trace.reply, trace };
  };
  const handoff = (category: EscalationCategory, extraMemory?: string) => {
    trace.route = "handoff";
    trace.category = category;
    const h = HANDOFF[category];
    return finish({
      response: h.response,
      escalate: true,
      escalationReason: h.reason,
      templateId: null,
      intent: "escalate to human",
      shouldFollowUp: false,
      followUpTiming: null,
      attachmentUrls: null,
      highEngagement: false,
      workingMemoryUpdates: { escalationFlags: extraMemory ? `${h.reason}; ${extraMemory}` : h.reason },
    });
  };

  const mark = async <T>(step: string, fn: () => Promise<T> | T): Promise<T> => {
    const start = Date.now();
    try {
      return await fn();
    } finally {
      trace.timeline.push({ step, start, end: Date.now() });
    }
  };
  trace.timeline.push({ step: "guards", start: started, end: Date.now() });

  try {
    // 1. Human fast path: a clear affirmative request never waits on a model.
    if (g.humanFastPath) {
      trace.rulesFired.push("gate.human-fast-path");
      return handoff("human");
    }

    // Oversized input: a deliberate, documented handoff rather than silent truncation.
    if (g.chars > HARD_INPUT_LIMIT) {
      trace.rulesFired.push("gate.oversized-input");
      return handoff("oversized_input");
    }

    // 2. Typed interpretation over the FULL message. Long messages are routed chunk by
    //    chunk and merged (terminal signals by max) before anything is drafted.
    const chunks = chunkText(g.redacted, ROUTER_CHUNK_CHARS);
    // allSettled: a failed chunk must not discard the usage of the chunks (and calls) that ran.
    const settled = await mark("router", () => Promise.allSettled(chunks.map((c) => deps.router.decide({ text: c, state: routerState(ctx, c), qs }))));
    for (const s of settled) {
      const usages = s.status === "fulfilled" ? s.value.usages : s.reason instanceof RouterFailure ? s.reason.usages : [{ stage: "router:failed-call", usage: undefined }];
      trace.usageByStage.push(...usages.map((u) => fromRouterUsage(u.stage, u.usage)));
    }
    const failed = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
    if (failed) {
      const f = failed.reason as { errors?: string[]; retries?: number; message?: string };
      trace.routerFailure = { errors: f.errors ?? [String(f.message ?? f)], retries: f.retries ?? 0 };
      throw failed.reason;
    }
    const rr: RouterResult = mergeChunks(settled.map((s) => (s as PromiseFulfilledResult<RouterResult>).value));
    const d = rr.decision;
    if (g.injectionHeuristic) d.promptInjection = Math.max(d.promptInjection, 0.9);
    trace.router = {
      adapter: d.adapter,
      fallbackUsed: rr.fallbackUsed,
      secondOpinion: rr.secondOpinion,
      merged: rr.merged,
      actionConsensus: rr.actionConsensus,
      chunks: chunks.length,
      errors: rr.errors,
      unconfirmed: rr.unconfirmed,
      retries: rr.retries,
      latencyMs: d.latencyMs,
      signals: summarise(d),
    };

    // 3. Policy gate (code holds authority).
    const gr = await mark("gate", () => gate(d, g, ctx.clinics.map((c) => c.name), rr.actionConsensus, rr.unconfirmed));
    trace.rulesFired.push(...gr.rulesFired);
    if (gr.route === "handoff") {
      return handoff(gr.category!, d.promptInjection >= THRESHOLDS.act ? "prompt-injection attempt" : undefined);
    }
    if (gr.route === "clarify") {
      trace.route = "clarify";
      return finish(baseReply(gr.clarifyQuestion!, "clarify which clinic", d.highEngagement >= 0.5));
    }

    // 4. Skills: router-selected + dependencies - suppressed, deterministic order.
    const requested = Object.entries(d.skills)
      .filter(([, p]) => p >= THRESHOLDS.skill)
      .map(([id]) => id);
    const sel = await mark("skills", () => selectSkills(domain, requested));
    trace.skills = {
      loaded: sel.ids,
      selectedBy: sel.selectedBy,
      suppressed: sel.suppressed,
      versions: Object.fromEntries(sel.ids.map((id) => [id, domain.skills.get(id)!.version])),
    };

    // 5. Evidence, code first.
    const ledger = new Ledger();
    ledger.addPolicyFacts(factsFor(domain, sel.ids));
    await mark("evidence", () => prefetch(sel.ids, d, ctx, g.text, exec, ledger));
    for (const id of sel.ids) {
      for (const url of domain.skills.get(id)!.links) ledger.addLink(url, `${domain.skills.get(id)!.title} page`, `skill:${id}`);
    }

    // 6-8. Writer: optional bounded tool loop, structured draft, validation, one repair.
    const gatherTools = [...new Set(sel.ids.flatMap((id) => domain.skills.get(id)!.tools))].filter((t) => READ_TOOLS.includes(t));
    const gather =
      deps.gatherMode === "always" ||
      (deps.gatherMode !== "never" &&
        // Only when a needed fact is actually missing after code prefetch.
        ((d.paymentMode.choice === "link_request" && sel.ids.includes("payment") && !ledger.links.some((l) => /assessment|payment link|checkout link/i.test(l.label))) ||
          (/\b(?:doctors?|surgeons?)\b/i.test(g.text) && !ledger.allEntities().some((e) => e.kind === "clinic" && e.doctors?.length))));
    const system = () => buildWriterSystem(domain, sel, ctx, ledger).system;
    const built = buildWriterSystem(domain, sel, ctx, ledger);
    trace.prompt = { approxTokens: built.approxTokens, system: built.system, user: renderUserMessage(ctx, g.redacted) };
    const loadedRulesText = [domain.core.body, ...sel.ids.map((id) => applyConditions(domain.skills.get(id)!.body, flags(ctx)))].join("\n");
    const writerArgs = {
      system,
      userMessage: renderUserMessage(ctx, g.redacted),
      gatherTools,
      gather,
      exec,
      ledger,
      vctx: {
        ledger,
        patientText: g.text,
        neverEcho: g.neverEcho,
        loadedRulesText,
        linksAlreadySent: ctx.linksAlreadySent,
        paymentSkillLoaded: sel.ids.includes("payment"),
        linkRequested: d.paymentMode.choice === "link_request",
        selectionWritePlanned: Object.keys(planSelection(d, ctx.clinics.map((x) => x.id), g.text).selection).length > 0,
        codeFollowUp: d.pausing >= PAUSE_FOLLOW_UP.threshold ? PAUSE_FOLLOW_UP.timing : null,
      },
    };
    let writerUsed = deps.writer;
    let failover: string | undefined;
    let w: WriterResult;
    w = await mark("writer", async () => {
      try {
        return await runWriter({ client: deps.writer, ...writerArgs });
      } catch (e) {
        for (const a of ((e as any).partialAttempts ?? []) as { phase: string; usage: unknown }[]) {
          trace.usageByStage.push(fromLlmUsage(`writer:${deps.writer.profile.key}:${a.phase}`, a.usage));
        }
        // The call that failed may still have been billed; its usage is unknown, not zero.
        trace.usageByStage.push({ stage: `writer:${deps.writer.profile.key}:failed-call`, inputTokens: null, outputTokens: null, costUsd: null });
        if (!deps.writerFallback) throw e;
        failover = `${deps.writer.profile.key} failed (${(e as Error).message.slice(0, 120)}); used ${deps.writerFallback.profile.key}`;
        writerUsed = deps.writerFallback;
        try {
          return await runWriter({ client: deps.writerFallback, ...writerArgs });
        } catch (e2) {
          for (const a of ((e2 as any).partialAttempts ?? []) as { phase: string; usage: unknown }[]) {
            trace.usageByStage.push(fromLlmUsage(`writer:${deps.writerFallback.profile.key}:${a.phase}`, a.usage));
          }
          trace.usageByStage.push({ stage: `writer:${deps.writerFallback.profile.key}:failed-call`, inputTokens: null, outputTokens: null, costUsd: null });
          throw e2;
        }
      }
    });
    for (const a of w.attempts) trace.usageByStage.push(fromLlmUsage(`writer:${writerUsed.profile.key}:${a.phase}`, a.usage));
    trace.facts = ledger.factCount;
    trace.violations = w.violations;
    trace.writer = {
      model: writerUsed.profile.key,
      outcome: w.outcome,
      attempts: w.attempts,
      claims: w.out?.claims ?? [],
      ...(failover ? { providerFailover: failover } : {}),
    };

    if (w.outcome === "unsupported") {
      trace.rulesFired.push("writer.unsupported-request");
      return handoff("writer_unsupported", w.out?.unsupported ?? undefined);
    }
    // Choose the COMPLETE result before anything is committed. A rejected draft contributes
    // nothing: its text, memory, follow-up and claims are all discarded.
    let final: { out: WriterOutput; rendered: Rendered; source: "writer" | "fallback" };
    if ((w.outcome === "ok" || w.outcome === "repaired") && w.out && w.rendered) {
      final = { out: w.out, rendered: w.rendered, source: "writer" };
    } else {
      const fb = buildFallback(sel.ids, ledger, g.text, d);
      if ("escalate" in fb) {
        trace.rulesFired.push("fallback.action-request-handoff");
        return handoff("writer_unsupported", fb.escalate);
      }
      const r = render(fb.out, ledger);
      const fv = [...r.violations, ...validate(fb.out, r.rendered, writerArgs.vctx)];
      if (hard(fv).length) return handoff("internal_error", "fallback failed validation");
      final = { out: fb.out, rendered: r.rendered, source: "fallback" };
      trace.writer.outcome = "fallback";
      trace.writer.claims = fb.out.claims;
      trace.rulesFired.push("fallback.validated");
    }
    const responseText = final.rendered.text;
    const attachments = final.rendered.attachments.length ? final.rendered.attachments : null;
    const intent = final.out.intent;

    // Output battery: semantic signals recorded for eval (never an escalation trigger).
    if (deps.outputBattery) {
      try {
        const battery = deps.outputBattery;
        const ob = await mark("output-battery", () => battery.ask(
          { patient_message: g.redacted, coordinator_reply: responseText },
          OUTPUT_BATTERY,
        ));
        trace.outputBattery = Object.fromEntries(Object.entries(ob.answers).map(([k, a]) => [k, a.p ?? 0]));
        trace.usageByStage.push(fromJevUsage("output-battery", ob.usage));
      } catch (e) {
        trace.outputBattery = { error: 1 } as any;
        trace.usageByStage.push({ stage: "output-battery:failed-call", inputTokens: null, outputTokens: null, costUsd: null });
      }
    }

    // 9. Commit writes after validation.
    const memory = buildMemory(final.source === "writer" ? final.out.memory : null, d);
    const c = await mark("commit", () => commitWrites(d, memory, exec, ctx.clinics.map((x) => x.id), g.text));
    trace.commits = c.receipts.map((r) => ({ tool: r.tool, ok: r.ok, args: r.args }));
    trace.commitSkipped = c.skipped;
    // A reply that says something was noted or saved is sent only with a successful write receipt.
    if (claimsPersistence(final.out.reply) && !c.receipts.some((r) => r.ok && r.result !== null)) {
      trace.rulesFired.push("commit.persistence-claim-without-receipt");
      return handoff("internal_error", "reply claimed a save that no write confirmed");
    }

    // 10. Finalize.
    let shouldFollowUp = final.source === "writer" && final.out.should_follow_up === true && !!final.out.follow_up_timing;
    let followUpTiming = shouldFollowUp ? final.out.follow_up_timing : null;
    if (d.pausing >= PAUSE_FOLLOW_UP.threshold && !shouldFollowUp) {
      shouldFollowUp = true;
      followUpTiming = PAUSE_FOLLOW_UP.timing;
      trace.rulesFired.push("finalize.pause-default-1-month");
    }
    trace.route = "answer";
    return finish({
      response: responseText,
      escalate: false,
      escalationReason: null,
      templateId: null,
      intent,
      shouldFollowUp,
      followUpTiming,
      attachmentUrls: attachments,
      highEngagement: d.highEngagement >= 0.5,
      workingMemoryUpdates: memory,
    });
  } catch (e) {
    trace.error = (e as Error).message;
    return handoff("internal_error");
  }
}

function baseReply(response: string, intent: string, highEngagement: boolean): Reply {
  return {
    response,
    escalate: false,
    escalationReason: null,
    templateId: null,
    intent,
    shouldFollowUp: false,
    followUpTiming: null,
    attachmentUrls: null,
    highEngagement,
    workingMemoryUpdates: null,
  };
}

function buildMemory(raw: Record<string, unknown> | null, d: import("./contracts.js").Decision): WorkingMemoryUpdates | null {
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw ?? {})) if (v !== null && v !== undefined && v !== "") patch[k] = v;
  if (d.targetWindow.choice !== "unknown" && choiceP(d.targetWindow) >= 0.7) patch.targetProcedureWindow = d.targetWindow.choice;
  const parsed = WorkingMemoryUpdatesSchema.safeParse(patch);
  const clean: Record<string, unknown> = {};
  if (parsed.success) Object.assign(clean, parsed.data);
  else {
    for (const [k, v] of Object.entries(patch)) {
      const one = WorkingMemoryUpdatesSchema.safeParse({ [k]: v });
      if (one.success) Object.assign(clean, one.data);
    }
  }
  return Object.keys(clean).length ? (clean as WorkingMemoryUpdates) : null;
}

function summarise(d: import("./contracts.js").Decision) {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    needsHuman: r2(d.needsHuman),
    unsupportedAction: `${d.unsupportedAction.choice}:${r2(choiceP(d.unsupportedAction))}`,
    paymentMode: `${d.paymentMode.choice}:${r2(choiceP(d.paymentMode))}`,
    medicalUrgent: r2(d.medicalUrgent),
    promptInjection: r2(d.promptInjection),
    pausing: r2(d.pausing),
    highEngagement: r2(d.highEngagement),
    clinicMentioned: d.clinicMentioned.choice,
    clinicLean: `${d.clinicLean.choice}:${r2(choiceP(d.clinicLean))}`,
    packageLean: `${d.packageLean.choice}:${r2(choiceP(d.packageLean))}`,
    skills: Object.fromEntries(Object.entries(d.skills).filter(([, p]) => p >= 0.2).map(([k, p]) => [k, r2(p)])),
  };
}

export const OUTPUT_BATTERY: Record<string, unknown> = {
  promises_offchannel_action: {
    type: "noul",
    instructions: "Does the coordinator reply promise to send, check, contact someone, or follow up on something later (other than a dated check-in the patient agreed to)?",
  },
  leaves_question_unanswered: {
    type: "noul",
    instructions: "Does the reply leave any question in the patient message unanswered (without saying it doesn't have that detail)?",
  },
  pressure_or_upsell: { type: "noul", instructions: "Does the reply pressure the patient, create urgency, or upsell something they did not ask about?" },
  unprompted_financing: { type: "noul", instructions: "Does the reply bring up financing, Klarna, PayPal or layaway when the patient did not ask about payment options?" },
  asks_multiple_questions: { type: "noul", instructions: "Does the reply ask the patient more than one question?" },
};

/** Mask emails and phone numbers in trace payloads (tool results carry patient contact details). */
export function maskPII(s: string): string {
  return s
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\+?\d[\d\s().-]{8,}\d/g, (m) => {
      const digits = m.replace(/\D/g, "").length;
      return digits >= 10 && digits <= 15 ? "[phone]" : m; // ids like 44444444-4444-... have 32 digits
    });
}

/** Messages up to this length are routed whole; longer ones chunk by chunk. */
export const ROUTER_CHUNK_CHARS = 12_000;

/** Split on sentence boundaries into chunks of at most `max` characters (a single long sentence is hard-split). */
export function chunkText(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let cur = "";
  for (const s of text.split(/(?<=[.!?])\s+/)) {
    if ((cur + " " + s).length > max && cur) {
      out.push(cur);
      cur = "";
    }
    if (s.length > max) {
      for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max));
      continue;
    }
    cur = cur ? `${cur} ${s}` : s;
  }
  if (cur) out.push(cur);
  return out;
}
