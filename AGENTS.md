# AGENTS.md

Instructions for Codex cloud and other AI coding agents working in this repository.

## Codex cloud environment

- Configure this repository in Codex cloud settings with Node 24.18.0 or newer and pnpm 11.9.0.
- Setup script:

  ```bash
  corepack enable
  corepack prepare pnpm@11.9.0 --activate
  pnpm install --frozen-lockfile
  ```

- Store `VITE_BASE44_APP_ID`, `VITE_BASE44_BACKEND_URL`, OpenAI, Anthropic, HeyGen, HMAC, and other service credentials in Codex environment variables or secrets. Do not commit `.env` files.
- Telnyx credentials are configured in-app through `IntegrationSecret`, not through frontend environment variables.

## Project shape

PennSync (package `base44-app`) is a frontend-only Vite + React 19 SPA. There is no local backend to run: the Base44 platform (auth, data entities, and the Deno functions under `base44/functions/`) is a hosted remote service. Those Deno functions are not runnable from this repo because there is no `deno.json` or local runner; `src/functions/*` are thin client wrappers that call the remote backend.

Use pnpm through Corepack. Do not use npm or yarn for installs.

## Running, building, and testing

Standard scripts are in `package.json` and `README.md`. Notable points:

- `pnpm run dev` starts only the Vite dev server (default `http://localhost:5173`) inside the cloud environment.
- `pnpm test` runs `test:utils` (node `--test`) then `test:components` (Vitest/jsdom).
- `pnpm run lint` currently reports warnings only (0 errors); treat lint as passing when there are still 0 errors.
- `pnpm run typecheck` is an informational baseline in CI (`continue-on-error`); it may report pre-existing errors and is not a gate.
- CI uses Node 24.18.0 with pnpm 11.9.0. Use `.nvmrc` / `.node-version` plus Corepack in cloud environments.

| Task | Command |
| --- | --- |
| Install | `pnpm install --frozen-lockfile` |
| Dev server | `pnpm run dev` |
| Build | `pnpm run build` |
| Lint | `pnpm run lint` |
| Typecheck baseline | `pnpm run typecheck` |
| Tests | `pnpm test` |

## Environment config

The only vars the frontend reads are `VITE_BASE44_APP_ID` and `VITE_BASE44_BACKEND_URL` (consumed in `src/lib/app-params.js`). The Vite dev server boots regardless, but without a valid app id + backend URL the app shows a blocking config state or redirects to `/login` and renders blank because `/login` is served by the hosted backend, not client-side.

App id and backend URL can also be passed via URL params `?app_id=...&server_url=...`, which are persisted to localStorage. Other vars such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `HEYGEN_API_KEY`, and `SIGNATURE_HMAC_SECRET` are backend Deno-function secrets and are not used by the local frontend bundle.

## Testing the running app in a browser without backend credentials

- Authenticated routes are gated; without a real backend they redirect to `/login` and may appear blank.
- Public capability-token pages render fully client-side: `/signer` renders an "Access Denied" card with no token, and `/join` renders an "Invalid Visit Link" card with no token. Use these to verify the SPA renders in a browser.
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
