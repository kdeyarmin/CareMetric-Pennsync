# Domain Review Closeout — 2026-07-30

Session scope: full domain-by-domain review of CareMetric-Pennsync, pure-logic
fixes, and live-readiness operational handoff.

## Domains reviewed (all closed)

| # | Domain | Outcome |
|---|---|---|
| 1 | Communications / Fax | Repo-side OK; fax races accepted; poller releases stale `retrying` claims |
| 2 | Compliance / Security / Signatures | Schema + guardrails OK; RLS remains hosted (LR-01) |
| 3 | Patient Operations | Referral readiness + offline queue OK |
| 4 | Clinical Core / OASIS / PDGM / SmartNote | Engines OK; offline re-save fixed; PDGM boundary pinned |
| 5 | Training / Learning | Pass threshold centralized; service-role attestation still hosted |
| 6 | Admin / Reports / Offline | Unified queue + offline keys OK |

## Pure-logic fixes landed this session

1. **Offline re-save collapse** — `upsertCreateVisitInSyncQueue` + `offlineClientRequestId` threading through Smart Note and Visit Scribe so edit-while-offline updates one queued `CREATE_VISIT` instead of duplicating visits on drain.
2. **LR-01 / LR-02 operational checklist** — concrete verification steps + fillable evidence JSON for `pnpm run readiness:report`.
3. **PDGM live-path functional boundary helper** — `computeFunctionalLevelHighShape` documents and tests `points >= low → medium` (matches `calculatePDGM`); dual-engine difference vs `pdgmGrouper` remains intentional.

## Intentionally not changed in-repo

| Item | Rationale |
|---|---|
| Official CMS Table 9 / case-mix weights | Requires agency files; both paths flag `isEstimate` until `is_official` |
| PDGM grouper vs live engine "reconciliation" | Different threshold *shapes* (`{low,medium}` vs `{low,high}`); grouper unwired |
| Fax TOCTOU notification races | Mitigated by `delivery_confirmation_sent` / `final_failure_notified` + stale claim release |
| Hosted RLS / staging E2E | Requires Base44 dashboard + credentials (LR-01 / LR-02) |

## How to proceed

1. Assign owners in `docs/audits/LIVE_READINESS_CHECKLIST_LR01_LR02.md`.
2. Apply RLS per `docs/SECURITY-RLS-CHECKLIST.md` and run V1–V6 on **raw network** responses.
3. Run staging smokes S1–S4 minimum.
4. Fill `docs/audits/live-readiness-evidence.template.json` locally and run `pnpm run readiness:report`.

**Stop/go:** do not claim hosted-production readiness or load real PHI until LR-01 passes.
