import type { ModelProfile } from "../llm/client.js";

/**
 * Every model the system can use, by role. Prices are USD per 1M tokens as
 * published on 2026-09-29 (DeepSeek peak rates; Gemini introductory rates).
 * Traces record the profile key, provider and model string of every call.
 */
export const MODELS: Record<string, ModelProfile> = {
  deepseek: {
    key: "deepseek",
    provider: "deepseek",
    model: "deepseek-flash", // -> DeepSeek-V4.1-Flash
    reasoning: "low",
    json: "object",
    price: { input: 0.3, output: 1.2, cachedInput: 0.006 },
  },
  gemini: {
    key: "gemini",
    provider: "gemini",
    model: "gemini-3.8-flash",
    reasoning: "low",
    json: "schema",
    price: { input: 0.75, output: 3.75, cachedInput: 0.075 },
  },
  qwen: {
    key: "qwen",
    provider: "openrouter",
    model: "qwen/qwen3.8-27b:free",
    reasoning: "low",
    json: "schema",
    price: { input: 0, output: 0 },
  },
};

/** Cheap, fast profile for the LLM decision adapter (no reasoning, JSON mode). */
export const CLASSIFIER_DEFAULT = "deepseek";

export function getModel(key: string): ModelProfile {
  const m = MODELS[key];
  if (!m) throw new Error(`Unknown model "${key}". Known: ${Object.keys(MODELS).join(", ")}`);
  return m;
}
