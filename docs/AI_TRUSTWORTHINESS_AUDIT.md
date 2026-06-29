# AI Trustworthiness Audit

Date: 2026-06-03

Extends the Smart Note redesign (`SMARTNOTE_REVIEW.md`) to the rest of the app.
Two anti-patterns were swept across the **live** code (211 `InvokeLLM` sites,
46 components that both call an LLM and write to an entity):

- **Pattern A** — fabricated/hardcoded "scores" written to the database that
  mislead clinicians and pollute analytics.
- **Pattern B** — LLM-generated clinical content persisted to the patient chart
  with no review by the nurse.

## Pattern A — fabricated metrics (fixed)

| Site | Problem | Fix |
| --- | --- | --- |
| `OASISAnalyzer.jsx` | Fast path **skips** data-quality validation but stubbed `data_quality_score: 80` (+`||75` fallback) and `pdgm_readiness: ready_for_grouping: true`, rendered to clinicians as "Quality: 80%" | `validation_summary = null` — the UI guards on it and shows nothing instead of a fake pass |
| `MedicalScribeAssistant.jsx` | Hardcoded `quality_score: 85/90` into scribe usage analytics (`structured_data_quality`) | Removed the fabricated field — no real quality signal exists, so it reports none; real signals (length, fields, applied) remain |
| `OASISAutoFlagger.jsx` | Thresholds `75/80/70` | **Not a bug** — legitimate config applied to upstream scores. Left as-is. |

(Other hits like `passing_score: 80` course-form defaults and the
`HospitalReadmissionRisk` additive rubric are deterministic/legitimate, not
fabricated.)

## Pattern B — unverified AI clinical content persisted

The headline finding: **most flows already have human-in-the-loop gates** — the
raw counts overstated the risk. The one genuine gap was fixed.

| Flow | Verdict |
| --- | --- |
| `DocumentVisit.jsx` (AI note template + audio→narrative) | **Fixed** — both paths force-wrote the raw AI output to `Visit.nurse_notes` *before* the nurse reviewed it (audio path also overwrote `raw_transcription` with a false "intelligently merged" string). Now the AI output populates the editor for review; the existing 30s autosave + Save button commit it after review. |
| `AICarePlanGenerator`, `AIReferralCarePlanGenerator`, `AICarePlanSuggestionEngine` | **OK, no change** — the nurse can edit/remove each generated plan and must explicitly click "Save All" before any `CarePlan.create`. Proper review gate. |
| `SmartNoteAssistant` / `ConstrainedNoteReviewer` | **OK** — constrained generation + value-guard + AI grounding; edits are re-verified before save (built earlier this effort). |

## Conclusion

The real, widespread trustworthy-AI problem was **Pattern A (fabricated scores)**,
now removed in the live surfaces. **Pattern B is mostly already mitigated** by
review/edit/select gates; the single force-persist gap (DocumentVisit) is fixed.

## Recommendation (policy, not yet enforced)

Codify "**no LLM-generated clinical content is persisted before the nurse can
review it**" as a reviewable rule. Two existing patterns satisfy it and can be
the reference implementations: the constrained-scribe **review-then-save**
(SmartNote) and the **edit/remove/Save-All** gate (care-plan generators). New
AI-write flows should reuse one of these rather than auto-persisting.
</content>
