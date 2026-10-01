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
while the live app requires 15.6. Today's store read agrees and dates it: the
live build is version `1.0`, released **2026-01-05** and never updated, while
every file under `ios/` arrived in this repository in one commit on
**2026-09-28**, nine months later. No commit here produced what people have
installed.

Three things follow, and the third is the one that moves this runbook's order.

**What the installed app loads cannot be measured from here.** Not from `appURL`
at any commit, because no commit here is its source. Reading it needs the binary
or the account: installing the live app and watching its requests, or finding the
PWABuilder output §6 of that runbook goes looking for. Both are outside this
container.

**Which version people have *is* measurable, and it is all of them.** `1.0` is
the only version ever published, so there is no version spread to reason about.

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
| 8 | *Blocked, and not on the critical path:* a replacement binary from this tree needs StoreKit purchase and restore first (recovery runbook §5.2), then Apple account continuity for `com.caremetric.ai` | **Kevin** — the in-app-purchase decision, the Apple account, and the no-upload gate in `docs/APP_STORE_SUBMISSION_CHECKLIST.md` | a release can be pulled; an installed update cannot be taken back |
| 9 | *Only if step 8 ever happens:* wait for adoption of that build | — | — |
| 10 | Repoint `app.caremetricai.com` at the owned host in GoDaddy | **Kevin** — DNS | yes, by restoring the A record |
| 11 | **Keep `caremetricai.base44.app` resolving.** This is what protects the installed app, not step 8 | **Kevin** — Base44 account | — |

Steps 8 and 9 are bracketed on purpose. They were written as the protection for
installed apps and they are not: the binary they describe cannot be submitted
until the in-app-purchase work exists, which is Stage L's row and predates this
migration. Steps 1 to 7 and 10 do not wait on them; step 11 does the protecting
instead. What the transitional native change in `#399` buys is that **whenever** a
replacement is built, it binds the custom domain — the source is right and ready,
and nothing about it is urgent.

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

Instrument: there is none from here. This is a value in Kevin's Base44 function
environment, not in the tree, and nothing in this repository can read it — so
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

## What this runbook does not cover

The Android half. There is no `android/` directory in this repository, so the
Play listing (`com.caremetic.ai` — that spelling is the real package id) cannot
be rebuilt from here at all. Whatever the installed Android app binds to is
unmeasured here and needs the original project before step 10 can be called safe
for both platforms.
