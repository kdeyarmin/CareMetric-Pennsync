# P2-02 Accessibility / axe implementation — 2026-07-30

## Delivered

| Track | Status |
|---|---|
| A. Component Vitest + vitest-axe | Done — `*.a11y.test.jsx` + setup matchers |
| B. Playwright + @axe-core/playwright | Done — `e2e/a11y-public.spec.js` |
| C. Authenticated matrix expansion | Done — inventory only until LR-02 |

## Files

- `src/lib/accessibilitySmokeMatrix.js` — public + authenticated routes
- `src/test/setup.js` — `vitest-axe/matchers`
- `src/components/ui/AccessDeniedState.a11y.test.jsx`
- `src/pages/PrivacyPolicy.a11y.test.jsx`
- `src/pages/JoinTelehealth.a11y.test.jsx`
- `playwright.config.js`
- `e2e/a11y-public.spec.js`
- `.github/workflows/a11y.yml` — workflow_dispatch only
- `docs/audits/A11Y_AXE_HOWTO.md`
- `package.json` — `test:a11y`, `test:a11y:e2e`, deps

## Local first run

```bash
pnpm install
pnpm run test:a11y
pnpm run build && pnpm run test:a11y:e2e:install && pnpm run test:a11y:e2e
```

## Note on lockfile

`pnpm-lock.yaml` must be regenerated on a machine with network after pulling these `package.json` deps. CI will fail install until the lockfile is updated.

PR: #107
