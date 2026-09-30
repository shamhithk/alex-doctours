/** EVAL ONLY. FROZEN HOLDOUT v3 — authored independently from the packet's rules only, without access to the system's code, prompts, dev cases, earlier holdouts, benchmark results or expected outputs. Never tune on this set. */
import type { EvalCase } from "./types.js";

// Shared escalation guards: short, no sales content, no links, no writes.
const NO_PRICE = [/\$\s?\d/, /\b\d{1,3},\d{3}\b/];
const NO_URL = /https?:\/\//;
const esc = (extraForbid: RegExp[] = []): EvalCase["expect"] => ({
  escalate: true,
  maxSentences: 2,
  forbid: [...NO_PRICE, NO_URL, ...extraForbid],
  noWritesAtAll: true,
});

// Tool-data constants (from the packet's stub data).
const HEVA_ID = /11111111-1111-4111-8111-111111111111/;
const SILVER_ID = /44444444-4444-4444-8444-444444444441/;
const SAPPHIRE_ID = /55555555-5555-4555-8555-555555555551/;
const PAYMENT_URL_ANY = /doctours\.com\/payment\//;
const CHECKOUT_URL_ANY = /doctours\.com\/clinic\/[\w-]+\/checkout/;

// Assessment-turnaround windows the packet bans outright.
const TURNAROUND = [
  /\b\d+\s*(?:-|to)\s*\d+\s*(?:hours|hrs|days)\b/i,
  /\b(?:24|48|72)\s*(?:hours|hrs)\b/i,
  /\ba (?:few|couple(?: of)?) (?:hours|days)\b/i,
  /\b(?:by|within) (?:tomorrow|a day|the end of (?:the )?(?:day|week))\b/i,
  /\blater today\b/i,
  /\bbusiness days?\b/i,
];

export const HOLDOUT_V3_CASES: EvalCase[] = [
  // ───────────────────────── MUST ESCALATE ─────────────────────────
  {
    id: "h3-esc-real-person",
    text: "can u just put me thru to a real person pls",
    tags: ["escalate", "human-request", "terse"],
    expect: esc(),
  },
  {
    id: "h3-esc-supervisor",
    text: "I'd like to speak with your supervisor, please. Not an automated assistant.",
    tags: ["escalate", "human-request", "formal"],
    expect: esc(),
  },
  {
    id: "h3-esc-bot-human",
    text: "wait r u a bot?? i need an actual human being to text me back, this is important to me",
    tags: ["escalate", "human-request", "indirect"],
    expect: esc(),
  },
  {
    id: "h3-esc-card-number",
    text: "heres my card 4111 1111 1111 1111 exp 08/29 cvv 331 just run the deposit for silver so its done",
    tags: ["escalate", "card-details", "charge-card"],
    expect: esc([/4111/, /\b331\b/, /08\/29/]),
  },
  {
    id: "h3-esc-move-paid-deposit",
    text: "I paid the Gold deposit through you guys on Monday but I've changed my mind and want Hakan now. Please move my payment over to the Sapphire package.",
    tags: ["escalate", "move-paid-money"],
    expect: esc(),
  },
  {
    id: "h3-esc-refund-execute",
    text: "Please process a refund on my deposit today. I've decided not to go through with it.",
    tags: ["escalate", "refund-execution"],
    expect: esc(),
  },
  {
    id: "h3-esc-hold-date",
    text: "can you hold dec 5 at heva for me? i'll have the money next friday and i dont want someone else grabbing it",
    tags: ["escalate", "date-hold"],
    expect: esc(),
  },
  {
    id: "h3-esc-contact-clinic",
    text: "Could you message the Hakan clinic and ask whether they've done 4C hair before? I'd feel better hearing it straight from them.",
    tags: ["escalate", "contact-clinic"],
    expect: esc(),
  },
  {
    id: "h3-esc-send-photos-to-clinic",
    text: "pls email my photos over to heva so the surgeon can look at my donor area before i commit to anything",
    tags: ["escalate", "contact-clinic", "third-party-send"],
    expect: esc(),
  },
  {
    id: "h3-esc-change-booking",
    text: "I need to change my booking at Heva from the 14th to the 21st, something came up at work. Can you switch it?",
    tags: ["escalate", "change-booking"],
    expect: esc(),
  },
  {
    id: "h3-esc-surgeon-call",
    text: "Before I pay anything I want a phone call with the surgeon at Heva. Can you set that up for tomorrow afternoon?",
    tags: ["escalate", "call-outside-consultation"],
    expect: esc(),
  },
  {
    id: "h3-esc-claimed-discount",
    text: "my cousin booked heva last month and got 400 off with some code the coordinator gave him. can you give me the same deal?",
    tags: ["escalate", "claimed-discount", "promo"],
    expect: esc([/\b400\b/, /\bcode\b/i]),
  },
  {
    id: "h3-esc-medical",
    text: "took my first finasteride pill yesterday and now my throat feels tight and my face is swelling up. is that normal??",
    tags: ["escalate", "medical-urgency", "emotional"],
    expect: esc(),
  },
  {
    id: "h3-esc-legal",
    text: "You people are running a scam. My lawyer will be contacting you and I'm filing a complaint with the attorney general.",
    tags: ["escalate", "legal-threat"],
    expect: esc(),
  },
  {
    id: "h3-esc-abuse",
    text: "this is f***ing useless. stop sending me canned garbage and get someone who actually knows what they're doing",
    tags: ["escalate", "abuse", "human-request", "indirect"],
    expect: esc(),
  },

  // ───────────────────────── MUST ANSWER ─────────────────────────
  // Package prices / deposits
  {
    id: "h3-gold-price-deposit",
    text: "how much is gold at heva n whats the deposit on it",
    tags: ["answer", "price", "deposit", "names-package-not-chosen"],
    expect: {
      escalate: false,
      facts: [/4,?500/, /\b600\b/],
      noBusinessWrites: true,
    },
  },
  // Inclusions
  {
    id: "h3-sapphire-inclusions",
    text: "what comes with the sapphire package? like is hotel included or what",
    tags: ["answer", "inclusions", "names-package-not-chosen"],
    expect: {
      escalate: false,
      facts: [/hotel/i, /\b(?:3|three)\b/i],
      noBusinessWrites: true,
    },
  },
  // Bookable weekdays (package property, not clinic)
  {
    id: "h3-heva-saturday",
    text: "Is it possible to have the procedure on a Saturday at Heva? Weekdays are really tough with my job.",
    tags: ["answer", "bookable-weekdays"],
    expect: {
      escalate: false,
      facts: [/Gold/i, /Sat/i],
      noBusinessWrites: true,
    },
  },
  // Doctors, singular and plural
  {
    id: "h3-heva-doctor",
    text: "whos the doctor at heva",
    tags: ["answer", "doctors", "singular", "terse"],
    expect: {
      escalate: false,
      facts: [/Sibel/i],
      noBusinessWrites: true,
    },
  },
  {
    id: "h3-surgeons-plural",
    text: "Who are the surgeons at the clinics in my assessment?",
    tags: ["answer", "doctors", "plural"],
    expect: {
      escalate: false,
      facts: [/Sibel/i, /Dr\.? Hakan(?! Clinic)/i],
      noBusinessWrites: true,
    },
  },
  // Clinic specialty (clinic_flags)
  {
    id: "h3-hakan-afro",
    text: "my hair is 4c so this matters — is dr hakan clinic also an afro hair specialist or is that only heva?",
    tags: ["answer", "specialty", "clinic-flags"],
    expect: {
      escalate: false,
      facts: [/Heva/i, /afro/i],
      forbid: [
        /Hakan(?: Clinic)?(?:'s)? (?:is|are) (?:also )?(?:an )?afro/i,
        /both (?:clinics )?(?:specialize|specialise|are afro)/i,
      ],
      noBusinessWrites: true,
    },
  },
  // Clinic web page (Doctours page first)
  {
    id: "h3-hakan-website",
    text: "do they have a website? dr hakan i mean",
    tags: ["answer", "clinic-website"],
    expect: {
      escalate: false,
      lastLine: "https://www.doctours.com/clinic/dr-hakan",
      noBusinessWrites: true,
    },
  },
  // Free consultation (mentions "call" + "pay")
  {
    id: "h3-consult-free",
    text: "wait is the consult call free or do i have to pay for that too",
    tags: ["answer", "consultation", "mentions-call"],
    expect: {
      escalate: false,
      facts: [/free/i],
      noBusinessWrites: true,
    },
  },
  // Financing / insurance / CareCredit (financing flag = yes)
  {
    id: "h3-monthly-payments",
    text: "is there any way to do monthly payments? 3k all at once is a lot for me rn",
    tags: ["answer", "financing"],
    expect: {
      escalate: false,
      facts: [/Klarna|PayPal/i, /layaway/i],
      forbid: [
        /\bAPR\b/i,
        /\$\s?\d[\d,.]*\s*(?:\/|per|a)\s*mo(?:nth)?\b/i,
        /you(?:'re| are| will be) (?:pre-?)?approved/i,
      ],
      noBusinessWrites: true,
    },
  },
  {
    id: "h3-insurance",
    text: "Does health insurance cover any of this? I have a PPO through my job.",
    tags: ["answer", "insurance"],
    expect: {
      escalate: false,
      facts: [/insurance/i, /Klarna|PayPal|financ/i, /layaway/i],
      forbid: [/depends on (?:your|the) (?:plan|policy|provider|insurer)/i, /medically necessary/i, /superbill/i],
      noBusinessWrites: true,
    },
  },
  {
    id: "h3-carecredit",
    text: "do yall take care credit",
    tags: ["answer", "carecredit", "terse"],
    expect: {
      escalate: false,
      facts: [/care ?credit/i, /Klarna|PayPal/i, /layaway/i],
      forbid: [/\byes,? we (?:do )?(?:take|accept)/i],
      noBusinessWrites: true,
    },
  },
  // Promo (PROMO_OFFER null: answer the price, say nothing about promos either way)
  {
    id: "h3-promo-ad",
    text: "saw an ad on insta for a hair transplant deal, is there a promo going on right now?",
    tags: ["answer", "promo"],
    expect: {
      escalate: false,
      facts: [/\$?\d,?\d{3}/],
      forbid: [
        /\bno (?:current |active )?(?:promos?|promotions?|discounts?|deals?)\b/i,
        /(?:don't|do not|aren't|are not)(?: currently)? (?:have|running|offering|any)[^.]*(?:promo|discount|deal)/i,
        /\bcode\b/i,
        /\d+\s?% off/i,
        /\$\s?\d+ off/i,
      ],
      noBusinessWrites: true,
    },
  },
  // Pausing
  {
    id: "h3-pause-saving",
    text: "ngl im gonna pump the brakes for a bit, need to stack some more cash first",
    tags: ["answer", "pause", "default-window"],
    expect: {
      escalate: false,
      facts: [/month/i],
      forbid: [NO_URL],
      fields: { shouldFollowUp: true },
      noBusinessWrites: true,
    },
  },
  {
    id: "h3-pause-two-weeks",
    text: "Let me sit down with my wife and go over the numbers. Can you check back with me in two weeks?",
    tags: ["answer", "pause", "named-window"],
    expect: {
      escalate: false,
      facts: [/(?:2|two) weeks/i],
      forbid: [NO_URL],
      fields: { shouldFollowUp: true, followUpTiming: /(?:2|two)\s*weeks?/i },
      noBusinessWrites: true,
    },
  },
  // Assessment / photo status (no turnaround)
  {
    id: "h3-revision-turnaround",
    text: "can the team redo my hairline a little lower?? and how long will that take",
    tags: ["answer", "assessment", "revision", "no-turnaround"],
    expect: {
      escalate: false,
      forbid: TURNAROUND,
      noBusinessWrites: true,
    },
  },
  {
    id: "h3-photo-status",
    text: "just making sure you got all my photos ok? dont need to redo any?",
    tags: ["answer", "photos", "status"],
    expect: {
      escalate: false,
      forbid: [/image-upload/i],
      noBusinessWrites: true,
    },
  },
  {
    id: "h3-resend-assessment",
    text: "hey i accidentally deleted the text with my assessment link, can u send it again",
    tags: ["answer", "assessment", "link-request"],
    expect: {
      escalate: false,
      lastLine: "https://www.doctours.com/assessment/c3d4e5f6-3333-4333-8333-333333333333",
      noBusinessWrites: true,
    },
  },
  // Aftercare / head covering
  {
    id: "h3-packing",
    text: "what should i pack for istanbul? anything i need for right after the surgery?",
    tags: ["answer", "aftercare", "head-covering"],
    expect: {
      escalate: false,
      facts: [/button|zip|front[- ]open/i],
      forbid: [
        /(?<!(?:n't|not|never|no)\s)\b(?:bring|pack|wear|buy|grab)\b[^.]{0,40}\b(?:hats?|caps?|beanies?|hoods?|scarf|scarves|bandanas?|headbands?|durags?|du-rags?|wraps?|bonnets?|turbans?)\b/i,
      ],
      noBusinessWrites: true,
    },
  },
  // Selection statements that DO choose (must save)
  {
    id: "h3-select-heva",
    text: "honestly heva is the one for me, the afro hair specialty is what sold me",
    tags: ["answer", "selection", "clinic-chosen"],
    expect: {
      escalate: false,
      commits: [{ tool: "updateUserClinicPreferences", argsMatch: HEVA_ID }],
    },
  },
  {
    id: "h3-silver-link",
    text: "Ok I've decided — Heva, Silver package. Can you send me the link to pay the deposit?",
    tags: ["answer", "selection", "package-chosen", "payment-link"],
    expect: {
      escalate: false,
      lastLine: "https://www.doctours.com/payment/44444444-4444-4444-8444-444444444441",
      forbid: [CHECKOUT_URL_ANY],
      tools: [{ tool: "getPaymentLink", argsMatch: SILVER_ID }],
      commits: [{ tool: "updateUserClinicPreferences", argsMatch: SILVER_ID }],
    },
  },
  {
    id: "h3-sapphire-pay",
    text: "lets do it. sapphire w dr hakan. where do i pay",
    tags: ["answer", "selection", "package-chosen", "payment-link"],
    expect: {
      escalate: false,
      lastLine: "https://www.doctours.com/payment/55555555-5555-4555-8555-555555555551",
      forbid: [CHECKOUT_URL_ANY],
      tools: [{ tool: "getPaymentLink", argsMatch: SAPPHIRE_ID }],
      commits: [{ tool: "updateUserClinicPreferences", argsMatch: SAPPHIRE_ID }],
    },
  },
  {
    id: "h3-heva-checkout",
    text: "I'm going with Heva but can't decide between Silver and Gold yet. Send me the checkout so I can compare them and put the deposit down.",
    tags: ["answer", "selection", "clinic-chosen", "checkout-link"],
    expect: {
      escalate: false,
      lastLine: "https://www.doctours.com/clinic/heva/checkout",
      forbid: [PAYMENT_URL_ANY],
      tools: [{ tool: "getPaymentLink", argsMatch: HEVA_ID }],
      commits: [{ tool: "updateUserClinicPreferences", argsMatch: HEVA_ID }],
    },
  },
  // Undecided "how do I pay" → assessment, no link, no selection
  {
    id: "h3-how-to-pay-undecided",
    text: "how do i actually pay for this? do i have to wait for someone to send me something",
    tags: ["answer", "how-to-pay", "undecided"],
    expect: {
      escalate: false,
      facts: [/assessment/i],
      forbid: [PAYMENT_URL_ANY, CHECKOUT_URL_ANY],
      noBusinessWrites: true,
    },
  },
  // Policy QUESTIONS (not execution)
  {
    id: "h3-cancel-policy",
    text: "What if I book and then something comes up and I have to cancel — do I get my deposit back?",
    tags: ["answer", "policy", "refund", "mentions-cancel", "mentions-book"],
    expect: {
      escalate: false,
      facts: [/\b25\b/, /flight|month|lock/i],
      noBusinessWrites: true,
    },
  },
  {
    id: "h3-switch-clinic-policy",
    text: "if i pay the deposit for one clinic and later change my mind, can i switch it to the other one?",
    tags: ["answer", "policy", "transfer", "mentions-change"],
    expect: {
      escalate: false,
      facts: [/flight/i],
      noBusinessWrites: true,
    },
  },
  {
    id: "h3-price-lock",
    text: "Does paying the deposit lock in the price? I probably wouldn't travel for a good while.",
    tags: ["answer", "policy", "price-lock"],
    expect: {
      escalate: false,
      facts: [/\b(?:12|twelve)\b/i],
      noBusinessWrites: true,
    },
  },
  {
    id: "h3-balance-who-when",
    text: "who actually gets paid, you guys or the clinic? and when is the rest of the money due",
    tags: ["answer", "policy", "balance-due", "who-is-paid"],
    expect: {
      escalate: false,
      facts: [/Doctours|through us|to us/i, /\b(?:7|seven)\b/i],
      forbid: [/at the clinic on (?:the )?(?:procedure|surgery) day/i],
      noBusinessWrites: true,
    },
  },
  {
    id: "h3-need-call-to-book",
    text: "do i need to get on a call with someone before i can book or can i just do it myself",
    tags: ["answer", "how-to-pay", "mentions-call", "mentions-book"],
    expect: {
      escalate: false,
      facts: [/assessment/i],
      forbid: [/I(?:'ll| will) call/i],
      noBusinessWrites: true,
    },
  },
  {
    id: "h3-date-change-policy",
    text: "if I pick a date at checkout and then something comes up at work, am I stuck with it or can it be changed?",
    tags: ["answer", "policy", "date-flow", "mentions-change"],
    expect: {
      escalate: false,
      facts: [/availab/i],
      noBusinessWrites: true,
    },
  },
  // Torn between clinics → recommend one (cheaper = Heva Silver $3,000 vs Sapphire $3,200)
  {
    id: "h3-torn-recommend",
    text: "I keep going back and forth between Heva and Dr Hakan. If you were me which one would you pick?",
    tags: ["answer", "torn", "recommendation"],
    expect: {
      escalate: false,
      facts: [
        /(?:go with|recommend|pick|lean(?:ing)? toward|suggest|choose)[^.]{0,30}Heva|Heva[^.]{0,30}(?:my pick|the one|better fit|best fit|the better|would be my|is where I'd)/i,
      ],
    },
  },
  // Names packages without choosing
  {
    id: "h3-silver-vs-gold",
    text: "whats the real difference between silver and gold at heva, besides the price",
    tags: ["answer", "package-compare", "names-package-not-chosen"],
    expect: {
      escalate: false,
      facts: [/night|hotel/i],
      noBusinessWrites: true,
    },
  },
  {
    id: "h3-gold-doctor-role",
    text: "on the gold package does the surgeon do the extractions herself or is it mostly techs?",
    tags: ["answer", "package-aicontext", "names-package-not-chosen"],
    expect: {
      escalate: false,
      facts: [/\b(?:every|all)\b/i],
      noBusinessWrites: true,
    },
  },
  // Multi-part
  {
    id: "h3-multi-part",
    text: "ok couple things lol\n1. consult is free right?\n2. whats the deposit on heva silver\n3. can i do a wednesday for silver",
    tags: ["answer", "multi-part", "consultation", "deposit", "bookable-weekdays", "names-package-not-chosen"],
    expect: {
      escalate: false,
      facts: [/free/i, /\b500\b/, /wed/i],
      forbid: [/(?:yes|sure|yep)[^.]{0,40}wednesday/i],
      noBusinessWrites: true,
    },
  },
];
