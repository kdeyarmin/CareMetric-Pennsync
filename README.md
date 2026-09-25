# PennSync by CareMetric

PennSync by CareMetric is an AI-powered home health documentation and analytics platform for clinicians. It's a Vite + React application with a large healthcare operations surface area (clinical documentation, OASIS/PDGM, training, fax, compliance, reporting, and admin workflows).

## Backends

The product is migrating off Base44. Two backends exist in this repository and
the frontend selects one at build time with `VITE_PENNSYNC_BACKEND`.

| Value | Backend | State |
| --- | --- | --- |
| unset or `base44` | Hosted Base44 platform: auth, entities, and the Deno functions under `base44/functions/` | The production path |
| `independent-staging` | Supabase Auth and the owned authority store in `services/authority-store`, reached through `services/authority-client` | Synthetic staging only, four fixed test accounts |

Two Railway services support the independent path, and both are deployed and
released as of 2026-09-25. `services/integration-runtime` runs the external
AI, email and private-file adapters; it serves the two AI operations and,
since 2026-09-25, `SendEmail`, with its browser route off and its browser
operation list empty.
`services/pennsync-api` is the home for backend handlers ported out of Base44
and serves all 80 of its names, including the two account-email senders.
Outbound delivery was switched on on 2026-09-25, so those two can now send
real mail; the switch permitting it lives on `services/pennsync-api`. Read `/readyz` on either
rather than this paragraph, and note that the two deploy by different
mechanisms: a variable change redeploys either service from `main`'s tip, and
`services/integration-runtime` additionally deploys on every merge touching
its directory, without waiting for CI. Either way what runs moves without
anything here changing.

Start here to work on the migration:

- [Transition plan](docs/BASE44_TO_RAILWAY_TRANSITION_PLAN_2026-09-19.md) — what is done, what remains, and the phased plan.
- [Railway go-live plan](docs/RAILWAY_GO_LIVE_PLAN_2026-09-21.md) — the hosted state measured by live probe, and the stages left to finish the move.
- [Exit decisions](docs/BASE44_EXIT_DECISIONS_2026-09-19.md) — the eight decisions the implementation assumes.
- `tools-transition-disposition.json` — the per-capability disposition for all 549 functions, entities, workflows and integrations.
- [Independent staging app](docs/INDEPENDENT_STAGING_APP.md) — how to run the independent build.

## GitHub and contributing

- See [CONTRIBUTING.md](CONTRIBUTING.md) for local setup, validation commands, and pull request expectations.
- GitHub Actions CI runs workflow linting, app linting, tests, shared-helper checks, Base44 function syntax checks, and production builds on pull requests.
- Dependabot is configured for the pnpm/npm ecosystem and GitHub Actions updates.

## Scripts

- `pnpm run dev` — start local dev server
- `pnpm run build` — production build
- `pnpm run preview` — preview production build
- `pnpm run lint` — run ESLint
- `pnpm run lint:fix` — auto-fix lint issues where possible
- `pnpm run typecheck` — run TypeScript checker against `jsconfig.json`
- `pnpm run check:updates` — dependency update audit script

Migration checks:

- `pnpm run check:transition-disposition` — every capability carries a disposition, no function that can perform no work is declared `port`, `broker` or `hub`, and every retired entity says where its existing rows go
- `pnpm run check:base44-surface` — remaining Base44 coupling stays within its baseline
- `pnpm run check:ported-call-sites` — every `src/` call site reaching a ported capability names a tenant, or is pinned as one that still does not
- `pnpm run check:file-references` — the schema file-reference census is current
- `pnpm run check:entity-schema-plan` — the candidate PostgreSQL schema matches the entity definitions
- `pnpm run check:tenant-paths` — how each carried entity reaches its agency; `node tools-tenant-path.mjs --blocking` lists the ones that cannot
- `pnpm run emit:entity-schema` — print the generated schema SQL
- `pnpm run test:pennsync-api` — the ported business API and its port parity guards

Migrating a deployment:

- `node tools-pennsync-provision.mjs` — build a store from nothing: pin the deployment, then apply every migration. Refuses a database that already holds one.
- `node tools-pennsync-migrate.mjs` — bring a store that already exists up to the committed migrations. Plans by default; applies with `--apply`. Refuses a database with no store, so between the two every database has exactly one right tool.


## Environment variables

Copy `.env.example` to `.env` and set the required values.

Backend selection (see `.env.example` for the independent-mode settings):

- `VITE_PENNSYNC_BACKEND` — omitted or `base44` keeps the production path; `independent-staging` selects Supabase and the owned authority store.

Base44 path:

- `VITE_BASE44_APP_ID` — Base44 application ID.
- `VITE_BASE44_BACKEND_URL` — Base44 backend origin used by the SDK and auth bootstrap requests.
- `VITE_SUPER_ADMIN_EMAIL` — platform-owner email for frontend UI gating; super-admin UI also requires Base44's protected `role=admin`.
- `SUPER_ADMIN_EMAIL` — matching backend function setting for platform-owner-only operations; missing configuration fails closed.
- `BASE44_LEGACY_SDK_IMPORTS` — optional build toggle for legacy SDK import compatibility.
- `VITE_CENTRAL_HELP_ENABLED` — optional first-party Support Hub control for the production CareMetric Base44 app. A build is enabled only when its immutable app ID matches and `VITE_DEPLOY_ENV` is exactly `production`; an omitted flag enables that verified production build, while an explicit value other than the exact string `true` disables it. Preview/development, staging, and every other app ID remain off. `/Help` remains available as the local fallback.
- `VITE_DEPLOY_ENV` — required central-help activation gate and allowlisted context label: `production`, `staging`, or `development`.
- `VITE_APP_VERSION` — optional version-shaped release token sent for version-aware help overlays (for example, `3.8.2` or `2026.09.07+abc123`). UUIDs, names, arbitrary labels, and values over 48 characters are rejected.

The Help launcher always uses the first-party SDK's fixed production Hub origin.
It sends only the product slug, a manifest-allowlisted route, the release token,
`en-US`, and the deployment label. Query strings, fragments, record identifiers,
user/tenant/patient data, tokens, and free text are never added to the URL.

## Project structure (high level)

- `src/pages` — route-level page components
- `src/components` — reusable and domain components
- `src/lib` — application infrastructure (auth, query client, routing helpers)
- `src/api` — API/domain access layer
- `base44/functions` — hosted Base44 Deno function handlers
- `services/authority-store` — owned PostgreSQL authority schema and its migrations
- `services/authority-client` — strict client for that authority
- `services/integration-runtime` — Railway service for AI, email and private files
- `services/pennsync-api` — Railway service for handlers ported out of Base44
- `services/hhgs-adapter` — offline CMS grouper adapter
- `docs` — engineering review and planning docs

## Notes

- The frontend uses `@` path aliasing to `src/*`.
- App routing is currently defined in `src/App.jsx`.
