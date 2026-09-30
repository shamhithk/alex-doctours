#!/usr/bin/env node
/**
 * Contract: read a JSON array of {id, text}; write a JSON array of Reply, one
 * per input, in the same order. Diagnostics go to stderr; traces to --trace.
 *
 *   npm run reply -- --input messages.json [--output replies.json] [--trace traces.jsonl]
 *                    [--writer deepseek|gemini|qwen] [--router auto|jev|laya|llm] [--concurrency 4]
 */
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { InputSchema } from "./contracts.js";
import { buildDeps, getDefaultOptions, loadEnv, type Options } from "./deps.js";
import { respond, type Trace } from "./workflow.js";
import { buildQuestions } from "./decision/questions.js";
import { mapLimit } from "./util.js";
import { otelFromEnv } from "./observability/otel.js";

function parseArgs(argv: string[]) {
  const a: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith("--")) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) a[k.slice(2)] = "true";
      else {
        a[k.slice(2)] = next;
        i++;
      }
    } else if (!a.input) a.input = k;
  }
  return a;
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  const raw = args.input ? readFileSync(args.input, "utf8") : readFileSync(0, "utf8");
  const parsed = InputSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    console.error("Invalid input: expected a JSON array of {id, text}.", parsed.error.issues);
    process.exit(2);
  }
  const opts: Options = {
    ...getDefaultOptions(),
    ...(args.writer ? { writer: args.writer } : {}),
    ...(args.router ? { router: args.router as Options["router"] } : {}),
    ...(args["no-battery"] ? { outputBattery: false } : {}),
  };
  const deps = buildDeps(opts);
  const qs = buildQuestions(deps.domain, deps.ctx);
  console.error(`writer=${opts.writer} router=${deps.routerName} items=${parsed.data.length}`);
  const otel = otelFromEnv();
  if (otel) console.error(`tracing: exporting spans to ${process.env.PHOENIX_COLLECTOR_ENDPOINT ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT}`);
  const concurrency = Number(args.concurrency ?? 4);
  const results = await mapLimit(parsed.data, concurrency, async (item) => {
    const r = await respond(item, deps, qs);
    otel?.export(r.trace);
    console.error(`  ${item.id}: route=${r.trace.route}${r.trace.category ? `/${r.trace.category}` : ""} ${r.trace.latencyMs}ms`);
    return r;
  });
  const replies = results.map((r) => r.reply);
  const json = JSON.stringify(replies, null, 2);
  // Create output folders (e.g. traces/, which is gitignored) so a fresh clone just works.
  for (const f of [args.output, args.trace]) if (f) mkdirSync(dirname(f), { recursive: true });
  if (args.output) writeFileSync(args.output, json + "\n");
  else process.stdout.write(json + "\n");
  if (args.trace) {
    writeFileSync(args.trace, "");
    for (const r of results) appendFileSync(args.trace, JSON.stringify(r.trace satisfies Trace) + "\n");
  }
  await otel?.shutdown();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
