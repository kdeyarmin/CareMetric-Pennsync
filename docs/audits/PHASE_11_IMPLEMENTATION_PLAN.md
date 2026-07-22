# Phase 11 Implementation Plan

_Audit follow-up date: 2026-07-22. Scope: live-readiness evidence input validation._

## Phase 11 goals

- Strengthen the Phase 10 local readiness-report CLI by validating evidence JSON shape before report generation.
- Provide precise, PHI-safe input errors for missing release objects, malformed evidence entries, invalid matrix rows, and invalid reviewer maps.
- Preserve application behavior; no hosted integrations, migrations, permissions, UI changes, or CI workflow changes are included.

## Included work

| Work item | Purpose |
|---|---|
| Input validator | Add a pure validator for readiness JSON files consumed by the CLI. |
| CLI integration | Return a usage/input error when the JSON file shape is invalid. |
| Tests | Cover valid input, invalid release/evidence/matrix/reviewer shapes, and CLI validation errors. |
| Documentation | Record Phase 11 status, validation, and remaining artifact/CI dependencies. |

## Excluded work

- No schema registry, artifact upload, GitHub Actions workflow, branch protection, hosted Base44 validation, or production release blocking.

## Current state after revalidation

- Phase 10 can read JSON and generate reports, but it trusts broad JSON shapes and could produce confusing output for malformed release/evidence files.

## Proposed implementation

1. Add `src/lib/liveReadinessInputValidation.js` with `validateLiveReadinessInput(input)`.
2. Update `tools-live-readiness-report.mjs` to validate parsed JSON and throw a concise validation error before report generation.
3. Add focused tests for validator behavior and CLI invalid-shape handling.
4. Update audit docs and completion report.

## Acceptance criteria

- Valid readiness input returns no validation errors.
- Invalid release, evidence, matrix, and reviewer shapes return field-specific errors.
- CLI returns exit code `2` for invalid JSON shape before report generation.
- Validation errors do not echo raw evidence values.
