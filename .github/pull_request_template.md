## Summary
- 

## Testing
- [ ] `pnpm run lint`
- [ ] `pnpm test`
- [ ] `pnpm run lint:actions`
- [ ] `pnpm run build`

## Deployment / environment notes
- PennSync is a frontend-only Vite + React SPA; Base44 auth, entities, and Deno functions are hosted remotely.
- Local authenticated flows require valid `VITE_BASE44_APP_ID` and `VITE_BASE44_BACKEND_URL` values in `.env` or URL params.
- If backend helper snippets or inline Base44 function helpers changed, run `pnpm run check:shared-helpers` and `pnpm run check:backend-transpile`.

## Screenshots
- Add screenshots or note `N/A` for non-visual changes.
