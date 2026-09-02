# OASIS response-schema migration and rollout

**CMS-aligned response sets for PennSync's supported OASIS-E2 item subset.**

Status: implemented behind a feature flag, **default OFF**. Not deployed, not
enabled for any tenant, no migration run, no production data modified.

PennSync is a clinical-assistance application used beside the agency's EMR. It
is not the legal record, it does not replace the EMR, it does not submit to
iQIES, and nothing here means PennSync completed, certified, approved or
determined Medicare compliance for an OASIS assessment. Every final official
OASIS response is selected explicitly by a clinician.

---

## 1. What was wrong

PennSync recorded `item_spec_version: "oasis-e2"` on saved rows. That records
which CMS **instrument** was in effect. Nothing recorded what PennSync's **own
answer choices meant** — so a row stamped `oasis-e2` could hold a response the
clinician picked from an abbreviated list whose codes name different things than
the official item.

An item-level warning existed, but downstream paths bypassed it: the printed
guide, the clipboard, the referral packet, the analytics extractors, the outcome
engine and the PDGM calculator all read `item_number` + `response` and treated
them as official.

Eighteen items were affected. Three of them were not the CMS item at all — they
carried an M-number over a different question.

## 2. The 18-item decision table

| Item | Disposition | Correction made |
| --- | --- | --- |
| M1100 | Align to CMS | Exact 3×5 living-arrangement × availability-of-assistance matrix; codes `01`–`15` preserved as strings |
| M1306 | Align to CMS | Stage 2 or higher / unstageable; Stage 1 explicitly excluded |
| M1340 | Align to CMS | Code `2` is "known but not observable due to non-removable dressing/device" — not "infected" |
| M1400 | Align to CMS | Correct exertion/rest distinctions; code `3` is minimal exertion **or agitation** and excludes rest (rest is `4`) |
| M1620 | Align to CMS | CMS `4` (daily) and `5` (more often than once daily) kept distinct; `NA` and `UK` supported (`UK` omitted at DC) |
| M1740 | Align to CMS | Check-all-that-apply `1`–`7`; `7` ("None of the above") enforced as mutually exclusive |
| M1830 | Align to CMS | Exact bathing scale; code `6` is a valid totally-dependent response ("bathed totally by another person") |
| M1840 | Align to CMS | Location-and-assistance meanings: `2` bedside commode, `3` bedpan/urinal, `4` totally dependent |
| M1860 | Align to CMS | PennSync's inserted "uneven surfaces" level removed; exact CMS `0`–`6` scale |
| M1870 | Align to CMS | Full oral/tube-feeding set `0`–`5` |
| M2001 | Align to CMS | Exact values `0`/`1`/`9`; M2003 follow-up **not** merged in |
| M2010 | Align to CMS | `0`=No, `1`=Yes, `NA`; the code-0 inversion eliminated |
| M2020 | Align to CMS | Transposed `1`/`2` corrected; `NA` supported |
| M2401 | Align to CMS | Official multi-row grid, rows b–f, each `0`/`1`/`NA` |
| M2420 | Align to CMS | Current discharge-disposition set `1`–`4`/`UK`; **discharge only** |
| M1033 *(prompt)* | PennSync-only screening | Preserved as `ps_hospitalization_risk_tier` (low/medium/high) |
| M1610 *(prompt)* | PennSync-only screening | Preserved as `ps_urinary_incontinence_frequency` |
| M1630 *(prompt)* | PennSync-only screening | Preserved as `ps_ostomy_self_management` |

New data and UI never display or persist `M1033`, `M1610` or `M1630` for the
three screening prompts. Those numbers survive **only** in the frozen legacy
reader, so an already-saved answer can still be displayed under the label it was
answered with.

There is no active warn-only decision among these 18 after cutover.
**Warn-and-refuse is permanent** for every legacy or unknown schema version.

### Deliberately NOT promoted

`M1700`, `M1810`, `M1820`, `M1845` and `M1850` are abbreviated items outside
this decision. They remain fail-closed and non-carryable until separately
reviewed. `NOT_PROMOTED_ABBREVIATED_ITEMS` in the registry names them, and a
test asserts none of them gained a v2 definition.

`M2410` (inpatient facility) and `M2003` (medication follow-up) are recorded in
`UNIMPLEMENTED_ITEMS` rather than omitted, so a consumer that wants a facility
destination gets a named "not implemented" instead of quietly reaching for
M2420.

## 3. Official source provenance

Every v2 definition was transcribed from a **final** CMS artifact. The draft
provenance the repository previously carried was replaced.

| Artifact | URL | Published | Effective | Retrieved | SHA-256 |
| --- | --- | --- | --- | --- | --- |
| Final OASIS-E2 All-Item Instrument | `https://www.cms.gov/files/zip/final-oasis-e2-all-item-04-01-2026.zip` → `Final OASIS-E2 All-Item 04-01-2026.pdf` | 2025-12-11 | 2026-04-01 | 2026-09-01 | `adf0cc77889ce9a19546e7989d0bc43c56c8e46ffae168723951e90f61ffa2f6` |
| OASIS-E2 SOC time point | same zip → `OASIS-E2 SOC 04-01-2026.pdf` | 2025-12-11 | 2026-04-01 | 2026-09-01 | `b0856345cc5782677dd2a88653315ae34670ebe781b97c4cc46161febf22f016` |
| OASIS-E2 ROC time point | same zip → `OASIS-E2 ROC 04-01-2026.pdf` | 2025-12-11 | 2026-04-01 | 2026-09-01 | `cb53ab197c806ddeecd9e959cf6ca1266d61e3f7b13a22f921d0474bcc918e1c` |
| OASIS-E2 FU time point | same zip → `OASIS-E2 FU 04-01-2026.pdf` | 2025-12-11 | 2026-04-01 | 2026-09-01 | `33fd62c7163a764f96e3bea8c7e4a84dc6e232cfe707c2a7d37508ae0772e33c` |
| OASIS-E2 TRN time point | same zip → `OASIS-E2 TRN 04-01-2026.pdf` | 2025-12-11 | 2026-04-01 | 2026-09-01 | `d7eda6ef8d4bff6cd15c0f43c11cf07fe55013aecd17240f2b04142d665b0e6e` |
| OASIS-E2 DC time point | same zip → `OASIS-E2 DC 04-01-2026.pdf` | 2025-12-11 | 2026-04-01 | 2026-09-01 | `4008e7530c3893916feffc84475e9e811d9cd889839fa5d44f9093fb00d0368f` |
| OASIS-E2 DAH time point | same zip → `OASIS-E2 DAH 04-01-2026.pdf` | 2025-12-11 | 2026-04-01 | 2026-09-01 | `558135e5a9b8e02c49a5f7706e9de6eedb91e0d5a6aadf14cb0a8d077e9ac9a8` |
| Containing zip (All-Item + time points) | `https://www.cms.gov/files/zip/final-oasis-e2-all-item-04-01-2026.zip` | 2025-12-11 | 2026-04-01 | 2026-09-01 | `2b4539e06fabe212aaad5bc8f877210918d1cf027089e5401593f79bcaca90df` |

Indexes: [OASIS Data Sets](https://www.cms.gov/medicare/quality/home-health/oasis-data-sets) ·
[OASIS User Manuals](https://www.cms.gov/medicare/quality/home-health/oasis-user-manuals)

**Method.** Each item's response set was transcribed code by code from the
final All-Item instrument, preserving CMS code strings exactly. Applicability
was derived by checking each item's presence as a real item definition — not a
skip-instruction cross-reference — in each final time point instrument.

**Limits.** This is a transcription of the **instrument**. It is not a
transcription of the OASIS-E2 Guidance Manual's coding instructions, and it does
not make PennSync the official OASIS completion or submission system.

### Applicability derived from the time point instruments

| Item | SOC | ROC | FU | TRN | DC |
| --- | :-: | :-: | :-: | :-: | :-: |
| M1100 | ✓ | ✓ | | | |
| M1306 | ✓ | ✓ | ✓ | | ✓ |
| M1340 | ✓ | ✓ | | | ✓ |
| M1400 | ✓ | ✓ | | | ✓ |
| M1620 | ✓ | ✓ | | | ✓ |
| M1740 | ✓ | ✓ | | | ✓ |
| M1830 | ✓ | ✓ | ✓ | | ✓ |
| M1840 | ✓ | ✓ | ✓ | | ✓ |
| M1860 | ✓ | ✓ | ✓ | | ✓ |
| M1870 | ✓ | ✓ | | | ✓ |
| M2001 | ✓ | ✓ | | | |
| M2010 | ✓ | ✓ | | | |
| M2020 | ✓ | ✓ | | | ✓ |
| M2401 | | | | ✓ | ✓ |
| M2420 | | | | | ✓ |

No item in this subset is collected at DAH.

## 4. Old and new data contracts

### Before

```jsonc
oasis_items: [{
  item_number: "M1830",     // PennSync form id OR a CMS number — ambiguous
  item_source: "cms_item",  // set from item IDENTITY, ignoring the response set
  item_spec_version: "oasis-e2",
  response: "6",            // meaning depends on a response set nobody recorded
}]
```

### After (additive — nothing removed)

```jsonc
// assessment level (queryable)
response_schema_id: "pennsync-oasis-response-v2-cms-e2",
instrument_version: "oasis-e2",
response_schema_source: "final-oasis-e2-all-item-04-01-2026",
migration_status: "native_v2" | "legacy_unconverted" | "legacy_provenance_annotated",
last_written_by, last_written_at,

// row level
oasis_items: [{
  definition_id: "m1830_cms_e2",
  item_number: "M1830",
  item_source: "cms_item",
  item_spec_version: "oasis-e2",
  response_schema_id: "pennsync-oasis-response-v2-cms-e2",
  response_shape: "single",
  response_value: { code: "6" },        // opaque STRING
  response_origin: "clinician_selected",
  selected_by: "rn@example.com",
  selected_at: "2026-06-01T10:00:00.000Z",
  response: undefined,                   // NOT dual-written
}]
```

**Response shapes.**

| Shape | Value |
| --- | --- |
| `single` | `{ code: "3" }` |
| `multi_select` | `{ codes: ["1", "3"] }` |
| `matrix_choice` | `{ code: "07" }` |
| `grid` | `{ rows: [{ row_id: "b", code: "NA" }, …] }` |

**Codes are opaque strings.** Nothing calls `parseInt`, `toNum`, numeric sorting
or numeric coercion on a code. `01`–`15`, `NA`, `UK` and M2001's `9` survive
exactly. Where an ordinal comparison is genuinely needed (the improvement
measures), rank is the **index in the published CMS response order**, never the
parsed value.

**The legacy scalar `response` is unchanged and is NOT dual-written.** Writing a
v2 value into an ambiguous field would recreate the problem this change exists
to fix.

**Screening answers** use non-M `definition_id`s and `item_source:
"pennsync_screening"`, carry no `item_number`, and are excluded from OASIS
completion, CMS output, analytics, outcomes and PDGM.

## 5. No-conversion guarantee

**PennSync does not convert or recode any existing response.** A legacy code and
a v2 code with the same characters mean different clinical facts, and no rule
maps one onto the other without inventing one.

`tools-oasis-response-migration.mjs` is expand-only, dry-run by default, and
proposes exactly one kind of write: **non-clinical provenance**
(`response_schema_id: "pennsync-oasis-response-v1-legacy"`, `migration_status:
"legacy_provenance_annotated"`) on rows that have no schema at all. It refuses
to apply anything whose clinical checksum would move, `--apply` is rejected
without `--i-have-read-the-plan`, and a second run is a no-op.

A row with no schema otherwise resolves as **legacy in memory** — it is never
persisted as v2.

### Dry-run evidence

Against a four-assessment fixture (`agencyA` legacy/unversioned, `agencyB` mixed):

```
4 assessment(s), 6 row(s): 1 v2, 1 legacy, 4 unversioned, 0 unknown.
5 row(s) require quarantine from CMS-labeled output and scoring.

by_tenant : agencyA {unversioned 3, legacy 1, v2 0}, agencyB {unversioned 1, v2 1}
by_writer : legacy_direct_write {unversioned 3, legacy 1}, protected_writer {v2 1}, ai_path {unversioned 1}
plan      : safe (byte-preserving) = true, proposed = 4, unsafe = 0
example   : M1830  before_checksum 0fc65f37f6cfa365 → after_checksum 0fc65f37f6cfa365
idempotence: first apply = 4 rows, second apply = 0 rows; clinical checksums unchanged
refusal   : `--apply` without `--i-have-read-the-plan` exits 2 without writing
```

## 6. AI restrictions

AI may return **only** verbatim evidence, uncertainty, discrepancies,
missing-information questions, documentation guidance and non-code summaries.

Removed: `suggested_response`, `suggested_value`, `recommended_score`,
`auto_update`, "Pre-fill OASIS", "AI-generated OASIS assessment", "Attest all",
"Apply Correction", "Apply Optimization", "Rescore Opportunities",
"Reimbursement Optimizations", "PDGM Optimization",
`functional_score_optimization`, and the clipboard action that copied AI codes.

Prompts that asked for reimbursement-maximising responses were rewritten to
forbid it as a hard constraint. Because prompts are asked and not enforced,
`aiResponseSanitizer.js` strips code-bearing fields at the boundary and
neutralises code assertions inside free text, so a model that emits a code
anyway cannot populate, persist, copy, export or score it.

## 7. Output rules

One fail-closed policy governs print, copy, PDF, CSV, JSON, referral packets,
EMR handoff, comparison downloads and clipboard.

- A **code** appears in a CMS-labeled section only for a v2, applicable,
  source-verified row explicitly selected by a clinician.
- PennSync screening information appears only in a separately labeled section
  titled **"PennSync screening — not an OASIS item"**, without M-numbers.
- Legacy and unknown rows are **refused or visibly quarantined with the item and
  the reason** — never silently omitted, because a missing row reads as "not
  applicable" to whoever receives the document.
- Every allowed guide states that PennSync is a companion reference, did not
  submit the assessment, and does not certify the response.
- The phrase "Transcribe each OASIS item" is gone, and is asserted against.
- Referral packets and AI analysis may carry source evidence and questions, but
  no prefilled official code.

## 8. Analytics / derived-data invalidation rules

A CMS-labeled calculation requires **all** of: a supported v2 response schema, a
genuine CMS item source, a compatible instrument version, a valid response
shape, a valid assessment time point, explicit clinician-selection provenance,
and compatible schemas at **both** episode endpoints.

Legacy, missing-schema, mixed-schema, screening, unsupported-instrument and
invalid-timepoint inputs return **named exclusion reasons with visible excluded
counts**. They are never coerced to zero, "no improvement", low functional
status, or a valid denominator.

Specific corrections:

- **M1830 code 6** is ratable total bathing dependence under v2 (6→3 improves);
  legacy code 6 remains excluded.
- **M1400 / M1860 / M2020** use v2 meanings only.
- **M2420** never maps codes 2–4 to hospital/rehab/SNF. Facility-transfer logic
  belongs to M2410, which is not implemented.
- The **hospitalization-risk tier never feeds official M1033 or PDGM**. Where a
  genuine official M1033 response is unavailable, the result is
  incomplete/unavailable rather than a substituted tier.
- **`calculatePDGM` rejects unversioned/legacy functional input** and returns an
  explicit incomplete result — no functional level, no case-mix weight, no
  payment estimate — instead of turning missing values into functional-low.
  Because M1800/M1810/M1820/M1850 have no CMS-verified response set in PennSync,
  the functional score is currently **not computable**; that is reported, not
  papered over.
- New `PatientOutcomeMetric`, `AgencyKPI` and `OASISUpload` derived records carry
  input response-schema ids, source assessment ids, instrument versions and
  `calculation_version`.
- **Existing derived records are not deleted or reinterpreted.** Records without
  verified source-schema provenance stay auditable but are hidden/retired from
  current CMS-labeled aggregates; recomputation happens only from trusted v2
  inputs.
- `aggregateFunctionalScores` no longer defaults a missing score to `0`. On every
  OASIS functional scale `0` means fully independent, so an incompletely
  extracted upload used to plot as an independent patient; a gap is now `null`
  and excluded uploads are counted with a reason.
- `pphWorklistEngine` no longer sums a missing functional item as `0`, which made
  a partially extracted assessment score as LOWER risk than an unknown one.
- `pdgmGrouper.groupPeriod()` requires `responseSchemaId === "pennsync-oasis-response-v2-cms-e2"`;
  anything else is reported in `missing` and never grouped.

Frontend and backend share the rules through a parity test
(`base44/functionTests/computeOutcomeMeasuresContract.test.js`), because the
Deno function cannot import the frontend module and silent drift between the two
is exactly how a legacy code would keep scoring after the UI stopped showing it.

## 9. Feature-flag rollout

`AgencySettings.`**`oasis_response_schema_v2_enabled`**, a flat boolean,
default **OFF**. Scoped per agency: both the frontend gate
(`responseSchema/featureFlag.js`) and the protected writer read this field name
off this entity, and the writer resolves the row belonging to *the caller's*
agency through the shared `resolveAgencySettings` helper.

The last part is not incidental. `AgencySettings` read RLS is open, so a
newest-row-wins `list()` returns whichever tenant saved most recently — one
agency's rollout flag would govern another's writes, and, worse, an agency
flipping its own kill switch could be overruled by a stranger's newer `false`
during the incident the switch exists for. A keyed miss resolves to `null` and
both gates read that as *not enabled*.

It lives on `AgencySettings` rather than `Agency` because `Agency` defines no
feature-flag object at all (only an `enabled_features` page list) and its read
RLS is admin-only, so the clinicians who are the primary callers of the write
path could never resolve their own agency's flag.

**P0 containment is unconditional** — AI, output and analytics containment ship
regardless of the flag. Only v2 new-entry controls are flagged.

Rollout order:

1. P0 AI/output/analytics containment
2. Reader support for frozen v1 and v2
3. Additive entity schema
4. Protected centralized writer
5. v2 controls
6. Schema-aware consumers and derived-data versioning
7. Named clinical review
8. Hosted schema / RLS validation
9. Controlled tenant activation

## 10. Rollback procedure

1. Set `oasis_response_schema_v2_enabled` to `false` on the affected agency's
   own `AgencySettings` row.
2. If an incident requires stopping writes immediately without a deploy, set
   `oasis_response_writes_disabled` on that same row — the protected writer
   returns 423. It is independent of the rollout flag, and it is the agency's
   own row that is consulted, so containing one tenant neither depends on nor
   affects another.

Rollback disables **new v2 writes only**. Both v1 and v2 readers keep working.
Never down-convert a v2 row, never resume legacy writes, and never restore the
removed AI/output behaviour. v1 is `writable: false` permanently, so legacy
entry cannot come back by flag.

## 11. Approval status

These are four **separate** approvals. None of them is implied by another.

| Gate | Status |
| --- | --- |
| **1. CMS source verification** | Transcribed from the final OASIS-E2 artifacts with recorded SHA-256 hashes. An independent re-read by a second person is **outstanding**. |
| **2. PennSync product disposition** | Decided — the 18-item table in §2. |
| **3. Named clinical / OASIS SME validation** | **OUTSTANDING.** Every v2 definition is `clinical_review: "pending_named_sme_review"` with `clinical_reviewed_by: null`. Kevin Deyarmin's 2026-09-01 sign-off is **not** option-level CMS approval — its recorded scope explicitly excluded individual response-option verification. |
| **4. Deployment approval** | **OUTSTANDING.** Not deployed, not enabled for any tenant. |

### Hosted schema / RLS status — RELEASE BLOCKER

`OASISAssessment` previously had open write RLS (`"write": {}`). This change
scopes write to the owning user and admins, matching the read rule, with
`base44/functions/saveOasisResponses` as the sanctioned writer.

**That is a declared contract in this repository. Whether the hosted Base44 app
enforces it has not been verified in this environment**, and PennSync is a
frontend-only SPA against a hosted backend — so UI-level enforcement is not
enforcement. Until hosted enforcement is proven, and until it is confirmed that
write-scoping does not break legitimate cross-user workflows, **v2 entry stays
disabled**. This is recorded as a release blocker, not a warning.

## 12. Data-driven controls

`src/components/oasis/OasisResponseControl.jsx` renders the shape the item
declares rather than a shape hard-coded at the call site: single-select,
matrix (M1100's published 3x5 grid), multi-select (M1740, with the mutually
exclusive "none" enforced in the control as well as the validator) and grid
(M2401's five rows). It begins blank — a pre-selected official response is a
response nobody chose — requires an explicit clinician action, preserves codes
exactly as strings, omits codes CMS does not offer at the time point, and shows
applicability plus source/version information. An item at an inapplicable time
point renders as a locked explanation rather than an answerable control.

`LegacyResponseNotice` shows a stored legacy answer read-only, with its frozen
v1 label and the persistent warning. It deliberately exposes no button, radio or
text input: edit, clone, carry-forward, copy and convert are all absent because
none can be made safe.

Accessibility: every input has a programmatic label, groups use `fieldset` /
`legend` and the matrix uses real table headers, unanswered state and grid
completeness are announced via `aria-live`, and the matrix scrolls inside its own
container rather than widening the page. `pnpm run test:a11y` runs axe over all
four shapes plus the legacy notice.

> The `test:a11y` script itself was fixed here. `vitest run src/**/*.a11y.test.jsx`
> was expanded by the SHELL, where `**` collapses to a single `*`, so only
> `src/<dir>/*.a11y.test.jsx` matched — two of the four a11y suites, including a
> pre-existing one, had never run. It is now a vitest filter (`a11y.test.jsx`),
> and the suite went from 2 tests to 19.

## 13. Known gaps in this change

`docs/oasis/CONSUMER_MATRIX.md` ends with an "Outstanding, by name" table. The
short version: several output surfaces (`OASISExportManager`,
`OASISPDFComparison`, the comparison view's display, `ReferralPDFSummarizer`,
`AdmissionPacketCustomizer`) are not yet routed through `buildOasisOutput()`;
`monitorComplianceRisks` has not had the schema gate applied;
`OutcomeMeasuresSection` does not yet surface excluded counts; and
`oasisPromptFormat` still labels AI-extracted values by M-number in an LLM
prompt.

None of these can currently emit a v2 code — there are none, because the flag is
off — and all sit downstream of gates that refuse unverifiable values. They are
listed so the gap is reviewable rather than implied by a green table.

## 14. Where the code lives

| Concern | Path |
| --- | --- |
| Append-only schema registry | `src/components/oasis/responseSchema/registry.js` |
| Frozen v1 snapshot | `src/components/oasis/responseSchema/v1Legacy.js` |
| CMS-derived v2 definitions | `src/components/oasis/responseSchema/v2CmsE2.js` |
| CMS source manifest | `src/components/oasis/responseSchema/sources.js` |
| Response shapes + validation | `src/components/oasis/responseSchema/shapes.js` |
| Pure response builder | `src/components/oasis/responseSchema/responseBuilder.js` |
| Fail-closed output policy | `src/components/oasis/responseSchema/outputPolicy.js` |
| AI sanitiser | `src/components/oasis/responseSchema/aiResponseSanitizer.js` |
| Versioned drafts | `src/components/oasis/responseSchema/draftStorage.js` |
| Feature flag / kill switch | `src/components/oasis/responseSchema/featureFlag.js` |
| Independent CMS golden fixtures | `src/components/oasis/responseSchema/cmsGoldenFixtures.js` |
| Protected backend writer | `base44/functions/saveOasisResponses/entry.ts` |
| Shared write validator | `base44/_shared/backendHelpers.mjs` (`oasisResponseGuard`) |
| Migration / dry-run tool | `tools-oasis-response-migration.mjs` |
| Schema-driven controls | `src/components/oasis/OasisResponseControl.jsx` |
| Consumer matrix | `docs/oasis/CONSUMER_MATRIX.md` |
| Client-side write adapter | `src/components/oasis/responseSchema/oasisWriteAdapter.js` |
| Static no-direct-writer test | `base44/oasisWriterContract.test.js` |
