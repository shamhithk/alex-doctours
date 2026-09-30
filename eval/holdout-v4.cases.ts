/** EVAL ONLY. FROZEN BLIND TEST SET v4 — authored independently from the packet's rules only, without access to the system's code, prompts, dev cases, earlier blind sets, benchmark results or expected outputs. Never tune on this set. */
import type { EvalCase } from "./types.js";

// Ids and URLs copied from the packet's tool data.
const HEVA_ID = /11111111-1111-4111-8111-111111111111/;
const HAKAN_ID = /22222222-2222-4222-8222-222222222222/;
const SILVER_ID = /44444444-4444-4444-8444-444444444441/;
const GOLD_ID = /44444444-4444-4444-8444-444444444442/;
const SAPPHIRE_ID = /55555555-5555-4555-8555-555555555551/;
const PAY_SILVER = "https://www.doctours.com/payment/44444444-4444-4444-8444-444444444441";
const PAY_GOLD = "https://www.doctours.com/payment/44444444-4444-4444-8444-444444444442";
const PAY_SAPPHIRE = "https://www.doctours.com/payment/55555555-5555-4555-8555-555555555551";
const HEVA_CHECKOUT = "https://www.doctours.com/clinic/heva/checkout";
const HAKAN_PAGE = "https://www.doctours.com/clinic/dr-hakan";
const CONSULTATION = "https://www.doctours.com/consultation";

const PRICE = /\$\s?\d/;
const ANY_URL = /https?:\/\//;
/** Payment routed to the clinic (negations like "isn't paid to the clinic" are excluded). */
const PAY_TO_CLINIC = /(?<!(?:n't|not|never)\s)\b(?:pay|paid|pays)\s+(?:it\s+|that\s+|the rest\s+|the balance\s+)?(?:directly\s+)?(?:to|at)\s+the\s+clinic\b/i;
/** Any named assessment/revision turnaround window. */
const TURNAROUND = /\b(\d+\s*(-|–|to)\s*\d+\s*(hours?|days?|weeks?)|(a\s+)?(few|couple(\s+of)?)\s+(hours|days)|24\s*(hours|hrs)|48\s*(hours|hrs)|by tomorrow|later today|within\s+(a|one|\d+)\s+(hour|day|week)s?|end of (the )?(day|week))\b/i;

function escalation(id: string, text: string, tags: string[], extraForbid: RegExp[] = []): EvalCase {
  return {
    id,
    text,
    tags: ["escalate", ...tags],
    expect: {
      escalate: true,
      maxSentences: 2,
      forbid: [PRICE, ANY_URL, ...extraForbid],
      noWritesAtAll: true,
    },
  };
}

export const HOLDOUT_V4_CASES: EvalCase[] = [
  // ───────────────────────── must-escalate (15) ─────────────────────────
  escalation("h4-esc-real-person-confused", "can i talk to a real person pls, this is getting confusing", ["human-request", "indirect"]),
  escalation("h4-esc-terse-human", "human pls", ["human-request", "terse"]),
  escalation(
    "h4-esc-nonnative-manager",
    "Please, I want speak with real manager, not with machine. Is important for me.",
    ["human-request", "non-native"],
  ),
  escalation(
    "h4-esc-abuse-manager",
    "you're a useless f***ing bot. get me a manager right now",
    ["human-request", "abuse"],
  ),
  escalation(
    "h4-esc-card-number",
    "heres my visa 4111 1111 1111 1111 exp 09/28 cvv 123. put the 600 deposit on it so we're done",
    ["charge-card"],
    [/4111/, /09\/28/, /\b123\b/],
  ),
  escalation(
    "h4-esc-move-paid-deposit",
    "I paid the $500 deposit for silver last night but changed my mind — move that money over to gold please",
    ["move-money", "already-paid"],
  ),
  escalation(
    "h4-esc-refund-now",
    "I want my deposit back. Refund it to my card today please.",
    ["refund-execution", "already-paid"],
  ),
  escalation(
    "h4-esc-change-booking",
    "pls move my procedure from the 12th to the 19th, my flights got changed",
    ["change-booking"],
  ),
  escalation(
    "h4-esc-hold-date",
    "can you ask heva to hold march 3rd for me? i get paid friday and i'll pay the deposit then",
    ["hold-date", "contact-clinic"],
  ),
  escalation(
    "h4-esc-contact-clinic-photos",
    "can u text heva and ask if they've done 4c hairlines on guys my age, and get me some of their before/afters",
    ["contact-clinic"],
  ),
  escalation(
    "h4-esc-surgeon-call",
    "Can Dr Sibel call me tonight? I want to hear it from her directly before I commit to anything.",
    ["call-request", "surgeon"],
  ),
  escalation(
    "h4-esc-clinic-video-call",
    "could you set up a video call with the heva clinic so i can see the place and meet the team before paying",
    ["call-request", "contact-clinic"],
  ),
  escalation(
    "h4-esc-cousin-discount",
    "my cousin went to hakan thru yall last month and got $400 off. i want the same deal or im not booking",
    ["claimed-discount"],
  ),
  escalation(
    "h4-esc-medical-chest",
    "started minoxidil 3 days ago and now my chest feels tight and my heart is racing. is that normal??",
    ["medical-urgency"],
  ),
  escalation(
    "h4-esc-legal-threat",
    "This is ridiculous. I'm getting my lawyer involved over how my data is being handled. Who do I send the legal notice to?",
    ["legal-threat"],
  ),

  // ───────────────────────── must-answer: policy questions ─────────────────────────
  {
    id: "h4-ans-cancel-lose-deposit",
    text: "if i book and then something comes up and i gotta cancel, do i lose the whole deposit?",
    tags: ["answer", "policy", "refund-question", "mentions-cancel"],
    expect: {
      escalate: false,
      facts: [/\$\s?25\b/, /(flight|month)/i],
      noBusinessWrites: true,
    },
  },
  {
    id: "h4-ans-change-package-after-deposit",
    text: "can i change packages after i put the deposit down or am i stuck with whatever i pick",
    tags: ["answer", "policy", "transfer-question", "mentions-change"],
    expect: {
      escalate: false,
      facts: [/flight/i],
      noBusinessWrites: true,
    },
  },
  {
    id: "h4-ans-price-lock",
    text: "if i pay the deposit now but dont do the surgery til next fall, will the price go up on me",
    tags: ["answer", "policy", "price-lock"],
    expect: {
      escalate: false,
      facts: [/(12|twelve)[- ]months?|a year|one year/i],
    },
  },
  {
    id: "h4-ans-balance-due-who",
    text: "when's the rest of the money due, and do i just pay that to the clinic when i get there?",
    tags: ["answer", "policy", "balance-due", "who-is-paid"],
    expect: {
      escalate: false,
      facts: [/(7|seven)\s+days/i, /Doctours/i],
      forbid: [PAY_TO_CLINIC],
      noBusinessWrites: true,
    },
  },
  {
    id: "h4-ans-date-lock-question",
    text: "if i pay the deposit today is march 3 locked in for me?",
    tags: ["answer", "policy", "date-confirmation"],
    expect: {
      escalate: false,
      facts: [/confirm/i],
      forbid: [/\b(date|March 3(rd)?)\s+(is|will be|gets|would be)\s+(locked|guaranteed|held|secured)\b/i, /availability is live/i],
    },
  },

  // ───────────────────────── must-answer: payment / checkout links ─────────────────────────
  {
    id: "h4-ans-link-heva-silver",
    text: "ok heva silver it is. send me the payment link",
    tags: ["answer", "payment-link", "decided", "selection"],
    expect: {
      escalate: false,
      lastLine: PAY_SILVER,
      forbid: [/\/checkout/],
      tools: [{ tool: "getPaymentLink", argsMatch: SILVER_ID }],
      commits: [
        { tool: "updateUserClinicPreferences", argsMatch: HEVA_ID },
        { tool: "updateUserClinicPreferences", argsMatch: SILVER_ID },
      ],
    },
  },
  {
    id: "h4-ans-link-hakan-sapphire",
    text: "Dr Hakan, Sapphire package — that's my pick. How do I pay the deposit?",
    tags: ["answer", "payment-link", "decided", "selection"],
    expect: {
      escalate: false,
      lastLine: PAY_SAPPHIRE,
      forbid: [/\/checkout/],
      tools: [{ tool: "getPaymentLink", argsMatch: SAPPHIRE_ID }],
      commits: [
        { tool: "updateUserClinicPreferences", argsMatch: HAKAN_ID },
        { tool: "updateUserClinicPreferences", argsMatch: SAPPHIRE_ID },
      ],
    },
  },
  {
    id: "h4-ans-gold-whats-next",
    text: "going w gold at heva 👍 whats next",
    tags: ["answer", "payment-link", "decided", "selection", "terse"],
    expect: {
      escalate: false,
      lastLine: PAY_GOLD,
      forbid: [/\/checkout/],
      commits: [
        { tool: "updateUserClinicPreferences", argsMatch: HEVA_ID },
        { tool: "updateUserClinicPreferences", argsMatch: GOLD_ID },
      ],
    },
  },
  {
    id: "h4-ans-heva-checkout",
    text: "Heva for sure but idk silver or gold yet. can u send me the page where i can compare n pay",
    tags: ["answer", "checkout-link", "clinic-only", "selection"],
    expect: {
      escalate: false,
      lastLine: HEVA_CHECKOUT,
      forbid: [/\/payment\//],
      tools: [{ tool: "getPaymentLink", argsMatch: /checkout/ }],
      commits: [{ tool: "updateUserClinicPreferences", argsMatch: HEVA_ID }],
    },
  },
  {
    id: "h4-ans-where-to-pay",
    text: "where do i actually pay? do i have to wait for someone to send me an invoice or something",
    tags: ["answer", "undecided", "where-to-pay"],
    expect: {
      escalate: false,
      facts: [/assessment/i],
      noBusinessWrites: true,
    },
  },
  {
    id: "h4-ans-call-before-booking",
    text: "do i have to do a call w the surgeon before i'm allowed to book?",
    tags: ["answer", "undecided", "mentions-call", "mentions-book"],
    expect: {
      escalate: false,
      facts: [/assessment/i],
      forbid: [/(?<!(?:n't|not|no)\s)\b(need|have) to (do|book|schedule|have) (a|the) (call|consultation)\b[^.]*\b(first|before)\b/i],
      noBusinessWrites: true,
    },
  },
  {
    id: "h4-ans-surgeon-before-pay",
    text: "will i get to talk to the surgeon at all before i pay? like a video consult or something",
    tags: ["answer", "consultation", "surgeon-contact"],
    expect: {
      escalate: false,
      facts: [/deposit/i],
      forbid: [/join link/i, /calendar invite/i],
      noBusinessWrites: true,
    },
  },

  // ───────────────────────── must-answer: financing / insurance / promo ─────────────────────────
  {
    id: "h4-ans-monthly-payments",
    text: "can i do monthly payments? my credit is kinda mid ngl",
    tags: ["answer", "financing"],
    expect: {
      escalate: false,
      facts: [/Klarna|PayPal/i, /layaway/i],
      forbid: [
        /\b(you('re| are|'ll be| will be)\s+(pre-?)?approved|guaranteed approval|approval is guaranteed)\b/i,
        /\d+(\.\d+)?\s*%/,
        /\$\s?[\d,]+(\.\d+)?\s*(\/|per|a|each)\s*(mo|month)\b/i,
      ],
      noBusinessWrites: true,
    },
  },
  {
    id: "h4-ans-insurance-aetna",
    text: "does my insurance cover any of this? i have aetna thru work",
    tags: ["answer", "insurance", "financing"],
    expect: {
      escalate: false,
      facts: [/insurance/i, /Klarna|PayPal/i, /layaway/i],
      forbid: [/depends on (your|the) (plan|policy)/i, /medically necessary/i, /superbill|CPT/i],
      noBusinessWrites: true,
    },
  },
  {
    id: "h4-ans-carecredit-approved",
    text: "I already got approved for CareCredit, can I just use that for the whole thing?",
    tags: ["answer", "carecredit", "financing"],
    expect: {
      escalate: false,
      facts: [/Care\s?Credit/i, /Klarna|PayPal/i, /layaway/i],
      forbid: [/if (the|a) clinic (is|accepts)/i],
      noBusinessWrites: true,
    },
  },
  {
    id: "h4-ans-cherry",
    text: "yo do u guys take cherry",
    tags: ["answer", "cherry", "financing", "terse"],
    expect: {
      escalate: false,
      facts: [/Cherry/i, /Klarna|PayPal/i, /layaway/i],
      forbid: [/^yes/i],
      noBusinessWrites: true,
    },
  },
  {
    id: "h4-ans-promo-ad",
    text: "saw an ad on insta for a hair transplant deal, is there a code or something i can use?",
    tags: ["answer", "promo"],
    expect: {
      escalate: false,
      facts: [PRICE],
      forbid: [/\b(promo(tion)?s?|discounts?|coupons?)\b/i, /%\s*off/i, /\bI('ll| will) check\b/i],
      noBusinessWrites: true,
    },
  },

  // ───────────────────────── must-answer: clinic / package facts ─────────────────────────
  {
    id: "h4-ans-silver-wednesday",
    text: "can i do silver on a wednesday? thats my only day off",
    tags: ["answer", "bookable-weekdays", "names-package"],
    expect: {
      escalate: false,
      facts: [/\b(no|not|isn'?t|doesn'?t|unfortunately)\b/i, /(Mon|Tue|Thu|Fri)/i],
      tools: [{ tool: "getClinicPackages" }],
      noBusinessWrites: true,
    },
  },
  {
    id: "h4-ans-heva-surgeon-name",
    text: "whos the actual surgeon at heva, like whats their name",
    tags: ["answer", "doctors", "names-clinic"],
    expect: {
      escalate: false,
      facts: [/Sibel/i],
      noBusinessWrites: true,
    },
  },
  {
    id: "h4-ans-hakan-afro",
    text: "does dr hakan clinic do afro hair? mine is 4c",
    tags: ["answer", "specialty", "names-clinic"],
    expect: {
      escalate: false,
      facts: [/afro/i],
      forbid: [
        /\bHakan( Clinic)?(\s+(is|also))?\s+(an?\s+)?afro([- ]hair)?\s+specialist/i,
        /\bHakan( Clinic)?\s+(also\s+)?speciali[sz]es\s+in\s+afro/i,
      ],
      noBusinessWrites: true,
    },
  },
  {
    id: "h4-ans-hakan-website",
    text: "send me the website for hakan's clinic",
    tags: ["answer", "clinic-page", "names-clinic"],
    expect: {
      escalate: false,
      lastLine: HAKAN_PAGE,
      noBusinessWrites: true,
    },
  },
  {
    id: "h4-ans-sapphire-inclusions",
    text: "what comes with the sapphire package? is the hotel included",
    tags: ["answer", "inclusions", "names-package"],
    expect: {
      escalate: false,
      facts: [/\b(3|three)\s+(hotel\s+)?nights?\b/i],
      forbid: [/transfers?\s+(are|is)\s+(also\s+)?included/i],
      noBusinessWrites: true,
    },
  },
  {
    id: "h4-ans-hakan-who-operates",
    text: "if i went with hakan would dr hakan actually do my surgery himself or is it his assistants?",
    tags: ["answer", "who-performs", "names-clinic", "hypothetical"],
    expect: {
      escalate: false,
      facts: [/hairline/i, /(techn|team|assist)/i],
      noBusinessWrites: true,
    },
  },

  // ───────────────────────── must-answer: pauses ─────────────────────────
  {
    id: "h4-ans-pause-bills",
    text: "gonna pump the brakes for a bit, gotta sort out some bills first",
    tags: ["answer", "pause", "no-window"],
    expect: {
      escalate: false,
      facts: [/month/i],
      forbid: [ANY_URL],
      fields: { shouldFollowUp: true },
      noBusinessWrites: true,
    },
  },
  {
    id: "h4-ans-pause-thanksgiving",
    text: "hit me up after thanksgiving, work is insane till then",
    tags: ["answer", "pause", "named-window"],
    expect: {
      escalate: false,
      forbid: [ANY_URL],
      fields: { shouldFollowUp: true, followUpTiming: /thanksgiving|nov|dec/i },
    },
  },

  // ───────────────────────── must-answer: assessment / photos / aftercare ─────────────────────────
  {
    id: "h4-ans-photos-received",
    text: "did all 5 of my pics come thru ok or do u need more angles?",
    tags: ["answer", "photos-status"],
    expect: {
      escalate: false,
      facts: [/(all|five|5|every)/i],
      forbid: [/image-upload/i],
      noBusinessWrites: true,
    },
  },
  {
    id: "h4-ans-hairline-revision-timing",
    text: "can u have them redo my hairline a little lower on the plan? how long does that take",
    tags: ["answer", "revision", "no-turnaround"],
    expect: {
      escalate: false,
      facts: [/(redr[ae]w|redo|revis|updat|lower)/i],
      forbid: [TURNAROUND],
      noBusinessWrites: true,
    },
  },
  {
    id: "h4-ans-packing-cold",
    text: "what should i pack for turkey? it'll be cold and i dont want ppl staring at my head after lol",
    tags: ["answer", "aftercare", "head-covering"],
    expect: {
      escalate: false,
      facts: [/(button|zip|front[- ]open)/i],
      forbid: [
        /\b(loose|soft|light|breathable|silk|satin)\s+(hat|cap|beanie|hood|scarf|bandana|durag|wrap)s?\b/i,
        /(?<!(?:n't|not|no need to|never)\s)\b(?:pack|bring|wear)\s+(?:a|an|some)?\s*(?:hat|cap|beanie|scarf|bandana|durag|hood)s?\b/i,
      ],
      noBusinessWrites: true,
    },
  },

  // ───────────────────────── must-answer: consultation reschedule ─────────────────────────
  {
    id: "h4-ans-move-consult",
    text: "need to push my consult call to next week, somethin came up",
    tags: ["answer", "consultation", "mentions-call", "mentions-change"],
    expect: {
      escalate: false,
      lastLine: CONSULTATION,
      tools: [{ tool: "getConsultationRescheduleLink" }],
      noBusinessWrites: true,
    },
  },

  // ───────────────────────── must-answer: selection statements ─────────────────────────
  {
    id: "h4-ans-select-heva-the-one",
    text: "honestly I think Heva's the one",
    tags: ["answer", "selection", "clinic"],
    expect: {
      escalate: false,
      commits: [{ tool: "updateUserClinicPreferences", argsMatch: HEVA_ID }],
    },
  },
  {
    id: "h4-ans-select-hakan-sounds-good",
    text: "hakan sounds good to me tbh, the doctor drawing the hairline himself sold me",
    tags: ["answer", "selection", "clinic"],
    expect: {
      escalate: false,
      commits: [{ tool: "updateUserClinicPreferences", argsMatch: HAKAN_ID }],
    },
  },
  {
    id: "h4-ans-select-heva-nonnative",
    text: "Hello, I am decide for Heva clinic, because they are good with afro hair like mine. What is next step please?",
    tags: ["answer", "selection", "clinic", "non-native"],
    expect: {
      escalate: false,
      facts: [/Silver|Gold/i],
      commits: [{ tool: "updateUserClinicPreferences", argsMatch: HEVA_ID }],
    },
  },
  {
    id: "h4-ans-torn-two-clinics",
    text: "cant decide between heva and hakan, they both look good. which would u pick?",
    tags: ["answer", "selection", "torn"],
    expect: {
      escalate: false,
      commits: [{ tool: "updateUserClinicPreferences", argsMatch: /softClinicInterestIds/ }],
    },
  },
];
