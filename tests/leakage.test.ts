import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { PACKET_EXPECTED_RESPONSES, PACKET_MESSAGES } from "../eval/packet.cases.js";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

const RUNTIME = [...files("src"), ...files("domains")];
const corpus = RUNTIME.map((p) => ({ p, text: readFileSync(p, "utf8").toLowerCase() }));

describe("no answer-key leakage into runtime code or prompts", () => {
  it.each(PACKET_EXPECTED_RESPONSES)("expected reply is absent: %s", (resp) => {
    // Check each sentence of the expected reply (>= 6 words) so paraphrase-free copies are caught.
    for (const sentence of resp.split(/(?<=[.!?])\s+/).filter((s) => s.split(" ").length >= 6)) {
      const hit = corpus.find((f) => f.text.includes(sentence.toLowerCase()));
      expect(hit?.p, `"${sentence}" found in ${hit?.p}`).toBeUndefined();
    }
  });
  it.each(PACKET_MESSAGES.map((m) => m.text))("sample input is not special-cased: %s", (msg) => {
    const hit = corpus.find((f) => f.text.includes(msg.toLowerCase()));
    expect(hit?.p).toBeUndefined();
  });
  it("the ungrounded consultation duration never reaches runtime", () => {
    expect(corpus.find((f) => /15\s*(to|-|–)\s*20\s*min/.test(f.text))?.p).toBeUndefined();
  });
  it("runtime code never imports eval fixtures", () => {
    expect(corpus.filter((f) => f.p.startsWith("src") && f.text.includes("eval/")).map((f) => f.p)).toEqual([]);
  });
});
