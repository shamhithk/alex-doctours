/**
 * Live provider smoke test: JSON output + one tool-call round trip per model.
 * Usage: npx tsx eval/smoke.ts [modelKey...]
 */
import { createClient, extractJson, type Msg } from "../src/llm/client.js";
import { MODELS } from "../src/models/registry.js";

try {
  process.loadEnvFile(".env");
} catch {}

const keys = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(MODELS);
const schema = {
  type: "object",
  additionalProperties: false,
  required: ["answer", "confidence"],
  properties: { answer: { type: "string" }, confidence: { type: "number" } },
};
const tool = {
  name: "getClinicPackages",
  description: "Get the packages (names, prices, deposits) for one clinic, by clinic name or id.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: { clinicName: { type: "string" }, clinicId: { type: "string" } },
  },
};

for (const key of keys) {
  const client = createClient(MODELS[key]);
  try {
    const j = await client.chat({
      system: "Return JSON only, shaped like {\"answer\": string, \"confidence\": number}.",
      messages: [{ role: "user", content: "What is the capital of France? Answer in json." }],
      json: { name: "answer", schema },
      maxTokens: 1500,
    });
    const parsed = extractJson(j.text);
    console.log(`[${key}] json ok=${!!parsed?.answer} ${JSON.stringify(parsed)} ${j.latencyMs}ms`, j.usage);

    const msgs: Msg[] = [{ role: "user", content: "How much does Dr. Hakan Clinic cost? Use the tool." }];
    const t1 = await client.chat({ system: "You answer using tools.", messages: msgs, tools: [tool], maxTokens: 1500 });
    console.log(`[${key}] tool calls:`, JSON.stringify(t1.toolCalls), t1.finishReason);
    if (t1.toolCalls.length) {
      msgs.push({ role: "assistant", content: t1.text || null, toolCalls: t1.toolCalls, providerData: t1.providerData });
      for (const c of t1.toolCalls) {
        msgs.push({
          role: "tool",
          toolCallId: c.id,
          name: c.name,
          content: JSON.stringify({ packages: [{ name: "Sapphire", basePrice: 3200, depositAmount: 500, currency: "USD" }] }),
        });
      }
      const t2 = await client.chat({ system: "You answer using tools.", messages: msgs, tools: [tool], maxTokens: 1500 });
      console.log(`[${key}] after tool: ${JSON.stringify(t2.text.slice(0, 160))} calls=${t2.toolCalls.length}`);
    }
  } catch (e) {
    console.log(`[${key}] ERROR`, (e as Error).message);
  }
}
