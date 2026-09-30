/**
 * Optional OpenTelemetry export. Converts each finished Trace into a span tree
 * using OpenInference conventions (rendered natively by Arize Phoenix; any
 * OTLP backend such as Langfuse or Tempo accepts the same spans).
 *
 * Enabled only when PHOENIX_COLLECTOR_ENDPOINT or OTEL_EXPORTER_OTLP_ENDPOINT is
 * set. Export is asynchronous and failure-silent: an unreachable collector never
 * changes replies or slows the CLI beyond a bounded flush on exit.
 */
import { context, trace as otel, SpanStatusCode, type Span, type Tracer } from "@opentelemetry/api";
import { BasicTracerProvider, BatchSpanProcessor, type SpanExporter } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { SemanticConventions as SC, OpenInferenceSpanKind as K, SEMRESATTRS_PROJECT_NAME } from "@arizeai/openinference-semantic-conventions";
import type { Trace } from "../workflow.js";

export interface TraceExporter {
  export(t: Trace): void;
  shutdown(): Promise<void>;
}

export function otelFromEnv(env: NodeJS.ProcessEnv = process.env): TraceExporter | undefined {
  const base = env.PHOENIX_COLLECTOR_ENDPOINT ?? env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!base) return undefined;
  const url = base.replace(/\/+$/, "").endsWith("/v1/traces") ? base : `${base.replace(/\/+$/, "")}/v1/traces`;
  const headers: Record<string, string> = {};
  if (env.PHOENIX_API_KEY) headers.Authorization = `Bearer ${env.PHOENIX_API_KEY}`;
  return createTraceExporter(new OTLPTraceExporter({ url, headers, timeoutMillis: 5000 }), env.PHOENIX_PROJECT_NAME ?? "doctours-reply");
}

export function createTraceExporter(exporter: SpanExporter, project = "doctours-reply"): TraceExporter {
  const provider = new BasicTracerProvider({
    resource: resourceFromAttributes({ "service.name": "doctours-reply", [SEMRESATTRS_PROJECT_NAME]: project }),
    spanProcessors: [new BatchSpanProcessor(exporter, { scheduledDelayMillis: 500 })],
  });
  const tracer = provider.getTracer("doctours-reply", "1.0.0");
  return {
    export: (t) => {
      try {
        emit(tracer, t);
      } catch {
        /* never let observability break a reply */
      }
    },
    shutdown: async () => {
      await Promise.race([provider.shutdown().catch(() => {}), new Promise((r) => setTimeout(r, 6000))]);
    },
  };
}

const json = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v ?? null));

function child(tracer: Tracer, parent: Span, name: string, start: number, end: number, attrs: Record<string, any>, error?: string) {
  const s = tracer.startSpan(name, { startTime: start, attributes: clean(attrs) }, otel.setSpan(context.active(), parent));
  if (error) s.setStatus({ code: SpanStatusCode.ERROR, message: error });
  s.end(Math.max(end, start));
  return s;
}

function clean(a: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(a)) if (v !== undefined && v !== null) out[k] = v;
  return out;
}

export function emit(tracer: Tracer, t: Trace) {
  const end = t.startedAt + t.latencyMs;
  const step = (name: string) => t.timeline.find((x) => x.step === name);
  const tags = [t.route, t.category, t.writer?.outcome].filter(Boolean) as string[];
  const root = tracer.startSpan(`reply ${t.id}`, {
    startTime: t.startedAt,
    attributes: clean({
      [SC.OPENINFERENCE_SPAN_KIND]: K.CHAIN,
      [SC.INPUT_VALUE]: t.message,
      [SC.OUTPUT_VALUE]: json(t.reply),
      [SC.OUTPUT_MIME_TYPE]: "application/json",
      [SC.TAG_TAGS]: JSON.stringify(tags),
      [SC.METADATA]: json({
        id: t.id,
        route: t.route,
        category: t.category,
        escalate: t.reply?.escalate,
        writer: t.writer?.model,
        router: t.router?.adapter,
        skills: t.skills?.loaded,
        costUsd: t.usage.costUsd,
      }),
      [SC.LLM_TOKEN_COUNT_PROMPT]: t.usage.inputTokens || undefined,
      [SC.LLM_TOKEN_COUNT_COMPLETION]: t.usage.outputTokens || undefined,
    }),
  });
  if (t.error) root.setStatus({ code: SpanStatusCode.ERROR, message: t.error });

  const g = step("guards");
  if (g) child(tracer, root, "input guards", g.start, g.end, { [SC.OPENINFERENCE_SPAN_KIND]: K.GUARDRAIL, [SC.INPUT_VALUE]: t.message, [SC.OUTPUT_VALUE]: json({ fastPath: t.rulesFired.includes("gate.human-fast-path") }) });

  const r = step("router");
  if (r && t.router) {
    child(tracer, root, `router · ${t.router.adapter}`, r.start, r.end, {
      [SC.OPENINFERENCE_SPAN_KIND]: K.CHAIN,
      [SC.INPUT_VALUE]: t.message,
      [SC.OUTPUT_VALUE]: json(t.router.signals),
      [SC.OUTPUT_MIME_TYPE]: "application/json",
      [SC.METADATA]: json({ secondOpinion: t.router.secondOpinion, merged: t.router.merged, actionConsensus: t.router.actionConsensus, chunks: t.router.chunks, fallbackUsed: t.router.fallbackUsed, errors: t.router.errors }),
    }, t.router.errors.length ? t.router.errors.join("; ") : undefined);
  }
  const gt = step("gate") ?? g;
  if (gt) {
    child(tracer, root, "policy gate", gt.start, gt.end, {
      [SC.OPENINFERENCE_SPAN_KIND]: K.GUARDRAIL,
      [SC.OUTPUT_VALUE]: json({ route: t.route, category: t.category, rulesFired: t.rulesFired }),
      [SC.OUTPUT_MIME_TYPE]: "application/json",
    });
  }
  const sk = step("skills");
  if (sk && t.skills) {
    child(tracer, root, "skills", sk.start, sk.end, {
      [SC.OPENINFERENCE_SPAN_KIND]: K.CHAIN,
      [SC.OUTPUT_VALUE]: json(t.skills),
      [SC.OUTPUT_MIME_TYPE]: "application/json",
    });
  }
  for (const tool of t.tools) {
    child(tracer, root, `tool · ${tool.tool}`, tool.at, tool.at + Math.max(1, tool.ms), {
      [SC.OPENINFERENCE_SPAN_KIND]: K.TOOL,
      [SC.TOOL_NAME]: tool.tool,
      [SC.TOOL_PARAMETERS]: json(tool.args),
      [SC.INPUT_VALUE]: json(tool.args),
      [SC.INPUT_MIME_TYPE]: "application/json",
      [SC.OUTPUT_VALUE]: tool.result ?? tool.error,
      [SC.METADATA]: json({ origin: tool.origin, callId: tool.callId }),
    }, tool.ok ? undefined : tool.error);
  }
  for (const [i, a] of ((t.writer?.attempts ?? []) as any[]).entries()) {
    const hardV = (a.violations ?? []).filter((v: any) => v.severity === "hard");
    const attrs: Record<string, any> = {
      [SC.OPENINFERENCE_SPAN_KIND]: K.LLM,
      [SC.LLM_MODEL_NAME]: a.model,
      [SC.LLM_PROVIDER]: t.writer?.model,
      [SC.OUTPUT_VALUE]: a.output,
      [SC.LLM_TOKEN_COUNT_PROMPT]: a.usage?.inputTokens,
      [SC.LLM_TOKEN_COUNT_COMPLETION]: a.usage?.outputTokens,
      [SC.LLM_TOKEN_COUNT_TOTAL]: (a.usage?.inputTokens ?? 0) + (a.usage?.outputTokens ?? 0),
      [SC.LLM_TOKEN_COUNT_COMPLETION_DETAILS_REASONING]: a.usage?.reasoningTokens || undefined,
      [SC.LLM_TOKEN_COUNT_PROMPT_DETAILS_CACHE_READ]: a.usage?.cachedInputTokens || undefined,
      [SC.LLM_COST_TOTAL]: a.usage?.costUsd,
      [SC.METADATA]: json({ phase: a.phase, finishReason: a.finishReason, violations: a.violations ?? [], toolCalls: a.toolCalls ?? [] }),
    };
    if (i === 0 && t.prompt?.system) {
      attrs[`${SC.LLM_INPUT_MESSAGES}.0.${SC.MESSAGE_ROLE}`] = "system";
      attrs[`${SC.LLM_INPUT_MESSAGES}.0.${SC.MESSAGE_CONTENT}`] = t.prompt.system;
      attrs[`${SC.LLM_INPUT_MESSAGES}.1.${SC.MESSAGE_ROLE}`] = "user";
      attrs[`${SC.LLM_INPUT_MESSAGES}.1.${SC.MESSAGE_CONTENT}`] = t.prompt.user ?? t.message;
      attrs[SC.INPUT_VALUE] = t.prompt.user ?? t.message;
    }
    child(tracer, root, `writer · ${a.phase}`, a.startedAt, a.startedAt + a.latencyMs, attrs, hardV.length ? hardV.map((v: any) => v.code).join(", ") : undefined);
  }
  if (t.writer) {
    const last = step("writer");
    child(tracer, root, "validation", last?.end ?? end, last?.end ?? end, {
      [SC.OPENINFERENCE_SPAN_KIND]: K.GUARDRAIL,
      [SC.OUTPUT_VALUE]: json({ outcome: t.writer.outcome, violations: t.violations ?? [], failover: t.writer.providerFailover, claims: t.writer.claims }),
      [SC.OUTPUT_MIME_TYPE]: "application/json",
    }, t.writer.outcome === "fallback" ? "drafts failed validation; deterministic fallback used" : undefined);
  }
  const ob = step("output-battery");
  if (ob && t.outputBattery) {
    child(tracer, root, "output battery · jev", ob.start, ob.end, {
      [SC.OPENINFERENCE_SPAN_KIND]: K.EVALUATOR,
      [SC.INPUT_VALUE]: t.reply?.response,
      [SC.OUTPUT_VALUE]: json(t.outputBattery),
      [SC.OUTPUT_MIME_TYPE]: "application/json",
    });
  }
  const cm = step("commit");
  if (cm) {
    child(tracer, root, "commit writes", cm.start, cm.end, {
      [SC.OPENINFERENCE_SPAN_KIND]: K.CHAIN,
      [SC.OUTPUT_VALUE]: json({ commits: t.commits ?? [], skipped: t.commitSkipped ?? [] }),
      [SC.OUTPUT_MIME_TYPE]: "application/json",
    });
  }
  root.end(end);
}
