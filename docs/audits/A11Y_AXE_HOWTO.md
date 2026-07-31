# Accessibility / axe testing (P2-02)

## Architecture

| Piece | Path |
|---|---|
| Shared axe-core rules | `src/lib/axeRules.js` |
| Playwright + axe helper | `e2e/axePlaywright.js` |
| Public route specs | `e2e/a11y-public.spec.js` |
| Component helper | `src/test/axeHelpers.js` |
| Smoke matrix | `src/lib/accessibilitySmokeMatrix.js` |

### Rule policy (`axeRules.js`)

- **Tags:** `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`
- **Fail gate:** `critical` + `serious` only (moderate/minor do not fail CI)
- **jsdom:** disables `color-contrast`, `link-in-text-block`
- **Browser:** contrast enabled; add exceptions only in `AXE_BROWSER_DISABLED_RULES`

### Playwright integration (`axePlaywright.js`)

```js
import { expectNoSeriousAxeViolations } from './axePlaywright.js';

await page.goto('/privacy');
await expectNoSeriousAxeViolations(page, '/privacy');
```

Uses `@axe-core/playwright` `AxeBuilder` with shared tags + disabled rules.

## No local machine

1. **Actions** → **Install a11y deps** (already ran if packages are in `package.json`)
2. **Actions** → **Accessibility (axe)** → Run workflow  
   Runs rule unit tests, Vitest component axe, and Playwright public-route axe.

## Scripts

```bash
node --test src/lib/axeRules.test.js
pnpm run test:a11y
pnpm run build && pnpm run test:a11y:e2e
PLAYWRIGHT_BASE_URL=https://staging.example pnpm run test:a11y:e2e
```

## Authenticated routes

Listed in `AUTHENTICATED_ACCESSIBILITY_SMOKE_ROUTES` — inventory only until LR-02 staging auth exists.
