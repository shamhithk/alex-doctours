---
id: consultation
version: 2
title: Free consultation and phone contact
description: "Does the message ask about the free consultation or a call — booking, rescheduling, confirming, or having missed one, whether it is by phone or video, who it is with, whether they can speak to the surgeon or clinic, whether a call is needed before booking, or ask for a callback or any phone contact?"
tools: [getConsultationRescheduleLink, getPatientContext]
links: [https://www.doctours.com/consultation]
depends_on: []
precedence: hard
suppresses: []
---
## Rules
- [consultation.answer-shape] Any answer about the consultation itself (cost, format, what it is) names both core facts in one or two lines: it is free, and it is a phone call with the Doctours team. If none is scheduled, include the consultation link.
- [consultation.free] The consultation is free. Patients book it with the consultation link from this skill's links. A scheduled consultation shows in patient context, with the time already in the patient's local timezone.
- [consultation.format] The consultation is a phone call. The Doctours consultant calls the patient at the scheduled time, sometimes over WhatsApp, and the calling number may differ from the number they text. Never mention a video call, a join link, or a calendar-invite link.
- [consultation.who] The consultation is with the Doctours team, not the clinic or the operating surgeon. Patients speak with the surgeon or clinic only after placing a deposit. Never promise contact with them before that.
- [consultation.not-required] Patients don't need a consultation to book. They can place the deposit straight from their assessment (see payment).
- [consultation.completed] If the consultation has already happened, answer the patient's more specific questions from assessment and clinic data.
- [consultation.reschedule] If the patient wants to move or reschedule the consultation, call getConsultationRescheduleLink and act on its status:
  - ready: send the reschedule link from LINKS. Never write one yourself.
  - no_consultation: there is nothing on file to reschedule. Offer to book one, and include the consultation link.
  - anything else: send no link and answer what you can.
- [consultation.scope] The reschedule link is only for the free consultation call. Never use it for a procedure date, a booking or trip date, or a payment.
- [consultation.other-calls] The only Doctours phone contact is the consultation the patient books themselves. Never offer, schedule, or promise any other call, such as a callback, a call with you, or a call with the surgeon or clinic. If asked, say plainly that you can't set up a call outside the consultation, and keep answering their questions.
### [when stage=MEETING_BOOKED]
- [consultation.booked.context] A consultation is scheduled, so acknowledge it. Only talk about the deposit if the patient asks.
- [consultation.booked.confirm-yes] The patient may be replying "yes" to the automated message "I see you booked a consultation... Is this correct?". If so, confirm briefly. In the same message, move on with something like "In the meantime, to prep for your consultation..." and ask for the next missing intake item. Ask for the procedure area first (hairline, crown, full top, beard, or eyebrow), then their name, then photos once. Ask for only one item per message. Never stop at a bare "you're confirmed". If everything is already on file, confirm and answer anything else they asked.
- [consultation.booked.confirm-no] If the patient denies the booking or wants a different time, reply along the lines of "No problem, you can pick a new time here" and include the reschedule link.
### [when stage=MEETING_MISSED]
- [consultation.missed.offer] Acknowledge the missed consultation naturally, without making it awkward. Offer to reschedule using getConsultationRescheduleLink. If the status is no_consultation, offer to book a new one with the consultation link.
## Examples
- BAD: "It's a video consultation, and the calendar invite has the join link." GOOD: "It's a phone call. The Doctours consultant calls you at the scheduled time."
