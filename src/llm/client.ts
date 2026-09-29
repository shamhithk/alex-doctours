/**
 * One small, dependency-free client over three wire formats:
 *  - DeepSeek direct API (OpenAI-compatible; JSON mode is `json_object` only)
 *  - OpenRouter (OpenAI-compatible; JSON-schema structured outputs)
 *  - Google Gemini API (native REST `generateContent`)
 * Retries 408/429/5xx/network with backoff, honours per-call timeouts, and
 * normalises usage so traces can compare models on equal terms.
 */

export type Provider = "deepseek" | "openrouter" | "gemini";
export type Reasoning = "off" | "low" | "medium" | "high";

export interface ModelProfile {
  key: string;
  provider: Provider;
  model: string;
  reasoning: Reasoning;
  /** JSON mode the provider supports for this model. */
  json: "schema" | "object";
  /** Price per 1M tokens (USD) for cost estimates in traces. */
  price: { input: number; output: number; cachedInput?: number };
  maxTokens?: number;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type Msg =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls?: ToolCall[]; providerData?: unknown }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatRequest {
  system: string;
  messages: Msg[];
  tools?: ToolSpec[];
  json?: { name: string; schema: Record<string, unknown> };
  maxTokens?: number;
  reasoning?: Reasoning;
  timeoutMs?: number;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedInputTokens: number;
  costUsd: number;
}

export interface ChatResponse {
  text: string;
  toolCalls: ToolCall[];
  /** Opaque data that must be sent back on the next turn (reasoning_content / Gemini parts). */
  providerData?: unknown;
  usage: Usage;
  latencyMs: number;
  model: string;
  finishReason: string;
}

export interface LlmClient {
  profile: ModelProfile;
  chat(req: ChatRequest): Promise<ChatResponse>;
}

export class LlmError extends Error {
  constructor(message: string, readonly status?: number, readonly retryable = false) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
  attempts = 4,
): Promise<any> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      if (res.ok) return JSON.parse(text);
      const retryable = res.status === 408 || res.status === 429 || res.status >= 500;
      lastErr = new LlmError(`${res.status} ${text.slice(0, 500)}`, res.status, retryable);
      if (!retryable) throw lastErr;
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff(i));
    } catch (e) {
      if (e instanceof LlmError && !e.retryable) throw e;
      lastErr = e;
      if (i < attempts - 1) await sleep(backoff(i));
    }
  }
  throw lastErr instanceof Error ? lastErr : new LlmError(String(lastErr));
}

const backoff = (i: number) => Math.min(8000, 750 * 2 ** i) + Math.floor(Math.random() * 250);

function cost(p: ModelProfile, u: Omit<Usage, "costUsd">): number {
  const cached = u.cachedInputTokens;
  const fresh = Math.max(0, u.inputTokens - cached);
  return (
    (fresh * p.price.input + cached * (p.price.cachedInput ?? p.price.input) + u.outputTokens * p.price.output) /
    1_000_000
  );
}

// ---------------------------------------------------------------- OpenAI-compatible

class OpenAICompatClient implements LlmClient {
  constructor(
    readonly profile: ModelProfile,
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const p = this.profile;
    const reasoning = req.reasoning ?? p.reasoning;
    const messages: any[] = [{ role: "system", content: req.system }];
    for (const m of req.messages) {
      if (m.role === "user") messages.push({ role: "user", content: m.content });
      else if (m.role === "tool") messages.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
      else {
        const out: any = { role: "assistant", content: m.content ?? "" };
        if (m.toolCalls?.length) {
          out.tool_calls = m.toolCalls.map((c) => ({
            id: c.id,
            type: "function",
            function: { name: c.name, arguments: JSON.stringify(c.args) },
          }));
        }
        // DeepSeek thinking mode: reasoning_content from tool turns must be sent back.
        const rc = (m.providerData as any)?.reasoning_content;
        if (p.provider === "deepseek" && rc) out.reasoning_content = rc;
        messages.push(out);
      }
    }
    const body: any = { model: p.model, messages, max_tokens: req.maxTokens ?? p.maxTokens ?? 4096 };
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }
    if (req.json) {
      body.response_format =
        p.json === "schema"
          ? { type: "json_schema", json_schema: { name: req.json.name, strict: true, schema: req.json.schema } }
          : { type: "json_object" };
    }
    if (p.provider === "deepseek") {
      body.thinking = { type: reasoning === "off" ? "disabled" : "enabled" };
      if (reasoning !== "off") body.reasoning_effort = reasoning === "low" ? "low" : "high";
      else body.temperature = 0;
    } else {
      // No `seed`: with require_parameters it filters out endpoints that don't support it (e.g. Qwen free).
      if (reasoning === "off") body.temperature = 0;
      else body.reasoning = { effort: reasoning };
      if (req.json || req.tools?.length) body.provider = { require_parameters: true };
    }
    const started = Date.now();
    const data = await postJson(
      `${this.baseUrl}/chat/completions`,
      { Authorization: `Bearer ${this.apiKey}` },
      body,
      req.timeoutMs ?? 90_000,
    );
    if (data.error) throw new LlmError(JSON.stringify(data.error).slice(0, 500), data.error.code, true);
    const choice = data.choices?.[0];
    const msg = choice?.message ?? {};
    const toolCalls: ToolCall[] = (msg.tool_calls ?? []).map((c: any) => ({
      id: c.id,
      name: c.function?.name,
      args: safeJson(c.function?.arguments) ?? {},
    }));
    const u = data.usage ?? {};
    const usageBase = {
      inputTokens: u.prompt_tokens ?? 0,
      outputTokens: u.completion_tokens ?? 0,
      reasoningTokens: u.completion_tokens_details?.reasoning_tokens ?? 0,
      cachedInputTokens: u.prompt_cache_hit_tokens ?? u.prompt_tokens_details?.cached_tokens ?? 0,
    };
    return {
      text: msg.content ?? "",
      toolCalls,
      providerData: msg.reasoning_content ? { reasoning_content: msg.reasoning_content } : undefined,
      usage: { ...usageBase, costUsd: typeof u.cost === "number" ? u.cost : cost(p, usageBase) },
      latencyMs: Date.now() - started,
      model: data.model ?? p.model,
      finishReason: choice?.finish_reason ?? "unknown",
    };
  }
}

// ---------------------------------------------------------------- Gemini

class GeminiClient implements LlmClient {
  constructor(
    readonly profile: ModelProfile,
    private readonly apiKey: string,
  ) {}

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const p = this.profile;
    const reasoning = req.reasoning ?? p.reasoning;
    const contents: any[] = [];
    for (const m of req.messages) {
      if (m.role === "user") contents.push({ role: "user", parts: [{ text: m.content }] });
      else if (m.role === "assistant") {
        // Send the model's own parts back unchanged: Gemini 3 function calling relies on thought signatures.
        const parts = (m.providerData as any)?.parts ?? [
          ...(m.content ? [{ text: m.content }] : []),
          ...(m.toolCalls ?? []).map((c) => ({ functionCall: { name: c.name, args: c.args } })),
        ];
        contents.push({ role: "model", parts });
      } else {
        const part = {
          functionResponse: { name: m.name, id: m.toolCallId, response: { result: safeJson(m.content) ?? m.content } },
        };
        const last = contents[contents.length - 1];
        if (last?.role === "user" && last.parts.every((x: any) => x.functionResponse)) last.parts.push(part);
        else contents.push({ role: "user", parts: [part] });
      }
    }
    const generationConfig: any = { maxOutputTokens: req.maxTokens ?? p.maxTokens ?? 4096 };
    // Gemini 3.8 Flash supports low | medium | high (minimal is rejected), so "off" maps to low.
    generationConfig.thinkingConfig = { thinkingLevel: reasoning === "off" ? "low" : reasoning };
    if (req.json) {
      generationConfig.responseMimeType = "application/json";
      generationConfig.responseJsonSchema = req.json.schema;
    }
    const body: any = { systemInstruction: { parts: [{ text: req.system }] }, contents, generationConfig };
    if (req.tools?.length) {
      body.tools = [
        {
          functionDeclarations: req.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parametersJsonSchema: t.parameters,
          })),
        },
      ];
    }
    const started = Date.now();
    const data = await postJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${p.model}:generateContent`,
      { "x-goog-api-key": this.apiKey },
      body,
      req.timeoutMs ?? 90_000,
    );
    const cand = data.candidates?.[0];
    const parts: any[] = cand?.content?.parts ?? [];
    const text = parts
      .filter((x) => typeof x.text === "string" && !x.thought)
      .map((x) => x.text)
      .join("");
    const toolCalls: ToolCall[] = parts
      .filter((x) => x.functionCall)
      .map((x, i) => ({ id: x.functionCall.id ?? `call_${i}_${x.functionCall.name}`, name: x.functionCall.name, args: x.functionCall.args ?? {} }));
    const um = data.usageMetadata ?? {};
    const usageBase = {
      inputTokens: um.promptTokenCount ?? 0,
      outputTokens: (um.candidatesTokenCount ?? 0) + (um.thoughtsTokenCount ?? 0),
      reasoningTokens: um.thoughtsTokenCount ?? 0,
      cachedInputTokens: um.cachedContentTokenCount ?? 0,
    };
    return {
      text,
      toolCalls,
      providerData: { parts },
      usage: { ...usageBase, costUsd: cost(p, usageBase) },
      latencyMs: Date.now() - started,
      model: data.modelVersion ?? p.model,
      finishReason: cand?.finishReason ?? "unknown",
    };
  }
}

// ---------------------------------------------------------------- factory + helpers

export function createClient(profile: ModelProfile, env: NodeJS.ProcessEnv = process.env): LlmClient {
  const need = (k: string) => {
    const v = env[k];
    if (!v) throw new LlmError(`Missing ${k} for model profile "${profile.key}". See .env.example.`);
    return v;
  };
  switch (profile.provider) {
    case "deepseek":
      return new OpenAICompatClient(profile, "https://api.deepseek.com", need("DEEPSEEK_API_KEY"));
    case "openrouter":
      return new OpenAICompatClient(profile, "https://openrouter.ai/api/v1", need("OPENROUTER_API_KEY"));
    case "gemini":
      return new GeminiClient(profile, need("GEMINI_API_KEY"));
  }
}

export function safeJson(s: unknown): any {
  if (typeof s !== "string") return s ?? undefined;
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

/** Parse a JSON object out of model text (tolerates ```json fences and leading prose). */
export function extractJson(text: string): any {
  const direct = safeJson(text.trim());
  if (direct && typeof direct === "object") return direct;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    const v = safeJson(fenced[1].trim());
    if (v) return v;
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return safeJson(text.slice(start, end + 1));
  return undefined;
}

export const emptyUsage = (): Usage => ({
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cachedInputTokens: 0,
  costUsd: 0,
});

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    costUsd: a.costUsd + b.costUsd,
  };
}
