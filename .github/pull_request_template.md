## Summary
- 

## Feature / workflow evidence
- [ ] Affected user roles and workflows are described.
- [ ] Data persistence, status/lifecycle effects, and rollback considerations are described.
- [ ] Permission, tenant-isolation, and PHI/privacy impacts are described, or explicitly marked N/A.
- [ ] Audit/backlog/roadmap docs were updated, or explicitly marked N/A.

## Testing
- [ ] `pnpm run lint`
- [ ] `pnpm test`
- [ ] `pnpm run lint:actions`
- [ ] `pnpm run build`

## Deployment / environment notes
- PennSync is a frontend-only Vite + React SPA; Base44 auth, entities, and Deno functions are hosted remotely.
- Local authenticated flows require valid `VITE_BASE44_APP_ID` and `VITE_BASE44_BACKEND_URL` values in `.env` or URL params.
- If backend helper snippets or inline Base44 function helpers changed, run `pnpm run check:shared-helpers` and `pnpm run check:backend-transpile`.
- If SSO, audit export, public portal, communications, or AI governance behavior changed, document the required hosted/staging verification and any unavailable credentials.

## Screenshots
- Add screenshots or note `N/A` for non-visual changes.

## Merge (stacked PRs)
- Classic REST / `gh pr merge` **cannot** merge stacked PRs (`403 … Use the web interface instead`).
- Prefer **Merge** in the GitHub UI, or `gh stack merge` — see `CONTRIBUTING.md` → *Stacked PRs and merging*.
