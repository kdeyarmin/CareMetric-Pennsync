# OASIS Scrubber — capability coverage analysis

Date: 2026-06-30

## Why this exists

The legacy `src/components/visit/OASISScrubber.jsx` (a 4,135-line component) was
removed during the OASIS consolidation, leaving several engines orphaned
(`pdgmGrouper`, `oasisScales`, `clinicalIndicators`, the `visit/*Results` panels,
`oasisScrubberPrompt`, `oasisScrubberData`). The question raised was whether a
real feature was lost and should be rebuilt.

**Finding: the feature was not lost — it was modernized into OASIS Center's
tabs.** Rebuilding the old component would duplicate live functionality. This
doc maps every distinctive capability of the old scrubber to the live component
that now provides it, so the question is closed with evidence and the orphaned
engines are confirmed superseded (not a missing feature).

## Capability map (old scrubber → live OASIS Center)

The old scrubber's analysis surface comes from its prompt spec
(`oasisScrubberPrompt.jsx`) and inline result rendering. Each capability maps to
a live, wired component (reachable from `OASISCenter` → tabs):

| Old scrubber capability | Live component (wired in) | Notes |
| --- | --- | --- |
| Visit-type mandatory-element completeness (SOC/ROC, recert, discharge) | `oasis/OASISValidationPanel` (Analyze + Compliance tabs); `hub-tabs/SmartOASISAssessment` (assessment entry) | Validation panel runs admission/SOC-timing + element checks per visit context. |
| Accuracy / cross-validation (contradictions between M-items) | `oasis/OASISValidationPanel` | Deterministic M1000↔admission-source, M1005, M0110 episode-timing, date/diagnosis/functional/clinical cross-checks with field-level issues + PDGM payment impact — **more rigorous** than the old LLM-only contradiction pass. |
| PDGM analysis: clinical group, case-mix weight, functional points, comorbidity | `hub-tabs/OASISAnalyzer` + `oasis/` PDGM suite (`AutomatedPDGMNavigator`, `EnhancedPDGMCaseMixAnalyzer`, `PDGMRevenueComparison`, `PDGMImpactAnalyzer`, `PDGMPredictiveForecaster`, `PDGMTrendDashboard`) | Full case-mix/revenue analysis on extracted OASIS data. |
| Documentation quality: specificity & defensibility scoring, vague-language flags | `oasis/AIDocumentationQualityAnalyzer`, `oasis/AIDocumentationAssistant` (Analyze + Documentation tabs) | Quality scoring + vague-language guidance. |
| GG-section / functional analysis & goal appropriateness | `hub-tabs/OASISClinicalReview`, `OASISDocumentationReview`; `oasis/OASISDraftGenerator` | Clinical + documentation review tabs. |
| Reimbursement-risk / optimization review | `hub-tabs/OASISRevenueAnalysis`, `OASISAuditDashboard` (admin) | Revenue uplift + audit-risk scrubbing. |
| Assessment entry / completion | `hub-tabs/SmartOASISAssessment` | The default Assessment tab. |

Every row resolves to a component that is imported and reachable from
`src/pages/OASISCenter.jsx` (verified by import grep). The covering set is newer
and, for cross-validation, deterministic rather than LLM-only.

## Conclusion & recommendation

- **No port performed — there is no real gap.** Porting any old-scrubber piece
  would duplicate a live, generally-superior capability and reintroduce the
  duplicate-feature confusion the consolidation removed.
## Cleanup performed (dead scrubber UI only)

After confirming no gap, the **dead scrubber UI cluster** was removed — the
result/summary panels that only the deleted `OASISScrubber` rendered, imported
solely by their own specs and referenced nowhere in `package.json`:

- 23 components removed: `CriticalMissingResults`, `IncompleteAssessmentsResults`,
  `CompliantItemsResults`, `OverscoringResults`, `UnderscoringResults`,
  `InconsistenciesResults`, `MismatchesResults`, `CrossValidationResults`,
  `VagueDocumentationResults`, `RecommendationsSummary`, `QualityMeasuresImpact`,
  `AuditDefenseSummary`, `ClinicalAlertsPanel`, `ClinicalGroupSummary`,
  `ClinicalIndicatorsDetail`, `ClinicalIndicatorsGrid`, `CollapsibleResultHeader`,
  `ComorbiditiesSummary`, `DocumentationQualitySummary`, `FunctionalPhrasesPanel`,
  `GGSectionAnalysis`, `OptimizationSuggestionsPanel`, `PdgmAnalysisSummary`
  (+ their `.spec.jsx`), plus `oasisScrubberData` and `oasisScrubberPrompt`
  (+ specs). 50 files total.

### Kept on purpose — tested clinical engines, NOT deleted

The pure engines were **kept** even though they're currently imported only by
their tests, because deleting them would *remove robustness*:

- `pdgm/pdgmGrouper.js` — the canonical PDGM grouping reference that the **live**
  `pdgm/pdgmRates.js` (used by the `PDGMRateSettings` page) is **parity-tested**
  against. Deleting it would drop a correctness guard on live billing logic.
- `oasis/oasisScales.js`, `visit/clinicalIndicators.js`,
  `visit/pdgmClinicalGroup.js`, `visit/oasisPromptFormat.js` — pure, unit-tested
  clinical logic. Harmless, and candidates to re-wire rather than discard.
- Live engines `pdgm/pdgmRates`, `oasis/patientMatchScore`, `oasis/oasisAnalytics`
  are wired into live pages/tabs and were never in scope.

Verified after removal: clean build; `vitest` (210) and `test:utils` (624) pass;
lint 0/0.
