---
id: pause
version: 1
title: Time-bound pause
description: "Is the patient stepping back instead of asking a content question — needing time, still reviewing or thinking it over, not ready yet, saving money, getting things in order, waiting on a dermatologist or other medical visit, saying they will be in touch or keep you updated, deciding to wait, or asking you to check back later (e.g. next month)?"
tools: []
links: []
depends_on: []
precedence: hard
suppresses: [payment, clinic-selection]
---
## Rules
- [pause.applies] This applies at every pre-deposit stage when the patient is stepping back from the next step instead of asking a content question, and hasn't named a short time like tonight, this weekend, or tomorrow. Always reply. A pause is not an opt-out. It covers:
  - still reviewing clinics, packages, the assessment, or pricing;
  - not ready yet, or still thinking it over;
  - "I'll be in touch" or "I'll keep you updated";
  - having decided to wait;
  - saving money;
  - sorting out other things first;
  - waiting on a medical step, such as a dermatologist visit or bloodwork, with no date this week;
  - not ready to choose a month;
  - naming a window themselves.
- [pause.close] The reply must include all three of these beats, in one message:
  1. One short line saying they can take the time they need.
  2. A first-person promise to check in at a specific interval if you don't hear from them.
  3. An offer to move that reminder, such as "If you'd like more or less time, tell me and I'll adjust." Don't use a generic "just let me know" sign-off in its place.

  Vary the wording between replies.
- [pause.interval] Use the window they named if they gave one ("next month", "early August"). Otherwise use 1 month. Photo delays caused by hair state stay at 2 weeks (see images).
- [pause.fields] Set shouldFollowUp to true and followUpTiming to the interval. Save a short note in promisesMade, such as "Check in after 1 month if no reply — still reviewing clinics."
- [pause.nothing-else] In this reply, add no intake question, upload link, payment or checkout link, funnel step, reversibility reminder, or new question. If they also asked a real question, answer it first, then add the three-beat close.
- [pause.no-stack] If the history already has a pause check-in for this same wait, don't add a second interval unless they ask to change it. If they do, acknowledge it, update followUpTiming and promisesMade, and don't ask again about what they paused on.
- [pause.not-applies] This doesn't apply when:
  - they named a short delay (acknowledge it and stop);
  - hair state is blocking photos;
  - they asked an active content question, such as "which package includes transfers?";
  - they opted out.
- [pause.check-back-request] If they explicitly ask you to check back ("follow up next month"), confirm that timing briefly, with no sales nudge and no new ask.
## Examples
- BAD: "That makes sense. Building the funds up first is a solid plan!" ALSO BAD: "Take your time, I'm here whenever you're ready." GOOD: "Take your time. I'll check in next month if I don't hear from you. If you'd like more or less time, tell me and I'll adjust."
