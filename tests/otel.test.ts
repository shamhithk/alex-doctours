import { describe, expect, it } from "vitest";
import { InMemorySpanExporter, SimpleSpanProcessor, BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import { emit, otelFromEnv } from "../src/observability/otel.js";
import { respond } from "../src/workflow.js";
import { buildContext } from "../src/context.js";
import { loadDomain } from "../src/skills/loader.js";
import { Router } from "../src/decision/router.js";
import { choice, decision, FakeAdapter, FakeLlm, HAKAN, tok, writerJson } from "./helpers.js";

const ctx = buildContext();
const domain = loadDomain();

async function spansFor(text: string, d: ReturnType<typeof decision>, llm: FakeLlm) {
  const { trace } = await respond({ id: "otel", text }, { ctx, domain, router: new Router(new FakeAdapter(d)), writer: llm });
  const mem = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(mem)] });
  emit(provider.getTracer("test"), trace);
  await provider.forceFlush();
  return mem.getFinishedSpans();
}

describe("OpenTelemetry export (OpenInference spans)", () => {
  it("renders an answered turn as a span tree with LLM, TOOL and GUARDRAIL spans", async () => {
    const llm = new FakeLlm([
      (req) => {
        return { text: writerJson({ reply: `${tok(req.system, "Dr. Hakan Clinic", "package-count")}. ${tok(req.system, "Sapphire", "price+deposit")}.` }) };
      },
    ]);
    const spans = await spansFor("What does Dr. Hakan Clinic cost?", decision({ skills: { "clinic-packages": 0.9 }, clinicMentioned: choice(HAKAN) }), llm);
    const root = spans.find((s) => s.name.startsWith("reply "))!;
    expect(root).toBeDefined();
    const kinds = spans.map((s) => s.attributes["openinference.span.kind"]);
    expect(kinds).toEqual(expect.arrayContaining(["CHAIN", "GUARDRAIL", "TOOL", "LLM"]));
    for (const s of spans.filter((x) => x !== root)) expect(s.parentSpanContext?.spanId).toBe(root.spanContext().spanId);
    const tool = spans.find((s) => s.name === "tool · getClinicPackages")!;
    expect(tool.attributes["tool.name"]).toBe("getClinicPackages");
    const llmSpan = spans.find((s) => s.name === "writer · draft")!;
    expect(String(llmSpan.attributes["llm.input_messages.0.message.content"])).toContain("# FACTS");
    expect(llmSpan.attributes["llm.token_count.prompt"]).toBe(100);
  });

  it("an escalation exports without writer spans and never carries card digits", async () => {
    const spans = await spansFor(
      "Charge the deposit on my card ending in 4242 right now.",
      decision({ unsupportedAction: choice("charge_card", 0.95), paymentMode: choice("execution_request") }),
      new FakeLlm([]),
    );
    expect(spans.some((s) => s.name.startsWith("writer"))).toBe(false);
    expect(JSON.stringify(spans.map((s) => s.attributes))).not.toContain("4242");
  });

  it("is disabled unless an endpoint is configured", () => {
    expect(otelFromEnv({})).toBeUndefined();
    expect(otelFromEnv({ PHOENIX_COLLECTOR_ENDPOINT: "http://localhost:6006" })).toBeDefined();
  });
});
