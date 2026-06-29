# AGENTS.md

## Cursor Cloud specific instructions

PennSync (package `base44-app`) is a **frontend-only** Vite + React 19 SPA. There is
**no local backend to run**: the Base44 platform (auth, data entities, and the
~150 Deno functions under `base44/functions/`) is a **hosted remote service**.
Those Deno functions are not runnable from this repo (no `deno.json`/local runner);
`src/functions/*` are thin client wrappers that call the remote backend.

### Running / building / testing
Standard scripts are in `package.json` and `README.md`. Notable points:
- `npm run dev` starts **only** the Vite dev server (default `http://localhost:5173`).
- `npm test` runs `test:utils` (node `--test`) then `test:components` (Vitest/jsdom).
- `npm run lint` currently reports warnings only (0 errors) — treat lint as passing.
- `npm run typecheck` is an **informational baseline** in CI (`continue-on-error`); it
  may report pre-existing errors and is not a gate.
- CI uses Node 20; the VM has Node 22, which builds/tests/lints fine.

### Environment config (required for the app to actually render)
- Copy `.env.example` to `.env`. The only vars the frontend reads are
  `VITE_BASE44_APP_ID` and `VITE_BASE44_BACKEND_URL` (consumed in
  `src/lib/app-params.js`). The Vite dev server boots regardless, but without a
  **valid** app id + backend URL the app shows a blocking config state or redirects
  to `/login` and renders blank (the `/login` route is served by the hosted backend,
  not client-side). All other `.env` vars (`TELNYX_*`, `OPENAI_API_KEY`, etc.) are
  **backend Deno-function secrets**, not used by the local frontend.
- App id / backend URL can also be passed via URL params `?app_id=...&server_url=...`
  (persisted to localStorage).

### Testing the running app in a browser without backend credentials
- Authenticated routes are gated; without a real backend they redirect to `/login`
  (blank). The only routes that render fully client-side are the public capability-token
  pages: `/signer` (renders an "Access Denied" card with no token) and `/join`
  (renders an "Invalid Visit Link" card with no token). Use these to verify the SPA
  renders in a browser.
- Console 404s against the backend origin (e.g. "App not found") are **expected**
  when `VITE_BASE44_APP_ID`/`VITE_BASE44_BACKEND_URL` point at a non-existent app.
- The product's core clinical logic (OASIS scoring `src/components/oasis/`, PDGM
  grouping `src/components/pdgm/pdgmGrouper.js`, SmartNote compliance, fax/SMS/voice
  utils) is pure and fully covered by the automated test suite — run the tests to
  validate core functionality without a backend.

### Full end-to-end (authenticated) flows
Logging in and exercising patient/clinical workflows requires a real hosted Base44
app: set `VITE_BASE44_APP_ID` + `VITE_BASE44_BACKEND_URL` to a live app and have
valid login credentials. These are not present in the default cloud environment.
