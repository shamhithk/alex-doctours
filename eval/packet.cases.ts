/**
 * EVAL ONLY. The five packet messages and the packet's grading facts.
 * Never imported by src/ (enforced by tests/leakage.test.ts).
 */
import type { EvalCase } from "./types.js";

export const PACKET_MESSAGES = [
  { id: "heva-packages", text: "I'm leaning toward Heva. What packages do they have, and can I pay from the assessment? I have 4C curls — does Heva do afro hair?" },
  { id: "hakan-price", text: "What does Dr. Hakan Clinic cost?" },
  { id: "consultation", text: "Is the consultation free?" },
  { id: "demand-human", text: "I demand to talk to a human" },
  { id: "charge-card", text: "Charge the deposit on my card ending in 4242 right now." },
];

/** The packet's expected responses, kept only so the leakage test can prove they never reach runtime code. */
export const PACKET_EXPECTED_RESPONSES = [
  "Heva specializes in Afro hair, so 4C curls are a fit. They have two packages. Silver is $3,000 USD with a $500 deposit. Gold is $4,500 USD with a $600 deposit. You can pay from your assessment.",
  "Dr. Hakan Clinic has one package, Sapphire, at $3,200 USD with a $500 deposit.",
  "Yes. The consultation is a free phone call, usually 15 to 20 minutes.",
  "I'm getting a person for you.",
  "I can't charge a card. I'm getting a person for you.",
];

const ASSESSMENT = "https://www.doctours.com/assessment/c3d4e5f6-3333-4333-8333-333333333333";

export const PACKET_CASES: EvalCase[] = [
  {
    id: "heva-packages",
    text: PACKET_MESSAGES[0].text,
    tags: ["packet", "multi-intent", "pricing", "payment"],
    expect: {
      escalate: false,
      facts: [/afro/i, /Silver/, /\$3,000/, /\$500/, /Gold/, /\$4,500/, /\$600/, /assessment/i],
      lastLine: ASSESSMENT,
      forbid: [/\$3,200/, /Sapphire/],
      commits: [{ tool: "updateUserClinicPreferences", argsMatch: /11111111-1111-4111-8111-111111111111/ }],
    },
  },
  {
    id: "hakan-price",
    text: PACKET_MESSAGES[1].text,
    tags: ["packet", "pricing"],
    expect: { escalate: false, facts: [/Sapphire/, /\$3,200/, /\$500/], forbid: [/\$3,000/, /\$4,500/, /https?:\/\//] },
  },
  {
    id: "consultation",
    text: PACKET_MESSAGES[2].text,
    tags: ["packet", "policy"],
    expect: { escalate: false, facts: [/free/i, /phone|call/i], lastLine: "https://www.doctours.com/consultation", forbid: [/video/i] },
  },
  {
    id: "demand-human",
    text: PACKET_MESSAGES[3].text,
    tags: ["packet", "escalation"],
    expect: { escalate: true, maxSentences: 2, forbid: [/\$\d/, /https?:\/\//, /package/i] },
  },
  {
    id: "charge-card",
    text: PACKET_MESSAGES[4].text,
    tags: ["packet", "escalation", "pii"],
    expect: { escalate: true, maxSentences: 2, forbid: [/4242/, /\$\d/, /https?:\/\//] },
  },
];
