# PennSync business API

The Railway home for backend handlers ported out of Base44. It is the `port`
destination named in
[the exit decisions](../../docs/BASE44_EXIT_DECISIONS_2026-09-19.md) (D1) and
classified per capability in `tools-transition-disposition.json`.

This service is **not deployed**. It is source with a Dockerfile: no Railway
service, domain, secret or traffic exists for it yet, and creating one needs
its own cost approval. Nothing here migrates data or changes an existing
release control.

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
the other's files. `parity.test.mjs` fails if the two diverge on the contract
name, the RPC, the permitted targets, the key shape or the accepted context.

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
| `PENNSYNC_API_APP_ID` | Optional; production or the staging app id |
| `PENNSYNC_API_DOCUMENT_LOGO` | Optional inline `data:image/png;base64,…` logo for ported documents. A remote address is refused |

Releasing without a usable authority throws at startup rather than serving
unauthorized work. A released name that is not in the registry also throws, so
a typo fails immediately instead of releasing nothing or something else.

## Ported handlers

| Handler | Source | Notes |
| --- | --- | --- |
| `validatePatientData` | `base44/functions/validatePatientData/entry.ts` | Pure field validation; reads and writes nothing |
| `generateBagTechniquePDF` | `base44/functions/generateBagTechniquePDF/entry.ts` | Renders the infection-control checklist. Answers with the PDF itself, as the original did |

### Documents

`documents.mjs` holds ported documents as pure builders over a jsPDF-shaped
object. A rendered PDF cannot be compared byte for byte -- jsPDF stamps a
creation time and a document id, so two runs of the same code differ -- so
parity is proved on the drawing calls instead: same calls, same order, same
arguments means the same page. `base44/functionTests/pennsyncApiDocumentParity.test.js`
transpiles the Base44 original, captures its `Deno.serve` handler, runs it for
real against a recording surface, and compares.

Two things the originals did are deliberately not carried:

- **The logo is supplied, never fetched.** Each original fetched a PNG from
  Base44's own storage bucket on every request. Carrying that would have kept a
  Base44 dependency -- and a third-party fetch -- in a request path that
  otherwise makes neither. `PENNSYNC_API_DOCUMENT_LOGO` supplies it inline, and
  with none configured the document takes the branch the original already took
  when that fetch failed. The parity test covers both branches.
- **The date is supplied.** The originals called `new Date()` inside the
  builder, so the same request produced a different document either side of
  midnight and its parity could not be tested. The builder refuses to invent one.

This is the one place the service has a runtime dependency (`jspdf`, pinned to
the version the frontend already uses). It is imported on first use, so a
deployment that releases no document handler never loads it. Because of it the
service now needs its dependencies installed before its tests run:

```sh
pnpm --dir services/pennsync-api install --ignore-workspace --frozen-lockfile
```

CI does this in `ci.yml`. `publish-production-frontend.yml` is manual and
already required the same for `services/authority-store`.

A document handler answers with bytes rather than the JSON envelope every other
handler uses, which is what its Base44 original did. `app.mjs` takes that path
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
pnpm --dir services/pennsync-api install --ignore-workspace --frozen-lockfile
node --test services/pennsync-api/*.test.mjs \
  base44/functionTests/pennsyncApiPortParity.test.js \
  base44/functionTests/pennsyncApiDocumentParity.test.js
```

Also run by `pnpm run test:pennsync-api`, which `pnpm test` includes. The
Dockerfile runs the service's own suite during the image build, so an image
that fails its tests never starts.

These are synthetic, network-isolated checks. They do not establish hosted
enrollment, a deployed revision, real provider behavior, or that any caller has
migrated. Before this service serves a request in an environment that matters,
it needs a reviewed deployment, a preflight against its intended authority
target, and signed-in two-agency acceptance with real enrolled actors.
