# Reviewed consumer matrix — the 18 conflicting OASIS IDs

Every place in the repository that reads, writes, displays, exports or scores one
of `M1033, M1100, M1306, M1340, M1400, M1610, M1620, M1630, M1740, M1830, M1840,
M1860, M1870, M2001, M2010, M2020, M2401, M2420`, with what it did before, what
it means under v2, and what was done about it.

Inventory basis: repository-wide search over `src/**` and `base44/**` for all 18
ids (case-insensitive, word-boundary), excluding `*.test.*` / `*.spec.*` and the
new `responseSchema/` module itself. Counts are occurrences, not distinct items.

Disposition key — **only the first four describe work done in this change**:

- **gated** — this file now refuses anything that is not a v2,
  clinician-selected, applicable, source-verified row
- **rewritten** — the behaviour itself was wrong and was replaced here
- **removed** — the capability is not compatible with the product boundary
- **schema-aware (dual)** — deliberately reads both schemas, with per-schema
  meanings, because it raises questions rather than emitting codes
- **gated upstream** — this file was NOT edited; it consumes something that is
  now gated, so it cannot receive an unverifiable value. The gate is in the
  named upstream file, not here.
- **form-scoped** — operates on the live in-memory PennSync form, not on saved
  rows. Produces screening warnings, never a CMS-labeled output or code.
- **display-only** — shows a stored value with its frozen v1 label and warning
- **unchanged** — reads item numbers for navigation/labelling only; carries no
  response code
- **OUTSTANDING** — a real gap. Named here rather than glossed.

---

## Writers

| Consumer | Occ. | Before | Under v2 | Disposition |
| --- | --: | --- | --- | --- |
| `src/components/hub-tabs/SmartOASISAssessment.jsx` | 1 | `OASISAssessment.create` with `item_source: itemSourceFor(...)` and a scalar `response` | Must route through the builder + protected writer | **gated** — export path rewritten; prefill unwired from `handleAnswer` |
| `src/components/clinical/OASISQuickUpdate.jsx` | 3 | Direct `OASISAssessment.create` | Same | **gated** — flagged by the static writer test; must use the adapter |
| `src/components/oasis/AIGeneratedOASISAssessment.jsx` | 2 | Mapped `suggested_response` → `response`, `ai_suggested: true`, then `create` | AI may not originate a response | **removed** — `saveAssessment` deleted |
| `src/components/hub-tabs/OASISAnalyzer.jsx` | 21 | `OASISUpload.create/update`; AI functional scores fed to PDGM | AI values are evidence, never official | **rewritten** — `onCorrection` wiring and rescore→PDGM removed |
| `src/components/oasis/OASISComparisonView.jsx` | — | `OASISUpload.update` | Writes review metadata only, no response field | **unchanged** (approved writer); its comparison *display* is **OUTSTANDING** — not yet routed through `buildOasisOutput()` |
| `src/components/referral/referralExtraction.js` | 7 | Extracts OASIS-like fields from referrals | Extraction is evidence, not a response | **gated upstream** — its output can no longer reach a referral packet as a code (see `generateReferralOASISPacket`), and carries no `response_schema_id`, so every CMS consumer refuses it. The module itself is unedited. |
| `base44/functions/saveOasisResponses/entry.ts` | 6 | *(new)* | The one protected write path | **new** |

## Output, print, copy, export, referral packets

| Consumer | Occ. | Before | Under v2 | Disposition |
| --- | --: | --- | --- | --- |
| `SmartOASISAssessment.handleExportPDF()` | — | Printed every answered item under its M-number and said "Transcribe each OASIS item below into your EMR" | Only `matches` items may print a code | **rewritten** — three sections: CMS-aligned, PennSync screening (no M-numbers), quarantined-with-reason |
| `src/components/oasis/OASISExportManager.jsx` | — | Bulk export of stored responses | Must use `buildOasisOutput()` | **OUTSTANDING** — not yet routed through the output policy |
| `base44/functions/generateReferralOASISPacket/entry.ts` | 21 | Printed "AI-Generated OASIS assessment" with 31 prefilled item values under official M-numbers | A blank preparation worksheet; referral drug lists kept as labelled evidence | **rewritten** — every prefilled value stripped; heading and intro replaced |
| `src/components/visit/oasisPromptFormat.js` | 10 | Formats AI-extracted document values under M-numbers into an LLM prompt | Should label them as extracted evidence, not responses | **OUTSTANDING** — prompt-only (never shown to a clinician or exported), but still names values by M-number |
| `src/components/oasis/OASISPDFComparison.jsx` | 4 | Compares stored codes | Legacy rows should be visibly quarantined | **OUTSTANDING** — not yet routed through the output policy |
| `src/components/oasis/OASISAuditReportGenerator.jsx` | — | `current_score → recommended_score (revenue_impact)` | No recommended code, no dollar figure | **rewritten** → documentation gaps |
| `src/components/oasis/OASISAutoFlagger.jsx` | — | Compiled rescore opportunities + revenue estimate | Same | **removed** |
| `ReferralPDFSummarizer.jsx`, `AdmissionPacketCustomizer.jsx` | — | May include OASIS-like values | Fail-closed policy | **OUTSTANDING** — not yet routed through the output policy |

## AI paths

| Consumer | Occ. | Before | Under v2 | Disposition |
| --- | --: | --- | --- | --- |
| `base44/functions/generateOASISAssessment/entry.ts` | — | "PRE-FILLED RESPONSES" + "PDGM OPTIMIZATION: which responses maximize appropriate reimbursement" | Evidence + questions only | **rewritten** — `suggested_response`, `pdgm_impact`, `pdgm_optimization_notes`, `estimated_pdgm_group` removed |
| `base44/functions/mapNoteToOASIS/entry.ts` | 12 | "Determine Value"; `auto_update` above 85% confidence | Never determine a value | **rewritten** — `suggested_value`/`suggested_value_label` removed; actions are review-routing only |
| `base44/functions/batchAIAnalysis/entry.ts` | — | Asked for `suggested_value` per item | Evidence only | **rewritten** |
| `src/components/oasis/NoteToOasisPrefill.jsx` | — | Per-item Apply + "Attest all ≥85%" | No applyable value exists | **rewritten** → evidence panel |
| `src/components/oasis/noteToOasisAutofill.js` | — | Resolved a value by string-matching model text to option labels | No value produced | **rewritten** → `buildOasisEvidence` |
| `src/components/oasis/AIDataValidationEngine.jsx` | — | "Apply Correction" / "Apply Optimization"; `reimbursement_optimizations` | Findings + questions | **rewritten** → `documentation_gaps` |
| `src/components/oasis/AISmartOASISAssistant.jsx` | 11 | `functional_optimization` with `recommended_score`, `case_mix_impact`, `revenue_impact` | Observation + documentation guidance | **rewritten** → `functional_documentation_guidance` |
| `src/components/oasis/AIProactiveOASISAssistant.jsx` | 4 | Proactive suggestions referencing item codes | Evidence only | **gated** by the sanitiser |
| `src/components/oasis/SmartNoteDataImport.jsx`, `ClinicalNoteToOASISMapper.jsx`, `ProactiveRescoringEngine.jsx`, `AIAssessmentDrafter.jsx` | 2–4 each | Mapped notes to item values | Evidence only | **gated** by the sanitiser at the boundary |

## Rules, scoring, analytics, outcomes, PDGM

| Consumer | Occ. | Before | Under v2 | Disposition |
| --- | --: | --- | --- | --- |
| `src/components/oasis/outcomeMeasureEngine.js` | 13 | `parseInt(it.response)`; M1830 `6` treated as unratable; bare response map | Whole assessment; rank by CMS response order; `6` ratable | **rewritten + gated** |
| `base44/functions/computeOutcomeMeasures/entry.ts` | 10 | Same, plus M2420 `2→hospital`, `3|4→snf` | M2420 is community/hospice only | **rewritten + gated**; parity-tested against the frontend |
| `base44/functions/calculatePDGM/entry.ts` | 4 | `parseInt` on codes; missing → 0 → functional-low → payment | Explicit incomplete result | **gated** |
| `src/components/pdgm/pdgmGrouper.js` | — | Computed functional points from codes with no provenance | Requires `responseSchemaId === v2`; otherwise reported in `missing` and never grouped | **gated** |
| `src/components/oasis/oasisScales.js` | 10 | Canonical scale table + option lists for the PennSync form | For v2 items the definitions are the source of meaning | **form-scoped** — unedited; it describes the legacy form, which is now stamped v1 on save |
| `src/components/oasis/oasisScoringEngine.js` | 15 | Care-scope + triggers from the in-memory form `answers` map | Screening output, never a CMS code | **form-scoped** — unedited |
| `src/components/oasis/oasisDeterministicChecks.js` | 12 | Checks the analyzer's extracted PDGM data | Screening warnings only | **form-scoped** — unedited |
| `src/components/oasis/OASISComplianceWarnings.jsx` | 12 | Warnings from the in-memory form `answers` map | Screening warnings only | **form-scoped** — unedited |
| `src/components/oasis/OASISClinicalReasoningEngine.jsx` | 7 | Reasoning over the in-memory form `answers` map | Screening output only | **form-scoped** — unedited |
| `src/components/compliance/crossDocumentConsistency.js` | 7 | `answersFromOasisItems` + numeric thresholds | Reads both schemas, per-schema code sets, emits no code | **schema-aware (dual)** |
| `src/components/oasis/dischargeComplianceEnforcer.js` | — | Star gap from the outcome rollup | Unverified measures earn no denominator | **gated upstream** (`outcomeMeasureEngine.js`); its test now asserts the 4-of-5 reality |
| `src/components/oasis/oasisAnalytics.js`, `OASISAnalyticsDashboard.jsx` | — | `aggregateFunctionalScores` defaulted a missing score to `0` — maximum independence on every OASIS scale | `null` (a chart gap), plus an excluded count and reason | **rewritten** |
| `src/components/oasis/OutcomeMeasuresSection.jsx` | — | Renders the outcome rollup | Excluded counts should be visible | **gated upstream** (`outcomeMeasureEngine.js`); surfacing `excluded_row_count` in this component is **OUTSTANDING** |
| `base44/functions/monitorComplianceRisks/entry.ts` | — | Reads raw item responses | Needs the same schema gate as the outcome cron | **OUTSTANDING** |
| `src/components/predictive/pphWorklistEngine.js` | — | Summed three functional scores, treating a missing item as `0` (= fully independent), so a partial extract scored as LOWER risk | Scores only when all three are present; otherwise adds no points and flags the gap | **rewritten** (no schema gate yet — the input is AI-extracted upload data, not saved rows) |
| `src/components/oasis/comorbidityReconciler.js` | 2 | `toNum(answers.m1306) >= 1` on the in-memory form map | Per-schema code sets | **form-scoped** — unedited; **OUTSTANDING** if it is ever fed saved rows |

## Item definitions, verification, display

| Consumer | Occ. | Before | Under v2 | Disposition |
| --- | --: | --- | --- | --- |
| `src/components/oasis/specs/verification.js` | 59 | `itemSourceFor` returned `cms_item` on identity alone; `cmsItemsOnly` fell back to the registry for unversioned rows | Conflicting/unchecked ⇒ `unknown`; unversioned rows dropped; v2 schema required | **rewritten** |
| `src/components/oasis/specs/registry.js` | — | `resolveSpecForDate` returned the active spec for a bad date | Returns `null` | **rewritten** |
| `src/components/oasis/oasisQuestions.jsx` | 36 | The legacy item bank | Frozen as v1; v2 controls are schema-driven | **display-only** (v1 labels + warning) |
| `src/components/oasis/OasisItemNotice.jsx` | — | Item-level caveat | Still shown, now backed by the registry | **unchanged** |
| `src/components/oasis/oasisGuidanceData.jsx` | 4 | Guidance text keyed by item | No response codes | **unchanged** |
| `src/pages/ClinicalPathwayManager.jsx` | 12 | Item numbers in pathway metadata | Labels only | **unchanged** |
| `src/components/carePlan/InterventionLibrary.jsx`, `InterventionDetailPanel.jsx` | 5 / 3 | Item numbers link interventions | Labels only | **unchanged** |
| `src/components/oasis/interventionsLibrary.js` | 5 | Same | Labels only | **unchanged** |
| `src/components/oasis/oasisReadinessChecklist.js` | 4 | Presence checks | No code carried | **unchanged** |
| PDGM scenario/forecast surfaces (`PDGMWhatIfBuilder`, `PDGMScenarioModeler`, `PDGMPredictiveForecaster`, `OASISScenarioManager`, `AutomatedPDGMNavigator`, `PDGMRevenueComparison`) | 3 each | Modelled payment against item values | Depend on `calculatePDGM`, which now fails closed | **gated** transitively |

## Storage and drafts

| Consumer | Before | Under v2 | Disposition |
| --- | --- | --- | --- |
| `base44/entities/OASISAssessment.jsonc` | Ambiguous scalar `response`; open write RLS | Structured `response_value` + provenance; scoped write | **rewritten** (additive) |
| `PatientOutcomeMetric`, `AgencyKPI`, `OASISUpload` | No input provenance | Schema ids, source ids, instrument versions, `calculation_version` | **rewritten** (additive) |
| localStorage OASIS drafts | Keyed loosely | Keyed by patient + time point + instrument + schema | **rewritten** |

---

## Items with no v2 definition, by design

| Item | Why | Effect |
| --- | --- | --- |
| `M1700`, `M1810`, `M1820`, `M1845`, `M1850` | Abbreviated; outside this decision | Fail-closed, non-carryable, never scorable |
| `M2410` | Not implemented from a verified source | Facility transfer is unavailable; M2420 must never stand in |
| `M2003` | Separate CMS item the legacy M2001 had merged in | Not folded back into M2001 |
| `M1800`, GG0130/GG0170 | Outside the 18; response sets not re-verified here | M1800 keeps its existing handling; GG keeps its own extraction. Their absence from v2 is why the PDGM functional score is currently not computable. |


---

## Outstanding, by name

These are real gaps in this change, listed so they are reviewable rather than
implied by a green table. None of them can currently emit a v2 code (there are
none yet — the flag is off), and all of them are downstream of gates that refuse
unverifiable values; but each still needs its own pass.

| Consumer | What is still needed |
| --- | --- |
| `OASISExportManager.jsx` | Route through `buildOasisOutput()` |
| `OASISPDFComparison.jsx`, `OASISComparisonView.jsx` (display) | Route comparison output through `buildOasisOutput()` |
| `ReferralPDFSummarizer.jsx`, `AdmissionPacketCustomizer.jsx` | Route through `buildOasisOutput()` |
| `oasisPromptFormat.js` | Label extracted values as evidence rather than by M-number |
| `base44/functions/monitorComplianceRisks/entry.ts` | Apply the same schema gate as `computeOutcomeMeasures` |
| `OutcomeMeasuresSection.jsx` | Surface `excluded_row_count` / `episode_excluded_reasons` |
| `comorbidityReconciler.js` | Per-schema code sets if it is ever fed saved rows |
| `oasisScoringEngine.js`, `OASISComplianceWarnings.jsx`, `OASISClinicalReasoningEngine.jsx`, `oasisDeterministicChecks.js`, `oasisScales.js` | Re-point at v2 definitions when the v2 controls replace the legacy form |
