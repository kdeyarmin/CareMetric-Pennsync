# Contributing to PennSync

PennSync is a frontend-only Vite + React SPA. Base44 authentication, data entities, and the Deno functions under `base44/functions/` run on the hosted Base44 platform, not from this repository.

## Local setup

1. Install dependencies with `npm ci`.
2. Copy `.env.example` to `.env`.
3. Set `VITE_BASE44_APP_ID` and `VITE_BASE44_BACKEND_URL` for a real hosted Base44 app if you need authenticated routes.
4. Start Vite with `npm run dev`.

Without valid Base44 credentials, authenticated app routes may redirect to `/login` or show a blocking configuration state. Public capability-token routes such as `/signer` and `/join` can still be used for basic SPA rendering checks.

## Validation before opening a pull request

Run the same core checks that GitHub CI runs:

```bash
npm run lint
npm test
npm run check:shared-helpers
npm run check:backend-transpile
npm run build
```

`npm run typecheck` and `npm run audit:prod` are useful informational baselines, but they are configured as non-blocking in CI.

## Pull request expectations

- Use the pull request template and include a concise summary plus exact tests/checks run.
- Add screenshots for visible UI changes when feasible.
- Keep backend helper snippets in sync by running `npm run check:shared-helpers` after shared helper edits.
- Do not add real secrets to `.env`, source files, screenshots, or pull request text.
