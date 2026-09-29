import { ReplySchema, WorkingMemoryUpdatesSchema, type InputItem, type Reply, type WorkingMemoryUpdates } from "./contracts.js";
import { renderUserMessage, type PatientContext } from "./context.js";
import { guardInput } from "./guards/input.js";
import { buildQuestions, routerState, type QuestionSet } from "./decision/questions.js";
import type { Router, RouterResult } from "./decision/router.js";
import { choiceP } from "./decision/adapter.js";
import { gate, HANDOFF, THRESHOLDS, type EscalationCategory } from "./policy/gate.js";
import { selectSkills, applyConditions, type Domain, type Selection } from "./skills/loader.js";
import { flags } from "./context.js";
import { Ledger } from "./evidence/ledger.js";
import { prefetch } from "./evidence/prefetch.js";
import { ToolExecutor } from "./tools/executor.js";
import { READ_TOOLS } from "./tools/registry.js";
import { buildWriterSystem } from "./writer/prompt.js";
import { runWriter, type WriterResult } from "./writer/writer.js";
import { minimalReply } from "./writer/fallback.js";
import { commitWrites } from "./commit.js";
import { addUsage, emptyUsage, type LlmClient } from "./llm/client.js";
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
  message: string;
  route: string;
  category?: string;
  rulesFired: string[];
  router?: {
    adapter: string;
    fallbackUsed: boolean;
    adjudicated: string[];
    errors: string[];
    latencyMs: number;
    signals: Record<string, unknown>;
  };
  skills?: { loaded: string[]; selectedBy: Selection["selectedBy"]; suppressed: Selection["suppressed"]; versions: Record<string, number> };
  prompt?: { approxTokens: number };
  tools: { callId: string; tool: string; args: unknown; ok: boolean; error?: string; origin: string }[];
  facts?: number;
  writer?: { model: string; outcome: WriterResult["outcome"] | "fallback"; attempts: unknown[]; claims: unknown[]; providerFailover?: string };
  violations?: unknown[];
  outputBattery?: Record<string, number>;
  commits?: { tool: string; ok: boolean; args: unknown }[];
  commitSkipped?: string[];
  usage: ReturnType<typeof emptyUsage>;
  latencyMs: number;
  reply: Reply;
  error?: string;
}

export async function respond(item: InputItem, deps: Deps, qs = buildQuestions(deps.domain, deps.ctx)): Promise<{ reply: Reply; trace: Trace }> {
  const started = Date.now();
  const { domain, ctx } = deps;
  const exec = new ToolExecutor(ctx.userId);
  const g = guardInput(item.text);
  const trace: Trace = {
    id: item.id,
    message: g.redacted,
    route: "",
    rulesFired: [],
    tools: [],
    usage: emptyUsage(),
    latencyMs: 0,
    reply: undefined as unknown as Reply,
  };
  const finish = (reply: Reply) => {
    trace.reply = ReplySchema.parse(reply);
    trace.tools = exec.records.map((r) => ({ callId: r.callId, tool: r.tool, args: r.args, ok: r.ok, error: r.error, origin: r.origin }));
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

  try {
    // 1. Human fast path: a clear affirmative request never waits on a model.
    if (g.humanFastPath) {
      trace.rulesFired.push("gate.human-fast-path");
      return handoff("human");
    }

    // 2. Typed interpretation.
    let rr: RouterResult;
    rr = await deps.router.decide({ text: g.redacted, state: routerState(ctx, g.redacted), qs });
    const d = rr.decision;
    if (g.injectionHeuristic) d.promptInjection = Math.max(d.promptInjection, 0.9);
    trace.router = {
      adapter: d.adapter,
      fallbackUsed: rr.fallbackUsed,
      adjudicated: rr.adjudicated,
      errors: rr.errors,
      latencyMs: d.latencyMs,
      signals: summarise(d),
    };

    // 3. Policy gate (code holds authority).
    const gr = gate(d, g, ctx.clinics.map((c) => c.name));
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
    const sel = selectSkills(domain, requested);
    trace.skills = {
      loaded: sel.ids,
      selectedBy: sel.selectedBy,
      suppressed: sel.suppressed,
      versions: Object.fromEntries(sel.ids.map((id) => [id, domain.skills.get(id)!.version])),
    };

    // 5. Evidence, code first.
    const ledger = new Ledger();
    prefetch(sel.ids, d, ctx, g.text, exec, ledger);
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
          (/\b(?:doctor|surgeon)\b/i.test(g.text) && !ledger.facts.some((f) => f.key === "clinic.doctor"))));
    const system = () => buildWriterSystem(domain, sel, ctx, ledger).system;
    trace.prompt = { approxTokens: buildWriterSystem(domain, sel, ctx, ledger).approxTokens };
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
      },
    };
    let writerUsed = deps.writer;
    let failover: string | undefined;
    let w: WriterResult;
    try {
      w = await runWriter({ client: deps.writer, ...writerArgs });
    } catch (e) {
      if (!deps.writerFallback) throw e;
      failover = `${deps.writer.profile.key} failed (${(e as Error).message.slice(0, 120)}); used ${deps.writerFallback.profile.key}`;
      writerUsed = deps.writerFallback;
      w = await runWriter({ client: deps.writerFallback, ...writerArgs });
    }
    trace.usage = addUsage(trace.usage, w.usage);
    trace.facts = ledger.facts.length;
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
    let responseText: string;
    let attachments: string[] | null = null;
    let intent = w.out?.intent ?? "answer patient question";
    if (w.outcome === "failed" || !w.rendered) {
      const fb = minimalReply(sel.ids, ledger);
      if (!fb) return handoff("internal_error", "draft failed validation twice");
      trace.writer.outcome = "fallback";
      responseText = fb.text;
      intent = fb.intent;
    } else {
      responseText = w.rendered.text;
      attachments = w.rendered.attachments.length ? w.rendered.attachments : null;
    }

    // Output battery: semantic signals recorded for eval (never an escalation trigger).
    if (deps.outputBattery) {
      try {
        const ob = await deps.outputBattery.ask(
          { patient_message: g.redacted, coordinator_reply: responseText },
          OUTPUT_BATTERY,
        );
        trace.outputBattery = Object.fromEntries(Object.entries(ob.answers).map(([k, a]) => [k, a.p ?? 0]));
      } catch (e) {
        trace.outputBattery = { error: 1 } as any;
      }
    }

    // 9. Commit writes after validation.
    const memory = buildMemory(w.out?.memory ?? null, d);
    const c = commitWrites(d, memory, exec, ctx.clinics.map((x) => x.id));
    trace.commits = c.receipts.map((r) => ({ tool: r.tool, ok: r.ok, args: r.args }));
    trace.commitSkipped = c.skipped;

    // 10. Finalize.
    let shouldFollowUp = w.out?.should_follow_up === true && !!w.out?.follow_up_timing;
    let followUpTiming = shouldFollowUp ? w.out!.follow_up_timing : null;
    if (d.pausing >= 0.7 && !shouldFollowUp) {
      shouldFollowUp = true;
      followUpTiming = "1 month";
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
