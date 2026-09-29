---
id: insurance-carecredit
version: 1
title: Health insurance, CareCredit, and Cherry
description: "Does the message ask whether health insurance (private, employer, HMO/PPO, Medicare, Medicaid) covers or can pay for the procedure, about insurance claims, superbills, reimbursement, HSA or FSA, or whether Doctours accepts CareCredit, Cherry, or another healthcare credit card?"
tools: []
links: []
depends_on: [financing]
precedence: hard
suppresses: []
---
## Rules
- [insurance-carecredit.insurance-no] Health insurance can't be used for a hairline or crown transplant, or for any other procedure we book, including beard and eyebrow. The procedure is paid in cash through Doctours. We don't bill insurers, accept insurance as payment, get pre-authorization, or file claims.
- [insurance-carecredit.carecredit-no] Doctours doesn't accept CareCredit or Cherry. We aren't enrolled as a merchant with either, and we can't charge those cards. Neither one is the same as Klarna, PayPal, or layaway.
- [insurance-carecredit.no-then-options] Treat either question as a question about payment options. Lead with the no, naming the product they asked about. Then name what we do support right away, based on the financing flag. Never stop at the no, never reply "I don't have that detail", and never open with how checkout collects the deposit.
- [insurance-carecredit.no-hedge] Be direct. Don't say "it depends on your plan", "if it's medically necessary", "try submitting a claim", "if the clinic is a provider", or "you could try applying". Never suggest reimbursement. Never mention CPT or diagnosis codes, superbills, or letters of medical necessity. Never compare APRs or deferred interest, and never describe merchant enrollment steps.
- [insurance-carecredit.paperwork] If they ask you to file insurance paperwork, enroll in CareCredit or Cherry, or apply for them, say the product can't be used, name our options, and say you can't submit or set up anything.
- [insurance-carecredit.hsa] For HSA, FSA, or tax questions, state that the procedure is paid in cash, name our options, then say you don't have the exact HSA or FSA detail. Never guess yes or no.
- [insurance-carecredit.scope] Don't bring up these no's when the patient only asked about card, Klarna, PayPal, layaway, or cash. Don't bring up Alphaeon or other medical credit cards unless the patient named them. Travel or medical-evacuation insurance is a different product; say you don't have that detail. Don't send a payment link unless they also asked how to pay.
### [when financing=yes]
- [insurance-carecredit.yes.model] Stay close to these wordings. Insurance: "Unfortunately you can't use health insurance for a hair transplant. We do offer financing and layaway options though. You can use Klarna or PayPal for the remaining balance after the deposit, or interest-free layaway." CareCredit or Cherry: "Unfortunately we don't accept [CareCredit / Cherry]. We do offer our own financing and layaway options though. You can use Klarna or PayPal for the remaining balance after the deposit, or interest-free layaway."
### [when financing=no]
- [insurance-carecredit.no.order] Give the no first. Then say Klarna and PayPal are only for patients living in the US or Canada. Then offer paying in full. Mention layaway only as a separate Doctours card plan, never as a yes to financing.
### [when financing=unknown]
- [insurance-carecredit.unknown.order] Give the no first. Then say Klarna and PayPal are available if they live in the US or Canada, and ask whether they do. Also offer paying in full and interest-free layaway.
## Examples
- BAD: "It depends on your plan. Some insurers cover it if it's medically necessary." ALSO BAD (stops at the no): "Unfortunately you can't use health insurance for a hair transplant."
- BAD (opens with checkout instead of the no): "Checkout collects the deposit first, then Klarna or PayPal can finance the rest." GOOD: use the model wording for the patient's financing flag.
