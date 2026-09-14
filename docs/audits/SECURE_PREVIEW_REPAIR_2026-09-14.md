# Secure preview startup repair — September 14, 2026

## Verified outcome

The existing CareMetric AI app, `694ec16e72e01b60d22f7cbf`, now offers a working secure preview launch instead of treating every embedded preview as a broken browser. Functional and test closeout commit: `f5f3b645e9a155da4d66de17a077b83b08e62f11`.

An authenticated browser check using the owner's saved session verified the correct Base44 editor, observed the new **Open a secure preview** panel, clicked **Open preview in a new tab**, and reported that the app opened without APP_IMPORT, APP_MOUNT, or LINK_GUARD errors. The normal preview URL returned was `https://preview--caremetricai.base44.app/`. This verified startup, not authenticated clinical transactions. No production Publish action was taken.

## Cause and repair

The previous bootstrap used one generic privacy-error screen for three different conditions: an embedded frame that was deliberately prohibited, a failed native privacy guard, or an application import/mount failure. That made a protected editor preview appear indistinguishable from a broken browser.

The new dependency-free pre-bootstrap UI keeps embedded frames inert and provides a clean same-origin-root launch in a separate tab. It discards the source URL's path, query, and fragment; rejects unsafe schemes and credential-bearing URLs; and uses noopener, noreferrer, and no-referrer. It does not copy login tokens, patient identifiers, return URLs, or browser storage. The new tab bootstraps normally and must establish its own app session.

Native guard failures remain blocked with specific non-sensitive support codes and an explicit reload control. App import/mount failures now show an application-loading error rather than falsely reporting a browser privacy failure. The top-level-only bootstrap policy, authority invalidation, clipboard/file/window guards, backend rules, and clinical/outbound gates were not weakened or removed.

A source contract originally banned every unmediated blank-target link, including this inert pre-bootstrap launcher. Its narrow exception now requires that only main.jsx consumes the helper, the helper imports no app/SDK/auth modules, it cannot send requests or read storage, and the launch contains no URL state with opener/referrer isolation. The prohibition remains everywhere in clinical application source. Real-browser tests verify the exception's behavior and that a failed native guard still blocks all app/API startup.

## Validation

All final exact-head GitHub workflows completed successfully:
- CI: run `34905489022`, job `104181059352`.
- Component Tests: run `34905489069`.
- Accessibility: run `34905489002`.

CI passed the clean frozen install, Base44 Node 20.20.2/npm 10.8.2 compatibility check, lint, complete application test command, OASIS worksheet check, shared helpers, backend syntax/targets, high-signal typecheck, and build. The informational type/audit steps are not a claim that their broader baselines have zero findings.

Additional local checks passed: 97 focused tests across eight files with retries disabled; 10 real Chromium tests covering the seven public routes, isolated embedded launch, top-level startup, and fail-closed native guard behavior; 281 backend syntax/target checks; and 225 shared-helper consumers. The focused tests and production build/browser checks also passed in a fresh pnpm dependency installation, not just the managed sandbox's mixed installation. The final test import uses the directly declared testing-library/react dependency rather than relying on an undeclared transitive testing-library/dom package.

The previously repaired pins remain eslint 9.39.5, @eslint/js 9.39.5, and vitest 4.1.11. No runtime dependency declaration, schema, backend function, mobile identity, domain, visibility setting, patient record, or credential changed in this preview repair.

## Boundaries still open

The Base44 AI builder's separate context-limit request `417559a7-920b-4b26-b868-84b9be7f5123` is not verified resolved. Direct connector edits completed this repair without requiring that builder conversation; existing support case #6aa84d1f remains relevant to provider-side issues.

At `2026-09-14T22:39:50Z`, unsigned reads of both production origins still referenced the older static entry containing revision `34bc0d3bb4ea2c7db941416733ad8d12f19ead1f`. This repair was not a production publication. Signing/billing continuity, physical-device acceptance, authenticated clinical workflows, and the full production/mobile release are separate outstanding qualifications.
