import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * Each line of eval/HOLDOUT.sha256 is "<sha256>  <path>", recorded before that set's first run.
 * holdout-v1 (exposed by the second review), holdout-v2 and holdout-v3 (their failures informed fixes)
 * are regression data now; their checksums stay pinned so earlier benchmarks remain reproducible.
 * holdout-v4 is the frozen set for generalization claims.
 */
const entries = readFileSync("eval/HOLDOUT.sha256", "utf8")
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => l.trim().split(/\s+/) as [string, string]);

describe("frozen evaluation sets", () => {
  it("records every holdout generation", () => {
    expect(entries.map(([, path]) => path)).toEqual(["eval/holdout-v1.cases.ts", "eval/holdout-v2.cases.ts", "eval/holdout-v3.cases.ts", "eval/holdout-v4.cases.ts"]);
  });
  it.each(entries.map(([hash, path]) => [path, hash] as const))("%s matches the checksum recorded before its first run", (path, recorded) => {
    const actual = createHash("sha256").update(readFileSync(path)).digest("hex");
    expect(actual, "A frozen set was edited. Never tune on it: move it to regression data and author a fresh holdout instead.").toBe(recorded);
  });
});
