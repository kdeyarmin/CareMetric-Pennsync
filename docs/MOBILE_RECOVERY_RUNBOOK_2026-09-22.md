# Mobile recovery runbook — 2026-09-22

What is live on both stores, where its source is and is not, and exactly what the
owner has to do — ordered by what cannot wait. Every claim below was measured on
2026-09-22 unless it says otherwise; nothing was changed in either store.

Nothing in this runbook can be done from a repository. Every action is in an
account only the owner holds: App Store Connect, the Apple Developer portal, or
Google Play Console.

## 1. What is live

| | iOS | Android |
| --- | --- | --- |
| Listing | "CareMetric AI" | "CareMetric AI" |
| Identity | App ID `6757097720`, bundle `com.caremetric.ai` | package **`com.caremetic.ai`** — the misspelling is the real one; `com.caremetric.ai` is a 404 on Play |
| Owner shown | Kevin Deyarmin | Kevin Deyarmin |
| Last updated | not published on the listing | **Jan 15, 2026** |
| Minimum OS | **iOS 15.6** | — |
| Monetisation | free, **four in-app purchases**: Monthly Premium Access $29.99, Quarterly Premium $79.99, Semi Annual Premium $149.99, Annual Premium $264.99 | — |
| Installs | — | 10+ |

## 2. Where the source is — and is not

**Neither live binary was built from any repository this work could reach.**

- **This repository.** Full history — 4,338 commits across 175 branches back to
  2025-12-01 — contains no `android/`, Gradle file, manifest, keystore,
  `assetlinks.json`, TWA manifest or Bubblewrap config. A first search reported
  the same thing from a shallow clone holding only 100 commits and six days of
  history; that was not evidence, and the full history was fetched before
  concluding.
- **`CM-Go`, `CMbackup`, `App-Studio`.** Full history of each contains no Android
  file and never mentions `com.caremetic.ai`. More decisively, **all three were
  created after Jan 15, 2026** (Feb 14, Feb 6 and Mar 16), so none could have
  produced the live Android release. `CM-Go` is a separate, never-built Expo app
  (`ai.caremetric.go`, EAS project id still a placeholder).
- **This repository's `ios/` is not the live iOS app.** Two independent signals:
  it contains **no StoreKit** while the live app sells four subscriptions, and it
  targets **iOS 15.0** while the live app requires **15.6**. It is a replacement
  candidate, not the source of what users have installed.

The repository's own 2026-07-02 readiness audit names the Play route as a
**Trusted Web Activity built with PWABuilder / Bubblewrap**. That fits every
finding above: PWABuilder generates the Android package in a browser and hands
back a zip containing the app bundle **and its signing key** — so there is no
Android source to find, and the thing to find is that zip.

## 3. Do today — live problems that need no key and no new binary

### 3.1 Google Play's Data Safety declaration is false

The live listing declares **"No data collected"** and **"No data shared with third
parties"**. The app collects account data and clinical data, and sends data to
model and telecom providers. An inaccurate Data Safety declaration is a Play
policy violation that can lead to enforcement against the listing.

**Fix:** Play Console → *App content* → *Data safety*. This is a form, not a
release: it needs no signing key and no new binary, so it is not blocked by
anything else in this runbook. It was first recorded as wrong on 2026-09-04 and
is still wrong today.

### 3.2 Digital Asset Links is empty on both origins

`https://caremetricai.base44.app/.well-known/assetlinks.json` and
`https://app.caremetricai.com/.well-known/assetlinks.json` both return `200`,
`application/json`, body **`[]`**. A TWA verifies ownership of its origin
through this file; with it empty, a TWA falls back to showing a browser URL bar
over the entire app.

**Fix:** needs the app signing certificate's SHA-256 from Play Console →
*Setup* → *App integrity* (§4). Once known, the file belongs at
`public/.well-known/assetlinks.json` — note that the Base44 host is what serves
`[]` today, so the file also has to be served by whichever host serves the
origin.

## 4. The one check that decides whether Android can ever be updated

Play Console → *Setup* → *App integrity*. **Is Play App Signing enabled?**

- **Yes.** Google holds the app signing key; you only ever need the *upload* key.
  If the upload key is lost, the same screen offers **Request upload key reset**
  — it is recoverable, and this is the good outcome.
- **No.** The app signing key is whatever signed the Jan 15 upload, and only you
  hold it. For a PWABuilder build that is `signing.keystore` beside
  `signing-key-info.txt` (which holds the alias and passwords), inside the zip
  PWABuilder produced. Search Downloads, email attachments and cloud drives for
  `signing-key-info.txt`. **If that key is gone, the app can never be updated** —
  a new package name and a new listing would be the only path, and existing
  installs would not move.

Either way, *App integrity* shows the **app signing certificate SHA-256**. That
value is what §3.2 needs, and it is how to confirm a recovered keystore is the
right one rather than a lookalike:

```sh
keytool -list -v -keystore signing.keystore   # compare SHA256 with App integrity
```

Do not generate a new key to "try it". A key that does not match cannot sign an
update, and uploading under a new package abandons every existing install.

## 5. iOS is easier than the plan says — and has its own trap

### 5.1 Certificates are not the continuity risk on iOS

The go-live plan records, for both platforms, *"must be recovered, never
regenerated — a new key means users cannot update."* **That is true of Android's
app signing key and not true of iOS.** iOS distribution certificates and
provisioning profiles expire every year and are routinely revoked and reissued;
updates keep working. What preserves update continuity on iOS is the **App Store
Connect app record (`6757097720`) and bundle ID (`com.caremetric.ai`) remaining
in the same developer team.**

So iOS "recovery" means **signing into the Apple Developer account that owns app
`6757097720`** — nothing more. With `CODE_SIGN_STYLE: Automatic` (as in
`ios/project.yml`), Xcode issues the certificate and profile itself.

A strong lead on which account: `CM-Go`'s `eas.json` records Apple team
**`JC83GT8MG8`** for `kdeyarmin@comcast.net`, and the live app's seller is also
Kevin Deyarmin. An individual developer membership has exactly one team. Confirm
at developer.apple.com → *Membership details* → *Team ID*, and that App Store
Connect lists app `6757097720` under that sign-in. A Team ID is not a secret — it
is embedded in every signed binary.

### 5.2 Do not ship this repository's `ios/` over the live app

The shell has no StoreKit. Submitting it as an update to `6757097720` would
**remove purchase and restore for current paying subscribers** of four live
products, and would lower the minimum OS the live app declares. Before it can
replace the live binary it needs StoreKit 2 purchase, restore, and a server-side
entitlement check — which is Stage L's IAP row, and why that row says *"and
today"*.

If the live app's own source can be found (§6), prefer it: it already has a
working purchase path.

## 6. Where to look for what was not found

Both live binaries predate or coincide with the start of this repository and were
built somewhere else. In rough order of likelihood:

1. **PWABuilder output zips** (Android, and possibly iOS — PWABuilder also
   produces an iOS package). Search for `signing-key-info.txt`,
   `signing.keystore`, `*.aab`, and any folder named after the app.
2. **Base44's own app-store publishing**, if it was used. If Base44 built and
   published either binary, Base44 may hold the build pipeline or the Android
   key — which matters directly, because this migration leaves Base44. Check the
   Base44 dashboard for a native / app-store publishing section on the
   CareMetric app.
3. **A hosted wrapper service** (Median/GoNative, AppMySite and similar). These
   offer in-app purchase plugins, which would explain an IAP-capable iOS binary
   with no StoreKit in any repository. Check billing history for such a service.
4. **Play Console → *App bundle explorer*** and **App Store Connect → *TestFlight
   / build history*** list every uploaded build with its version and upload
   date. They will not hand back source, but they tell you which tool's version
   scheme and dates to look for.

## 7. Why this blocks the Base44 exit, not just the stores

Moving the frontend off `caremetricai.base44.app` (Stages J and L) changes the
origin both apps load:

- **This repository's iOS shell** hard-codes `appURL =
  https://caremetricai.base44.app/` and restricts navigation with
  `WKAppBoundDomains` = `base44.app`, `base44.com`. Changing either needs an App
  Store update.
- **A TWA** bakes its start URL into the app bundle and verifies against
  `assetlinks.json` on that origin. Changing origin needs a new bundle **signed
  with the original key**.

The live binaries' own configuration is unknown, since their source was not
found — but a TWA points at a web origin by definition. So **both signing paths
have to be recovered before the frontend moves**, or the apps break at cutover
and cannot be fixed afterwards. That makes §4 the longest pole in the exit, not
a Stage L formality.

## 8. What this could not do

It had no access to App Store Connect, the Apple Developer portal or Google Play
Console, so it did not read a signing certificate, confirm Play App Signing
enrollment, retrieve a binary, or change a declaration. Every store fact above is
from the public listings; every source fact is from full git history.
