# Accessibility / axe testing (P2-02) — How to run

## What was added

| Layer | Location | Runs without staging? |
|---|---|---|
| Smoke matrix (public + auth inventory) | `src/lib/accessibilitySmokeMatrix.js` | Yes (metadata only) |
| Component axe (Vitest + jsdom) | `*.a11y.test.jsx` | Yes |
| Browser axe (Playwright) | `e2e/a11y-public.spec.js` | Yes for public routes |
| Authenticated routes | Matrix only | **No** — needs LR-02 staging |

## Install (once)

```bash
pnpm install
pnpm run test:a11y:e2e:install   # Chromium for Playwright
```

## Component-level axe (CI-friendly)

```bash
pnpm run test:a11y
# or included in:
pnpm run test:components
```

Scans:

- `AccessDeniedState`
- `PrivacyPolicy` (public)
- `JoinTelehealth` invalid-link state

Color-contrast is disabled under jsdom (not reliable). Contrast is enforced in the Playwright suite.

## Public route browser axe

```bash
pnpm run build
pnpm run test:a11y:e2e
```

Against staging (no local server):

```bash
PLAYWRIGHT_BASE_URL=https://your-staging.example pnpm run test:a11y:e2e
```

Driven by `publicAccessibilityRoutes()` from the matrix (`/privacy`, `/join`, `/signer`, `/followup`).
Fails on **serious** or **critical** violations only.

## Authenticated routes (LR-02)

`AUTHENTICATED_ACCESSIBILITY_SMOKE_ROUTES` lists Dashboard, Patients, ClinicalDocumentation, UserManagement, ReportsAnalytics, OfflineMode.

Do **not** enable these in CI until:

1. Staging URL + nurse/admin test users exist (LR-02)
2. A Playwright auth setup (storageState) is added
3. Product agrees on WCAG target level

## Optional CI workflow

`.github/workflows/a11y.yml` is **workflow_dispatch** only so main PR CI stays green until deps are installed on runners and public routes are confirmed clean.

## ESLint

`eslint-plugin-jsx-a11y` remains **warn**-level for static JSX. Promote individual rules to error after the backlog is clean.
