# Telnyx 10DLC Campaign Registration — CareMetric AI (Test/Demo)

> Copy-paste sheet for the Telnyx **Campaign** registration form.
> Scope: **test/demo site only** — `https://caremetric.ai`. Use as the template
> for each production practice (each practice gets its own number + campaign).
> Brand is already **VETTED** (Telnyx + external org).

---

## 1. Use case (recommended)

**Mixed** — the program spans more than one message category (appointment
reminders + confirmations + care follow-ups + assessment requests + Rx refill
reminders + health notifications). If Telnyx shows a separate **Low Volume
Mixed** option and this is a demo with low traffic, that is also acceptable.

---

## 2. Website / Content URL

```
https://caremetric.ai
```

---

## 3. Campaign description

```
CareMetric AI is a HIPAA-compliant electronic health record (EHR) platform for healthcare practices. This campaign sends transactional and informational SMS messages to patients who have provided explicit written consent through the EHR patient intake process. Messages include appointment reminders, appointment confirmations, care follow-up notifications, assessment completion requests, prescription refill reminders, and health-related notifications from their healthcare provider. All messages are sent on behalf of the patient's healthcare practice. No marketing or promotional content is sent. Website: https://caremetric.ai  Security & Compliance: https://caremetric.ai/security  The brand has been vetted by Telnyx and by an outside organization.
```

---

## 4. Message flow / Call-to-action (how patients opt in)

```
Patients opt in to SMS notifications through two methods:

1. DIGITAL CONSENT (Web Form): During patient registration in the CareMetric AI EHR platform or through the patient self-registration portal, the patient is presented with an explicit, unchecked-by-default SMS consent checkbox and full disclosure statement. The form displays a mobile phone number field and a separate, standalone SMS consent checkbox (not bundled with other consents or terms). The checkbox is labeled with the full consent disclosure: "I consent to receive automated text messages from [Practice Name] regarding appointment reminders, care follow-ups, assessment requests, and health-related notifications. Message frequency varies. Message and data rates may apply. Consent is not a condition of receiving care. Reply STOP to unsubscribe at any time. Reply HELP for assistance. Your mobile information will not be shared with third parties for promotional or marketing purposes. View our Privacy Policy at https://caremetric.ai/privacy-policy." The patient must affirmatively check the box to opt in. The consent event is logged with timestamp, the exact disclosure text shown, and the identity of the staff member or patient who recorded it. Screenshots of the digital opt-in form are available at https://caremetric.ai/security in the 10DLC SMS Campaign Registration section.

2. VERBAL CONSENT (In-Office): During office visits, staff reads the following literal script to the patient: "Hi [Patient Name], my name is [Staff Name] from [Practice Name]. We would like to send you text message reminders and notifications about your healthcare. These messages may include appointment reminders, confirmations, care follow-up notifications, and health-related messages from your provider. Message frequency may vary. Standard message and data rates may apply. Your mobile information will not be shared with third parties for promotional or marketing purposes. Consent is not required as a condition of receiving care. You may opt out at any time by replying STOP to any message. Reply HELP for assistance. Our privacy policy is available at https://caremetric.ai/privacy-policy. Do you consent to receive SMS notifications from [Practice Name]?" If the patient says yes, a confirmation SMS is sent: "CareMetric AI: Thanks for subscribing to healthcare notifications from your provider! Reply HELP for help. Message frequency varies. Msg&data rates may apply. Consent is not a condition of receiving care. Reply STOP to opt out." If the patient declines, no messages are sent.

Consent status is stored in the patient's electronic health record, visible in their chart, and can be revoked at any time by replying STOP, through the patient portal, or by contacting the practice directly.
```

---

## 5. Keywords & responses

### Opt-in
**Keywords**
```
START, YES
```
**Opt-in / confirmation message** (recommended version, includes the "not a condition of care" line)
```
CareMetric AI: Thanks for subscribing to healthcare notifications from your provider! Reply HELP for help. Message frequency varies. Msg&data rates may apply. Consent is not a condition of receiving care. Reply STOP to opt out.
```

### Opt-out
**Keywords**
```
STOP, UNSUBSCRIBE
```
**Opt-out message**
```
CareMetric AI: You are unsubscribed and will receive no further messages. Contact your healthcare provider directly for appointment information.
```

### Help
**Keywords**
```
HELP
```
**Help message**
```
CareMetric AI: For help, contact your healthcare provider or reach us at support@caremetricai.com or visit https://caremetric.ai. Reply STOP to unsubscribe. Msg&data rates may apply.
```

> Screenshot for all three auto-responses:
> https://www.dropbox.com/scl/fi/cr1m1ifygidy9imk53uca/sample-sms.png?rlkey=mpz0gi8gak3xvhsxw9sza1d34&st=zz0a70ge&dl=0

---

## 6. Sample messages (5 distinct)

```
1) Reminder: You have an appointment with Dr. Smith tomorrow, March 15 at 2:00 PM. Reply STOP to opt out.
```
```
2) Confirmation: Your appointment with Dr. Smith on March 15 at 2:00 PM is confirmed. Reply STOP to opt out.
```
```
3) Your provider has requested you complete a health assessment. Please log in to your patient portal to complete it. Reply STOP to opt out.
```
```
4) This is a follow-up from your recent visit. Please contact our office if you have questions about your care plan. Reply STOP to opt out.
```
```
5) Prescription refill reminder: It's time to refill your prescription. Please contact your pharmacy or provider with questions. Reply STOP to opt out.
```

> Note: your original list repeated the assessment message twice. I removed the
> duplicate and added a **confirmation** (#2) and a **Rx refill** (#5) sample so
> every message type named in the description is represented. Keep or drop these
> two as you prefer.

---

## 7. Compliance links

| Field | URL |
|---|---|
| Privacy Policy | `https://caremetric.ai/privacy-policy` |
| Terms & Conditions | `https://caremetric.ai/terms` |
| Login (optional) | `https://caremetric.ai/login` |

---

## 8. Campaign & content attributes

| Attribute | Answer | Why |
|---|---|---|
| **Embedded Link** | **Yes** | Messages/auto-responses contain `https://caremetric.ai` and portal links. |
| **Embedded Phone Number** | **No** | No phone numbers appear in the messages (Help directs to email/website). Set **Yes** only if a practice's messages will include a callable number. |
| **Number Pooling** | **No** | Each practice uses its own dedicated number (one number per campaign). |
| **Age-Gated Content** | **No** | No age-restricted content. |
| **Direct Lending or Loan Arrangement** | **No** | Healthcare notifications only; no lending. |

---

## 9. Webhook

```
https://ubbtgcaosuebrlwcvihw.supabase.co/functions/v1/twilio-sms-webhook
```
Where provisioning status updates for the campaign and assigned numbers are
delivered if the primary webhook fails.

---

## ⚠️ Two things to double-check before you submit

1. **Webhook function name.** The URL above ends in `twilio-sms-webhook`, but
   this app's Telnyx integration uses a Supabase function for status events.
   Confirm `twilio-sms-webhook` is the correct/intended endpoint for Telnyx
   provisioning callbacks (not a leftover from the old Twilio setup).
2. **Support email domain.** The Help message uses `support@caremetricai.com`
   while every other URL uses the `caremetric.ai` domain. Verify the email
   address is correct (e.g., `support@caremetric.ai`) so reviewers don't flag a
   domain mismatch.
```
