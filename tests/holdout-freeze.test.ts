import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

describe("frozen holdout", () => {
  it("eval/holdout.cases.ts matches the checksum recorded before its first run", () => {
    const actual = createHash("sha256").update(readFileSync("eval/holdout.cases.ts")).digest("hex");
    const recorded = readFileSync("eval/HOLDOUT.sha256", "utf8").split(/\s+/)[0];
    expect(actual, "The holdout was edited. Never tune on it: move it to regression data and author a fresh holdout instead.").toBe(recorded);
  });
});
