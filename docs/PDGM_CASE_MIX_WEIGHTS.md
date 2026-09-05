# CY 2026 PDGM case-mix table: reference-only status

PennSync includes the official CMS CY 2026 432-row case-mix-weight, HIPPS, and
LUPA-threshold table in `src/components/pdgm/hhCaseMixWeightsCy2026.js`. It is
strict-parsed and useful for provenance and reconciliation tests.

It is **not a payment engine**. A row can be selected safely only after the full,
date-effective CMS HHGS applies diagnosis validity and grouping, code-first and
manifestation rules, secondary-diagnosis handling, comorbidity exclusions,
functional scoring, timing, and admission-source rules. PennSync does not yet
implement or host that complete behavior.

Consequently:

- no case-mix table, admin upload, stored `is_official` value, or rate override
  can enable payment output;
- the legacy factorized reimbursement approximation is retired and returns no
  money;
- PDGM rate editing, reporting, documentation-impact dollars, and backend
  calculation remain default-off; and
- users must use the official EMR/CMS-approved grouper for billing.

## Source and parsing contract

The bundled table was extracted from the primary CMS distribution:

- [CY 2026 HH PDGM case-mix weights and LUPA thresholds ZIP](https://www.cms.gov/files/zip/cy2026-hh-pdgm-case-mix-weights-lupa-thresholds.zip)
- [CMS case-mix weights page](https://www.cms.gov/medicare/payment/prospective-payment-systems/home-health-pps/home-health-pps-case-mix-weights)

`parseCaseMixWeightsCsv` requires explicit clinical group, admission source,
timing, functional level, comorbidity adjustment, and case-mix weight columns.
It rejects unknown values, duplicate groups, partial strict-mode files, invalid
weights, and fabricated mappings. HIPPS codes are carried through verbatim; the
loader never decodes a missing combination from memory.

The expected structure is exactly 432 rows:

`12 clinical groups × 2 admission sources × 2 timing values × 3 functional levels × 3 comorbidity levels`.

## HHGS release selection and golden evidence

The case-mix table is only one input. CY 2026 claims must also use the official
date-effective HHGS release:

- v07.0.26: 2026-01-01 through 2026-03-31;
- v07.1.26: 2026-04-01 through 2026-09-30; and
- v07.2.26: 2026-10-01 through 2026-12-31.

See `docs/pdgm-cy2026.md` for authoritative CMS URLs and the offline 310-case
verification procedure. Passing the official JAR's own fixtures validates the
download and runner; the production gate remains closed until a PennSync
implementation independently matches those fixtures and receives required
operational sign-off.
