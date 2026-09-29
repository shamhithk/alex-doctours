import { buildContext } from "./context.js";
import { loadDomain } from "./skills/loader.js";
import { createClient } from "./llm/client.js";
import { CLASSIFIER_DEFAULT, getModel } from "./models/registry.js";
import { LlmDecisionAdapter } from "./decision/llm.js";
import { SystemOneAdapter } from "./decision/systemone.js";
import type { DecisionAdapter } from "./decision/adapter.js";
import { Router } from "./decision/router.js";
import type { Deps } from "./workflow.js";

export interface Options {
  writer: string;
  router: "auto" | "jev" | "laya" | "llm" | "jev-only" | "llm-only";
  classifier: string;
  outputBattery: boolean;
  gatherMode: "auto" | "always" | "never";
}

export const DEFAULT_OPTIONS: Options = {
  writer: process.env.WRITER_MODEL ?? "deepseek",
  router: (process.env.ROUTER as Options["router"]) ?? "auto",
  classifier: process.env.CLASSIFIER_MODEL ?? CLASSIFIER_DEFAULT,
  outputBattery: process.env.OUTPUT_BATTERY !== "0",
  gatherMode: "auto",
};

export function loadEnv() {
  try {
    process.loadEnvFile(".env");
  } catch {
    /* no .env: rely on the real environment */
  }
}

/** First configured model that is not the primary writer (DeepSeek, then Gemini). */
function fallbackWriter(primary: string) {
  for (const key of ["deepseek", "gemini"]) {
    if (key === primary) continue;
    const env = key === "deepseek" ? "DEEPSEEK_API_KEY" : "GEMINI_API_KEY";
    if (process.env[env]) return createClient(getModel(key));
  }
  return undefined;
}

export function buildDeps(opts: Options): Deps & { routerName: string } {
  const ctx = buildContext();
  const domain = loadDomain();
  const jev = process.env.TYPESAFE_API_KEY
    ? new SystemOneAdapter("jev", process.env.TYPESAFE_BASE_URL ?? "https://api.typesafe.ai", process.env.TYPESAFE_API_KEY)
    : undefined;
  const laya = process.env.LAYA_URL ? new SystemOneAdapter("laya", process.env.LAYA_URL, undefined, "laya") : undefined;
  const llm = new LlmDecisionAdapter(createClient(getModel(opts.classifier)));

  let primary: DecisionAdapter;
  let secondary: DecisionAdapter | undefined;
  switch (opts.router) {
    case "jev":
      if (!jev) throw new Error("--router jev needs TYPESAFE_API_KEY");
      primary = jev;
      secondary = llm;
      break;
    case "laya":
      if (!laya) throw new Error("--router laya needs LAYA_URL");
      primary = laya;
      secondary = llm;
      break;
    case "llm":
      primary = llm;
      secondary = jev ?? laya;
      break;
    case "jev-only":
      if (!jev) throw new Error("--router jev-only needs TYPESAFE_API_KEY");
      primary = jev;
      break;
    case "llm-only":
      primary = llm;
      break;
    default:
      primary = jev ?? laya ?? llm;
      secondary = primary === llm ? undefined : llm;
  }
  const router = new Router(primary, secondary);
  return {
    ctx,
    domain,
    router,
    routerName: router.name,
    writer: createClient(getModel(opts.writer)),
    writerFallback: fallbackWriter(opts.writer),
    outputBattery: opts.outputBattery ? jev : undefined,
    gatherMode: opts.gatherMode,
  };
}
