# Hosting exit runbook — the origin, the custom domain, and the iPhone app

The ordered procedure for D3's second step, `complete_hosting_exit`: moving
`app.caremetricai.com` off Base44 and onto our own host, and getting the
installed iOS app onto the custom domain first so that the move does not strand
it. The decision is `docs/BASE44_EXIT_DECISIONS_2026-09-19.md` D3; the stage is
`docs/RAILWAY_GO_LIVE_PLAN_2026-09-21.md` Stage L, whose "native half" section
holds the App Store analysis this runbook does not repeat.

Everything in this file was measured on **2026-10-01 against `main` at
`a227446f`**, and every figure in it is a reading of one day rather than a
property. Each step names its own instrument; run the instrument.

## What is true today

| Thing | Reading |
| --- | --- |
| `app.caremetricai.com` | **A record → `216.24.57.1`**, TTL 1800. Not a CNAME. |
| `caremetricai.com` nameservers | `ns01.domaincontrol.com`, `ns02.domaincontrol.com` — DNS is at GoDaddy |
| Both origins' server chain | `server: cloudflare`, `via: 1.1 Caddy`, `x-render-origin-server: uvicorn` |
| Response headers | `referrer-policy`, `strict-transport-security: max-age=31536000`, `x-content-type-options: nosniff`, `x-frame-options: DENY` |
| `caremetricai.base44.app` only | `x-robots-tag: noindex, follow` and a `robots` meta; the custom domain is indexable |
| What **this repository's** iOS shell loads | `https://caremetricai.base44.app/` on `main`; `app.caremetricai.com` on the transitional branch |
| What the **installed** iOS app loads | **unknown, and not readable here** — see below |
| The live App Store build | version `1.0`, released 2026-01-05, **never updated**, minimum iOS 15.6 (`itunes.apple.com/lookup?id=6757097720`, read 2026-10-01) |

Instruments: `curl -sS -D - https://app.caremetricai.com/ -o /dev/null` and
`curl -H 'accept: application/dns-json'
'https://cloudflare-dns.com/dns-query?name=app.caremetricai.com&type=A'`.

**Not measured, and it matters:** the real TLS certificate issuer and expiry on
either origin. This container's outbound HTTPS is re-signed by an egress
gateway, so `openssl s_client` reports the gateway's certificate and not the
origin's. Read that from a normal network before relying on it.

## The installed iPhone app is not built from this repository

This is the single most consequential reading in this file, and it is not new
here: `docs/MOBILE_RECOVERY_RUNBOOK_2026-09-22.md` §2 established it on
2026-09-22 from two independent signals — this repository's `ios/` shell has no
StoreKit while the live app sells four subscriptions, and it targets iOS 15.0
while the live app requires 15.6. Both still hold: the store page lists all four
subscriptions today (`$29.99`, `$79.99`, `$149.99`, `$264.99`), and the minimum
is still 15.6.

Today's store read dates it. The live build is version `1.0`, released
**2026-01-05**, never updated. The earliest commit touching `ios/` anywhere is
**2026-07-02** — `091a4107`, "Add iOS shell: camera/mic Info.plist strings and
WKDownloadDelegate for blob exports" — six months after that release, and
`appURL` held the placeholder `pennsync.example.com` until `ae7e53ef` on
2026-07-03 pointed it at the Base44 subdomain. So no commit here produced what
people have installed.

**Read that history through the GitHub API, not a local clone.** A first version
of this section said the whole directory arrived in one commit on 2026-09-28,
which is this container's shallow boundary (`git rev-parse
--is-shallow-repository` is `true`, 128 commits, and `git log` names that
boundary as the earliest commit touching every path in the tree). The claim was
an artefact of clone depth that happened to support the right conclusion, which
is the worst way for a reading to be wrong.

Three things follow, and the third is the one that moves this runbook's order.

**What the installed app loads cannot be measured from here.** Not from `appURL`
at any commit, because no commit here is its source. Reading it needs the binary
or the account: installing the live app and watching its requests, or finding the
build artefact §6 of that runbook goes looking for. Both are outside this
container. One of those two was done on 2026-10-01: the owner read iOS's own
App Privacy Report on the installed app, which is recorded under "What each answer
to that question changes" below. That is still not a reading from here, and this
paragraph's claim about the container stands.

The public hints were tried on 2026-10-01 and none of them answers it, which is
itself worth recording so nobody tries again. Both app origins serve a real,
deliberately **empty** association file — `/.well-known/apple-app-site-association`
returns `{"applinks":{"apps":[],"details":[]}}` and `/.well-known/assetlinks.json`
returns `[]`, both as `application/json` and both distinguishable from the SPA
shell an invented path returns. So no app claims either domain: there are no
universal links, and nothing about the binary can be read from them. The
marketing site at `www.caremetricai.com` (the apex 301s to it) references
`app.caremetricai.com` and no Base44 host, which says what the product's own
front door uses and nothing about what the binary loads. The listing's support,
privacy and EULA URLs all name the Base44 subdomain, which is consistent with a
January build made against it and is not proof of one.

**Note a contradiction between two documents here.**
`docs/RAILWAY_GO_LIVE_PLAN_2026-09-21.md` states as fact that "Both apps load
`caremetricai.base44.app`", while §7 of the recovery runbook says the live
binaries' own configuration is unknown because their source was not found. The
runbook's version is the measured one; the plan's sentence is the one a reader
would act on, and it belongs to that page's next change.

**Which version people have *is* measurable, and it is all of them.** `1.0` is
the only version ever published, so there is no version spread to reason about.

**The store listing's own links point at the hostname being retired, and this one
is cheap to fix.** Read from the live product page on 2026-10-01: the privacy
policy in the app's privacy panel is `https://caremetricai.base44.app/privacypolicy`,
the developer Support link is `https://caremetricai.base44.app/support`, and the
EULA named in the app's own description is `https://caremetricai.base44.app/eula`.
All three are on the Base44 subdomain. Apple requires a working privacy-policy
URL, so retiring that hostname breaks the listing itself — independently of
anything the binary does. Changing them is **App Store Connect metadata**, which
needs no new binary and no StoreKit, so unlike step 8 it is not blocked. Two
pre-existing notes while they are being changed, measured the same day and not
caused by the move: `/privacypolicy` is a real route in this bundle
(`src/routes.jsx:226`, aliased three ways), `/support` is not — the only
redirect is `/Support` with a capital — and `/eula` is no route at all. All
three return the app shell on both origins today, because an unknown path does
too.

**Keeping the hostname resolving is a different claim from §7's remedy, and it
does not replace it.** §7 of the recovery runbook says that changing the origin
needs an App Store update on iOS and a new bundle signed with the original key on
Android, so **both signing paths have to be recovered before the frontend
moves**, "or the apps break at cutover and cannot be fixed afterwards". That is
about what makes it ever *possible* to change what the installed apps load.
Keeping `caremetricai.base44.app` resolving is about what stops them breaking
while that has not happened. Both hold; the second is not a cheaper substitute
for the first, and nothing here reduces §7's requirement, which the plan page
already carries as a Stage L row ahead of the frontend move.

Three refinements to §7 that this section's findings supply, offered to that
document rather than asserted here:

- **Its iOS bullet reasons from this repository's shell** ("hard-codes `appURL`
  … changing either needs an App Store update"), and §2 of the same document
  establishes that shell is not the live app. The iOS half therefore describes a
  binary nobody has installed.
- **"Cannot be fixed afterwards" is Android's**, the way "never regenerated" was
  in §5.1. Lose the Android upload key and the app can never be updated again;
  on iOS account access can be regained and a binary shipped later, so what
  cannot be undone there is the *window* in which users are broken, not the
  ability to fix it.
- **"The frontend moves" is two events here, not one.** Step 10 moves
  `app.caremetricai.com` and does not touch `caremetricai.base44.app`, which
  keeps resolving to Base44 until step 11 ends. So if the live app loads the
  Base44 subdomain, step 10 changes nothing for it; if it loads the custom
  domain, step 10 is the event, and our host must then serve what it needs —
  which is the `/login` precondition above. Which of the two strands it depends
  on the unknown this section opened with.

**So the transitional binary cannot be the protection for installed apps.** A
build from this tree must not be submitted over the live app at all: the recovery
runbook §5.2 records that it would remove purchase and restore for current paying
subscribers of four live products and lower the declared minimum OS. That is
Stage L's in-app-purchase row and it is a product decision, not a hosting one. So
what protects installed apps across the hosting move is **keeping
`caremetricai.base44.app` resolving** — step 11 below, which is therefore
load-bearing and open-ended rather than a tidy-up, and stays so until either the
live app is known to load the custom domain or a StoreKit-complete replacement is
live.

## What each answer to that question changes

**Answered on 2026-10-01, and it is the first branch: the installed app loads
`caremetricai.base44.app`.** The owner opened the installed app with iOS's App
Privacy Report switched on, and its "Domains contacted directly by app" list holds
three entries, one contact each at 18:12 local: `base44.app`,
`caremetricai.base44.app` and `qtrypzzcjebvfcihiynt.supabase.co`.
`app.caremetricai.com` is absent, and a wrapper that opened it would have put it
first. Three limits on that reading, since it is the evidence the order below now
rests on: it names domains rather than the page the wrapper opened, so the start
URL is a strong inference and not a direct reading; it is one launch on one phone
inside the report's own window; and it says nothing about the Android app. **So
everything under "If the installed app loads `caremetricai.base44.app`" below is
now the live branch, and the custom-domain branch is kept for the record rather
than planned around.**

The third domain is **Base44's own storage** and not ours: this repository's SSRF
allowlist names `qtrypzzcjebvfcihiynt.supabase.co` as a Base44 host
(`base44/functions/importProvidersCsv/entry.ts:154` and two siblings), its paths
sit in a `base44-prod` bucket, and the owned staging project is
`xxtyweswohkvgkprimwa.supabase.co` (`.env.example`). A build from this tree is
expected to contact it at launch, which is what put it on the closing list below.

Written out in advance so the answer needs no further reasoning when it arrives.
Base44's documentation settles the mechanism: the wrapper "automatically chooses
the main entry URL for your mobile app based on your published app" and there is
no per-app start page, so the installed binary opens whichever address was the
app's primary published one in January 2026. There are exactly two candidates and
each leads somewhere different below.

**One thing is true either way, and is not waiting on the answer.** Step 7b — the
listing's privacy-policy, Support and EULA URLs — is App Store Connect metadata,
needs no binary, and is blocked by nothing. It can be done before the answer
arrives.

### If the installed app loads `caremetricai.base44.app`

- **Step 10 changes nothing for it.** Moving the `app.caremetricai.com` record
  does not touch the Base44 subdomain, so every installed phone keeps working
  across the DNS move without any action.
- **Step 11 is indefinite rather than temporary.** That hostname has to keep
  resolving to Base44 for as long as installed copies are in use, and nothing in
  the hosting move brings that to an end. Its end condition is a replacement
  build being live *and* adopted, which is a product decision rather than a step
  here.
- **So the hosting exit completes with one Base44-served hostname still live**,
  and the Base44 plan cannot be closed by finishing this runbook. That is a
  consequence for the closing list at the end of this file, not a blocker for any
  step in it.
- **A replacement build's requirements split in two, and the split decides whose
  call each half is.** Restoring what Base44's wrapper already does is
  engineering: a shell that opens the primary address, camera and microphone,
  blob downloads, an app-bound domain list. `ios/` plus #399 is already that, and
  it is the half that needs no decision. The declared minimum OS belongs here too,
  not in the half below: this tree targets 15.0 against the live 15.6, and raising
  it back is the deployment target in `ios/project.yml`, declared there twice
  (`options.deploymentTarget.iOS` and the target's own `deploymentTarget`). Doing *more* than Base44's wrapper
  does is Kevin's, and it is one item — StoreKit purchase and restore, which
  Base44's documentation says it does not support at all ("the purchase has to
  happen on the web for now"). The recovery runbook's §5.2 blocker is that item.
- **Keep the purchase question out of this.** Whether anyone has ever bought a
  subscription inside the app is an App Store Connect sales reading, not
  something a phone or this repository can answer. It decides how much the
  StoreKit half matters; it does not decide whether step 10 can happen, and step
  10 does not wait on it.

### If the installed app loads `app.caremetricai.com`

- **Step 10 is the cutover for every installed phone.** The moment that record
  moves, installed apps load our host. Nothing else in this runbook has that
  property.
- **So step 10 inherits the whole sign-in precondition, and step 6 is its gate.**
  Our origin must serve authentication itself before the record moves: measured on
  2026-10-01, `/login` on the app origin is a Base44-served document rather than
  this bundle, and after step 10 that document is simply gone. The precondition
  covers more than `/login` — anything the wrapper navigates to in the main frame
  has to exist on our origin — so step 6's instrument is a floor and not the whole
  check.
- **Step 11 shortens from indefinite to a bounded window.** What still points at
  the Base44 subdomain is then links rather than apps: emailed links minted before
  step 7, and the listing URLs before step 7b. It has to keep resolving until
  those have aged out, which is a date rather than an open end.
- **No replacement binary is on the critical path at all.** #399 becomes
  housekeeping — it makes the repository's shell agree with what the live app
  already does — and step 8 stops being load-bearing in any form.

## Two facts that decide the order of everything below

**The custom domain already serves the same application.** `app.caremetricai.com`
and `caremetricai.base44.app` return the same build — byte-identical except for
three injected tags (`og:url`, `twitter:url`, `canonical`) and the `robots` meta.
So the native **source** can be moved onto the custom domain while Base44 is
still serving it, and a replacement binary built from this tree at any later date
needs no coordination with the hosting move. An earlier version of this paragraph
went one step further and said the hosting move therefore needs no App Store
release — which is true of a binary built from this tree and says nothing about
the one people have installed, since that was built somewhere else. The section
above is the correction; step 11 is what it costs.

**`/login` on both origins is a Base44 page, not our bundle.** Measured:
`app.caremetricai.com/login` returns a 17,441-byte document that is not the SPA
shell at all, and `src/lib/AuthContext.jsx:1193` guards on
`window.location.pathname === '/login'` while `navigateToLogin` hands off to
`base44.auth.redirectToLogin`. A host of ours would answer `/login` with the app
shell and sign-in would break.

So **our host can serve this origin only for a build whose authentication is
already independent** — which is exactly what D3 puts in step one, and is a hard
precondition rather than a preference. The instrument is one line:

```sh
curl -sS -o /dev/null -w '%{size_download}\n' https://app.caremetricai.com/login
curl -sS -o /dev/null -w '%{size_download}\n' https://app.caremetricai.com/
```

While those two differ, Base44 is still serving a page on this origin that we
do not build, and the DNS move would take it away.

## What serves the site from our side

`services/pennsync-site` — see its README. It is **paused unless
`PENNSYNC_SITE_RELEASED` reads exactly `enabled-v1`**, so it can be created,
deployed and watched long before it serves anybody.

Two deliberate parity gaps, recorded rather than closed:

- **The injected tags go away.** `index.html` in this repository carries no
  `og:url`, `twitter:url` or `canonical`; Base44 injects them per origin. Our
  host serves the build as committed, so those three tags disappear from the
  page. That is an SEO and link-preview change, not a functional one, and
  adding them is a frontend change with its own review rather than something
  this host should synthesise.
- **`x-robots-tag` goes away on the Base44 subdomain** only, which is Base44's
  header on its own hostname. The custom domain never had it.

## Who built it, and what that changes

Kevin answered on 2026-10-01, in his words: **"built only with base44"**. Base44's
own documentation then settles several things this file had been treating as
unknown, and unsettles one it had been treating as known.
`/mnt/project-files/base44-full-exit/base44-published-the-iphone-app-2026-10-01.md`
carries the quotations and sources; three consequences belong here.

**The wrapper opens whichever address is the app's primary published one.** Base44
"automatically chooses the main entry URL for your mobile app based on your
published app" and "you cannot currently select a different start page just for
the app" — the custom domain when one is configured, the default Base44 address
otherwise. So both origins remain possible for the January build and the
determinant is which was primary when it was generated. **If it is the custom
domain, step 10 is the event that reaches installed phones**, and the `/login`
precondition above applies to them as much as to a browser.

**Base44 publishes web changes to installed copies without a store submission**:
"When you publish most content and design changes in Base44, they also appear in
your app without sending a new version to the Apple App Store or Google Play."
That is how a web view behaves and it is why step 11 protects anybody at all.

**And the StoreKit blocker behind step 8 is in doubt.** §5.2 of the recovery
runbook holds that a build from this tree would remove purchase and restore from
paying subscribers of four live products. Base44's documentation says it does not
support store billing — "Apple and Google both require their own billing systems
for anything digital, and Base44 does not support them yet, so the purchase has to
happen on the web for now" — and this repository's subscriptions are Stripe, with
no Apple receipt verification anywhere in the tree. The listing showing four
products proves they are **configured** in the App Store record, not that the
binary can sell them. So step 8 may be cheaper than this file has been saying.
It is not established either way — whether anyone has purchased is not readable
from outside — and what to do about it is a product question rather than a hosting
one. Nothing here acts on it; the step is marked in doubt rather than reopened.

## Order of operations

Steps marked **Kevin** are his and nothing here performs them. Steps marked
**release thread** belong to "Redeploy and release waves 1-3", which owns
Railway reads and release writes; no other thread writes Railway.

| # | Step | Who | Reversible |
| --- | --- | --- | --- |
| 1 | Merge the host and the transitional native build (both drafts, both switched off) | Claude | yes |
| 2 | Create the Railway service for `services/pennsync-site` | **Kevin** — paid infrastructure | the service can be deleted |
| 3 | Set its build arguments and leave `PENNSYNC_SITE_RELEASED` unset | release thread | yes |
| 4 | Deploy and read `/healthz`: expect `"released": false` | release thread | yes |
| 5 | Set `PENNSYNC_SITE_RELEASED=enabled-v1` and verify asset-for-asset against the deployment's own hostname | release thread | yes — unset it |
| 6 | Confirm `/login` no longer belongs to Base44 on this origin (the instrument above) | Claude | n/a, a reading |
| 7 | Point `APP_PUBLIC_URL` at `https://app.caremetricai.com` in the Base44 function environment | **Kevin** — Base44 account | yes, by restoring the previous value |
| 7b | Repoint the App Store listing's privacy-policy, Support and EULA URLs off `caremetricai.base44.app` | **Kevin** — App Store Connect metadata, no binary and not blocked by step 8 | yes, by restoring the URLs |
| 8 | *Not on the critical path, and its blocker is now in doubt:* a replacement binary from this tree was held behind StoreKit purchase and restore (recovery runbook §5.2) — see the note below, because Base44 documents that it does not support store billing at all | **Kevin** — the in-app-purchase question, the Apple account, and the no-upload gate in `docs/APP_STORE_SUBMISSION_CHECKLIST.md` | a release can be pulled; an installed update cannot be taken back |
| 9 | *Only if step 8 ever happens:* wait for adoption of that build | — | — |
| 10 | Repoint `app.caremetricai.com` at the owned host in GoDaddy | **Kevin** — DNS | yes, by restoring the A record |
| 11 | **Keep `caremetricai.base44.app` resolving.** This is what protects installed copies while step 8 is blocked. It does not replace recovering the signing paths — see below | **Kevin** — Base44 account | — |

Steps 8 and 9 are bracketed on purpose. They were written as the protection for
installed apps and they are not: the binary they describe cannot be submitted
until the in-app-purchase work exists, which is Stage L's row and predates this
migration. Steps 1 to 7 and 10 do not wait on them; step 11 does the protecting
instead. What the transitional native change in `#399` buys is that **whenever** a
replacement is built, it binds the custom domain — the source is right and ready,
and nothing about it is urgent.

How long step 11 lasts, and whether step 10 is a cutover or a non-event for the
installed app, both turn on the one unknown above. "What each answer to that
question changes" states each branch's consequences before the answer arrives.

### Step 7 in detail

`APP_PUBLIC_URL` is the single value that decides where every emailed link
points, and it is the one piece of the move that lives outside this repository.
Thirteen Base44 functions read it — `adminResetPassword`,
`autoApproveInvitedUser`, `checkAllIntegrations`, `createNotification`,
`createUserWithTempPassword`, `createUserWithTempPasswordV2`,
`dispatchScheduledSignatureReminders`, `generateFollowUpPortalToken`,
`generateSignerToken`, `preflightStagingReadinessFixture`, `resetUserPassword`,
`userManagement` and `userManagementV2` — so an invitation, a password reset, a
signature reminder and a provider follow-up link are all built from it.

It fails closed by design: `.env.example:85-88` records that there is no
`APP_URL` or production fallback, and each function's `getAppBaseUrl` refuses a
value that is not one exact absolute HTTPS origin.
`base44/functionTests/publicAppUrlContract.test.js` is the assertion.

Two things follow, and together they are why this has a step of its own rather
than a line in step 10:

- **It can move early and safely.** Both origins already serve the same
  application, so pointing it at the custom domain while Base44 is still hosting
  changes which hostname a recipient sees and nothing else.
- **It must move before step 11.** Once `caremetricai.base44.app` stops being
  reachable, a value still naming it makes every outbound link in all thirteen
  functions dead — and these are the links by which a new member first reaches
  the product, so the failure lands on people who cannot work around it.

Setting it ahead of step 8 is the tidier order, for a weaker reason than it
first looks: once the shell loads `app.caremetricai.com`, a link on that origin
is the same origin the app itself uses, so nothing a recipient opens points at a
hostname the product is leaving. It does **not** mean the link opens the
installed app — that needs a universal-link association, and there is none in
`ios/PennSync/` to measure.

Step 7b is the same shape from the other side and is numbered with it for that
reason: another value outside the code that names the hostname being retired, in
App Store Connect rather than the function environment. The section above has the
three URLs as read on 2026-10-01 and the two pre-existing route notes that go
with changing them. Unlike step 8 it needs no binary, so it is not blocked.

Instrument: there is none from here for `APP_PUBLIC_URL`. This is a value in
Kevin's Base44 function environment, not in the tree, and nothing in this
repository can read it — so
confirm it by sending one invitation to an address he controls and reading the
link, which is his to do and is also a message to a real person.

### Step 10 in detail

The record is an **A** record at GoDaddy, so the change is: replace the A record
for `app` with the CNAME the owned host asks for (Railway issues one per custom
domain), after the host already answers for that name. Two things to have in
hand before touching it:

1. The host must already hold a certificate for `app.caremetricai.com`, which
   normally means adding the custom domain to the service and completing its
   validation **before** the record moves. A record moved first means a TLS
   error, not a 404, and TLS errors are what browsers remember.
2. The TTL is 1800 seconds. Lower it to 300 a day ahead so a rollback takes
   five minutes rather than thirty.

Rollback is restoring the A record to `216.24.57.1`. That works for as long as
Base44 still serves the app, which is step 11's whole point.

## Verifying, at each point

```sh
pnpm run build
# Before the domain moves — against the deployment's own hostname.
PENNSYNC_SITE_VERIFY_ORIGIN=https://<deployment-host> node tools-live-frontend-sync.mjs --json
# After it moves — the committed production pair.
node tools-live-frontend-sync.mjs --json
```

The report carries `origin_allowlist`: `"environment"` for the first,
`"production"` for the second. A green under `"environment"` says the owned host
serves this exact build and says **nothing** about what production serves.
Neither says anything about authenticated workflows, tenant isolation or data
migration; the tool's own `scope` field says so.

The build must be made with the same `PENNSYNC_ASSET_REVISION` the image was
built with, or the asset filenames differ and the comparison cannot run. That is
why the image build refuses an empty one.

## What the exit leaves Base44 holding

The last step of the hosting exit is a revocation list, not a switch-off, because
Base44 holds credentials and bindings that keep working after it stops serving
anything. Everything here is read from this repository or from Base44's own
documentation; nothing was read from an account.

**An Apple App Store Connect API key.** Base44's documentation says that to
generate the installable file it takes an Issuer ID, Key ID, Team ID and the `.p8`
key file, and that "Base44 keeps your credentials saved, so they are ready the next
time you generate files." That key can create and upload builds for the app record,
so it is the most consequential item on this list. Revoking it is one action in
Apple's own developer portal, and Apple only lets a `.p8` be downloaded once, so
the copy Base44 holds may be the only one — revoke rather than try to retrieve it.

**The function-environment secrets.** Read from every `Deno.env.get` in
`base44/functions/` and `base44/_shared/`, the secret-bearing names are
`INTERNAL_FN_SECRET`, `SIGNATURE_HMAC_SECRET`, `SIGNATURE_HMAC_KEYRING`,
`OPENAI_API_KEY`, `ANTHROPIC_API_KEY` and `HEYGEN_API_KEY`. `APP_PUBLIC_URL`,
`SUPER_ADMIN_EMAIL` and the various `*_RELEASE` names are configuration rather than
credentials and need no revocation, only the move step 7 already covers. Each
secret is rotated at the provider that issued it, not inside Base44 — a value
deleted from Base44's environment is still a live key at OpenAI, Anthropic or
HeyGen until it is rotated there.

**The Telnyx credentials**, which per `AGENTS.md` are configured in-app through the
`IntegrationSecret` entity rather than the environment, so they live in Base44's
data and leave with it.

**The custom-domain binding.** Base44 holds the configuration and the TLS
certificate for `app.caremetricai.com` while it serves that hostname. After step 10
moves the record, remove the binding there too, or two places keep claiming the
same name.

**Three images the product serves from Base44's storage.** These are ours to fix
rather than to revoke, and they are the one item here that breaks something a user
sees. All three point at `qtrypzzcjebvfcihiynt.supabase.co`, under a bucket named
`base44-prod`, which this repository's own SSRF allowlist names as a Base44 host
(`base44/functions/importProvidersCsv/entry.ts:154` and two siblings). Read from
every `https://` in production `src/` and `services/` code on 2026-10-01, test files
excluded:

- `src/lib/brand.js` holds `BRAND_LOGO_URL`, imported by fifteen modules including
  `PageLoader.jsx` and `SignInScreen.jsx`, so the first screen of a cold start
  fetches it. This is the one the installed app's privacy report showed.
- `src/components/education/HandoutPreview.jsx:42` hard-codes an agency letterhead
  image in the patient-education preview, reached from `PatientEducationHub.jsx`.
- `services/pennsync-api/branded-email.mjs:34` puts the same brand logo in the mail
  the **owned** service sends. That one is worth reading twice: it is not Base44
  code, so an exit that moved every capability across would still be sending mail
  whose header image is served by the account being closed, and a recipient would
  see a broken image rather than an error anyone reports.

Each is a URL constant rather than a mechanism, so the work is moving the two image
files to a host of ours and changing three lines. Nothing here blocks a step, and
nothing in this runbook's order depends on it. **The order inside the item does
matter, though, and it is the opposite of the obvious one: the files have to be
served from the destination, and each new URL read back as actually returning the
image, before any of the three constants changes.** A constant pointing at an
address that does not serve the image yet is a broken image in production, and in
the mail case it is a broken image in somebody's inbox.

**The destination, and what it waits on.** The destination is the application's own
`public/` bundle, referenced as `https://app.caremetricai.com/<path>`. That name is
the one address that is correct on both sides of step 10: Base44 serves this
bundle at it today, and our own host serves the same bundle at it afterwards, so the
constants never have to change twice. What it waits on is therefore not the owned
host but a **publish of the frontend carrying the files**, which is a deliberate
act through `publish-production-frontend.yml` rather than anything automatic. Two
consequences worth having in writing. Using the owned deployment's own Railway
hostname instead would work sooner and ties the asset to a hostname nobody has
promised to keep, so it is the worse choice despite being available earlier. And
adding a file under `public/` fails `tools-app-store-migration.test.mjs`, which pins
that directory and `ios/` to an exact inventory of 25 paths — deliberately, so that
a native-adjacent addition is reviewed rather than absorbed. That is a reviewed
change to the baseline inventory and belongs in the same pull request as the files.

The code change is **not** this branch's: it belongs in a small pull request of its
own, after the two this runbook ships with. Merging it ships nothing by itself,
since `services/pennsync-api` deploys on a release-variable write rather than on a
merge touching its directory.

**The hosted data, the user accounts and the generated native build**, which are
the other half of the exit rather than this runbook's, named here only so the list
is not read as complete on its own.

Nothing in this repository can verify any of these from outside, so this is a list
to work through in the accounts rather than a measurement.

## What this runbook does not cover

The Android half. There is no `android/` directory in this repository, so the
Play listing (`com.caremetic.ai` — that spelling is the real package id) cannot
be rebuilt from here at all. Whatever the installed Android app binds to is
unmeasured here and needs the original project before step 10 can be called safe
for both platforms.
