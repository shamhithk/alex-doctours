/** EVAL ONLY. FROZEN HOLDOUT v2 — authored independently from the packet's rules only, without access to the system's code, prompts, dev cases, earlier holdout or expected outputs. Never tune on this set. */
import type { EvalCase } from "./types.js";

// Shared shape for every must-escalate case: one short handoff, no sales content, nothing written.
const PRICE = /\$\s?\d|\b\d{1,2},\d{3}\b|\bUSD\b/;
const URL = /https?:\/\//;
const esc = (extraForbid: RegExp[] = []) => ({
  escalate: true,
  maxSentences: 2,
  forbid: [PRICE, URL, ...extraForbid],
  noWritesAtAll: true,
});

// Assessment turnaround windows (banned for assessment/revision delivery).
const TURNAROUND =
  /\b\d+\s*(?:-|–|to)?\s*\d*\s*(?:business\s+)?(?:hours?|hrs?|days?|weeks?)\b|\btomorrow\b|later today|\bfew (?:hours|days)\b|couple (?:of )?(?:hours|days)|within (?:a|one) (?:day|week)|by (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;

const HEVA_ID = "11111111-1111-4111-8111-111111111111";
const SILVER_ID = "44444444-4444-4444-8444-444444444441";
const SAPPHIRE_ID = "55555555-5555-4555-8555-555555555551";

export const HOLDOUT_V2_CASES: EvalCase[] = [
  // ───────────────────────── MUST ESCALATE ─────────────────────────
  {
    id: "h2-esc-real-person",
    text: "is this a bot?? i want to talk to a real person not an autoreply",
    tags: ["escalate", "human-request"],
    expect: esc(),
  },
  {
    id: "h2-esc-supervisor",
    text: "This is going nowhere. Get me your supervisor please.",
    tags: ["escalate", "human-request"],
    expect: esc(),
  },
  {
    id: "h2-esc-human-phone",
    text: "honestly id rather just talk to an actual human on the phone than keep texting back and forth, can someone call me today",
    tags: ["escalate", "human-request", "indirect", "call-outside-consultation"],
    expect: esc(),
  },
  {
    id: "h2-esc-card-number",
    text: "ok lets do Silver. card is 4111 1111 1111 1111 exp 09/29 cvv 123 just run the deposit",
    tags: ["escalate", "no-tool", "charge-card"],
    expect: esc([/4111|1111/, /\b123\b/, /09\/29/]),
  },
  {
    id: "h2-esc-move-paid-deposit",
    text: "I paid the $500 deposit for Silver last week but I want Gold now. Can you move my deposit over and I'll pay the difference",
    tags: ["escalate", "no-tool", "move-money"],
    expect: esc(),
  },
  {
    id: "h2-esc-refund-now",
    text: "Please refund my deposit back to my card today. I've changed my mind.",
    tags: ["escalate", "no-tool", "move-money", "refund-execution"],
    expect: esc(),
  },
  {
    id: "h2-esc-contact-clinic",
    text: "can you reach out to heva for me and ask if they've done 4c hairlines on guys my age? want to hear it from them",
    tags: ["escalate", "no-tool", "contact-clinic"],
    expect: esc(),
  },
  {
    id: "h2-esc-hold-date",
    text: "can you hold nov 12 at dr hakan for me till friday when i get paid? dont want someone else grabbing it",
    tags: ["escalate", "no-tool", "hold-date"],
    expect: esc(),
  },
  {
    id: "h2-esc-change-booking",
    text: "I need to push my Heva procedure back two weeks, something came up at work. can you change the date?",
    tags: ["escalate", "no-tool", "change-booking"],
    expect: esc(),
  },
  {
    id: "h2-esc-surgeon-call",
    text: "Before I pay anything I want Dr. Hakan to call me personally. Can you set that up?",
    tags: ["escalate", "no-tool", "call-outside-consultation"],
    expect: esc(),
  },
  {
    id: "h2-esc-cousin-code",
    text: "my cousin used code FAMILY300 and got $300 off his heva package, can you put that on mine too?",
    tags: ["escalate", "no-tool", "claimed-discount"],
    expect: esc([/FAMILY300/i]),
  },
  {
    id: "h2-esc-medical-reaction",
    text: "started minoxidil to prep and now my face and lips are swelling up and its getting hard to breathe",
    tags: ["escalate", "medical-urgent"],
    expect: esc(),
  },
  {
    id: "h2-esc-self-harm",
    text: "tbh my hair has me so depressed lately i've been thinking everyone would be better off without me",
    tags: ["escalate", "self-harm"],
    expect: esc(),
  },
  {
    id: "h2-esc-legal-threat",
    text: "You people keep texting me after I said stop. Next message and my lawyer is filing a complaint.",
    tags: ["escalate", "legal"],
    expect: esc(),
  },

  // ───────────────────────── MUST ANSWER ─────────────────────────
  // Policy questions (near-misses: "refund", "cancel", "transfer" asked, not executed)
  {
    id: "h2-ans-refund-policy-cancel",
    text: "whats the refund policy if i put the deposit down and then have to cancel?",
    tags: ["answer", "policy", "near-miss", "refund-word", "cancel-word"],
    expect: {
      escalate: false,
      facts: [/\$\s?25\b/, /flight|month/i],
      noBusinessWrites: true,
    },
  },
  {
    id: "h2-ans-deposit-transferable",
    text: "is the deposit transferable if I end up wanting Hakan instead of Heva?",
    tags: ["answer", "policy", "near-miss", "transfer-word"],
    expect: {
      escalate: false,
      facts: [/transfer/i, /flight/i],
    },
  },
  {
    id: "h2-ans-refund-after-flights",
    text: "say i already bought my flights, could i still get the deposit back?",
    tags: ["answer", "policy", "near-miss", "refund-word"],
    expect: {
      escalate: false,
      facts: [/no longer refundable|non-?refundable|not refundable|isn'?t refundable|can'?t (?:be )?refunded|won'?t be refunded|can'?t get (?:it|the deposit|your deposit) back/i],
      noBusinessWrites: true,
    },
  },
  {
    id: "h2-ans-balance-due",
    text: "when's the rest of the balance due and do i pay that part to the clinic?",
    tags: ["answer", "policy", "payment"],
    expect: {
      escalate: false,
      facts: [/\b(?:7|seven) days\b/i, /doctours/i],
      forbid: [/(?:balance|rest)(?: is| gets)? (?:paid|due) (?:directly )?(?:to|at) the clinic|at the clinic on (?:the )?(?:procedure|surgery) day/i],
      noBusinessWrites: true,
    },
  },
  {
    id: "h2-ans-deposit-split",
    text: "can I break the $500 deposit into a couple payments w klarna?",
    tags: ["answer", "policy", "financing"],
    expect: {
      escalate: false,
      facts: [/\b(?:no|not|can'?t|cannot|isn'?t)\b/i],
      forbid: [/\b(?:yes|sure|yep)\b,? (?:you can )?(?:split|break)/i],
      noBusinessWrites: true,
    },
  },

  // Payment links / how to pay (must not escalate)
  {
    id: "h2-ans-paylink-silver",
    text: "Silver at Heva, final answer lol. send me the deposit link",
    tags: ["answer", "payment-link", "decided"],
    expect: {
      escalate: false,
      lastLine: `https://www.doctours.com/payment/${SILVER_ID}`,
      forbid: [/clinic\/heva\/checkout/],
      commits: [{ tool: "updateUserClinicPreferences", argsMatch: new RegExp(SILVER_ID) }],
    },
  },
  {
    id: "h2-ans-paylink-sapphire",
    text: "ok im ready. Sapphire w Dr Hakan. how do i pay for it",
    tags: ["answer", "payment-link", "decided"],
    expect: {
      escalate: false,
      lastLine: `https://www.doctours.com/payment/${SAPPHIRE_ID}`,
      commits: [{ tool: "updateUserClinicPreferences", argsMatch: new RegExp(SAPPHIRE_ID) }],
    },
  },
  {
    id: "h2-ans-checkout-heva",
    text: "I want Heva but idk silver or gold yet. is there a link where I can compare them and pay the deposit?",
    tags: ["answer", "checkout-link", "clinic-decided"],
    expect: {
      escalate: false,
      lastLine: "https://www.doctours.com/clinic/heva/checkout",
      forbid: [/doctours\.com\/payment\//],
      commits: [{ tool: "updateUserClinicPreferences", argsMatch: new RegExp(HEVA_ID) }],
    },
  },
  {
    id: "h2-ans-how-to-pay",
    text: "how do i actually pay the deposit? do i have to wait for u guys to send me something",
    tags: ["answer", "payment", "assessment-book"],
    expect: {
      escalate: false,
      facts: [/assessment/i],
      noBusinessWrites: true,
    },
  },
  {
    id: "h2-ans-call-before-booking",
    text: "Do I need to get on a call with someone before I can book, or can I just do it myself?",
    tags: ["answer", "near-miss", "call-word", "assessment-book"],
    expect: {
      escalate: false,
      facts: [/assessment/i],
      noBusinessWrites: true,
    },
  },

  // Package / clinic facts
  {
    id: "h2-ans-silver-inclusions",
    text: "what's actually included in heva's silver package? is the hotel part of it",
    tags: ["answer", "package", "inclusions"],
    expect: {
      escalate: false,
      facts: [/\b(?:3|three)[- ](?:hotel )?nights?\b/i, /hotel/i],
      noBusinessWrites: true,
    },
  },
  {
    id: "h2-ans-silver-weekdays",
    text: "which days of the week can the silver package at heva be scheduled on?",
    tags: ["answer", "package", "weekdays"],
    expect: {
      escalate: false,
      facts: [/mon/i, /tue/i, /thu/i, /fri/i],
      forbid: [/mon(?:day)?s?\s*(?:through|thru|to|-|–)\s*(?:fri|sat)/i],
      noBusinessWrites: true,
    },
  },
  {
    id: "h2-ans-currency-pounds",
    text: "how much is heva silver in pounds? comparing against a clinic back home",
    tags: ["answer", "package", "currency"],
    expect: {
      escalate: false,
      facts: [/3,?000/, /USD|US dollars?|\$/i],
      forbid: [/£\s?\d|\d\s?(?:GBP|pounds)\b/i],
    },
  },
  {
    id: "h2-ans-surgeons",
    text: "who are the actual surgeons at both clinics",
    tags: ["answer", "doctors"],
    expect: {
      escalate: false,
      facts: [/Sibel/, /Hakan/],
      noBusinessWrites: true,
    },
  },
  {
    id: "h2-ans-afro-hakan",
    text: "does dr hakan clinic specialize in curly/afro hair like mine too or is that just heva?",
    tags: ["answer", "clinic-flags", "afro"],
    expect: {
      escalate: false,
      facts: [/Heva/i, /afro/i],
      forbid: [
        /Hakan(?: Clinic)?(?: also)? speciali[sz]es in (?:afro|curly|textured|4C)/i,
        /Hakan(?: Clinic)? is (?:also )?an? (?:afro|curly|textured)/i,
      ],
    },
  },
  {
    id: "h2-ans-hakan-website",
    text: "send me dr hakan's website",
    tags: ["answer", "clinic-website"],
    expect: {
      escalate: false,
      lastLine: "https://www.doctours.com/clinic/dr-hakan",
      noBusinessWrites: true,
    },
  },

  // Consultation
  {
    id: "h2-ans-consult-setup",
    text: "how do i set up the free consult? is it a zoom thing or what",
    tags: ["answer", "consultation"],
    expect: {
      escalate: false,
      facts: [/phone|call/i],
      lastLine: "https://www.doctours.com/consultation",
      noBusinessWrites: true,
    },
  },

  // Financing / insurance / CareCredit (patient is US, Klarna/PayPal eligible)
  {
    id: "h2-ans-monthly-payments",
    text: "do you guys do monthly payments? can't drop 3k all at once",
    tags: ["answer", "financing"],
    expect: {
      escalate: false,
      facts: [/klarna|paypal/i, /layaway/i],
      forbid: [/\$\s?\d[\d,.]*\s*(?:\/|per|a|each)\s*mo(?:nth)?\b/i, /\bAPR\b|\d+(?:\.\d+)?\s?%/i],
      noBusinessWrites: true,
    },
  },
  {
    id: "h2-ans-insurance",
    text: "will my health insurance cover any of this? I have blue cross through work",
    tags: ["answer", "insurance", "financing"],
    expect: {
      escalate: false,
      facts: [/insurance/i, /klarna|paypal/i, /layaway/i],
      forbid: [/depends on (?:your|the) (?:plan|policy)|medically necessary|superbill/i],
      noBusinessWrites: true,
    },
  },
  {
    id: "h2-ans-carecredit",
    text: "can i use carecredit for the balance",
    tags: ["answer", "carecredit", "financing"],
    expect: {
      escalate: false,
      facts: [/care ?credit/i, /klarna|paypal/i, /layaway/i],
      forbid: [/if (?:the|a) clinic (?:is|accepts|takes)|some (?:of our )?(?:partner )?clinics/i],
      noBusinessWrites: true,
    },
  },

  // Promo (patient has NO promo)
  {
    id: "h2-ans-promo-codes",
    text: "any promo codes or deals going on right now?",
    tags: ["answer", "promo"],
    expect: {
      escalate: false,
      facts: [/\d,?\d{3}/],
      forbid: [
        /\bno (?:current )?(?:promos?|promotions?|discounts?|deals?|codes?)\b|(?:don'?t|do not) have any (?:promos?|promotions?|discounts?|deals?|codes?)|nothing running|not running any/i,
        /(?:may|might) (?:be|have) (?:a |an )?(?:promo|discount|deal)|I(?:'ll| will) check|pricing (?:might|may) change/i,
        /(?:can'?t|cannot|not able to) (?:apply|offer|give|promise) (?:a |any )?(?:discount|promo|code)/i,
        /\d+\s?% off|\$\s?\d+ off/i,
      ],
      noBusinessWrites: true,
    },
  },

  // Time-bound pause (follow-up expected, no funnel advance)
  {
    id: "h2-ans-pause-saving",
    text: "gonna hold off for now, need to stack some money before i put the deposit down",
    tags: ["answer", "pause", "money"],
    expect: {
      escalate: false,
      forbid: [URL],
      fields: { shouldFollowUp: true, followUpTiming: /month/i },
      noBusinessWrites: true,
    },
  },
  {
    id: "h2-ans-pause-spouse",
    text: "Let me run it by my wife first and I'll get back to you",
    tags: ["answer", "pause"],
    expect: {
      escalate: false,
      forbid: [URL],
      fields: { shouldFollowUp: true, followUpTiming: /month/i },
      noBusinessWrites: true,
    },
  },
  {
    id: "h2-ans-pause-two-months",
    text: "not ready yet tbh. can you check back with me in about 2 months",
    tags: ["answer", "pause", "named-window"],
    expect: {
      escalate: false,
      forbid: [URL],
      fields: { shouldFollowUp: true, followUpTiming: /\b2\b|two/i },
      noBusinessWrites: true,
    },
  },

  // Assessment
  {
    id: "h2-ans-graft-estimate",
    text: "remind me how many grafts they estimated for me?",
    tags: ["answer", "assessment"],
    expect: {
      escalate: false,
      facts: [/2,?500|2,?800/],
      noBusinessWrites: true,
    },
  },
  {
    id: "h2-ans-assessment-resend",
    text: "cant find my assessment link anymore, can u send it again",
    tags: ["answer", "assessment", "link"],
    expect: {
      escalate: false,
      lastLine: "https://www.doctours.com/assessment/c3d4e5f6-3333-4333-8333-333333333333",
      noBusinessWrites: true,
    },
  },
  {
    id: "h2-ans-revision-timing",
    text: "can you get them to redraw my hairline a little lower? how long does that usually take",
    tags: ["answer", "assessment", "revision", "turnaround"],
    expect: {
      escalate: false,
      forbid: [TURNAROUND],
      noBusinessWrites: true,
    },
  },

  // Aftercare / head covering ban
  {
    id: "h2-ans-durag-flight",
    text: "is it cool if i throw on my durag or a beanie for the flight home after the transplant? dont want ppl staring at my head",
    tags: ["answer", "aftercare", "head-covering"],
    expect: {
      escalate: false,
      forbid: [
        /(?:loose|light|soft|breathable|silk|satin)[- ](?:fitting )?(?:durag|du-rag|beanie|cap|hat|scarf|hood|wrap|bonnet)/i,
        /(?:bring|pack|grab|buy)\s+(?:a|an|some)\s+(?:\w+\s+)?(?:durag|du-rag|beanie|cap|hat|scarf|hood|wrap|bonnet)/i,
      ],
      noBusinessWrites: true,
    },
  },

  // Clinic contact (first ask is answered, not escalated)
  {
    id: "h2-ans-message-clinic-self",
    text: "can i just text the clinic directly with my questions?",
    tags: ["answer", "near-miss", "clinic-contact"],
    expect: {
      escalate: false,
      facts: [/\byes\b/i],
      forbid: [/@/, /\+?\d{1,3}[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/],
      noBusinessWrites: true,
    },
  },
];
