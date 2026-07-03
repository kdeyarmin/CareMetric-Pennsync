# PennSync by CareMetric

PennSync by CareMetric is an AI-powered home health documentation and analytics platform for clinicians. It's a Vite + React application with a large healthcare operations surface area (clinical documentation, OASIS/PDGM, training, fax, compliance, reporting, and admin workflows).

## GitHub and contributing

- See [CONTRIBUTING.md](CONTRIBUTING.md) for local setup, validation commands, and pull request expectations.
- GitHub Actions CI runs linting, tests, shared-helper checks, Base44 function syntax checks, and production builds on pull requests.
- Dependabot is configured for npm and GitHub Actions updates.

## Scripts

- `npm run dev` — start local dev server
- `npm run build` — production build
- `npm run preview` — preview production build
- `npm run lint` — run ESLint
- `npm run lint:fix` — auto-fix lint issues where possible
- `npm run typecheck` — run TypeScript checker against `jsconfig.json`
- `npm run check:updates` — dependency update audit script


## Environment variables

Copy `.env.example` to `.env` and set the required values:

- `VITE_BASE44_APP_ID` — Base44 application ID.
- `VITE_BASE44_BACKEND_URL` — Base44 backend origin used by the SDK and auth bootstrap requests.
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
