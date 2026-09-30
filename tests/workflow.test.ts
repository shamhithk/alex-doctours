import { describe, expect, it } from "vitest";
import { respond, type Deps } from "../src/workflow.js";
import { buildContext } from "../src/context.js";
import { loadDomain } from "../src/skills/loader.js";
import { Router } from "../src/decision/router.js";
import { mapLimit } from "../src/util.js";
import { ReplySchema } from "../src/contracts.js";
import { choice, decision, FakeAdapter, FakeLlm, HAKAN, HEVA, tok, writerJson } from "./helpers.js";

const ctx = buildContext();
const domain = loadDomain();

function deps(d: ReturnType<typeof decision>, llm: FakeLlm, extra: Partial<Deps> = {}): Deps {
  return { ctx, domain, router: new Router(new FakeAdapter(d)), writer: llm, gatherMode: "auto", ...extra };
}

describe("workflow: handoff is terminal", () => {
  it("fast-path human request: no router call, no LLM call, no tools", async () => {
    const adapter = new FakeAdapter(decision());
    const llm = new FakeLlm([]);
    const { reply, trace } = await respond({ id: "h", text: "I demand to talk to a human" }, { ctx, domain, router: new Router(adapter), writer: llm });
    expect(reply.escalate).toBe(true);
    expect(reply.escalationReason).toBeTruthy();
    expect(adapter.calls).toBe(0);
    expect(llm.requests).toHaveLength(0);
    expect(trace.tools).toHaveLength(0);
    expect(reply.response.split(/(?<=[.!?])\s+/).length).toBeLessThanOrEqual(2);
  });
  it("card charge: escalates, never echoes the card digits, writes nothing", async () => {
    const llm = new FakeLlm([]);
    const d = decision({ unsupportedAction: choice("charge_card", 0.95), paymentMode: choice("execution_request") });
    const { reply, trace } = await respond({ id: "c", text: "Charge the deposit on my card ending in 4242 right now." }, deps(d, llm));
    expect(reply).toMatchObject({ escalate: true, attachmentUrls: null, shouldFollowUp: false });
    expect(reply.response).not.toContain("4242");
    expect(JSON.stringify(trace)).not.toContain("4242");
    expect(trace.commits).toBeUndefined();
    expect(llm.requests).toHaveLength(0);
  });
  it("a mixed message (price + human) escalates without answering the price", async () => {
    const llm = new FakeLlm([]);
    const d = decision({ needsHuman: 0.9, skills: { "clinic-packages": 0.9 } });
    const { reply } = await respond({ id: "m", text: "whats the sapphire deposit? actually just get someone real" }, deps(d, llm));
    expect(reply.escalate).toBe(true);
    expect(reply.response).not.toMatch(/\$/);
  });
});

describe("workflow: answer path", () => {
  it("renders facts from tools, links last, commits the clinic lean after validation", async () => {
    const llm = new FakeLlm([
      (req) => {
        const link = req.system.split("# LINKS")[1].match(/(L\d+): Patient's personal assessment/)![1];
        return {
          text: writerJson({
            reply: `${tok(req.system, "Heva Clinic", "specialty")}. ${tok(req.system, "Heva Clinic", "packages")}. ${tok(req.system, "Silver", "price+deposit")}. You can pay from your assessment using the link below.`,
            link_ids: [link],
            claims: [{ text: "afro", sources: ["core"] }],
            intent: "answer Heva packages",
          }),
        };
      },
    ]);
    const d = decision({
      skills: { "clinic-packages": 0.9, payment: 0.8, "clinic-selection": 0.8 },
      clinicMentioned: choice(HEVA),
      clinicLean: choice(HEVA, 0.9),
      paymentMode: choice("link_request", 0.8),
      highEngagement: 0.9,
    });
    const { reply, trace } = await respond({ id: "a", text: "I'm leaning toward Heva, what packages and can I pay from the assessment?" }, deps(d, llm));
    expect(ReplySchema.safeParse(reply).success).toBe(true);
    expect(reply.escalate).toBe(false);
    expect(reply.response).toContain("Heva Clinic specializes in Afro hair. Heva Clinic has two packages: Silver and Gold. Silver is $3,000 USD with a $500 deposit.");
    expect(reply.response.split("\n").at(-1)).toBe("https://www.doctours.com/assessment/c3d4e5f6-3333-4333-8333-333333333333");
    expect(reply.highEngagement).toBe(true);
    expect(trace.commits).toEqual([expect.objectContaining({ tool: "updateUserClinicPreferences", ok: true })]);
    expect(JSON.stringify(trace.commits)).toContain(HEVA);
    expect(trace.tools.some((t) => t.tool === "getClinicPackages" && t.origin === "code")).toBe(true);
  });

  it("repairs once from concrete violations", async () => {
    const llm = new FakeLlm([
      () => ({ text: writerJson({ reply: "Sapphire is $3,200." }) }),
      (req) => {
        const last = req.messages.at(-1) as { content: string };
        expect(last.content).toMatch(/UNSOURCED_QUANTITY/);
        return { text: writerJson({ reply: `${tok(req.system, "Dr. Hakan Clinic", "package-count")}. ${tok(req.system, "Sapphire", "price")}.` }) };
      },
    ]);
    const d = decision({ skills: { "clinic-packages": 0.9 }, clinicMentioned: choice(HAKAN) });
    const { reply, trace } = await respond({ id: "r", text: "What does Dr. Hakan Clinic cost?" }, deps(d, llm));
    expect(reply.response).toBe("Dr. Hakan Clinic has one package. Sapphire is $3,200 USD.");
    expect(trace.writer?.outcome).toBe("repaired");
  });

  it("falls back to a deterministic, fact-only reply after two failed drafts (no false escalation)", async () => {
    const bad = () => ({ text: writerJson({ reply: "Sapphire is $3,100, I'll send details later." }) });
    const llm = new FakeLlm([bad, bad]);
    const d = decision({ skills: { "clinic-packages": 0.9 }, clinicMentioned: choice(HAKAN) });
    const { reply, trace } = await respond({ id: "f", text: "What does Dr. Hakan Clinic cost?" }, deps(d, llm));
    expect(reply.escalate).toBe(false);
    expect(reply.response).toContain("Sapphire is $3,200 USD with a $500 deposit");
    expect(trace.writer?.outcome).toBe("fallback");
  });

  it("writer-detected unsupported request becomes a handoff", async () => {
    const llm = new FakeLlm([() => ({ text: writerJson({ unsupported: "asked us to email the hotel" }) })]);
    const { reply } = await respond({ id: "u", text: "email the hotel my passport" }, deps(decision({ skills: { travel: 0.9 } }), llm));
    expect(reply.escalate).toBe(true);
  });

  it("pausing sets the default 1-month follow-up and no funnel writes", async () => {
    const llm = new FakeLlm([() => ({ text: writerJson({ reply: "Take the time you need. I'll check in next month if I don't hear from you, and if you'd like more or less time, tell me and I'll adjust." }) })]);
    const { reply, trace } = await respond({ id: "p", text: "need to save up first, will reach out" }, deps(decision({ pausing: 0.95, skills: { pause: 0.95 } }), llm));
    expect(reply).toMatchObject({ shouldFollowUp: true, followUpTiming: "1 month", escalate: false });
    expect(trace.commits ?? []).toEqual([]);
  });
});

describe("workflow: tool calling", () => {
  it("runs the bounded gather loop, executes read tools and rejects writes from the model", async () => {
    const llm = new FakeLlm([
      () => ({
        toolCalls: [
          { id: "1", name: "getClinicDoctorsTool", args: { clinicName: "Dr. Hakan Clinic" } },
          { id: "2", name: "updateUserClinicPreferences", args: { clinicSelection: {} } },
        ],
      }),
      () => ({ text: "READY" }),
      (req) => {
        expect(req.system).toContain("Dr. Hakan is the hair transplant surgeon at Dr. Hakan Clinic");
        return { text: writerJson({ reply: "Dr. Hakan Clinic's surgeon is Dr. Hakan, a hair transplant surgeon." }) };
      },
    ]);
    const d = decision({ skills: { "clinic-packages": 0.9 } });
    const { reply, trace } = await respond({ id: "t", text: "who is the doctor there?" }, deps(d, llm, { gatherMode: "always" }));
    expect(reply.escalate).toBe(false);
    const modelCalls = trace.tools.filter((t) => t.origin === "model");
    expect(modelCalls.find((t) => t.tool === "getClinicDoctors")?.ok).toBe(true);
    expect(modelCalls.find((t) => t.tool === "updateUserClinicPreferences")?.ok).toBe(false);
  });
});

describe("runner", () => {
  it("keeps input order regardless of completion order", async () => {
    const out = await mapLimit([30, 1, 20, 5], 4, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      return i;
    });
    expect(out).toEqual([0, 1, 2, 3]);
  });
  it("turns a router outage into a truthful handoff, never a dropped item", async () => {
    const broken = { name: "broken", decide: async () => { throw new Error("down"); } };
    const { reply, trace } = await respond({ id: "x", text: "What does Gold cost?" }, { ctx, domain, router: new Router(broken as any), writer: new FakeLlm([]) });
    expect(reply.escalate).toBe(true);
    expect(trace.error).toMatch(/down/);
  });
});

describe("writer provider failover", () => {
  it("re-runs the turn on the fallback writer when the primary provider fails", async () => {
    const broken = new FakeLlm([]); // throws on first call
    const backup = new FakeLlm([
      (req) => {
        return { text: writerJson({ reply: `${tok(req.system, "Dr. Hakan Clinic", "package-count")}. ${tok(req.system, "Sapphire", "price+deposit")}.` }) };
      },
    ]);
    const d = decision({ skills: { "clinic-packages": 0.9 }, clinicMentioned: choice(HAKAN) });
    const { reply, trace } = await respond({ id: "fo", text: "What does Dr. Hakan Clinic cost?" }, { ...deps(d, broken), writerFallback: backup });
    expect(reply.escalate).toBe(false);
    expect(reply.response).toContain("$3,200 USD with a $500 deposit");
    expect(trace.writer?.providerFailover).toMatch(/failed/);
  });
});

describe("trace hygiene", () => {
  it("masks patient contact details but keeps canonical ids", async () => {
    const { maskPII } = await import("../src/workflow.js");
    const s = maskPII('{"email":"jordan.hale@example.invalid","phone":"+15555550123","id":"44444444-4444-4444-8444-444444444441"}');
    expect(s).not.toContain("jordan.hale@");
    expect(s).not.toContain("5555550123");
    expect(s).toContain("44444444-4444-4444-8444-444444444441");
  });
  it("records a step timeline and tool timings", async () => {
    const llm = new FakeLlm([(req) => {
      return { text: writerJson({ reply: `${tok(req.system, "Dr. Hakan Clinic", "package-count")}. ${tok(req.system, "Sapphire", "price")}.` }) };
    }]);
    const { trace } = await respond({ id: "tl", text: "What does Dr. Hakan Clinic cost?" }, deps(decision({ skills: { "clinic-packages": 0.9 }, clinicMentioned: choice(HAKAN) }), llm));
    expect(trace.timeline.map((t) => t.step)).toEqual(expect.arrayContaining(["guards", "router", "gate", "skills", "evidence", "writer", "commit"]));
    expect(trace.tools.every((t) => typeof t.at === "number")).toBe(true);
    expect(trace.prompt?.system).toContain("# FACTS");
  });
});

describe("long inputs (review finding 5)", () => {
  it("routes every chunk: a paraphrased human request in the middle of a long message escalates", async () => {
    const filler = "I have been reading a lot about hair transplants and comparing notes with friends. ".repeat(180);
    const text = filler + "Could somebody from your staff take over this conversation for me. " + filler;
    expect(text.length).toBeGreaterThan(24_000);
    const perChunk = { name: "chunky", calls: 0, decide: async (inp: { text: string }) => { perChunk.calls++; return decision({ needsHuman: /staff take over/.test(inp.text) ? 0.9 : 0.02 }); } };
    const { reply, trace } = await respond({ id: "long", text }, { ctx, domain, router: new Router(perChunk as any), writer: new FakeLlm([]) });
    expect(perChunk.calls).toBeGreaterThan(1);
    expect(trace.router?.chunks).toBe(perChunk.calls);
    expect(reply.escalate).toBe(true);
  });
  it("messages over the hard limit get a deliberate handoff, not silent truncation", async () => {
    const { reply, trace } = await respond({ id: "huge", text: "x ".repeat(30_000) }, { ctx, domain, router: new Router(new FakeAdapter(decision())), writer: new FakeLlm([]) });
    expect(reply.escalate).toBe(true);
    expect(trace.category).toBe("oversized_input");
  });
});

describe("rejected-draft isolation and request-specific fallback (review finding 2 + extras)", () => {
  const badDraft = () => ({
    text: writerJson({
      reply: "Sapphire is $3,100 and I charged your card.",
      should_follow_up: true,
      follow_up_timing: "tomorrow",
      memory: { keyConcerns: null, promisesMade: "I charged your card", preferredPaymentMethod: null, communicationStyle: null, procedureArea: null },
      claims: [{ text: "bogus", sources: ["F1"] }],
    }),
  });
  it("discards the rejected draft's memory, follow-up and claims; commits nothing from it", async () => {
    const d = decision({ skills: { "clinic-packages": 0.9 }, clinicMentioned: choice(HAKAN) });
    const { reply, trace } = await respond({ id: "iso", text: "What does Dr. Hakan Clinic cost?" }, deps(d, new FakeLlm([badDraft, badDraft])));
    expect(trace.writer?.outcome).toBe("fallback");
    expect(reply.response).toBe("Sapphire is $3,200 USD with a $500 deposit.");
    expect(reply.shouldFollowUp).toBe(false);
    expect(reply.followUpTiming).toBeNull();
    expect(reply.workingMemoryUpdates).toBeNull();
    expect(JSON.stringify(trace.commits ?? [])).not.toContain("charged");
    expect(JSON.stringify(trace.writer?.claims)).not.toContain("F1");
  });
  it("answers the question actually asked: inclusions, not a price catalogue", async () => {
    const d = decision({ skills: { "clinic-packages": 0.9 }, clinicMentioned: choice(HEVA) });
    const { reply } = await respond({ id: "inc", text: "What does the Gold package include?" }, deps(d, new FakeLlm([badDraft, badDraft])));
    expect(reply.response).toBe("Gold includes 4 hotel nights.");
    expect(reply.response).not.toMatch(/\$/);
  });
  it("a missing detail is stated plainly, with no promise of a later lookup", async () => {
    const d = decision({ skills: { travel: 0.9 } });
    const { reply } = await respond({ id: "miss", text: "What's the weather like in Istanbul in March?" }, deps(d, new FakeLlm([badDraft, badDraft])));
    expect(reply.escalate).toBe(false);
    expect(reply.response).toBe("I don't have that exact detail.");
  });
  it("if any adapter flagged an action, a failed draft becomes a handoff, not a 'missing detail'", async () => {
    const d = decision({ skills: { "clinic-packages": 0.9 }, unsupportedAction: choice("hold_date", 0.45) });
    const { reply, trace } = await respond({ id: "act", text: "can you keep march 12 for me at heva" }, deps(d, new FakeLlm([badDraft, badDraft])));
    expect(reply.escalate).toBe(true);
    expect(trace.rulesFired).toContain("fallback.action-request-handoff");
  });
});

describe("cost accounting by stage (review finding 6)", () => {
  const okDraft = (req: any) => ({ text: writerJson({ reply: `${tok(req.system, "Sapphire", "price+deposit")}.` }) });
  it("includes routing cost (LLM classifier and Jev estimate), not just the writer", async () => {
    const llmRouter = { name: "llm", decide: async () => ({ ...decision({ skills: { "clinic-packages": 0.9 }, clinicMentioned: choice(HAKAN) }), raw: { usage: { inputTokens: 1000, outputTokens: 50, costUsd: 0.5 } } }) };
    const { trace } = await respond({ id: "c1", text: "What does Dr. Hakan Clinic cost?" }, { ctx, domain, router: new Router(llmRouter as any), writer: new FakeLlm([okDraft]) });
    expect(trace.usageByStage.map((s) => s.stage)).toEqual(expect.arrayContaining(["router:llm", "writer:fake:draft"]));
    expect(trace.usage.costUsd).toBeCloseTo(0.5, 5);
    expect(trace.usage.costComplete).toBe(true);

    const jevRouter = { name: "jev", decide: async () => ({ ...decision({ skills: { "clinic-packages": 0.9 }, clinicMentioned: choice(HAKAN) }), raw: { usage: { input_tokens: 1_000_000, output_tokens: 20 } } }) };
    const j = await respond({ id: "c2", text: "What does Dr. Hakan Clinic cost?" }, { ctx, domain, router: new Router(jevRouter as any), writer: new FakeLlm([okDraft]) });
    expect(j.trace.usage.costUsd).toBeCloseTo(0.042, 5);
    expect(j.trace.usage.costEstimated).toBe(true);
  });
  it("keeps completed calls before a failover and marks the failed call's cost unknown", async () => {
    const primary = new FakeLlm([]); // throws on the first call
    const { trace } = await respond(
      { id: "c3", text: "What does Dr. Hakan Clinic cost?" },
      { ...deps(decision({ skills: { "clinic-packages": 0.9 }, clinicMentioned: choice(HAKAN) }), primary), writerFallback: new FakeLlm([okDraft]) },
    );
    expect(trace.usageByStage.some((s) => s.stage.endsWith("failed-call") && s.costUsd === null)).toBe(true);
    expect(trace.usage.costComplete).toBe(false);
  });
});
