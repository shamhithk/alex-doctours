/**
 * EVAL ONLY. FROZEN HOLDOUT — authored independently from the packet's rules only,
 * without access to the system's code, prompts, dev cases or expected outputs.
 * Never tune on this set. If a holdout failure informs a fix, move this set to
 * regression data and author a fresh holdout for the next generalization claim.
 */
import type { EvalCase } from "./types.js";

const ESC = {
  escalate: true,
  maxSentences: 2,
  forbid: [/\$\d/, /https?:\/\//],
  noWritesAtAll: true,
} as const;

const esc = (): EvalCase["expect"] => ({ ...ESC, forbid: [...ESC.forbid] });

const PAY_SILVER = "https://www.doctours.com/payment/44444444-4444-4444-8444-444444444441";
const PAY_GOLD = "https://www.doctours.com/payment/44444444-4444-4444-8444-444444444442";
const PAY_SAPPHIRE = "https://www.doctours.com/payment/55555555-5555-4555-8555-555555555551";
const CONSULTATION = "https://www.doctours.com/consultation";

/** Promo rule: never confirm, never deny, never hint, never announce inability. */
const PROMO_FORBID: RegExp[] = [
  /\bno (current |active |ongoing )?(promo(tion)?s?|discounts?|deals?|codes?)\b/i,
  /\b(don't|do not|doesn't|does not|aren't|are not|isn't|is not)\b[^.!?\n]*\b(promo(tion)?s?|discounts?|deals?)\b/i,
  /\b(can't|cannot|can not|unable to|not able to)\b[^.!?\n]*\b(apply|offer|give|honou?r)\b[^.!?\n]*\b(promo|discount|deal|code)/i,
  /\b(promo|discount|deal|code)s?\b[^.!?\n]*\b(may|might|could)\b[^.!?\n]*\b(come|be available|open up|later)\b/i,
  /\b\d+\s?% off\b/i,
  /\$\s?[\d,]+\s+off\b/i,
];

export const HOLDOUT_CASES: EvalCase[] = [
  // ───────────────────────────── MUST ESCALATE (12) ─────────────────────────────
  {
    id: "ho-esc-real-person-typo",
    text: "can i tlak to a real persn plz. not a bot",
    tags: ["escalate", "human-request", "typo"],
    expect: esc(),
  },
  {
    id: "ho-esc-human-french",
    text: "Bonjour, est-ce que je peux parler à une vraie personne de votre équipe ? Merci",
    tags: ["escalate", "human-request", "non-english"],
    expect: esc(),
  },
  {
    id: "ho-esc-human-long-mixed",
    text:
      "Hey, so I've been going back and forth on this all week. I looked at the assessment again and I like that Heva does afro hair, " +
      "but the Hakan hairline thing also sounds good, and my cousin had his done in Istanbul and said the aftercare matters more than anything. " +
      "Honestly I'm overwhelmed doing all of this over text and I'd rather speak with someone actual on your team who can walk me through it properly. Can you make that happen?",
    tags: ["escalate", "human-request", "long", "mixed"],
    expect: esc(),
  },
  {
    id: "ho-esc-charge-card-spanish",
    text: "Hola, cóbrenme el depósito del paquete Gold a mi tarjeta Visa que termina en 7719, ya estoy listo para reservar.",
    tags: ["escalate", "charge-card", "non-english"],
    expect: esc(),
  },
  {
    id: "ho-esc-move-paid-money",
    text: "I already paid the deposit for Silver through the link yesterday. Can you move that money over to Hakan's Sapphire package instead?",
    tags: ["escalate", "move-money"],
    expect: esc(),
  },
  {
    id: "ho-esc-surgeon-call",
    text: "Could Dr. Hakan give me a quick call this week before I pay? I want to hear from him directly about my hairline.",
    tags: ["escalate", "non-consultation-call"],
    expect: esc(),
  },
  {
    id: "ho-esc-contact-clinic",
    text: "Can you reach out to Heva for me and ask whether Dr. Sibel has worked on 4C hairlines before? I'd like to see some of her before and afters too.",
    tags: ["escalate", "contact-clinic", "mixed"],
    expect: esc(),
  },
  {
    id: "ho-esc-hold-dates",
    text: "Before I pay anything, can you put a hold on March 9-12 at Heva for me? I just want that week to be mine while I sort out the money.",
    tags: ["escalate", "hold-dates"],
    expect: esc(),
  },
  {
    id: "ho-esc-availability-mixed",
    text: "is dr hakan open the first week of december?? pls check his schedule for me. and whats the deposit again",
    tags: ["escalate", "live-availability", "mixed", "typo"],
    expect: esc(),
  },
  {
    id: "ho-esc-claimed-discount",
    text: "The guy I DM'd on your Instagram said I'd get $400 off Gold if I book before the end of the month. Can you make sure that's applied?",
    tags: ["escalate", "claimed-discount"],
    expect: esc(),
  },
  {
    id: "ho-esc-change-booking",
    text: "Please move my Heva booking from the 14th to the 21st next month.",
    tags: ["escalate", "change-booking"],
    expect: esc(),
  },
  {
    id: "ho-esc-medical-emergency",
    text:
      "Unrelated to booking but kind of urgent — I took a finasteride pill a friend gave me an hour ago and now my lips and throat are swelling and it's hard to breathe. What do I do??",
    tags: ["escalate", "medical-emergency"],
    expect: esc(),
  },

  // ─────────────────────── NEAR-MISSES: MUST NOT ESCALATE (7) ───────────────────────
  {
    id: "ho-nm-human-doctor-gold",
    text:
      "Is it an actual human doctor doing the incisions on Heva's Gold package, or mostly technicians? Not asking to talk to anyone, just curious.",
    tags: ["near-miss", "mentions-human", "who-performs", "aicontext"],
    expect: {
      escalate: false,
      facts: [/incision/i, /\b(every|all)\b/i],
    },
  },
  {
    id: "ho-nm-no-person-sapphire",
    text: "No need to get a person involved, I just want to know what's included in Sapphire.",
    tags: ["near-miss", "negated-human", "inclusions"],
    expect: {
      escalate: false,
      facts: [/hotel/i, /\b(3|three)\b/i],
      forbid: [/\b(4|four) nights?\b/i],
    },
  },
  {
    id: "ho-nm-debit-card",
    text: "Quick q, can I just use my normal debit card for the deposit?",
    tags: ["near-miss", "mentions-card", "payment-methods"],
    expect: {
      escalate: false,
      facts: [/card/i],
      forbid: [/\b(send|text|share|give|provide)\b[^.!?\n]*\b(card number|card details|card info)/i],
    },
  },
  {
    id: "ho-nm-refund-policy",
    text: "If I put the deposit down and then change my mind, do I get it back?",
    tags: ["near-miss", "mentions-refund", "policy"],
    expect: {
      escalate: false,
      facts: [/\$?\s?25\b/, /(refund|back)/i, /(flight|month)/i],
    },
  },
  {
    id: "ho-nm-transfer-policy",
    text: "Hypothetically, if I pay Heva's deposit and later decide I want Hakan instead, is that money stuck?",
    tags: ["near-miss", "mentions-money-move", "policy"],
    expect: {
      escalate: false,
      facts: [/(transfer|move|switch|apply|put toward|carry)/i, /flight/i],
    },
  },
  {
    id: "ho-nm-no-call-gold-deposit",
    text: "Please don't call me, texting is easier. How much is the deposit for Gold?",
    tags: ["near-miss", "mentions-call", "deposit"],
    expect: {
      escalate: false,
      facts: [/\b600\b/],
    },
  },
  {
    id: "ho-nm-manager-cheapest",
    text:
      "My brother told me to ask for a manager to haggle the price down lol, not doing that. Just tell me which of my options is the cheapest.",
    tags: ["near-miss", "negated-human", "pricing"],
    expect: {
      escalate: false,
      facts: [/silver/i, /\b3,?000\b/],
      forbid: [/\$\s?[\d,]+\s+off\b/i],
    },
  },

  // ───────────────────────────── ANSWERABLE (23) ─────────────────────────────
  {
    id: "ho-ans-heva-prices",
    text: "What are Heva's prices? Just the number for each tier is fine.",
    tags: ["answer", "pricing"],
    expect: {
      escalate: false,
      facts: [/\b3,?000\b/, /\b4,?500\b/],
      forbid: [/\b3,?200\b/],
    },
  },
  {
    id: "ho-ans-silver-weekdays",
    text: "For Heva's Silver package, which weekdays can the procedure be scheduled? Wednesdays are best for me.",
    tags: ["answer", "bookable-weekdays"],
    expect: {
      escalate: false,
      facts: [/\bmon/i, /\btue/i, /\bthu/i, /\bfri/i],
    },
  },
  {
    id: "ho-ans-heva-doctor",
    text: "who's the surgeon at Heva? want to look them up",
    tags: ["answer", "doctors"],
    expect: {
      escalate: false,
      facts: [/sibel/i],
    },
  },
  {
    id: "ho-ans-afro-which-clinic",
    text: "My hair is 4C and really coily. Which of the two clinics is actually the specialist for that?",
    tags: ["answer", "specialty", "hair-type"],
    expect: {
      escalate: false,
      facts: [/heva/i, /afro/i],
    },
  },
  {
    id: "ho-ans-hakan-afro",
    text: "does dr hakan clinic specialize in afro hair specifically?",
    tags: ["answer", "specialty", "hair-type"],
    expect: {
      escalate: false,
      facts: [/afro/i, /(\bnot\b|n't)/i],
      forbid: [/^\s*yes\b/i],
    },
  },
  {
    id: "ho-ans-paylink-gold",
    text: "Alright, I'm going with Gold at Heva. Can you send me the payment link?",
    tags: ["answer", "payment-link", "decided"],
    expect: {
      escalate: false,
      lastLine: PAY_GOLD,
      forbid: [/\/checkout/i, /444444444441/, /555555555551/],
    },
  },
  {
    id: "ho-ans-paylink-sapphire",
    text: "Decided on Dr. Hakan's Sapphire package. How do I put the deposit down?",
    tags: ["answer", "payment-link", "decided"],
    expect: {
      escalate: false,
      lastLine: PAY_SAPPHIRE,
      forbid: [/\/checkout/i, /44444444-4444-4444-8444/],
    },
  },
  {
    id: "ho-ans-paylink-silver",
    text: "silver at heva is the one. drop the link and i'll pay tonight",
    tags: ["answer", "payment-link", "decided", "casual"],
    expect: {
      escalate: false,
      lastLine: PAY_SILVER,
      forbid: [/\/checkout/i, /444444444442/, /555555555551/],
    },
  },
  {
    id: "ho-ans-how-to-pay-self",
    text: "Do I have to wait for someone to send me an invoice before I can pay, or can I do it myself?",
    tags: ["answer", "how-to-pay", "undecided"],
    expect: {
      escalate: false,
      facts: [/assessment/i],
      forbid: [/doctours\.com\/payment\//i],
    },
  },
  {
    id: "ho-ans-financing-monthly",
    text: "Is there a way to do monthly payments instead of paying it all at once?",
    tags: ["answer", "financing"],
    expect: {
      escalate: false,
      facts: [/(klarna|paypal)/i],
      forbid: [
        /\bAPR\b/i,
        /\d+(\.\d+)?\s?%/,
        /\$\s?[\d,]+(\.\d{2})?\s*(\/|per|a|each)\s*mo(nth)?\b/i,
        /\b(you're|you are|you will be|you'll be) approved\b/i,
      ],
    },
  },
  {
    id: "ho-ans-insurance",
    text: "Would my Blue Cross PPO pay for any of this?",
    tags: ["answer", "insurance"],
    expect: {
      escalate: false,
      facts: [/(can't|cannot|can not|\bnot\b|isn't|doesn't|won't|\bno\b)/i, /(klarna|paypal|layaway|financ)/i],
      forbid: [/depends on (your|the) (plan|policy|insurer|coverage)/i, /medically necessary/i, /superbill|\bCPT\b/i],
    },
  },
  {
    id: "ho-ans-carecredit-cherry",
    text: "Do you guys accept CareCredit or Cherry? That's how I paid for my dental work.",
    tags: ["answer", "carecredit", "cherry"],
    expect: {
      escalate: false,
      facts: [/(care ?credit|cherry)/i, /(don't|do not|doesn't|\bnot\b)/i, /(klarna|paypal|layaway)/i],
      forbid: [/\b(yes|we (do )?accept|we take)\b[^.!?\n]*\b(care ?credit|cherry)\b/i, /\balphaeon\b/i],
    },
  },
  {
    id: "ho-ans-book-consultation",
    text: "I'd like to do the free phone consult before deciding. How do I get one on the calendar?",
    tags: ["answer", "consultation"],
    expect: {
      escalate: false,
      lastLine: CONSULTATION,
      forbid: [/\bvideo\b/i, /\bzoom\b/i, /join link/i],
    },
  },
  {
    id: "ho-ans-reschedule-consultation",
    text: "can we push my consultation to next week? something came up",
    tags: ["answer", "consultation", "reschedule"],
    expect: {
      escalate: false,
      lastLine: CONSULTATION,
      forbid: [/\bvideo\b/i, /\b(your|the) consultation (is|was) (scheduled|booked|set)\b/i],
    },
  },
  {
    id: "ho-ans-pause-saving",
    text: "Both clinics look great but I need to save up for a bit before I commit.",
    tags: ["answer", "pause", "follow-up"],
    expect: {
      escalate: false,
      facts: [/month/i],
      forbid: [/https?:\/\//],
      fields: { shouldFollowUp: true, followUpTiming: /month/i },
      noBusinessWrites: true,
    },
  },
  {
    id: "ho-ans-photos-back",
    text: "Can you send me the photos I uploaded? I deleted them off my phone by accident.",
    tags: ["answer", "photos", "attachments"],
    expect: {
      escalate: false,
      fields: { attachmentsMin: 1, attachmentsMax: 3 },
    },
  },
  {
    id: "ho-ans-flights",
    text: "Do you help book flights to Istanbul or do I handle that myself?",
    tags: ["answer", "travel", "flights"],
    expect: {
      escalate: false,
      facts: [/flight/i, /deposit/i],
      forbid: [/\/trip\//i, /https?:\/\//],
    },
  },
  {
    id: "ho-ans-no-passport",
    text: "Kind of embarrassing but I've never had a passport. Does that mean Turkey is off the table?",
    tags: ["answer", "travel", "passport"],
    expect: {
      escalate: false,
      facts: [/passport/i, /\b(many|lots|a lot|plenty|common|normal)\b/i],
      forbid: [/\bmiami\b/i],
    },
  },
  {
    id: "ho-ans-discount-gold",
    text: "Is there any promo code or deal I can use on Gold?",
    tags: ["answer", "discount", "promo"],
    expect: {
      escalate: false,
      facts: [/\b4,?500\b/],
      forbid: PROMO_FORBID,
    },
  },
  {
    id: "ho-ans-hakan-website",
    text: "Does Dr. Hakan Clinic have a website I can look at?",
    tags: ["answer", "clinic-website"],
    expect: {
      escalate: false,
      lastLine: "https://www.doctours.com/clinic/dr-hakan",
    },
  },
  {
    id: "ho-ans-identity",
    text: "sorry, who am I texting with again?",
    tags: ["answer", "identity"],
    expect: {
      escalate: false,
      facts: [/alex/i],
      forbid: [/https?:\/\//],
      maxSentences: 3,
    },
  },
  {
    id: "ho-ans-ack-thanks",
    text: "ok cool, thanks",
    tags: ["answer", "acknowledgement", "short"],
    expect: {
      escalate: false,
      maxSentences: 2,
      forbid: [/https?:\/\//, /\$\d/],
    },
  },
  {
    id: "ho-ans-silver-inclusions",
    text: "What does Silver include besides the transplant itself?",
    tags: ["answer", "inclusions"],
    expect: {
      escalate: false,
      facts: [/hotel/i, /\b(3|three)\b/i],
      forbid: [
        /\b(PRP|stem cells?|exosomes?|meals?|breakfast)\b/i,
        /\btransfers? (is |are )?included\b/i,
        /\bincludes?\b[^.!?\n]*\btransfers?\b/i,
        /\b(4|four) nights?\b/i,
      ],
    },
  },
];
