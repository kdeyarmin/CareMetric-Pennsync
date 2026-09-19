# AGENTS.md

Instructions for Codex cloud and other AI coding agents working in this repository.

## Cursor Cloud specific instructions

- The VM's default `node` (`/exec-daemon/node`) is v22 and takes PATH precedence, but this repo requires Node `>=24.18.0`. Node 24.18.0 is installed via nvm and prepended to `PATH` in `~/.bashrc`, so a normal interactive shell already resolves the correct node. If a command reports the wrong version, run `export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"` (or `nvm use 24.18.0`) first. The startup update script also runs `nvm use 24.18.0` before `pnpm install`.
- Frontend-only SPA: `pnpm run dev` serves Vite on `http://localhost:5173`. There is no local backend; `[base44] Proxy not enabled` is expected/harmless.
- Base44 config comes from `VITE_BASE44_APP_ID` and `VITE_BASE44_BACKEND_URL`, provided as Cursor secrets (Vite reads them at dev-server startup, so restart `pnpm run dev` after they change). When they are set, the app root renders the real branded "Welcome to PennSync" login screen and the sign-in form POSTs to the hosted `base44.app` backend end-to-end; `403 "You must be logged in"` console errors before login are expected. Full authenticated patient/clinical flows additionally require valid login credentials, which are not present by default.
- When the config secrets are absent, authenticated routes redirect to `/login` and render blank. To verify rendering without config, use `/signer` (renders the signing-unavailable state) or `/join` (renders an "Invalid Visit Link" card). Public signer and provider-follow-up capabilities are quarantined: their pages do not call the backend, and their token URL parameters are removed before the React app imports.
- Authenticated login/write flows work end-to-end when valid login credentials exist as secrets (e.g. `PENNSYNC_TEST_EMAIL` / `PENNSYNC_TEST_PASSWORD`): sign-in POSTs to `/api/apps/<appId>/auth/login`, and profile writes (`base44.auth.updateMe`, i.e. `PUT /api/apps/<appId>/entities/User/me`) persist. Form fields backed by `base44.auth.me()` (react-query) briefly show empty/grey placeholder text on reload before the real value loads — wait a few seconds before judging persistence.
- Standard commands (install/dev/build/lint/test/typecheck) are in `package.json` and the table below; do not duplicate them elsewhere.

## Codex cloud environment

- Configure this repository in Codex cloud settings with Node 24.18.0 or newer and pnpm 11.9.0.
- Setup script:

  ```bash
  corepack enable
  corepack prepare pnpm@11.9.0 --activate
  pnpm install --frozen-lockfile
  ```

- Store `VITE_BASE44_APP_ID`, `VITE_BASE44_BACKEND_URL`, optional `VITE_SUPER_ADMIN_EMAIL`, OpenAI, Anthropic, HeyGen, HMAC, and other service credentials in Codex environment variables or secrets. Do not commit `.env` files.
- Telnyx credentials are configured in-app through `IntegrationSecret` — never through environment variables, frontend *or* backend. Do not add a `Deno.env.get('TELNYX_…')` fallback to a Base44 function: the path is retired, two guardrails enforce it, and it has been re-added and reverted twice. If a send reports "not configured", check the `readError` the credential helper now returns before assuming the key is missing. The helper is generated from `base44/_shared/backendHelpers.mjs`; edit it there, never in a function copy.

## Project shape

PennSync (package `base44-app`) is a Vite + React 19 SPA with two selectable backends.

On the default path the Base44 platform (auth, data entities, and the Deno functions under `base44/functions/`) is a hosted remote service. Those Deno functions are not runnable from this repo because there is no `deno.json` or local runner; `src/functions/*` are thin client wrappers that call the remote backend.

The product is migrating off Base44. `VITE_PENNSYNC_BACKEND=independent-staging` builds the same app against Supabase Auth and the owned authority store in `services/authority-store`, through `services/authority-client`. That path is synthetic staging only: four fixed test accounts, names-only patients, and unsupported operations fail closed with no Base44 fallback. Two Railway services support it — `services/integration-runtime` (deployed, paused) and `services/pennsync-api` (source only, not deployed).

Before changing anything in the migration, read [the transition plan](docs/BASE44_TO_RAILWAY_TRANSITION_PLAN_2026-09-19.md) and [the exit decisions](docs/BASE44_EXIT_DECISIONS_2026-09-19.md). A `broker` disposition is checked against the entity's schema under D2's ceiling — no PHI, no authority decision — and is refused for a table that reaches tenancy through a clinical entity, names a clinical subject, carries a credential (a `code` counts when the row also has an expiry or verification marker) or can hold a file; an exemption is enumerated per field in the manifest's `broker_ceiling` block with a reason, and a stale one fails. Adding a carried entity whose schema names no agency requires a kind in `tools-tenant-decision.json`, and `agency` is the default: `global` is re-checked against the schema and refused if the table carries an actor column, references a carried entity or can hold a file. Adding a backend function, entity schema, workflow or Core integration requires a disposition in `tools-transition-disposition.json`; a function whose module can do no work (no import, await, network, environment or Base44 client, and no request read beyond the method) cannot be `port`, `broker` or `hub`, so pausing an endpoint means moving it to `preserved_paused` or `retire` in the same change. The same holds for a handler **paused at source** — a module-level flag pinned `false` whose guard returns a refusal. That module usually still imports and awaits, so the inert check cannot see it, and nine such capabilities sat in the port queue as writable work until they were measured. Switching a capability off means changing its disposition in the same change. The port queue's blocker categories are measured from each module, never inferred from the feature: a handler that only calls a Core integration waits on the runtime rather than the record store, and one that touches an uploaded file waits on the file layer, because the shared SSRF allowlist names Base44's own storage host. Retiring an *entity* additionally needs a retention basis in the manifest's `retention` block — six years in the export archive if its rows hold any identifier, the named system if it only mirrored one, `none` only for operational or synthetic rows — because `retire` decides the target store and never means delete. Adding Base44 coupling to `src/` fails the surface ratchet. Both run in `pnpm test`.

The record store migration (`services/authority-store/supabase/record-migrations/20260919170000_record_store.sql`) is generated, not written: change the entity definitions, the tenant decisions or the generator and re-run `node tools-entity-schema-plan.mjs --write-migration`. A test fails if the committed SQL and the generator disagree. Its tables are owned by `pennsync_records_owner`, which must never hold `SUPERUSER` or `BYPASSRLS` — either one silently voids all 596 policies — and it grants no caller role anything, because an RLS policy runs with the querying role's privileges, so a caller holding a table would also need the helpers that decide who it is.

Use pnpm through Corepack. Do not use npm or yarn for installs.

## Running, building, and testing

Standard scripts are in `package.json` and `README.md`. Notable points:

- `pnpm run dev` starts only the Vite dev server (default `http://localhost:5173`) inside the cloud environment.
- `pnpm test` runs the utility/core, schema/contract, security, deduplication, and component/page suites.
- `pnpm run lint` is clean: 0 errors AND 0 warnings. Keep it that way — a new warning is a real finding, not background noise. Coverage includes `src/App.jsx`, `src/main.jsx`, and `src/routes.jsx`.
- `pnpm run typecheck` is an informational baseline in CI (`continue-on-error`); it may report pre-existing errors and is not a gate.
- `pnpm run typecheck:signal` **is** a CI gate (CI + Workflow Quality). It filters the checkJs pass to high-signal defect codes; keep it at 0 findings.
- Accessibility axe runs on PRs/`main` via `.github/workflows/a11y.yml` (`test:a11y` + Playwright public routes). Local: `pnpm run build && pnpm run test:a11y:e2e`.
- Backend/Deno function syntax checks and Base44 inline-parity tests transpile via `tools-transpile-ts.mjs` (esbuild), not the classic `typescript.transpileModule` API — so TypeScript 7+ is supported for `tsc`/typecheck.
- CI uses Node 24.18.0 with pnpm 11.9.0. Use `.nvmrc` / `.node-version` plus Corepack in cloud environments.

| Task | Command |
| --- | --- |
| Install | `pnpm install --frozen-lockfile` |
| Dev server | `pnpm run dev` |
| Build | `pnpm run build` |
| Lint | `pnpm run lint` |
| Typecheck baseline | `pnpm run typecheck` |
| High-signal typecheck (gate) | `pnpm run typecheck:signal` |
| Accessibility (component) | `pnpm run test:a11y` |
| Accessibility (Playwright) | `pnpm run build && pnpm run test:a11y:e2e` |
| Tests | `pnpm test` |
| Capability dispositions (gate) | `pnpm run check:transition-disposition` |
| Base44 coupling ratchet (gate) | `pnpm run check:base44-surface` |
| File-reference census (gate) | `pnpm run check:file-references` |
| Entity schema plan (gate) | `pnpm run check:entity-schema-plan` |
| Tenant paths (gate) | `pnpm run check:tenant-paths` |
| Tenant decisions (gate) | `pnpm run check:tenant-decisions` |
| Emit candidate schema SQL | `pnpm run emit:entity-schema` |
| Regenerate the record store migration | `node tools-entity-schema-plan.mjs --write-migration` |
| Ported business API | `pnpm run test:pennsync-api` |

## Environment config

`VITE_PENNSYNC_BACKEND` selects the backend. Omitted or `base44` keeps the production path; `independent-staging` requires the `VITE_PENNSYNC_STAGING_*` values documented in `.env.example` and `docs/INDEPENDENT_STAGING_APP.md`, and fails closed before a Base44 client can be constructed if any of them is missing or invalid.

On the Base44 path the frontend reads `VITE_BASE44_APP_ID` and `VITE_BASE44_BACKEND_URL` (consumed in `src/lib/app-params.js`), the optional exact `VITE_BASE44_FUNCTIONS_VERSION`, and the optional `VITE_SUPER_ADMIN_EMAIL` override used by `src/lib/superAdmin.js`. Function-revision URL and storage overrides are scrubbed; floating version aliases are rejected. The Vite dev server boots regardless, but without a valid app id + backend URL the app shows a blocking config state or redirects to `/login` and renders blank because `/login` is served by the hosted backend, not client-side.

App id and backend URL can also be passed via URL params `?app_id=...&server_url=...`, which are persisted to localStorage. Other vars such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `HEYGEN_API_KEY`, and `SIGNATURE_HMAC_SECRET` are backend Deno-function secrets and are not used by the local frontend bundle.

## Testing the running app in a browser without backend credentials

- Authenticated routes are gated; without a real backend they redirect to `/login` and may appear blank.
- `/signer` renders a static signing-unavailable state and `/join` renders an "Invalid Visit Link" card with no token. Use these to verify the SPA renders in a browser. Do not treat the quarantined signer or provider-follow-up routes as end-to-end capability tests.
- Console 404s against the backend origin such as "App not found" are expected when `VITE_BASE44_APP_ID` or `VITE_BASE44_BACKEND_URL` points at a non-existent app.
- Core clinical logic (OASIS scoring in `src/components/oasis/`, PDGM grouping in `src/components/pdgm/pdgmGrouper.js`, SmartNote compliance, fax/SMS/voice utils) is pure and covered by the automated test suite.

## Full end-to-end authenticated flows

Logging in and exercising patient/clinical workflows requires a real hosted Base44 app. Set `VITE_BASE44_APP_ID` and `VITE_BASE44_BACKEND_URL` in Codex environment settings and use valid login credentials. These are not present in the default cloud environment.

## Debugging expectations

When asked to debug, do not make a small isolated patch unless the user explicitly asks for one.

Always:

- Inspect the full feature path and related files.
- Identify root causes before editing.
- Create a complete bug inventory first.
- Check for duplicated patterns elsewhere.
- Run lint, typecheck, tests, and build when available.
- Add or update tests when practical.
- Review the final diff for regressions.

## Done means

A task is not complete until:

- All known related bugs have been listed.
- Safe fixes have been implemented.
- Validation commands have been run or clearly explained if unavailable.
- Remaining risks are documented.
