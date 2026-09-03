# CY2026 PDGM reference & grouper data plan

Source rule: **CMS-1828-F**, "CY 2026 HH PPS Rate Update" — Federal Register doc
**2025-21767** (published 2025-12-02, effective 2026-01-01).

> ⚠️ **Billing safety:** the bundled 432-row case-mix-weight/HIPPS/LUPA table is
> source-traced to the primary CMS CY 2026 file, but it is only one input to the
> official grouper. Functional point/threshold tables, diagnosis-to-clinical-
> group mappings, comorbidity tables/interactions, and parity against CMS HHGS
> input/output fixtures are still missing. Do not produce payment amounts until
> the complete official grouper passes golden-case parity.

## Current CMS grouper releases (verified 2026-09-02)

CMS posted HHGS `v07.2.26` on 2026-08-20 for claims starting 2026-10-01. CMS
states that it has no logic or interface changes, but it updates diagnosis-code
tables that affect grouping and HIPPS assignments. Until 2026-09-30, the latest
already-effective package is `v07.1.26` (posted 2026-02-10). A production
integration must select the official grouper by claim-from date; merely using
the newest posted file early would be incorrect.

- CMS HHGS releases: <https://www.cms.gov/medicare/payment/prospective-payment-systems/home-health/home-health-grouper-software>
- CMS CY 2026 case-mix weights: <https://www.cms.gov/medicare/payment/prospective-payment-systems/home-health-pps/home-health-pps-case-mix-weights>
- CMS CY 2026 final-rule summary: <https://www.cms.gov/newsroom/fact-sheets/calendar-year-cy-2026-home-health-prospective-payment-system-final-rule-cms-1828-f>

## VERIFIED

### Base 30-day period payment rate (CY2026)
- Quality submitters: **$2,038.22** ✅ (already set as the app default — see
  `src/components/pdgm/pdgmRates.js` and `base44/functions/calculatePDGM/entry.ts`).
  Down from CY2025 $2,057.35. The −1.023% permanent and −3.0% temporary behavior
  adjustments are already baked in.
- Non-submitters (QRP non-compliant): updated by +0.4% instead of +2.4%. The exact
  printed dollar figure was not found in summaries (≈$1,997.46 by the standard
  method — **derived, unverified**).

### LUPA per-visit rates (CY2026, quality submitters)
| Discipline | Per-visit | First-visit add-on | Add-on factor |
|---|---|---|---|
| Home Health Aide (HHA) | $80.12 | — | — |
| Medical Social Services (MSW) | $283.64 | — | — |
| Occupational Therapy (OT) | $194.74 | $335.69 | 1.7238 |
| Physical Therapy (PT) | $193.42 | $313.82 | 1.6225 |
| Skilled Nursing (SN) | $176.96 | $304.37 | 1.7200 |
| Speech-Language Pathology (SLP) | $210.25 | $351.03 | 1.6696 |

Add-on applies only to SN/PT/OT/SLP, first visit of an only/initial LUPA period.
Per-visit rates are not subject to the behavior or case-mix budget-neutrality adjustments.

### 12 PDGM clinical groups (official names)
Musculoskeletal Rehabilitation · Neuro/Stroke Rehabilitation · Wounds (Post-Op &
Skin/Non-Surgical) · Complex Nursing Interventions · Behavioral Health · MMTA —
Surgical Aftercare · MMTA — Cardiac and Circulatory · MMTA — Endocrine · MMTA —
Gastrointestinal Tract and Genitourinary System · MMTA — Infectious Disease,
Neoplasms, and Blood-Forming Diseases · MMTA — Respiratory · MMTA — Other.

> Note: the legacy `calculatePDGM` engine uses non-standard names (`MMTA_Wounds`,
> `MMTA_Neuro_Rehab`, …). The table-driven `pdgmGrouper.js` uses the official names
> above and is the target for the accurate model.

### Functional impairment scoring
- OASIS items used: **M1800, M1810, M1820, M1830, M1840, M1850, M1860, M1033**.
- Levels: Low / Medium / High.
- ⚠️ Point values (Table 8) and low/med/high cut-points (Table 9) **vary by clinical
  group**, were recalibrated on CY2024 data, and are **NOT** in any web summary.
  Do not reuse prior-year values — they change annually. → NEEDS CMS DOWNLOAD.

### Comorbidity adjustment
- None / Low (one qualifying secondary dx in a subgroup) / High (≥2 dx in
  interacting subgroup pairs).
- CY2026 counts: **20 low** subgroups, **98 high** interaction subgroups.
- ⚠️ Full diagnosis→subgroup lists (Tables 10 & 11) **NOT** web-available. → NEEDS CMS DOWNLOAD.

### Case-mix weights (432 cells)
- Structure: clinical group (12) × admission source (community/institutional) ×
  timing (early/late) × functional level (3) × comorbidity (3) = 432.
- Case-mix budget-neutrality factor: **1.0052** (final; 1.0051 was proposed).
- The full official 432-row weight/HIPPS/LUPA table is bundled in
  `src/components/pdgm/hhCaseMixWeightsCy2026.js` and strict-parsed/tested.
  This does not replace the diagnosis, functional, comorbidity, or executable
  HHGS logic needed to select the correct row.

### Other verified ancillary values
FDL ratio (outliers) **0.37** · labor-related share **74.9%** · wage-index BN factor
**1.0025** (standard) / **1.0005** (per-visit).

## STILL NEEDED to finish the billing-grade grouper

Download these in a browser (cms.gov returns HTTP 403 to automated tools):

1. **Functional point values (Table 8) & thresholds by clinical group (Table 9)**,
   and **comorbidity subgroup lists (Tables 10/11)** — the final rule PDF, Federal
   Register doc 2025-21767, and the applicable official HHGS package.
2. **Diagnosis-to-clinical-group and unacceptable-primary-diagnosis tables**
   from HHGS `v07.1.26`, plus the effective 2026-10-01 changes from `v07.2.26`.
3. **Official HHGS input/output test fixtures and Java 17 execution parity** for
   both effective releases. Base44 edge functions cannot be treated as a port of
   HHGS until representative and boundary fixtures match exactly.

## Wiring plan (once the files are in hand)

`src/components/pdgm/pdgmGrouper.js` is already a clean, table-driven engine that
takes `{ itemPoints, functionalThresholds, dxToGroup, comorbidity, caseMixTable }`
and returns `missing: [...]` instead of guessing when a table is absent. To make
PDGM billable:

1. Add date-effective CMS data modules exporting the missing four structures;
   the complete CY 2026 `caseMixTable` is already bundled and tested.
2. Point `calculatePDGM` (or a new grouped path) at `groupPeriod(input, cmsTables)`
   instead of the decomposed factor approximation.
3. Add LUPA logic using the per-visit rates above + the downloaded LUPA thresholds.
4. Keep the "Official CMS rates" flag tied to using verified tables.

Primary references: CMS HHGS release page, CMS CY 2026 case-mix-weight page, CMS
fact sheet CMS-1828-F, and Federal Register document 2025-21767.
