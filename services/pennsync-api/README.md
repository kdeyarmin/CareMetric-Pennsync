# PennSync business API

The Railway home for backend handlers ported out of Base44. It is the `port`
destination named in
[the exit decisions](../../docs/BASE44_EXIT_DECISIONS_2026-09-19.md) (D1) and
classified per capability in `tools-transition-disposition.json`.

This service is **deployed and paused** as of 2026-09-22 (stage B of
[the go-live plan](../../docs/RAILWAY_GO_LIVE_PLAN_2026-09-21.md)). It runs in
the CareMetric Train Railway project at
`pennsync-api-production.up.railway.app`, root `/services/pennsync-api`, its
committed `Dockerfile`, healthcheck `/healthz`, configuration in service
settings rather than a `railway.toml`.

**No handler is released and no traffic reaches it.** `PENNSYNC_API_RELEASE`
is unset and `PENNSYNC_API_FUNCTIONS` is empty, so `/readyz` answers 503 with
`released:false` and every name is refused `PENNSYNC_API_NOT_RELEASED`.
Releasing one is stage D and needs the real identities stage C creates.
Nothing here migrates data or changes an existing release control.

## What it is

A Node 24 HTTP service with exactly three routes:

| Route | Purpose |
| --- | --- |
| `GET /healthz` | Process liveness and deployed revision. Available while paused. |
| `GET /readyz` | Release, authority and released-function state. 503 until ready. |
| `POST /v1/functions/<name>` | One release-gated ported handler. |

There is no generic entity, query or proxy route. A caller cannot name a
database function, table, origin or model. The dispatch path accepts only a
registered handler name, and only one an operator has released.

## Authority

Every request carries the caller's own Supabase Auth access token, which is
replayed to the owned authority store's fixed `pennsync_staging_context` RPC.
The API gateway verifies the signature and the database authorizes the read.
This service holds only a publishable key, which identifies the project rather
than the caller, and it refuses a secret or service-role key at startup.

Handlers never resolve their own authority. They receive a frozen projection
(native user, legacy user, agency, membership id and version, role) with no
token, key or raw response in it, so a handler cannot widen its caller's scope.

The owned store issues no platform-owner context, so there is no global or
owner scope in this service at all. Every request names exactly one agency.

`authority.mjs` is a deliberate duplicate of the external runtime's copy,
because each Railway service builds from its own directory and cannot import
the other's files. `base44/functionTests/pennsyncApiAuthorityParity.test.js`
fails if the two diverge on the contract name, the RPC, the permitted targets,
the key shape or the accepted context. It lives outside both services for the
same reason the duplication exists: this directory is a Docker build context,
so a file in it that imports `../integration-runtime/` fails the image build.
`api.test.mjs` enforces that — no file here may import out of this directory.

## Release controls

All default closed. A deployment that sets nothing serves health and readiness
only.

| Setting | Required value |
| --- | --- |
| `PENNSYNC_API_RELEASE` | Exactly `enabled-v1`; anything else stays paused |
| `PENNSYNC_API_FUNCTIONS` | Comma-separated released handler names, each of which must exist in the registry |
| `PENNSYNC_API_AUTHORITY_URL` | One of the two reviewed authority targets |
| `PENNSYNC_API_AUTHORITY_PUBLISHABLE_KEY` | A modern publishable key |
| `PENNSYNC_API_ALLOWED_ORIGINS` | Optional HTTPS origin allowlist; defaults to the two production origins |
| `PENNSYNC_API_APP_ID` | Required once released; production or the staging app id, and it must name the app the target store was pinned to |
| `PENNSYNC_API_DOCUMENT_LOGO` | Optional inline `data:image/png;base64,…` logo for ported documents. A remote address is refused |
| `PENNSYNC_API_DELIVERY` | Exactly `enabled-v1` to let a capability send a message to a person. Anything else, including `" enabled-v1"`, stays paused |

## Outbound delivery is released separately

`PENNSYNC_API_DELIVERY` is a second switch and not a detail of the first. A
released capability that writes a record and a released capability that sends a
person a message are different decisions with different owners, so the second
needs its own act.

Unset — which is every deployment today — every sender answers 503
`OUTBOUND_DELIVERY_RELEASE_PAUSED`, `SendEmail` is not in the brokered set at
all, and the service reaches no mail provider. Set, `SendEmail` becomes askable
and the senders among the released names send. It is refused at startup without
`PENNSYNC_API_INTEGRATIONS_URL`, because a channel that cannot carry anything
should not report itself open, and `/readyz` publishes `deliveryReleased` so the
state is readable from outside the service rather than inferred from a plan.

Since D98 readiness also HONOURS it: a released set containing a sender while
this switch is unset reports `ready: false`, because such a deployment refuses
every send and a probe that passed would say the opposite. `deliveryRequired` is
published beside the flag, so a deployment that needs delivery and has it can be
told from one that needs it and does not.

A sender's recipient is resolved against the caller's own agency roster, so
these endpoints can reach the people in the agency the request names and nobody
else. An address outside it is refused `RECIPIENT_NOT_IN_AGENCY`.

Mail also needs the integration runtime's own side: `INTEGRATIONS_RELEASE`,
`SendEmail` in `INTEGRATIONS_ALLOWED_OPERATIONS`, and a configured provider
(`SENDGRID_API_KEY`, `NOTIFICATION_FROM_EMAIL`). Two services must both permit
it, which is deliberate: no single switch starts mail flowing.

Releasing without a usable authority throws at startup rather than serving
unauthorized work. A released name that is not in the registry also throws, so
a typo fails immediately instead of releasing nothing or something else.

Releasing without `PENNSYNC_API_APP_ID` throws for a subtler reason. This
service is always independent-authority, so its app id is not a label: it is the
request's key into the owned store, whose `actor()` admits exactly the one app
its deployment was pinned to. That pin defaults to **staging** while this
setting defaults to **production**, so a release that states neither is the one
combination that reports `ready:true` and is refused by every authorization
call. The operator says which app this deployment serves, or it does not start.

## Ported handlers

| Handler | Source | Notes |
| --- | --- | --- |
| `validatePatientData` | `base44/functions/validatePatientData/entry.ts` | Pure field validation; reads and writes nothing |
| `generateBagTechniquePDF` | `base44/functions/generateBagTechniquePDF/entry.ts` | Renders the infection-control checklist. Answers with the PDF itself, as the original did |
| `generateSmartNoteGuide` | `base44/functions/generateSmartNoteGuide/entry.ts` | Clinician guide. Answers with base64 in the envelope, as the original did |
| `generateUserManual` | `base44/functions/generateUserManual/entry.ts` | Product manual. Answers with the PDF itself, as the original did |
| `generatePatientHandout` | `base44/functions/generatePatientHandout/entry.ts` | Patient education guide (D81), a PARTIAL port: the document is served, and `action: 'email'` gets the original's own paused answer, 503 `OUTBOUND_DELIVERY_RELEASE_PAUSED`. Its twenty templates are copied from the original and compared as source text; its page is proved call-for-call across every condition and style. Answers with base64 inside the envelope, as the original did. Reads and writes no entity row |
| `sendAccountReadyEmail` | `base44/functions/sendAccountReadyEmail/entry.ts` | The account-ready notice, whole since D97: one brokered `Core.SendEmail`, released separately on `PENNSYNC_API_DELIVERY`. With that unset it answers exactly what D86 shipped — 403 to a non-admin, then 503 `OUTBOUND_DELIVERY_RELEASE_PAUSED` — because authorization runs before the pause and the pause before the body. With it set, the message goes. The recipient is resolved against the caller's own agency roster (D98), so an address nobody in that agency holds is refused `RECIPIENT_NOT_IN_AGENCY`; that read is the only one, and it happens after the pause |
| `sendWelcomeEmail` | `base44/functions/sendWelcomeEmail/entry.ts` | The welcome notice, the same shape and the same two gates, with a stronger reason for both: its message body carries a working temporary password, which is why D56 singled it out and why D98's recipient binding is not optional here |
| `analyzeReferralPriority` | `base44/functions/analyzeReferralPriority/entry.ts` | The first port that reaches outside the service: one brokered `InvokeLLM`. Reads and writes no entity row |
| `analyzeReferralIntake` | `base44/functions/analyzeReferralIntake/entry.ts` | One brokered `InvokeLLM`, and a guard that answers an empty payload without calling the model at all — the original's comment says the call otherwise times out at the 120s proxy limit |
| `generateReferralTasks` | `base44/functions/generateReferralTasks/entry.ts` | One brokered `InvokeLLM`, with `response_json_schema` rather than the tolerant parser: its schema carries `required` at every level, so the provider takes it |
| `matchPatientWithAI` | `base44/functions/matchPatientWithAI/entry.ts` | Candidate patients arrive in the request rather than from a query, so it reads no entity row. Sends demographics to the model, as the original did |
| `analyzeReferral` | `base44/functions/analyzeReferral/entry.ts` | A four-action dispatcher. Its own docstring calls it a replacement for three of the handlers above, but every prompt is differently worded and its patient projection sends nine fields where the standalone sends twenty — so both live on, and both are ported. `full_analysis` starts priority and match together, then asks for tasks with the priority answer |
| `generateUserGuidePDF` | `base44/functions/generateUserGuidePDF/entry.ts` | The only port that both asks a model and renders. Eleven guide prompts, extracted from the original rather than retyped, and a render proved call-for-call against it. Reads and writes no entity row |

### Brokered Core integrations

Twelve functions called `base44.integrations.Core` and read no entity row. They
were counted against the record store until the modules were read; what they
actually needed is the integration runtime, which already brokers those
providers. `integrations.mjs` is that path, `analyzeReferralPriority` was the
first handler to use it, and the bucket is empty now: five were written, two
turned out to be paused at source, four are held by the file layer rather than
by the runtime, and `generateUserGuidePDF` was the last to be ported.

Two properties are worth stating because they are easy to lose:

**A handler never receives a credential.** `app.mjs` builds a capability bound
to the caller's own request and passes that function to the handler; the bearer
stays in the module's closure. So a brokered call carries exactly the caller's
authority — never the service's — and a handler cannot read, log or forward the
token that authorizes it. Set `PENNSYNC_API_INTEGRATIONS_URL` to the runtime's
origin; it must be one of a fixed pair, because that is where the bearer goes.
Unset, such a handler refuses before it reaches the network.

**The runtime's words do not come back.** Its failures map to one code here. A
provider message or an upstream stack would otherwise cross a trust boundary on
the way to the caller, and a test drives a leaking payload through to prove it
does not.

Parity for a handler like this cannot be a return value: it computes almost
nothing, and its real output is the request it makes. So
`pennsyncApiIntegrationParity.test.js` drives the original Deno module with a
stubbed client that records the `InvokeLLM` argument, drives the port with a
stubbed capability that records the same, and compares both the call and the
answer. The prompt is the contract with the model — a reworded prompt is a
different function even when every surrounding line matches.

### Records

Sixty-two of the functions still to port read or write entity rows.
`records.mjs` is the path, and it is shaped exactly like the integration
capability above: `app.mjs` binds it to the caller's own request, the bearer
stays in the closure, and a handler receives `records(operation, entity, args)`
rather than a connection, a key or a table name.

Five operations — `list`, `get`, `insert`, `update`, `delete` — over the 31
entities the broker family serves (`brokered-entities.mjs`, generated from the
same plan as the family's SQL). Everything else is refused here before a request
leaves the service: an unknown operation, an entity outside the family, a write
to reference data, or an argument nobody declared. The database is still the
authority on every one of those answers — `record-brokers.test.mjs` applies the
real migration and proves the policies and the broker deny — and none of these
checks is a substitute for it.

There is **no new credential and no new origin**. The record store is the same
database as the authority store (its migration refuses to apply without
`pennsync_private.deployment_app_id()`), so this reuses the authority target and
publishable key `authority.mjs` already validates against a fixed pair. The
caller's own bearer authorizes the call, so a read carries exactly the caller's
authority; the key names the project and nobody.

Refusals are a shared vocabulary and only that. The eight `PENNSYNC_BROKER_*`
codes are defined once in the generator, interpolated into the SQL and emitted
to `brokered-entities.mjs`; a test asserts the set the SQL raises and the set
this service knows are the same in both directions. Anything else PostgREST
returns — a database message, a hint, a constraint name — maps to one code.

Two answers here are deliberately not failures: `get` and `update` return null
and `delete` returns false both for a row that is not there and for one that is
not the caller's. Telling those apart would report whether an id exists in
another agency.

### Documents

`documents.mjs` is the shared surface; each document is its own
`document-*.mjs` file holding a pure builder over a jsPDF-shaped object. A rendered PDF cannot be compared byte for byte -- jsPDF stamps a
creation time and a document id, so two runs of the same code differ -- so
parity is proved on the drawing calls instead: same calls, same order, same
arguments means the same page. `base44/functionTests/pennsyncApiDocumentParity.test.js`
transpiles the Base44 original, captures its `Deno.serve` handler, runs it for
real against a recording surface, and compares.

Two things the originals did are deliberately not carried:

- **A logo is supplied, never fetched.** `generateBagTechniquePDF` fetched a PNG
  from Base44's own storage bucket on every request. Carrying that would have
  kept a Base44 dependency -- and a third-party fetch -- in a request path that
  otherwise makes neither. `PENNSYNC_API_DOCUMENT_LOGO` supplies it inline, and
  with none configured the document takes the branch the original already took
  when that fetch failed. The parity test covers both branches.
- **A date is supplied.** `generateBagTechniquePDF` and `generateSmartNoteGuide`
  called `new Date()` inside the builder, so the same request produced a
  different document either side of midnight and its parity could not be tested.
  Those builders refuse to invent one. `generateUserManual` read no clock and
  fetched nothing, so it ports verbatim.

Each answers the way its original answered: two with the bytes, and
`generateSmartNoteGuide` and `generatePatientHandout` with base64 inside the
envelope, because that is what their originals returned. The handout's date
keeps its original's long form ("September 22, 2026") and is supplied the same
way.

#### The user guide, which is both

`generateUserGuidePDF` asks a model for the guide and then renders what comes
back, so it is proved on both halves — the call against the original's call, the
drawing against the original's drawing.

Its eleven prompts were **extracted, not retyped**. The original carries roughly
480 lines of prompt text; that text is the contract with the model, and a parity
test had already caught a single dropped trailing space in a much shorter
prompt. `tools-user-guide-prompts.mjs` drives the original with its client and
PDF library stubbed, captures the exact argument each guide type produces, and
writes `user-guide-prompts.mjs`. The parity test then compares the committed
data against what the original produces now, for every guide type, so it cannot
drift from its source without failing.

Two details in the render that look incidental and are not:

- **The page is Letter, not A4.** The original constructs jsPDF with
  `format: 'letter'` — 215.9mm by 279.4mm. The port hardcoded A4 until the
  parity recorder disagreed with the original about the width of the header bar,
  which would have rendered every guide at the wrong size. Geometry is read from
  the document now, and read as `pageSize.width`, a property, because that is
  what the original reads; jsPDF also offers `getWidth()`, and the two are not
  interchangeable for a stub.
- **The page break is per line.** An up-front check cannot catch a block taller
  than a page, so the original checks before drawing each line. Model output is
  long, which makes that the common case rather than the rare one.

An unknown or crafted `guide_type` resolves to `all_features` exactly as the
original resolves it — it matters beyond tidiness, because the resolved value
reaches the download filename and the `Content-Disposition` header.

This is the one place the service has a runtime dependency (`jspdf`, pinned to
the version the frontend already uses). It is imported on first use, so a
deployment that releases no document handler never loads it. Because of it the
service now needs its dependencies installed before its tests run:

```sh
pnpm --dir services/pennsync-api install --frozen-lockfile
```

CI does this in `ci.yml`. `publish-production-frontend.yml` is manual and
already required the same for `services/authority-store`.

A binary document handler answers with bytes rather than the JSON envelope every
other handler uses, which is what its Base44 original did. `app.mjs` takes that path
only for a handler that declares itself binary, and checks the shape it is
handed rather than trusting it: a wrong content type, a non-buffer body or a
filename with a path or quote in it is refused as an unavailable response
instead of being put into a header.

Ported transforms without a handler yet, in `transforms.mjs`:

| Transform | Source | Why no handler |
| --- | --- | --- |
| `buildAdmissionNoteTemplate`, `buildSmartNoteData` | `base44/functions/extractReferralDataForSmartNote/entry.ts` | Needs an authorized referral read this service does not have. Accepting a caller-supplied referral instead would let anyone choose the payload |

The smart-note mapping is ported ahead of its handler on purpose: its key
paths have been corrected in the original more than once, and each time a
section rendered blank until someone noticed. The parity test pins it now so a
future edit on either side fails instead of quietly emptying a note.

`base44/functionTests/pennsyncApiPortParity.test.js` transpiles the original
Deno entry and asserts the ported implementation returns identical errors
across a case matrix. A port lands only with that guard.

One behavior deliberately differs: the original accepted any authenticated
active user, while this service requires a current agency membership, because
it has no global scope. A caller migrating to this endpoint must therefore send
`agency_id`. That is a tightening, and it is why migrating the existing frontend
caller is a separate reviewed change rather than part of adding the handler.

Presence in the registry is not release. `validatePatientData` is implemented
and unreleased.

## Tests

```sh
pnpm --dir services/pennsync-api install --frozen-lockfile
node --test services/pennsync-api/*.test.mjs \
  base44/functionTests/pennsyncApiPortParity.test.js \
  base44/functionTests/pennsyncApiDocumentParity.test.js \
  base44/functionTests/pennsyncApiAuthorityParity.test.js
```

Also run by `pnpm run test:pennsync-api`, which `pnpm test` includes. The
Dockerfile runs the service's own suite during the image build, so an image
that fails its tests never starts — which is why the three parity suites live
in `base44/functionTests/` instead: each reaches outside this directory, and
the build context has nothing outside it.

These are synthetic, network-isolated checks. They do not establish hosted
enrollment, a deployed revision, real provider behavior, or that any caller has
migrated. Before this service serves a request in an environment that matters,
it needs a reviewed deployment, a preflight against its intended authority
target, and signed-in two-agency acceptance with real enrolled actors.
