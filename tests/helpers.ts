import type { Decision } from "../src/contracts.js";
import type { ChatRequest, ChatResponse, LlmClient, ModelProfile } from "../src/llm/client.js";
import type { DecisionAdapter } from "../src/decision/adapter.js";

export const HEVA = "11111111-1111-4111-8111-111111111111";
export const HAKAN = "22222222-2222-4222-8222-222222222222";
export const SILVER = "44444444-4444-4444-8444-444444444441";
export const SAPPHIRE = "55555555-5555-4555-8555-555555555551";

export function decision(over: Partial<Decision> = {}): Decision {
  const c = (choice: string, p = 0.95) => ({ choice, probabilities: { [choice]: p } });
  return {
    adapter: "test",
    needsHuman: 0.02,
    medicalUrgent: 0,
    selfHarm: 0,
    abuseOrLegal: 0,
    promptInjection: 0,
    pausing: 0,
    highEngagement: 0.3,
    unsupportedAction: c("none") as any,
    paymentMode: c("none") as any,
    clinicMentioned: c("none"),
    clinicLean: c("none"),
    packageLean: c("none"),
    communicationStyle: c("casual"),
    targetWindow: c("unknown"),
    skills: {},
    latencyMs: 1,
    ...over,
  };
}

export const choice = (choice: string, p = 0.95) => ({ choice, probabilities: { [choice]: p } }) as any;

export class FakeAdapter implements DecisionAdapter {
  name = "fake";
  calls = 0;
  constructor(private readonly d: Decision | (() => Decision)) {}
  async decide() {
    this.calls++;
    return typeof this.d === "function" ? this.d() : this.d;
  }
}

const profile: ModelProfile = { key: "fake", provider: "deepseek", model: "fake", reasoning: "low", json: "object", price: { input: 0, output: 0 } };

/** Scripted LLM: each call pops the next handler's output. */
export class FakeLlm implements LlmClient {
  profile = profile;
  requests: ChatRequest[] = [];
  constructor(private readonly script: ((req: ChatRequest) => Partial<ChatResponse>)[]) {}
  async chat(req: ChatRequest): Promise<ChatResponse> {
    this.requests.push(req);
    const step = this.script.shift();
    if (!step) throw new Error("FakeLlm: no scripted response left");
    const r = step(req);
    return {
      text: r.text ?? "",
      toolCalls: r.toolCalls ?? [],
      providerData: r.providerData,
      usage: { inputTokens: 100, outputTokens: 20, reasoningTokens: 0, cachedInputTokens: 0, costUsd: 0 },
      latencyMs: 1,
      model: "fake",
      finishReason: "stop",
    };
  }
}

export const writerJson = (over: Record<string, unknown>) =>
  JSON.stringify({
    reply: "",
    link_ids: [],
    attachment_ids: [],
    claims: [],
    intent: "answer",
    should_follow_up: false,
    follow_up_timing: null,
    memory: { keyConcerns: null, promisesMade: null, preferredPaymentMethod: null, communicationStyle: null, procedureArea: null },
    unsupported: null,
    ...over,
  });

/** Find an entity ref in the writer prompt's FACTS block and build a clause token for it. */
export function tok(system: string, name: string, kind: string): string {
  const facts = system.split("# FACTS")[1] ?? "";
  const m = facts.match(new RegExp(`^([A-Z]{1,3}\\d*) = (?:package|clinic) "${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`, "m"));
  if (!m) throw new Error(`no entity "${name}" in FACTS`);
  return `{{${m[1]}:${kind}}}`;
}
