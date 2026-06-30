# PDGM case-mix weights — loading the official CMS table

The deterministic PDGM grouper (`src/components/pdgm/pdgmGrouper.js`) needs the
official CMS **case-mix weight table** to turn a 30-day period's variables into a
HIPPS code + case-mix weight. That table is **official CMS data that changes every
year**, so this repo deliberately ships **no weights**. Instead,
`src/components/pdgm/caseMixWeightsLoader.js` loads the agency's official file.

## What this is for (and isn't)

This is **not a billing engine**. Its purpose is an **admin-only
documentation-impact / value comparison**: showing how documentation changes move
the case-mix weight — e.g. *"the reimbursement implied by the original
documentation was X; after the app's documentation enhancements it's now Y."* It
lets administrators see the app's value.

Two hard requirements follow from that:

- **Financials are admin-only — never shown to nurses.** Any view built on this
  must gate the dollar/weight figures to financial/admin roles, the same way OASIS
  uploads already route through `listOASISUploads` (which strips financial fields
  for non-financial users) and the Revenue/Analytics tabs are admin-gated. Nurses
  see the *documentation* guidance; they never see the reimbursement numbers.
- **Accuracy still matters** — a wrong or stale weight makes the comparison
  misleading, so the loader only ingests an authoritative file you supply and
  **never guesses**: unmappable rows and an incomplete table are reported, not
  filled in.

## 1. Get the official file

Download the case-mix weights for the payment year you're billing from CMS:

- **CMS → Home Health PPS Case-Mix Weights**
  <https://www.cms.gov/medicare/payment/prospective-payment-systems/home-health-pps/home-health-pps-case-mix-weights>
- Each year (2014–present) is a ZIP containing the final case-mix weight data.
  For **CY2026** the weights were recalibrated using CY2024 data, with updated
  functional levels, comorbidity subgroups, and LUPA thresholds. There are exactly
  **432 payment groups** (2 timing × 2 admission source × 12 clinical groups ×
  3 functional levels × 3 comorbidity adjustments).

The weights are U.S. Government work (public domain); the constraint here is
**accuracy and year-correctness**, not licensing.

## 2. Export it to CSV with these columns

Open the CMS workbook and export (or save-as) a CSV. The loader matches column
headers case- and punctuation-insensitively, and accepts common synonyms.
**Required** columns (explicit variable columns — HIPPS codes are NOT decoded
automatically, to avoid a from-memory mapping):

| Logical field | Accepted headers | Accepted values |
| --- | --- | --- |
| Clinical Group | `Clinical Group`, `Group` | the 12 official names (e.g. `MMTA - Cardiac and Circulatory`) or common abbreviations |
| Admission Source | `Admission Source`, `Source` | `Community` / `Institutional` |
| Timing | `Timing` | `Early` / `Late` |
| Functional Level | `Functional Level`, `Functional Impairment Level` | `Low` / `Medium` / `High` |
| Comorbidity Adjustment | `Comorbidity Adjustment`, `Comorbidity` | `None` / `Low` / `High` (also accepts `No/Low/High Comorbidity Adjustment`) |
| Case-Mix Weight | `Case-Mix Weight`, `Weight` | a decimal in `[0.2, 5.0]` |

**Optional** columns: `HIPPS` (carried through verbatim), `LUPA Threshold`.

Quote any field containing a comma (two clinical-group names do). A normal CSV
export already does this.

## 3. Load it

```js
import { parseCaseMixWeightsCsv } from "@/components/pdgm/caseMixWeightsLoader";
import { groupPeriod } from "@/components/pdgm/pdgmGrouper";

const result = parseCaseMixWeightsCsv(csvText, { year: 2026, source: "CMS CY2026 Final Rule" });
if (!result.ok) {
  // result.errors lists every unmappable row / missing-column / incompleteness.
  // Do NOT proceed with a partial table.
  console.error(result.errors);
} else {
  // result.caseMixTable is the { [caseMixKey]: { hipps?, weight, lupaThreshold? } }
  // map pdgmGrouper.groupPeriod() consumes (with itemPoints, functionalThresholds,
  // dxToGroup, comorbidity — also supplied from the corresponding CMS tables).
  const period = groupPeriod(input, { ...otherCmsTables, caseMixTable: result.caseMixTable });
}
```

Validation performed (in `strict` mode, the default): all six required columns
present; every value maps to the engine's vocabulary or the row is rejected;
weights numeric and in range; no duplicate payment groups; exactly 432 groups and
all 12 clinical groups present. Anything off → `ok: false` with specific
`errors`/`warnings`.

## Keep it consistent with the canonical calculation

The app's canonical PDGM dollar calculation is the backend `calculatePDGM`
function (`base44/functions/calculatePDGM`). For the before/after comparison to be
credible, the *weight → dollars* step should use the **same** rates/method as
`calculatePDGM` (this loader supplies the case-mix weight; `calculatePDGM` /
`pdgmRates` supply the base rate and multipliers). Don't show two different dollar
figures for the same period — drive the comparison from one calculation so the
"before vs after" delta is the only thing that moves.
