# Source map: monolithic system prompt → core + skills

Source: `pre-deposit-respond-packet.md` lines 763–1555 (the `text` fence). Each row is a section heading from the source, with the file and rule ids its content moved to, or the reason it was dropped. Bold sub-blocks and numbered items that act as sections are listed too.

| # | Source section (line) | Destination | Rule ids / reason |
|---|---|---|---|
| 1 | # IDENTITY (764) | core | core.identity.role, core.voice.no-channel-excuses (one BAD/GOOD pair kept). The "move the $300 payment" and "change procedure date" examples were dropped because they come from the booked tier. |
| 2 | # OBJECTIVE (777) | core | core.objective.answer-then-stop |
| 3 | # RESPONSE MODE (780) | core + skills | core.objective.no-extras (only additions a loaded rule allows). Exceptions: 1 → intake-collection.first-contact / .answer-then-anchor; 2 → images.no.proactive, consultation.booked.confirm-yes; 3 → payment.always-answer, payment.sent.*, clinic-selection.sent.*; 4 → pause.nothing-else. |
| 4 | # COLLECTION PERSISTENCE (788) | intake-collection | intake-collection.items, .states, .ask-once, .answer-then-anchor; deferred photos → images.delay-hair-state; no anchor on pause → pause.nothing-else |
| 5 | # FINANCING GEOGRAPHY (809) | financing | financing.us-ca-only, .not-guaranteed, .yes.offer, .no.first-sentence, .no.never-offer, .unknown.ask; insurance/CareCredit hand-off → financing.no-proactive |
| 6 | # HEALTH INSURANCE (821) | insurance-carecredit | insurance-carecredit.insurance-no, .no-then-options, .no-hedge, .paperwork, .hsa, .scope, .yes.model, .no.order, .unknown.order. The "don't confuse with work-leave letters" line was dropped because those letters are booked-tier only. |
| 7 | # CARECREDIT / CHERRY (842) | insurance-carecredit | insurance-carecredit.carecredit-no, .no-then-options, .no-hedge, .paperwork, .scope (Alphaeon), .yes.model |
| 8 | # CLINIC WEBSITE (862) | clinic-selection | clinic-selection.website. Changed to fit the fixtures: the clinic `url` is the Doctours page, so there is no separate site for a second ask, and the URL comes from LINKS. |
| 9 | # VOICE (SINGLE COMMUNICATOR) (876) | core | core.voice.first-person, core.voice.plain-text |
| 10 | # CONVERSATION AWARENESS (881) | core | core.convo.hold-notice, .no-repeats, .continue, .no-reask, .no-paraphrase, .openers |
| 11 | # CAPABILITIES & CONSTRAINTS (894) | core + skills | core.cap.scope, .no-offers, .no-future-promises, .no-stall, .no-false-lookup, .allowed; photo attachments → images.send-back; revisions → assessment.revisions; promo → promo-discount.*; date hold → payment.date-flow. Dropped: self-serve work-leave letters, booking-documents link, first-party flight tools and trip links, driver/WhatsApp example (booked tier or tools that don't exist); "routed to a person" sentences (escalation is decided in code). Pre-deposit flight line kept in travel.flights-help / .pre-deposit-limits. |
| 12 | "Allowed and expected" payment-link paragraph (908) | payment | payment.path-by-clarity, payment.one-link. "Do not route to human" was dropped because code handles escalation. |
| 13 | CRITICAL — do not over-commit (910) | core | core.cap.no-future-promises, .no-offers, .no-stall, .allowed. Examples: assessment-notes → assessment examples; date-hold → payment example; claimed discount → promo-discount example. |
| 14 | # BUSINESS POLICY GROUNDING (929) | core + skills | core.ground.sources, .history-not-source, .gap, .no-ui-invention, core.ban.financing-math, core.ban.drive-times; airport/transfer coverage → clinic-packages.airports. The first-party trip-link example was dropped (booked tier / tool doesn't exist). The rest of the examples went to their topic skills (financing, insurance-carecredit, payment, consultation). |
| 15 | # CREATOR / PARTNERSHIP (954) | creator | creator.handoff-only, .no-terms, .no-thread, .keep-helping. The "normally routed to a human" wording was dropped (code handles escalation). |
| 16 | # PACKAGE & CLINIC FACTS (960) | clinic-packages + others | clinic-packages.grounded, .reverify, .verbatim, .included-vs-paid, .no-blending, .price-currency, .aicontext, .own-hotel, .hotels, .incisions; hair type → clinic-selection.specialty-from-flags; passport → travel.why-passport; finasteride → general-faq.meds; messaging the clinic → general-faq.contact-clinic. getBookingPackageDetails and getTripDetails.hotel were dropped (tools don't exist). |
| 17 | # GUIDELINES (991) | core + skills | core.objective.size, .undershare, .no-track-record, core.specific.name-it (no invented clinic labels), core.ban.head-covering, core.ban.assessment-eta, core.ban.weekday-dates, core.voice.english, core.ground.gap; follow-up requests → general-faq.follow-up, pause.check-back-request; first-reply no-URL → intake-collection.first-contact. Link placement was dropped (code renders links). |
| 18 | # SPECIFICITY (1008) | core | core.specific.name-it |
| 19 | # DATA COLLECTION (1016) | core + intake-collection | core.out.memory (patientName), intake-collection.record. The updateUser call was dropped: the writer calls no write tools, and code commits them. |
| 20 | # STRUCTURED OUTPUT FIELDS (1019) | core + skills | core.out.follow-up; follow-up triggers → pause.fields, images.done-check, images.delay-hair-state, general-faq.follow-up; attachments → images.send-back; payment-link mechanics → payment.path-by-clarity / .one-link. Dropped because code derives or validates them: highEngagement, intent, the attachmentUrls schema, getPaymentLink argument mechanics. |
| 21 | # DEPOSIT ELIGIBILITY RULE (1030) | payment | payment.clinic-deposit |
| 22 | # DIRECT-FROM-CLINIC PRICE QUOTES (1038) | payment | payment.direct-quote (example made generic; the fixture price was removed). "Routes to a human upstream" was dropped (code handles escalation). |
| 23 | # FIRST-CONTACT INTRODUCTION (1043) | intake-collection | intake-collection.first-contact |
| 24 | # INSTANT FORM AREA CONFIRMATION (1052) | intake-collection | intake-collection.instant-form |
| 25 | # INFORMATION COLLECTION (1058) | intake-collection | intake-collection.items, .asks, .ask-once |
| 26 | # CONCERN REFLECTION (1068) | intake-collection | intake-collection.concern, .concern-tone (one BAD/GOOD kept) |
| 27 | # IMAGE GUIDANCE (1101) | images | images.payoff, .done-instruction, .done-check, .chat-photos-count, .no-bare-claim, .upload-trouble, .missing-angles, .back-photo, .beard-eyebrow, .no.proactive, .yes.no-ask; photos not blocked by area/name → intake-collection.answer-then-anchor |
| 28 | # REVERSIBILITY (1134) | reversibility | reversibility.when, .once, .one-clause, .facts, .not-reversible, .no-urgency |
| 29 | # TIME-BOUND PAUSE (1170) | pause | pause.applies, .close, .interval, .fields, .nothing-else, .no-stack, .not-applies |
| 30 | # WHAT MATTERS vs NICE TO HAVE (1212) | what-matters | what-matters.purpose, .matters, .optional, .required, .lower-tier, .tool-facts, .extra-nights, .no-disparage, .brief |
| 31 | # STAGE-SPECIFIC BEHAVIOR (1248) | split by stage | See rows 32–46 |
| 32 | ## LEAD (1250) | intake-collection | intake-collection.lead.flow |
| 33 | ## PREP_PRE_CLINICAL (1256) | assessment + payment | assessment.prep.status, assessment.not-ready, payment.always-answer |
| 34 | ## PRE_CLINICAL_SENT (1264) | payment + clinic-selection + assessment | See rows 35–40 |
| 35 | "When they reply received / got it" (1267) | clinic-selection | clinic-selection.sent.ack |
| 36 | Step 0 — Assessment Context (1269) | payment + assessment | payment.assessment-book, payment.path-by-clarity (decided patient → link; resend the assessment link for how/where-to-pay), assessment.sent.answer, assessment.estimate |
| 37 | Step 1 — Clinic Selection (1276) | clinic-selection | clinic-selection.sent.already-selected, .sent.count, .sent.torn, .sent.destination, .lean-definition, .engage-any-partner. Instructions to call updateUserClinicPreferences were dropped (code commits the selection from router decisions). |
| 38 | Step 2 — Package Selection (1299) | payment | payment.sent.package-step, payment.ambiguous-package. updateUserClinicPreferences calls and dropped-reason retries were dropped (code handles writes). |
| 39 | Step 3 — Payment (1308) | payment + financing + promo-discount | payment.path-by-clarity, .one-link, .deposit-only, .date-flow, .refund-transfer, .no-proactive-financing; financing.deposit-first; promo-discount.no-invention, .active.code. "Routed to a person" was dropped (code handles escalation). |
| 40 | Pacing (1324) | payment | payment.sent.pacing; pause rules → pause (which suppresses payment and clinic-selection) |
| 41 | ## MEETING_BOOKED / MEETING_COMPLETED (1326) | consultation | consultation.booked.context, consultation.completed, payment.always-answer, consultation.reschedule |
| 42 | ### CONSULTATION BOOKING CONFIRMATION (1333) | consultation | consultation.booked.confirm-yes, .booked.confirm-no |
| 43 | ## MEETING_MISSED (1338) | consultation | consultation.missed.offer |
| 44 | ## WAITING (1341) | core | core.objective.no-extras (answer, no unprompted check-ins or rapport questions). No stage-specific rule left. |
| 45 | # IMAGE DELAY HANDLING (1344) | images + pause | images.delay-hair-state, .delay-short, .delay-unspecified; pause.interval |
| 46 | # CONSULTATION RESCHEDULING (1362) | consultation | consultation.reschedule, consultation.scope. "Routes to a human" on error was dropped (code handles escalation). |
| 47 | # CLINIC STATUS TIERS (1369) | clinic-selection | clinic-selection.no-internal-labels, .engage-any-partner, .never-deny-location, .location-not-funnel. Changed to fit the fixtures: tools return top-level status "ACTIVE" and no ai_context.status, so the recommended/limited/do_not_recommend tiers became "any ACTIVE clinic may be named on request" plus the "not one I can recommend" wording. The no-follow-up-promise line is covered by core.voice.first-person / core.cap.no-stall. |
| 48 | NEVER DENY A LOCATION (1379) | clinic-selection | clinic-selection.never-deny-location (examples made generic) |
| 49 | # PRE-ASSESSMENT CLINIC AND PRICING ANSWERS (1387) | clinic-packages + intake-collection | clinic-packages.pre-assessment-cap; the pivot to an anchor → intake-collection.answer-then-anchor. The GOOD example was dropped because it quoted a fixture clinic's price range. |
| 50 | # TRAVEL READINESS (1397) | travel | travel.passport-normalize (one BAD/GOOD kept) |
| 51 | # PHONE CONTACT (1406) | consultation | consultation.other-calls. "Routed to a person" was dropped (code handles escalation). |
| 52 | # TOOL USAGE (1409) | skill `tools:` frontmatter + rules | getPatientContext → payment/consultation; getSavedClinics after the assessment only → clinic-selection.location-not-funnel; getClinicPackages fields (bookableWeekdays, airports, hotels) → clinic-packages.weekdays/.airports/.hotels; getAllClinics slug/url → clinic-selection.website; getPatientImages → images.done-check; getLatestAssessment → assessment.link/.not-ready; getConsultationRescheduleLink → consultation.reschedule; getFullCalls → call-context.when. Dropped: updateUserClinicPreferences usage and the selected-vs-soft write mechanics (code commits writes; the lean/torn definition was kept in clinic-selection.lean-definition); tentativeProcedureDates writing (the fixture tool has no such argument; timing is read from getPatientContext, see core.out.memory); lockedReason active_booking (booked tier); "Tool" suffix removed. |
| 53 | # OPERATIONAL KNOWLEDGE (1425) | split | See rows 54–64 |
| 54 | OK 1 — The Goal (1426) | payment + travel | payment.always-answer, payment.sent.endpoint; travel.no-premature-logistics, travel.flights-help, travel.pre-deposit-limits, travel.timing-general, travel.no-itinerary, travel.package-specific. Trip links and the first-party flight tools were dropped (tools don't exist or booked tier). |
| 55 | OK 2 — Procedure Areas and Clinics (1430) | general-faq | general-faq.areas |
| 56 | OK 3 — Assessment (1431) | assessment + payment | assessment.contents, .estimate, .no-visuals, .revisions, .notes-not-revisions; payment.assessment-book |
| 57 | OK 4 — Assessment Clinic Recommendations (1435) | clinic-selection | clinic-selection.location-not-funnel, .fit-notes, .specialty-from-flags. ranking/badFor are not in the fixtures; bestFor and patientFacingSummary are kept. |
| 58 | OK 5 — Scheduling (1436) | general-faq + consultation + payment | general-faq.season, consultation.free (local timezone), payment.date-flow, core.cap.scope (no live availability). Dropped: saving tentativeProcedureDates (no such tool argument); covered by core.out.memory ("don't re-ask timing on file"). |
| 59 | OK 6 — Payment & Deposits (1439) | payment + financing + insurance-carecredit | payment.deposit-only, .routing, .refund-transfer, .price-lock, .methods, .path-by-clarity, .one-link; financing.yes.account-holder, financing.layaway, financing.no-proactive; insurance-carecredit.* |
| 60 | OK 7 — Why Doctours (1452) | general-faq | general-faq.why-doctours |
| 61 | OK 8 — Consultations (1453) | consultation | consultation.free, .who, .format |
| 62 | OK 9 — Pricing (1456) | clinic-packages | clinic-packages.price-currency, .grounded; the "transparency only when asked" line → general-faq.why-doctours |
| 63 | OK 10 — Availability (1457) | general-faq + clinic-packages | general-faq.season, clinic-packages.weekdays (the "Heva runs Mon–Sat" example was dropped because it names fixture data) |
| 64 | OK 11 — Platform Links (1461) | skill `links:` frontmatter | Static links: image-upload (images, intake-collection) and consultation (consultation). Tool-built links (assessment, payment, checkout, reschedule, clinic page) are never written in skills; they are referenced from LINKS. |
| 65 | WORKING_MEMORY_SYSTEM_INSTRUCTION (1471) | core | core.out.memory (memoryPatch, partial merge, field meanings). Dropped: the "call updateWorkingMemory with full JSON" mechanics (the writer returns memoryPatch instead); escalationFlags (set by code). |
| 66 | Runtime header: responding as coordinator / date / chat kind / sender (1507–1513) | core | core.identity.role, core.identity.question ({{COORDINATOR_DISPLAY_NAME}} placeholder), core.convo.continue (thread-visible). Date, chat kind, and sender are runtime context that code injects. |
| 67 | # Patient Summary (1515) | dropped | Runtime data that code injects; its flags drive the `[when financing=…]`, `stage`, `images`, and `promo` sections. |
| 68 | # Clinic flags (1518) | clinic-selection | clinic-selection.specialty-from-flags. The flag values themselves are runtime data. |
| 69 | # ACTIVE PROMO OFFER (1523) | promo-discount + core | promo-discount.none.answer-price, .none.no-deny, .no-promises, .active.*, .used.spent; core.ban.promo |
| 70 | # Message Classification (1530) | dropped | Replaced by the per-skill `description` classifier questions |
| 71 | # Available Context (1534) | dropped / merged | Runtime data. Its eligibility rule → payment.clinic-deposit; clinic-flag and website notes → clinic-selection |
| 72 | # Recent Calls (1543) | call-context | call-context.when, .not-grounding, .facts-win, .no-invention, .no-new-calls (the call data itself is runtime) |
| 73 | # Recent Conversation + CRITICAL review note (1546–1549) | core | core.convo.no-repeats (the transcript is runtime data) |
| 74 | NOTE: Mastra memory (1551) | core | core.out.memory (clinic/package selection is not in memory; read it from getPatientContext). The Mastra mechanics were dropped (runtime). |

## Global drops (apply across sections)
- Escalation instructions and every "routed to a person / goes to a human" line: code decides escalation before the writer runs.
- Link placement (URL on the last line, "using the link below"): code renders LINKS.
- Tools that don't exist: getBookingPackageDetails, getTripRecommendations, searchAirports, updateUserAirport, updateFlightPreferences, getTripDetails.
- Writer-side write-tool calls (updateUser, updateUserClinicPreferences, issuePromoCode, updateWorkingMemory): code commits writes; the writer returns memoryPatch.
- Booked-tier flows: trip links, booking hub, booking-documents / work-leave letters, driver WhatsApp details, procedure-date changes after booking.
