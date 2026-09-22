# Google Play Data Safety — draft answers, 2026-09-22

For `com.caremetic.ai`. **The live declaration — "No data collected", "No data
shared with third parties" — is wrong** (see
[the mobile recovery runbook](MOBILE_RECOVERY_RUNBOOK_2026-09-22.md) §3.1).
This drafts replacement answers from what the code does, with the evidence for
each. It is not legal advice: the owner submits the form and owns every answer,
and the items marked **Decide** need a judgment only the owner can make.

The Android app is a Trusted Web Activity over the web app, so what the web app
and its backend collect is what the Android app collects.

## Section 1 — Data collection and security

| Question | Answer | Basis |
| --- | --- | --- |
| Does your app collect or share any of the required user data types? | **Yes** | everything in §2 |
| Is all user data collected by your app encrypted in transit? | **Yes** | the app loads only `https://` origins; the iOS shell declares system TLS only |
| Do you provide a way for users to request that their data be deleted? | **Decide** — answer *Yes* only if a working path exists | the listing already says *Yes*. Apple Guideline 5.1.1(v) separately requires in-app account deletion; the repository's audits list it as open |

## Section 2 — Data types

"Collected" means sent off the device. **Required** means the app cannot do its
job without it; **optional** means the user can choose not to provide it.

### Collected today — declare these

| Play category | Type | Required? | Purposes | Evidence |
| --- | --- | --- | --- | --- |
| Health and fitness | **Health info** | Required | App functionality | the product's core: patient charts, diagnoses, medications, OASIS assessments, visit notes |
| Personal info | **Name** | Required | App functionality, Account management | staff users and patients |
| Personal info | **Email address** | Required | App functionality, Account management, Developer communications | sign-in; invitation and account emails |
| Personal info | **User IDs** | Required | App functionality, Account management | account identifiers |
| Personal info | **Address** | Required | App functionality | patient home addresses for home-health visits |
| Personal info | **Phone number** | Required | App functionality | patient, physician and staff phone fields |
| Personal info | **Other info** | Required | App functionality | `Patient.date_of_birth`; Medicare identifiers (`AdrAuditCase.medicare_number`, `OASISFeedback.extracted_medicare_id`) |
| Audio | **Voice or sound recordings** | Optional | App functionality | visit audio recording (`VisitAudioRecorder.jsx`, `AudioRecorder.jsx`), transcribed by OpenAI Whisper. `transcribeAudioWithWhisper`, `transcribeAndGenerateSOAPNote` and `generateNoteFromRecording` are none of them paused at source, so this runs wherever the OpenAI key is configured — confirm it is in production |
| Files and docs | **Files and docs** | Optional | App functionality | uploaded referrals, documents and PDFs |
| App activity | **App interactions** | Required | Fraud prevention, security, and compliance | activity and security logs kept for audit (`UserActivity`, `SecurityLog`) |

### Not collected — measured, so answer No

| Type | Why not |
| --- | --- |
| Location (approximate or precise) | no geolocation API anywhere in `src/`. Patient addresses are typed in, which is *Address* above, not device location |
| Race and ethnicity | no schema field in 253 entities, and the OASIS module implements none of the race/ethnicity items (A1005, A1010, M0140) |
| Contacts | no device address-book access; fax contacts are typed in |
| Calendar events | no device calendar access; visit scheduling is the app's own data |
| Web browsing history | none |
| Crash logs / analytics | no analytics, telemetry or crash-reporting SDK in the frontend, and the Base44 SDK's own analytics is explicitly disabled in `src/api/base44Client.js` |

### Decide — depends on what is live, or on a judgment

| Type | The question | Evidence |
| --- | --- | --- |
| **Political or religious beliefs** | Declare as *optional* if you accept that incidental free text counts | the AI referral-extraction prompt asks for *"cultural or religious considerations affecting care"* (`src/components/referral/referralExtraction.js`), so it can be captured as free text. There is no structured religion field |
| **SMS or MMS**, **Other in-app messages** | Declare only if messaging is enabled in production | Telnyx messaging exists in code, but the go-live plan records messaging as paused by literal gates, and `dispatchScheduledSms`, `scheduleSms` and `redriveFailedSms` are paused at source |
| **Photos**, **Videos** | Declare only if camera fax or telehealth is enabled | camera fax is part of the fax domain (recorded as paused); telehealth's `createTelehealthToken` is paused at source |
| **Device or other IDs** | Decide whether stored IP addresses count | `SecurityLog.ip_address`, `TrainingAuditLog.ip_address` |
| **Purchase history** | Declare only if the app itself records purchases | purchases made through Google Play Billing are Google's to disclose, not yours |

## Section 3 — Sharing

Play does **not** count a transfer to a **service provider** that processes data
on your behalf as sharing. The app sends data to:

| Recipient | What | Evidence |
| --- | --- | --- |
| OpenAI | visit audio; clinical text | `api.openai.com` in backend functions (Whisper) |
| Anthropic | clinical text for AI features | `api.anthropic.com` |
| Base44 | everything — the hosting platform, including its built-in LLM, email and file integrations | the whole backend |
| Telnyx | phone numbers and message content, if messaging is live | `api.telnyx.com`, 18 references |
| HeyGen | training-video scripts for staff courses — no patient data | `api.heygen.com`, called only by `manageTrainingVideos` and `syncTrainingVideoStatuses` (the training domain) and an integration health check |

**Decide:** if every recipient processes data only on your behalf, under a
contract — and for health data, under a **Business Associate Agreement** — then
*"Shared: No"* is defensible for each type. If any recipient may use the data for
its own purposes (for example, to train models), that type is **Shared** with
that recipient. This turns on each vendor's contract, which the repository cannot
see. A missing BAA for a recipient of health data is a HIPAA question well
beyond this form.

## What this cannot do

It reads the code, not the production configuration. Where a feature's live
state decides an answer, it is marked **Decide** rather than guessed.
