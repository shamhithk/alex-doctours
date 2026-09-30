import { addUsage, emptyUsage, extractJson, type LlmClient, type Msg, type Usage } from "../llm/client.js";
import type { Ledger } from "../evidence/ledger.js";
import type { ToolExecutor } from "../tools/executor.js";
import { toolSpecs } from "../tools/registry.js";
import { WRITER_SCHEMA } from "./prompt.js";
import {
  coerceWriterOutput,
  hard,
  render,
  validate,
  type Rendered,
  type ValidateContext,
  type Violation,
  type WriterOutput,
} from "../validation/validate.js";

export interface WriterAttempt {
  phase: "gather" | "draft" | "repair";
  startedAt: number;
  /** Raw model text (truncated), for trace viewers. */
  output: string;
  latencyMs: number;
  usage: Usage;
  model: string;
  toolCalls?: { name: string; args: Record<string, unknown>; ok: boolean; error?: string }[];
  violations?: Violation[];
  finishReason: string;
}

export interface WriterResult {
  out?: WriterOutput;
  rendered?: Rendered;
  violations: Violation[];
  attempts: WriterAttempt[];
  usage: Usage;
  outcome: "ok" | "repaired" | "failed" | "unsupported";
}

const MAX_GATHER_ROUNDS = 2;
const MAX_TOOL_CALLS = 4;

/**
 * Phase A (optional): a bounded native tool-calling loop over the loaded
 * skills' read tools, for facts code did not prefetch.
 * Phase B: one structured-output draft, validated; at most one targeted repair.
 */
export async function runWriter(opts: {
  client: LlmClient;
  system: () => string;
  userMessage: string;
  gatherTools: string[];
  gather: boolean;
  exec: ToolExecutor;
  ledger: Ledger;
  vctx: ValidateContext;
}): Promise<WriterResult> {
  const attempts: WriterAttempt[] = [];
  try {
    return await runWriterInner(opts, attempts);
  } catch (e) {
    // Keep completed calls' usage for cost accounting when a provider fails mid-turn.
    (e as any).partialAttempts = attempts;
    throw e;
  }
}

async function runWriterInner(
  opts: Parameters<typeof runWriter>[0],
  attempts: WriterAttempt[],
): Promise<WriterResult> {
  const { client, exec, ledger } = opts;
  let usage = emptyUsage();

  if (opts.gather && opts.gatherTools.length) {
    const tools = toolSpecs(opts.gatherTools);
    const msgs: Msg[] = [{ role: "user", content: opts.userMessage }];
    let calls = 0;
    for (let round = 0; round < MAX_GATHER_ROUNDS && calls < MAX_TOOL_CALLS; round++) {
      const startedAt = Date.now();
      const res = await client.chat({
        system:
          opts.system() +
          "\n\n# GATHER STEP\nBefore drafting, call a tool ONLY if a fact or link needed to answer is missing from FACTS/LINKS. If nothing is missing, reply with the single word READY.",
        messages: msgs,
        tools,
        maxTokens: 1500,
        timeoutMs: 60_000,
      });
      usage = addUsage(usage, res.usage);
      const executed = res.toolCalls.slice(0, MAX_TOOL_CALLS - calls).map((c) => {
        const rec = exec.run(c.name, c.args, "model");
        ledger.ingest(rec);
        return { call: c, rec };
      });
      attempts.push({
        phase: "gather",
        startedAt,
        output: res.text.slice(0, 4000),
        latencyMs: res.latencyMs,
        usage: res.usage,
        model: res.model,
        finishReason: res.finishReason,
        toolCalls: executed.map(({ call, rec }) => ({ name: call.name, args: call.args, ok: rec.ok, error: rec.error })),
      });
      if (!executed.length) break;
      calls += executed.length;
      msgs.push({ role: "assistant", content: res.text || null, toolCalls: executed.map((e) => e.call), providerData: res.providerData });
      for (const { call, rec } of executed) {
        msgs.push({ role: "tool", toolCallId: call.id, name: call.name, content: JSON.stringify(rec.ok ? rec.result : { error: rec.error }) });
      }
    }
  }

  const draft = async (messages: Msg[], phase: "draft" | "repair") => {
    const startedAt = Date.now();
    const res = await client.chat({
      system: opts.system(),
      messages,
      json: { name: "reply", schema: WRITER_SCHEMA },
      maxTokens: 3000,
      timeoutMs: 90_000,
    });
    usage = addUsage(usage, res.usage);
    const parsed = extractJson(res.text);
    const { out, violations: v0 } = coerceWriterOutput(parsed);
    let violations = v0;
    let rendered: Rendered | undefined;
    if (out && !out.unsupported && !hard(v0).length) {
      const r = render(out, ledger);
      rendered = r.rendered;
      violations = [...v0, ...r.violations, ...validate(out, r.rendered, opts.vctx)];
    }
    attempts.push({ phase, startedAt, output: res.text.slice(0, 4000), latencyMs: res.latencyMs, usage: res.usage, model: res.model, violations, finishReason: res.finishReason });
    return { out, rendered, violations, rawText: res.text };
  };

  const first = await draft([{ role: "user", content: opts.userMessage }], "draft");
  if (first.out?.unsupported) return { out: first.out, violations: first.violations, attempts, usage, outcome: "unsupported" };
  if (first.out && first.rendered && !hard(first.violations).length) {
    return { out: first.out, rendered: first.rendered, violations: first.violations, attempts, usage, outcome: "ok" };
  }

  const problems = hard(first.violations).map((v) => `- ${v.code}: ${v.detail}`).join("\n");
  const second = await draft(
    [
      { role: "user", content: opts.userMessage },
      { role: "assistant", content: first.rawText || "(empty)" },
      {
        role: "user",
        content: `Your json broke these rules:\n${problems}\nReturn a corrected json object only. Keep everything that was correct. State facts only with clause tokens from FACTS (e.g. {{P2:price+deposit}}, {{P2:inclusions}}, {{R:refund}}); each token already names its package or clinic. Put link ids in link_ids instead of typing URLs. Remove any claim that an action was done.`,
      },
    ],
    "repair",
  );
  if (second.out?.unsupported) return { out: second.out, violations: second.violations, attempts, usage, outcome: "unsupported" };
  if (second.out && second.rendered && !hard(second.violations).length) {
    return { out: second.out, rendered: second.rendered, violations: second.violations, attempts, usage, outcome: "repaired" };
  }
  return { out: second.out ?? first.out, violations: second.violations, attempts, usage, outcome: "failed" };
}
