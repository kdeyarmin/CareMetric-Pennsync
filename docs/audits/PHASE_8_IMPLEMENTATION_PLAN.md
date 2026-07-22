# Phase 8 Implementation Plan

_Audit follow-up date: 2026-07-22. Scope: PHI-safe live-readiness release ledger._

## Phase 8 goals

- Convert Phase 7 evidence packets into a deterministic, PHI-minimized release ledger that can be attached to a release record.
- Preserve the distinction between evidence references and evidence contents; the ledger should summarize readiness without copying credentials, PHI, raw test artifacts, or reviewer notes into application code.
- Keep application behavior unchanged; no hosted integrations, migrations, permissions, routes, or UI changes are included.

## Included work

| Work item | Purpose |
|---|---|
| Release ledger builder | Create a PHI-safe release ledger from evidence packets and release metadata. |
| Ledger validation | Block release-complete status unless all packets are review-complete and release metadata is present. |
| Deterministic export rows | Provide reviewer-friendly rows with capability, risk, status, and reference counts only. |
| Documentation | Record Phase 8 status, validation, and remaining release-process dependencies. |

## Excluded work

- No production release automation, artifact upload, e-signature workflow, hosted Base44 change, CI enforcement, or live environment access.
- No evidence artifact contents are stored in the ledger helper.

## Current state after revalidation

- Phase 7 added evidence-packet helpers that can report missing evidence, missing references, and missing reviewer decisions.
- Teams still need a safe way to summarize packets for release review without exposing sensitive contents or credentials.

## Proposed implementation

1. Add `src/lib/liveReadinessReleaseLedger.js` with:
   - required release metadata keys;
   - `createLiveReadinessReleaseLedger(release, evidence, matrix)`;
   - `ledgerRowsForExport(ledger)`.
2. Add tests proving incomplete release metadata and incomplete evidence packets block release readiness.
3. Add tests proving ledger export rows omit raw evidence values and include reference counts only.
4. Update audit docs and completion report.

## Acceptance criteria

- A release ledger is not release-complete unless release id, environment, requested rollout date, release owner, rollback owner, and monitoring owner are present.
- A release ledger is not release-complete unless every included packet is review-complete.
- Export rows include capability metadata and counts, not raw evidence values.
- Tests cover incomplete metadata, incomplete packets, complete release readiness, and PHI-safe export shape.
