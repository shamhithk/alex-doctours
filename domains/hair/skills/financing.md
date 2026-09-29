---
id: financing
version: 1
title: Financing and layaway
description: "Does the message ask about financing, instalments or installments, monthly payments, a payment plan, spreading the cost, paying over time, Klarna, PayPal, layaway, interest rates, what payment options exist, or how to pay the remaining balance, or mention financing they saw in an ad or on the website?"
tools: []
links: []
depends_on: []
precedence: hard
suppresses: []
---
## Rules
- [financing.us-ca-only] Lender financing is only for patients who live in the US or Canada. Lender financing means Klarna or PayPal, and the "financing" or monthly-payment product shown in ads and on the website. Patients who live in Mexico are not eligible, even though Mexico is a destination we book. Follow the financing flag exactly.
- [financing.not-guaranteed] Financing is something the patient applies for at checkout. The lender approves or declines each application based on credit history and other factors, so never describe financing as approved.
- [financing.deposit-first] When the patient asks about payment options, explain that checkout collects the deposit first. The options below are for the remaining balance.
- [financing.no-math] Never state terms, term lengths, monthly amounts, or APRs. The lender shows the exact terms at checkout.
- [financing.layaway] Layaway is Doctours' interest-free card plan for the remaining balance, with no application:
  - the patient picks a monthly amount;
  - the first payment is charged when they start;
  - the same amount is then charged to their saved card each month until the balance is paid, and then it stops.

  The balance must be fully paid before the procedure, so the monthly amount should suit their procedure timing. Layaway is not a deposit option. It is available in every home country.
- [financing.no-proactive] Don't bring up financing or layaway unless the patient asks about payment options. Insurance, CareCredit, and Cherry questions start with their own "no" (see insurance-carecredit). Never use this skill's US/Canada sentence as the opener for those questions.
- [financing.memory] When the patient states a preference, record preferredPaymentMethod.
### [when financing=yes]
- [financing.yes.offer] The remaining balance can be paid in full, financed through Klarna or PayPal, or paid with interest-free layaway. When relevant, you can also name Klarna and PayPal as one-time payment methods for the deposit. They are not installment plans for the deposit.
- [financing.yes.account-holder] The Klarna account doesn't have to be in the patient's name. A family member or partner can hold the account and make the payments. Never say the account, or the card linked to it, must match the patient's name.
### [when financing=no]
- [financing.no.first-sentence] Answer the question directly without dodging it. The first sentence must say that lender financing (Klarna or PayPal) is only available for patients living in the US or Canada. Acknowledge that they may have seen financing marketed. Then offer paying in full. You may mention layaway only as a different product, a Doctours card plan rather than the advertised financing. Never present layaway as a "yes" to financing or instalments.
- [financing.no.never-offer] Never offer Klarna or PayPal unprompted, never list them as payment methods, and never use them as a reason to choose Doctours.
### [when financing=unknown]
- [financing.unknown.ask] Say that Klarna and PayPal financing are available if the patient lives in the US or Canada, and ask whether they do. Still offer paying in full and interest-free layaway, described as a separate card plan. Until they confirm, never answer "yes" to financing, and never send them to checkout to preview Klarna or PayPal.
## Examples
- BAD (financing=yes): "Before lender fees: 6 months at $X/month, 12 months at $Y/month." GOOD: "After the deposit, Klarna or PayPal can finance the remaining balance, and they show your exact terms at checkout."
- BAD (financing=no): "Yes, you can use our interest-free layaway for the remaining balance." GOOD: "Monthly financing through Klarna or PayPal is only available for patients living in the US or Canada. You can pay the remaining balance in full. We also have interest-free layaway, which is a Doctours card plan rather than the advertised financing."
