import { TOOLS, resolveToolName } from "./registry.js";
import { CLINICS, PACKAGES } from "../packet/tools.js";

export interface ToolRecord {
  callId: string;
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  result: unknown;
  error?: string;
  ms: number;
  origin: "code" | "model" | "commit";
}

/**
 * Executes tools for one turn. Validates arguments, rejects unknown tools and
 * write tools from the model, de-duplicates identical calls, and keeps a
 * record of every call as evidence provenance.
 */
export class ToolExecutor {
  readonly records: ToolRecord[] = [];
  private seq = 0;
  private cache = new Map<string, ToolRecord>();

  constructor(private readonly userId: string) {}

  run(name: string, args: Record<string, unknown>, origin: ToolRecord["origin"]): ToolRecord {
    const resolved = resolveToolName(name);
    const callId = `t${++this.seq}`;
    const started = Date.now();
    const fail = (error: string): ToolRecord => {
      const rec: ToolRecord = { callId, tool: name, args, ok: false, result: null, error, ms: 0, origin };
      this.records.push(rec);
      return rec;
    };
    if (!resolved) return fail(`unknown_tool: ${name} is not one of the supplied tools`);
    const def = TOOLS.get(resolved)!;
    if (origin === "model" && def.kind === "write") return fail(`write_tool_not_allowed: ${resolved}`);

    const parsed = def.input.safeParse(args ?? {});
    if (!parsed.success) return fail(`invalid_args: ${parsed.error.issues.map((i) => i.message).join("; ")}`);

    const key = `${resolved}:${stableStringify(parsed.data)}`;
    const cached = this.cache.get(key);
    if (cached && def.kind === "read") {
      const rec = { ...cached, callId, origin, ms: 0 };
      this.records.push(rec);
      return rec;
    }
    let result: unknown;
    try {
      // User-scoped tools get the patient's id by default so the model never has to guess it.
      const userScoped = (def.parameters as { properties?: Record<string, unknown> }).properties?.userId !== undefined;
      result = def.fn(userScoped ? { userId: this.userId, ...parsed.data } : parsed.data);
    } catch (e) {
      return fail(`tool_threw: ${(e as Error).message}`);
    }
    const rec: ToolRecord = { callId, tool: resolved, args: parsed.data, ok: true, result, ms: Date.now() - started, origin };
    if (def.kind === "read") this.cache.set(key, rec);
    this.records.push(rec);
    return rec;
  }
}

export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .filter((k) => o[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(",")}}`;
}

/** The preference stub only checks that ids exist; membership is enforced here. */
export function packageBelongsToClinic(packageId: string, clinicId: string): boolean {
  return PACKAGES.some((p) => p.id === packageId && p.clinicId === clinicId);
}

export function clinicExists(clinicId: string): boolean {
  return CLINICS.some((c) => c.id === clinicId);
}
