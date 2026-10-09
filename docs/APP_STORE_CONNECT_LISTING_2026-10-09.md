# App Store Connect changes — 2026-10-09

What the owner does in App Store Connect for the 1.1.0 submission of Apple ID
6757097720 (bundle `com.caremetric.ai`). Nothing here can be done from this
repository: no App Store Connect API key exists in it or in its CI secrets. The
release audit's items B1, B3 and B7 are the reasons; this page is the steps.

## 1. Retire the four in-app purchases (B1)

The 1.1.0 binary has no StoreKit and the web app has no purchase screen. The
owner decided on 2026-10-08 that there are no subscriptions.

1. **Sales and Trends → Subscriptions:** note how many active subscribers each
   product has. The number decides step 3.
2. **Apps → CareMetric AI → Monetization → Subscriptions:** open each of
   Monthly Premium ($29.99), Quarterly Premium ($79.99), Semi Annual Premium
   ($149.99) and Annual Premium ($264.99) and choose **Remove from Sale**.
3. If anyone is still subscribed: removing from sale stops new purchases.
   Reports conflict on whether existing subscriptions keep renewing ([Apple
   forum: availability set to none](https://developer.apple.com/forums/thread/779909),
   [Apple forum: sunsetting a subscription](https://developer.apple.com/forums/thread/842508)).
   Plan for both: tell those subscribers that access comes from their agency,
   and ask Apple Developer Support how to stop their renewals.
4. In **App Review Information → Notes**, use the text in section 4.

## 2. Make the store name match the device (B3)

The device shows **PennSync** (`CFBundleDisplayName`); the listing says
**CareMetric AI**. The new name keeps both, which is how the app already
brands its reports ("PennSync by CareMetric AI Report").

**App Information** (editable once version 1.1.0 is created):

| Field | Text | Length |
| --- | --- | --- |
| Name | `PennSync by CareMetric AI` | 25 / 30 |
| Subtitle | `Home health clinical workflow` | 29 / 30 |

The listing icon comes from the uploaded binary. The 1.1.0 binary carries the
full-bleed PennSync icon committed on 2026-10-09, so the store icon changes
when that build is selected. No separate upload is needed.

Already done outside App Store Connect on 2026-10-09: the Base44 app is renamed
**PennSync** and its logo is the same icon, so the hosted fallback sign-in page
no longer says "Welcome to CareMetric AI". The logo reaches the published app at
its next publish.

## 3. Version 1.1.0 text (B4, B7)

**Promotional text** (133 / 170):

```
Document visits, complete OASIS, manage care plans and collect signatures in one secure workspace built for home health agency staff.
```

**Keywords** (95 / 100):

```
home health,OASIS,nurse,clinician,visit notes,charting,care plan,hospice,e-signature,fax,agency
```

**Description.** Replaces the old one, which advertised "Predictive Analytics"
(removed) and linked a EULA that opens the sign-in screen. Leave the EULA link
out so Apple's standard EULA applies.

```
PennSync by CareMetric AI is the clinical workspace for home health agency staff. Clinicians and office teams use it to document visits, complete OASIS assessments, coordinate care and keep the chart current from the field.

PennSync is for staff of agencies that use it. You sign in with an account issued by your agency. There is nothing to buy in the app.

DOCUMENT VISITS
• SmartNote: write or dictate visit notes, with AI-assisted drafts that a clinician reviews before anything reaches the chart
• Record visit audio and turn it into a narrative or SOAP note
• Clinical phrase library and documentation checks

OASIS CENTER
• Complete, review and audit OASIS assessments
• Scoring and consistency review before submission
• Outcome measures

PATIENTS AND CARE
• Patient charts, visit schedule and care-team assignments
• Care plans and clinical pathways
• Incident reporting

COMMUNICATE
• Secure messages within your agency
• Telehealth visits with patients
• Call and text patients from the chart through your agency's line, with texting consent recorded
• Send and receive faxes, including referral faxes
• Electronic signatures, in person or by secure link

FOR ADMINISTRATORS
• Staff roster, credentials, time off and training
• Productivity, quality and compliance dashboards
• Reports and PDF exports

PRIVACY AND SECURITY
• You see only your agency's records, and clinical records only for patients on your care team
• Automatic sign-out after 15 minutes of inactivity
• AI-assisted features send what you submit (text, documents or audio) to third-party AI providers to produce a result. The app says so and asks you to agree before first use. AI output is a draft for a clinician to review.

Questions: support@caremetric.ai
```

**URLs:** Privacy Policy `https://app.caremetricai.com/privacy`. Remove the
`caremetricai.base44.app/eula` link wherever it appears.

**Screenshots:** the binary is universal and the listing has no iPad
screenshots. Add 13-inch iPad screenshots, or make the app iPhone-only (B7).

## 4. App Review notes

Fill in the demo account. It must have an active membership in a synthetic
agency with non-PHI sample data, or the reviewer stops at "No clinical
workspace was opened" (B7).

```
PennSync is used only by staff of home health agencies. Accounts are issued by the agency: there is no self sign-up and nothing is sold in the app. The previous version's subscriptions have been removed from sale; agencies obtain access under an enterprise agreement (Guideline 3.1.3(c)).

Demo account: <email> / <password> (a synthetic agency with sample, non-patient data).

- The app signs out after 15 minutes of inactivity.
- Account deletion: Settings > Delete My Account.
- AI-assisted features show a disclosure naming the providers and require agreement before first use. Output is a draft that a clinician must review.
```
