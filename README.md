# PennSync by CareMetric

PennSync by CareMetric is an AI-powered home health documentation and analytics platform for clinicians. It's a Vite + React application with a large healthcare operations surface area (clinical documentation, OASIS/PDGM, training, fax, compliance, reporting, and admin workflows).

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


## Environment variables

Copy `.env.example` to `.env` and set the required values:

- `VITE_BASE44_APP_ID` — Base44 application ID.
- `VITE_BASE44_BACKEND_URL` — Base44 backend origin used by the SDK and auth bootstrap requests.
- `VITE_SUPER_ADMIN_EMAIL` — platform-owner email for frontend UI gating; super-admin UI also requires Base44's protected `role=admin`.
- `SUPER_ADMIN_EMAIL` — matching backend function setting for platform-owner-only operations; missing configuration fails closed.
- `BASE44_LEGACY_SDK_IMPORTS` — optional build toggle for legacy SDK import compatibility.

## Project structure (high level)

- `src/pages` — route-level page components
- `src/components` — reusable and domain components
- `src/lib` — application infrastructure (auth, query client, routing helpers)
- `src/api` — API/domain access layer
- `functions` — backend function handlers
- `docs` — engineering review and planning docs

## Notes

- The frontend uses `@` path aliasing to `src/*`.
- App routing is currently defined in `src/App.jsx`.
