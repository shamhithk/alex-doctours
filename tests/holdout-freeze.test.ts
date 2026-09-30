import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * Each line of eval/HOLDOUT.sha256 is "<sha256>  <path>", recorded before that set's first run.
 * holdout-v1 is regression data since the second review exposed it; its checksum stays pinned
 * so earlier benchmarks remain reproducible. holdout-v2 is the frozen set for generalization claims.
 */
const entries = readFileSync("eval/HOLDOUT.sha256", "utf8")
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => l.trim().split(/\s+/) as [string, string]);

describe("frozen evaluation sets", () => {
  it("records both holdout generations", () => {
    expect(entries.map(([, path]) => path)).toEqual(["eval/holdout-v1.cases.ts", "eval/holdout-v2.cases.ts"]);
  });
  it.each(entries.map(([hash, path]) => [path, hash] as const))("%s matches the checksum recorded before its first run", (path, recorded) => {
    const actual = createHash("sha256").update(readFileSync(path)).digest("hex");
    expect(actual, "A frozen set was edited. Never tune on it: move it to regression data and author a fresh holdout instead.").toBe(recorded);
  });
});
