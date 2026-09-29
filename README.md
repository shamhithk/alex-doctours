# Doctours reply system: skills, typed routing, and a real human handoff

This replaces the single ~41k-token system prompt with a **bounded workflow**:
- **Models interpret and word the reply.** A typed router classifies the message, and an LLM writes the reply.
- **Code holds authority.** It decides escalation, facts, links, writes and output shape.

Every message runs through the same ten steps. Each step is traced, and each can be tested on its own.

```bash
npm install
cp .env.example .env        # add your keys (see "Keys" below)
npm run reply -- --input messages.json --output replies.json
```

`messages.json` is a JSON array of `{ "id", "text" }`. `replies.json` is a JSON array of `Reply` objects, one per input, in the same order. Diagnostics go to stderr, so stdout stays pure JSON when `--output` is omitted.

---

## Results (measured 2026-09-29)

All numbers come from `npm run eval`. There are 44 cases: the 5 packet messages plus 39 held-out cases (paraphrases, near-misses, adversarial, multi-intent, a non-English message) against the packet's fixed patient. The "Router" column is described in [Routing](#2-typed-interpretation-one-call-many-questions).

| Variant | Writer | Router | Runs | Pass rate | pass^k (all runs pass) | Escalation recall / precision | Prompt tokens / turn (p50) | Latency p50 / p95 | Cost per answered msg |
|---|---|---|---|---|---|---|---|---|---|
| **This system** | DeepSeek V4.1 Flash (`deepseek-flash`) | Jev + LLM confirm | 132 (k=3) | **100%** | **44/44** | **100% / 100%** | 6.1k | 2.3 s / 5.7 s | $0.00086 |
| This system | Gemini 3.8 Flash | Jev + LLM confirm | 132 (k=3) | **100%** | **44/44** | **100% / 100%** | 6.1k | 2.2 s / 4.5 s | $0.0053 |
| This system | Qwen3.8-27B (OpenRouter free) | Jev + LLM confirm | 44 (k=1)¹ | 97.7% | 43/44 | 100% / 100% | 6.1k | 5.9 s / 33 s (free-tier queueing) | $0 |
| Router ablation | DeepSeek | LLM primary + Jev confirm | 44 (k=1) | 100% | 44/44 | 100% / 100% | 6.1k | 4.1 s / 7.5 s | $0.00081 |
| Router ablation | DeepSeek | Jev only | 44 (k=1) | 100% | 44/44 | 100% / 100% | 6.1k | 2.4 s / 5.9 s | $0.00067 |
| Router ablation | DeepSeek | LLM only | 44 (k=1) | 100% | 44/44 | 100% / 100% | 6.1k | 4.0 s / 7.3 s | $0.00075 |
| **Original monolithic prompt** | DeepSeek | none | 44 | 56.8% | n/a | **50%** / 100% | **~80k** (41k prompt, re-sent on each tool round) | 7.3 s | ~$0.0034 |

¹ **Qwen caveat:** the Qwen run used v1 of the skills; its one failure (Heva deposits and link omitted) is the gap the v2 skill clarifications fixed for Gemini. The v2 Qwen rerun hit OpenRouter's free-tier limit of 50 requests per day. Those rate-limited rows sit in `eval/results/invalid/` and are not reported.

**Router ablation, honestly read:**
- **Before the fix:** the two-adapter agreement rule is what stopped real false escalations (Jev on "send my photos back", "help with booking flights").
- **After the fix:** once Jev's `unsupported_action` definitions listed what the coordinator *can* do, each adapter alone also scored 100% on this set.
- **What's kept:** the agreement rule stays as a safety net, which costs one extra classifier call only on escalation candidates.
- **Why Jev primary:** it's the default because it halves median latency.

**Tool-calling eval** (`eval/toolcalling.ts`): the model sees all 10 read tools and nothing is prefetched. There are 9 cases, including a two-step chain (find the package id → request its payment link) and a case where no tool should be called.

| Model | Cases passed | Valid-argument rate | Invented tools |
|---|---|---|---|
| DeepSeek | 9/9 | 100% (14 calls) | 0 |
| Gemini | 9/9 | 100% (10 calls; the most economical) | 0 |
| Qwen | 9/9 | 100% (11 calls) | 0 |

**Default writer:**
- **DeepSeek.** It ties Gemini on pass^3 and escalation accuracy, and costs about 6× less per message.
- **Gemini** is the best alternative when tail latency matters most (p95 4.5 s).
- **Qwen free** is as accurate on the cases it ran, but its free-tier latency and rate limits rule it out as a default.

**Default router:** Jev primary, with the LLM classifier as confirmation. It has the same accuracy as LLM-primary at about half the latency.

The monolith's 50% escalation recall is structural. The old prompt has no handoff path and teaches graceful declines ("I'm not able to move a payment…"), so it declines instead of escalating.

---

## How it works

```
input guards ─► typed router (Jev) ─► policy gate ─┬─► handoff (code, one sentence, STOP)
                                                   ├─► clarify (code, one question)
                                                   └─► skills ─► code-first evidence ─► writer (LLM, JSON)
                                                          ─► validators ─► ≤1 repair ─► fallback ─► commit writes ─► Reply + trace
```

### 1. Input guards (code)
- **Normalise and cap** the input.
- **Card data:** find card fragments ("card ending in 4242", "last four …", CVV) and full card numbers (Luhn check). These go on a never-echo list and are redacted before any model or trace sees them.
- **Human fast path:** a conservative pattern set catches clear requests like "talk to a human" or "get me a manager". It ignores negated, quoted and identity phrasings such as "are you a bot?". These requests hand off in about 2 ms, with no model call.
- **Injection:** prompt-injection phrasing is flagged here.

### 2. Typed interpretation: one call, many questions
The router answers ~30 typed questions against the message **in one call**:
- **Booleans:** needs_human, medical_urgent, self_harm, abuse_or_legal, prompt_injection, pausing, high_engagement, plus one per skill.
- **Choices:** unsupported_action (charge card, move paid money, contact clinic, hold date, change booking, off-channel call, claimed discount, other), payment_mode (policy question / link request / execution request), the clinic and package referred to or leaned toward (options built from tool data), communication style, and target window.

Adapters, all behind one `DecisionAdapter` interface:
- **Jev** (TypeSafe `/v1/systemone`): typed answers with calibrated probabilities, about 400 ms, very low cost.
- **Laya** (`LAYA_URL`): a self-hosted server using the same request/response schema. It's a drop-in replacement; see [Limitations](#limitations-and-honest-notes).
- **LLM classifier:** the same questions answered with JSON output. It is the default router when no Jev key is set, and the second opinion otherwise.

**Two-adapter safety net:**
- **Uncertain answers** (probability 0.35–0.6) on escalation-critical questions get a second opinion from the other adapter.
- **Action escalations need both adapters to agree.** Any escalation driven by `unsupported_action` must be confirmed by the second adapter. This fixed real false escalations found during eval: Jev read "can you send my photos back?" and "do you help with booking flights?" as off-channel actions.
- **Human requests and safety are never vetoed.** Recall matters most for those.

### 3. Policy gate (code)
The gate applies a fixed priority order, and the first match wins:
1. **safety** (medical urgency, self-harm);
2. **human request**;
3. **unsupported action**;
4. **abuse or legal threat**;
5. **clarify** (a supported request with an ambiguous clinic);
6. **answer**.

Two rules sharpen the distinction between asking and doing:
- A **policy question** ("what's your refund policy?") is answered. A **request to execute** it ("move my $300") escalates.
- A **payment-link request** is never escalated. The old prompt is explicit about this.

**Handoff is terminal and rendered by code.** The reply is one short sentence per category, for example "I can't take card payments here, so I'm bringing in a person from our team." The code also sets:
- `escalate: true`, a short `escalationReason`, and `escalationFlags` in memory;
- no writer call, no business tools, no writes.

The writer never produces a handoff. The old prompt's VOICE rules ("never say someone from our team will…") would otherwise fight the handoff sentence.

### 4. Skills: what's loaded per turn
The old prompt is decomposed into `domains/hair/core.md` plus 17 skill files (`domains/hair/skills/*.md`). `domains/hair/SOURCE_MAP.md` maps every one of the old prompt's ~52 sections to a rule id, or to "dropped" with a reason (phantom tools, booked-tier flows, things now enforced in code).

**Always loaded (~2.7k tokens):**
- `core.md`: identity and first-person voice, answer-then-stop and size-to-message, specificity, conversation awareness, capability limits (no off-channel promises, no stalling), grounding, universal bans (head-covering advice, assessment turnaround times, drive times, financing math), identity answer, promo stance;
- patient summary, clinic flags, collection status, working memory, recent calls, links already sent;
- a one-line index of the skills that weren't loaded.

**Loaded per turn:** skills whose router probability is ≥ 0.6, plus their `depends_on` (for example insurance → financing), minus anything a loaded skill `suppresses` (pause suppresses payment and clinic-selection). They're ordered **hard → stage → guideline**, then by id, so conflicts resolve the same way every run. On average 2.0 skills load per answered turn. The full writer prompt is 4.4k–8.8k tokens (6.1k median) against 41k before.

**Skill file format:** YAML frontmatter (`id`, `version`, `description` (the router question), `tools`, `links`, `depends_on`, `precedence`, `suppresses`) plus rules with ids like `[payment.assessment-book]`. Rules that branch on patient data sit under `### [when financing=yes]` headings, and the loader keeps only the matching branch. The model never sees the branches that don't apply to this patient.

### 5. Evidence: code first, then a bounded tool loop
**Code prefetches** from the router's decision: packages for the clinics in scope, the assessment link, a payment link for a decided package or a checkout link for a decided clinic, images, doctors, and so on. Every result goes into an **evidence ledger**:
- **facts** `F#`, keyed by clinic · package · field, with exact rendering such as `$3,000 USD`;
- **links** `L#`, only tool-returned or skill-declared URLs;
- **attachments** `A#`.

A null tool result is recorded as "no data", never filled in.

**Tool registry.** It holds exactly the packet's 14 functions:
- **Validated:** arguments are checked with zod, identical reads are de-duplicated, and the patient's `userId` is injected.
- **Guarded:** the prompt's `…Tool` aliases resolve to the real names; phantom tools from the old prompt (trip, airport and booking tools) are rejected; the model can't call write tools.

**Optional tool loop.** When a needed fact is still missing, the writer gets a bounded native tool-calling loop (≤ 2 rounds, ≤ 4 calls) over its loaded skills' read tools.

### 6–8. Writer, validation, repair, fallback
The writer returns JSON:
- `reply`, which uses **fact tokens** (`Silver is {{F4}} with a {{F5}} deposit`) and never types prices or URLs;
- `link_ids` / `attachment_ids`;
- `claims` with sources;
- `intent`, follow-up fields, a memory patch, and `unsupported`.

Code renders exact values and appends the links as the final lines. **Validators** then check:
- unknown ids;
- typed dollar amounts, unless the figure appears verbatim in a loaded rule (like the $25 fee);
- **attribution** (a token's package or clinic must be named in the same sentence, which catches "Silver is [Gold's price]");
- typed URLs and unrequested clinic-page links;
- echoed card digits;
- off-channel promises ("I'll send…", "let me check", "someone from our team will…");
- head-covering advice, assessment turnaround times, financing math;
- markdown, reply length, multiple questions.

**On failure:**
- Hard violations get **one targeted repair** with the concrete violation list.
- If the repair also fails, a supported request gets a **deterministic reply built only from ledger facts**, rather than a false escalation.
- Only when nothing can be rendered does it hand off.

**Jev output battery (signal only).** A second Jev call asks whether the reply promises an off-channel action, dodges a question, pressures, raises financing unprompted, or asks more than one question. The answers are recorded in the trace and eval reports. They never trigger an escalation.

### 9–10. Writes and finalise
**Writes run once, after validation, and never after a handoff:**
- Clinic and package selection come from the router's **typed** lean decision, not from model prose.
- Package-belongs-to-clinic membership is enforced here, because the stub only checks that ids exist.
- The memory patch is validated against the packet's enums and passed to `updateWorkingMemory`.

**Finalise:**
- A pause with no named window defaults to a 1-month follow-up.
- `templateId` is always null, and `escalationReason` is null when `escalate` is false.
- The whole Reply is validated with zod.

**Provider outage:**
- If the writer's provider fails after retries (outage, rate limit), the turn is re-run on a **fallback writer**: DeepSeek, or Gemini when DeepSeek is primary. The trace records it as `providerFailover`.
- If everything fails, the reply is a truthful handoff, never a dropped item.
- Evals run with `--failover 0` so each model is measured on its own.

### Traces
`--trace traces.jsonl` writes one line per message. Each line records:
- redacted input, route, fired gate rules;
- router adapter and signals, adjudications;
- skills loaded (why each loaded, versions, suppressions), prompt size;
- every tool call (origin: code, model or commit), the number of facts;
- each writer attempt with usage, violations and repair outcome, plus claims;
- output-battery signals, commits, cost, latency;
- the final Reply.

---

## How this answers the packet's eight problems

| Problem | What replaced it |
|---|---|
| 1. Huge prompt crowds context | ~2.7k-token core + only matched skills (6.1k median prompt vs 41k). Rules that can never apply to this patient's stage are never loaded. |
| 2. A trace can't show which rule produced a reply | Rule ids, skill ids + versions, gate rules, fact provenance (tool call ids) and claims are in every trace. |
| 3. A new line of care means pasting another domain in | Add `domains/fertility/{core.md,skills/*.md}`. Router questions are generated from skill descriptions, so no code changes. |
| 4. Subtasks have nowhere to go | A bounded tool loop runs in its own step. `call-context` isolates call-log reading, and a read-only subagent is the next step for long call histories. |
| 5. Every message pays for the full prompt | Escalations cost one Jev call, or nothing on the fast path. Answers cost ~6k prompt tokens. |
| 6. A policy change ripples into unrelated replies | Edit one skill file. Only turns that load it change, and its version appears in traces. |
| 7. Conflicts resolve differently run to run | Fixed precedence (hard > stage > guideline), explicit `suppresses`, gate priority in code, conditional branches chosen from data. |
| 8. One behaviour can't be tested alone | 94 unit tests (guards, gate, executor, ledger, validators, skills, workflow with a scripted fake model), plus per-behaviour eval assertions. |

---

## Decisions on conflicts in the packet
- **Escalation reply vs the old VOICE rules:** handoff is rendered by code, outside the writer.
- **"Don't resend links" vs a patient asking to pay from the assessment:** the payment skill includes the assessment link when the patient asks how, where, or about paying from the assessment. That request overrides the no-repeat rule.
- **Consultation duration:** "15 to 20 minutes" appears only in the expected output, not in the prompt or tools. It's omitted, and a test enforces that. The reply says the consultation is free, is a phone call, and gives the booking link.
- **Refund/transfer:** questions about the policy are answered. Requests to actually move paid money escalate.
- **Stale "Message Classification: pricing/high":** ignored; the router re-classifies every message.
- **Fixture mismatches the old prompt assumed away:**
  - `updateUserClinicPreferences` has no `tentativeProcedureDates` argument.
  - `updateUser` accepts names only.
  - The clinic `url` is a Doctours page.
  - There's no `ai_context.status`.
  - `getPatientContext` doesn't persist writes.

  Code works with the tools as they actually are.
- **Answer-key hygiene:** the expected replies and the 5 sample messages live only in `eval/`. `tests/leakage.test.ts` fails the build if any expected sentence, sample message or the ungrounded duration appears in `src/` or `domains/`.

---

## Setup

**Prerequisites:** Node ≥ 22.

**Keys.** Put them in `.env`, which is gitignored. The code reads them only from the environment.

| Variable | Needed for |
|---|---|
| `DEEPSEEK_API_KEY` | default writer (`deepseek-flash`) and the LLM classifier |
| `GEMINI_API_KEY` | `--writer gemini` (`gemini-3.8-flash`) |
| `OPENROUTER_API_KEY` | `--writer qwen` (`qwen/qwen3.8-27b:free`) |
| `TYPESAFE_API_KEY` | optional; Jev router. Without it, the LLM classifier routes alone. |
| `LAYA_URL` | optional; self-hosted Laya router (same API as Jev) |

**Commands**

```bash
npm run reply -- --input eval/packet.messages.json --output replies.json --trace traces.jsonl
npm run reply -- --input msgs.json --writer gemini --router auto     # router: auto|jev|laya|llm|jev-only|llm-only
npm test                                                            # 94 unit tests, no network
npm run typecheck
npx tsx eval/run.ts --writer deepseek --k 3                         # live eval, pass^k, report in eval/results/
npx tsx eval/baseline.ts --writer deepseek                          # original monolithic prompt, same cases/scorer
npx tsx eval/toolcalling.ts --models deepseek,gemini,qwen           # tool selection / argument validity
npx tsx eval/router-probe.ts "some message"                          # raw Jev vs LLM router answers
npx tsx eval/smoke.ts                                                # provider smoke test (JSON + tool round trip)
```

## Repository layout
```
src/cli.ts                 CLI contract (ordered JSON in → JSON out)
src/workflow.ts            the ten-step pipeline and the trace
src/guards/input.ts        normalisation, card data, human fast path, injection
src/decision/              questions, Jev/Laya + LLM adapters, router (uncertain band + agreement)
src/policy/gate.ts         priority gate, thresholds, handoff sentences
src/skills/loader.ts       skill parsing, conditional branches, dependency/suppression/precedence
src/evidence/              ledger (facts/links/attachments) + code-first prefetch
src/tools/                 the 14 packet tools: registry, validation, executor, membership check
src/writer/                prompt assembly, JSON writer + bounded tool loop + repair, deterministic fallback
src/validation/validate.ts render + validators
src/commit.ts              post-validation writes
src/llm/client.ts          DeepSeek / OpenRouter / Gemini client (retries, timeouts, usage, cost)
src/models/registry.ts     model profiles and prices
src/packet/                the packet's constants and tools, verbatim
domains/hair/              core.md, skills/*.md, SOURCE_MAP.md
eval/                      cases (packet + held-out), runner, baseline, tool-calling, router probe
tests/                     unit tests
fixtures/original-system-prompt.txt   the monolith, used only by the baseline
```

## Limitations and honest notes
- **Small eval set.** The held-out set is 39 cases written from the packet's rules. It's a regression suite, not proof of behaviour on every possible message. Thresholds (act 0.6, uncertain 0.35, skill 0.6) were set against it.
- **Laya was not run** in these measurements (it needs a Python server). It uses the same API as Jev, so it's a drop-in via `LAYA_URL`.
- **Qwen runs** use a free OpenRouter endpoint (fp4 quantization, rate-limited), so its latency numbers reflect the free tier.
- **Gemini pricing** rises to $1.50/$7.50 per 1M tokens on 2027-01-01. The cost column uses today's introductory price.
- **The output battery is a signal, not a gate.** It flags phrasing such as "or I can send you a link" as a possible off-channel promise, which the old prompt actually allows.
- **Sample outputs:** `examples/packet.replies.deepseek.json` and `examples/packet.traces.deepseek.jsonl` are real outputs and traces for the 5 packet messages.
- **Fixture tools are stateless.** Writes are validated and recorded, but not persisted between messages, as the packet specifies (each message is a fresh turn on the same history).
