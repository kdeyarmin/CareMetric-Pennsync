# OASIS Subsystem Review

Date: 2026-06-03

OASIS drives PDGM reimbursement and Medicare compliance, and OASIS answers are
legally attested CMS data — so fabricated scores or AI-guessed M-items are
high-stakes. This review mapped the analyze / score / PDGM surface, verified each
finding (the mapping was AI-assisted; several findings were overstated), and
fixed the clear, safe ones.

## Fixed this pass

- **Deterministic scoring engine is now tested.** `oasisScoringEngine`
  (`evaluateOASIS` + `computeCareScope`) is pure, reimbursement-adjacent logic
  that had **zero tests** — despite a comment about a real string-concat bug
  (`"3" + 0 → "30"`). Renamed `.jsx → .js` and added **11 unit tests** (trigger
  /severity logic, sorting, string coercion, empty-answer handling, and a
  regression guard for the concat bug), wired into CI.
- **AI-generated OASIS documentation is now labeled unverified.**
  `OASISDraftGenerator` produced homebound/skilled-need justifications the prompt
  called "defensible in audit" and offered copy/export with no indication it was
  AI-generated. Added a visible "AI-generated draft — a clinician must verify
  before use; not a vetted/attested document" banner, and the same disclaimer
  header on the exported file.
- **PDGM revenue projection no longer pins a stale year.**
  `PDGMCaseMixForecaster` instructed the LLM to "project revenue based on 2024
  Medicare base rates (~$2,100)" — stale false-precision in a 2026 app. Changed
  to a rough-estimate framing that must be verified against the current CMS rate
  table. (Earlier in this effort, `OASISAnalyzer`'s fabricated `data_quality_score: 80`
  when validation is skipped was already removed.)

## Follow-up fixes (2026-06-03)

- **#3 — OASIS analysis scores are now labeled AI estimates.** `OASISAnalyzer`
  rendered the LLM-generated `overall / accuracy / compliance / revenue` scores
  as authoritative percentages. Added an amber "AI-generated estimates — not an
  official OASIS/PDGM determination; a clinician must verify every M-item" banner
  above the scores, marked each card `(est.)`, and added the same disclaimer to
  the exported PDF report (`generateOASISReportPDF`). This is the interim
  honest-labeling fix; the full fix (a deterministic validation engine producing
  pass/fail + an issue list, separate from "AI insights") remains deferred.

## Verified — already adequately gated (no change)

- **AI-generated OASIS answers** (`AIGeneratedOASISAssessment`): sets
  `ai_suggested: true` per item (provenance) and the clinician reviews/edits and
  explicitly saves — the same human-in-the-loop gate accepted for the care-plan
  generators. (Minor: it can mark `status: 'completed'` on AI-suggested-unedited
  items; the save is the clinician's action, but a dedicated `needs_review` state
  would be stronger — left as a recommendation.)

## Deferred — real, but bigger than a safe fix

| # | Item | Why deferred |
| --- | --- | --- |
| #2 | Hardcoded CMS base rate (`$2031.64` fallback / FY2024) | Needs an admin-updatable, dated CMS rate config + effective-date checks — a feature. Mitigated the worst (the prompt pin) above. |
| #3 | OASISAnalyzer `overall/accuracy/compliance` scores are LLM-generated, shown as authoritative | **Interim relabel shipped** (see "Follow-up fixes" above): AI-estimate banner on-screen + disclaimer in the exported PDF. The full fix — a deterministic OASIS validation engine (pass/fail + issue list) separate from "AI insights" — remains (large). |
| #10 | No deterministic PDGM clinical-group / HIPPS / case-mix-weight computation (relies on LLM `estimated_pdgm_group`) | Requires implementing the CMS grouper logic tables — a substantial, high-value build (the natural next step, and now unit-testable like the scoring engine). |
| #8 | 3162-line `OASISAnalyzer.jsx` mega-component | Refactor into upload / extract / analyze / merge / save with testable boundaries — large, risky, no runtime test here. |
| #6, #9 | Advisory (non-blocking) review flags; heuristic patient-match auto-merge at 85% | UX/safety changes; warrant product input on how strict to gate. |
| #11, #12 | OASIS question-set versioning; score-change audit trail | Small enhancements. |

## Recommendation

The biggest remaining correctness win is **deterministic PDGM grouping** (#10):
compute the clinical group / HIPPS / case-mix weight from CMS logic tables rather
than asking an LLM to guess the `estimated_pdgm_group`. Like the scoring engine,
it would be pure and unit-testable — and it's the foundation for trustworthy
revenue projections (#2/#3).
</content>
