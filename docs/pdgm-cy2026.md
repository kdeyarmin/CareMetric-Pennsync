# CY2026 PDGM reference & grouper data plan

Source rule: **CMS-1828-F**, "CY 2026 HH PPS Rate Update" — Federal Register doc
**2025-21767** (published 2025-12-02, effective 2026-01-01).

> ⚠️ **Billing safety:** the numbers below are split by confidence. Only the
> **VERIFIED** figures (cross-checked across ≥2 independent summaries of the final
> rule) should be treated as usable, and even those should be confirmed against the
> primary CMS rule tables before being relied on for billing. The
> **NEEDS CMS DOWNLOAD** items are the values that actually drive payment accuracy
> (the 432 case-mix weights, functional point/threshold tables, and comorbidity
> diagnosis lists) — they are **not** reproduced in any web-fetchable source and
> must come from the CMS files. Do **not** fabricate them.

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
- ⚠️ The full 432-row weight table (Rule **Table 13**) is **NOT** web-fetchable. → NEEDS CMS DOWNLOAD.

### Other verified ancillary values
FDL ratio (outliers) **0.37** · labor-related share **74.9%** · wage-index BN factor
**1.0025** (standard) / **1.0005** (per-visit).

## NEEDS CMS DOWNLOAD (to finish the billing-grade grouper)

Download these in a browser (cms.gov returns HTTP 403 to automated tools):

1. **CY2026 PDGM case-mix weights (432-cell, Table 13) + LUPA thresholds & HIPPS
   crosswalk** — CMS **Home Health Agency (HHA) Center**:
   <https://www.cms.gov/medicare/enrollment-renewal/providerssuppliers/home-health-agency-center>
2. **Functional point values (Table 8) & thresholds by clinical group (Table 9)**,
   and **comorbidity subgroup lists (Tables 10/11)** — the final rule PDF, Federal
   Register doc 2025-21767, and CMS's interactive **PDGM Grouper Tool** (Functional
   Thresholds tab) on the Home Health PDGM page.

## Wiring plan (once the files are in hand)

`src/components/pdgm/pdgmGrouper.js` is already a clean, table-driven engine that
takes `{ itemPoints, functionalThresholds, dxToGroup, comorbidity, caseMixTable }`
and returns `missing: [...]` instead of guessing when a table is absent. To make
PDGM billable:

1. Add a `cyYYYY` CMS data module exporting those five structures from the
   downloaded files (caseMixTable keyed by clinical group × source × timing ×
   functional × comorbidity → `{ hipps, weight }`).
2. Point `calculatePDGM` (or a new grouped path) at `groupPeriod(input, cmsTables)`
   instead of the decomposed factor approximation.
3. Add LUPA logic using the per-visit rates above + the downloaded LUPA thresholds.
4. Keep the "Official CMS rates" flag tied to using verified tables.

Sources used for the verified figures: team-iha CY2026 rule summary; Homecare
Homebase; CHAP; Applied Policy; Home Health Care News. Primary references
(not directly fetchable here): CMS fact sheet CMS-1828-F; Federal Register 2025-21767.
