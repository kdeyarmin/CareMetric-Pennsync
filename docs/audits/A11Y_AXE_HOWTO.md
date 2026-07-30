# Accessibility / axe testing (P2-02) — How to run

## No local machine required

If you cannot run Node/pnpm on your computer:

1. Open the repo on GitHub → **Actions**
2. Select **Install a11y deps (no local machine)**
3. **Run workflow** on branch `wire-p1-pure-helpers`
4. That job installs `vitest-axe`, `@playwright/test`, and `@axe-core/playwright`, then **commits** the lockfile
5. After it finishes, PR #107 CI should stay green and a11y assertions will activate
6. Optionally run **Accessibility (axe)** for Playwright public-route scans

Until that install job runs, component a11y tests **soft-skip** (they do not fail CI). New packages are **not** listed in `package.json` yet so `pnpm install --frozen-lockfile` stays green.

## What is already on the branch

| Layer | Location | Needs package install? |
|---|---|---|
| Smoke matrix (public + auth) | `src/lib/accessibilitySmokeMatrix.js` | No |
| Component axe specs | `*.a11y.test.jsx` + `src/test/axeHelpers.js` | Soft-skip without `vitest-axe` |
| Browser axe | `e2e/a11y-public.spec.js` | Yes (after install workflow) |
| Auth routes | Matrix inventory only | Staging / LR-02 |

## After the install workflow

```bash
pnpm run test:a11y
pnpm run build && pnpm run test:a11y:e2e:install && pnpm run test:a11y:e2e
```

Staging:

```bash
PLAYWRIGHT_BASE_URL=https://your-staging.example pnpm run test:a11y:e2e
```

Public routes: `/privacy`, `/join`, `/signer`, `/followup`. Fails on **serious/critical** only.

## Authenticated routes (LR-02)

`AUTHENTICATED_ACCESSIBILITY_SMOKE_ROUTES` lists Dashboard, Patients, ClinicalDocumentation, UserManagement, ReportsAnalytics, OfflineMode. Not CI-runnable without staging credentials.

## ESLint

`eslint-plugin-jsx-a11y` stays **warn**-level for static JSX.
