# Phase 10 Implementation Plan

_Audit follow-up date: 2026-07-22. Scope: non-blocking live-readiness report CLI._

## Phase 10 goals

- Provide a manual/dry-run command that can consume the Phase 9 CI report contract before any CI enforcement is approved.
- Keep the workflow non-blocking and local: the command reads a JSON evidence file, emits a PHI-minimized readiness report, and exits with a status code only for the local caller.
- Preserve application behavior; no hosted integrations, migrations, permissions, routes, UI changes, or GitHub Actions workflow changes are included.

## Included work

| Work item | Purpose |
|---|---|
| CLI report command | Add a `tools-live-readiness-report.mjs` helper for local/dry-run report generation. |
| Package script | Add a discoverable `pnpm run readiness:report -- <file>` script. |
| CLI tests | Verify pass, fail, invalid JSON, and missing argument behavior. |
| Documentation | Record Phase 10 status, validation, and remaining CI/artifact-storage dependencies. |

## Excluded work

- No branch-protection enforcement, GitHub Actions workflow, artifact upload, hosted Base44 access, or production deployment automation.

## Current state after revalidation

- Phase 9 added a stable CI report contract, but reviewers still need a simple way to generate the report from a local evidence JSON file before choosing CI enforcement.

## Proposed implementation

1. Add `tools-live-readiness-report.mjs` with a reusable `runLiveReadinessReportCli` function and direct CLI entrypoint.
2. Add `tools-live-readiness-report.test.mjs` covering local pass/fail/error behavior.
3. Add `readiness:report` to `package.json`.
4. Update audit docs and completion report.

## Acceptance criteria

- The CLI prints a JSON report for a valid input file.
- The CLI returns exit code `0` only when the report status is `pass`.
- The CLI returns exit code `1` for readiness failures and `2` for usage/input errors.
- The CLI does not print raw evidence values beyond the PHI-minimized Phase 9 report contract.
