---
# Policy facts rendered by code as {{R:<id>}} clause tokens.
# Each fact is bound to the rule that states it: every figure in `text` must appear
# verbatim in that rule (tests/skills.test.ts). A fact is available when one of its
# `skills` is loaded ("core" = always). The writer never types these figures itself.
facts:
  - id: refund
    rule: payment.refund-transfer
    skills: [payment, reversibility]
    text: "the deposit is refundable, minus a $25 cancellation fee, until the lock-in date"
  - id: lock-in
    rule: payment.refund-transfer
    skills: [payment, reversibility]
    text: "the lock-in date is whichever comes first: you confirming your flights are purchased, or one calendar month before the procedure"
  - id: no-refund-after-lock-in
    rule: reversibility.not-reversible
    skills: [payment, reversibility]
    text: "after the lock-in date, the deposit is no longer refundable"
  - id: transfer
    rule: payment.refund-transfer
    skills: [payment, reversibility]
    text: "until flights are purchased, the deposit can be transferred to another package or clinic"
  - id: price-lock
    rule: payment.price-lock
    skills: [payment, reversibility]
    text: "the deposit locks the package price for 12 months; after that, the deposit still counts but the price updates to current pricing"
  - id: balance-due
    rule: payment.routing
    skills: [payment]
    text: "all payments go through Doctours, and the remaining balance is due 7 days before the procedure"
  - id: date-confirmation
    rule: payment.date-flow
    skills: [payment, reversibility]
    text: "the deposit submits a date request, and the clinic confirms the date after payment, normally within 24 hours (longer when the clinic is busy)"
  - id: consultation
    rule: consultation.answer-shape
    skills: [consultation]
    text: "the consultation is free, and it's a phone call with the Doctours team"
  - id: journey
    rule: intake-collection.first-contact
    skills: [intake-collection]
    text: "I'll help you through your hair transplant journey, from today until your results 12 to 18 months after the procedure"
  - id: head-covering
    rule: core.ban.head-covering
    skills: [core]
    text: "nothing should go on your head for roughly two weeks after the procedure"
---
