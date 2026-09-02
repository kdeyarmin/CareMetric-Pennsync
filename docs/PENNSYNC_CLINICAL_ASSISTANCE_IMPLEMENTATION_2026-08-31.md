# PennSync Clinical Assistance Implementation — 2026-08-31

Status: **complete** for this pass. Branch `claude/pennsync-clinical-implementation-omj3ze`, PR #129.

## 1. Executive summary

PennSync is an **assistance platform that sits beside the agency's EMR**, not a
replacement for it. This pass audited `main` as of `fdc810d` and implements the
remaining gaps in the field-nurse assistance workflow, with a bias toward
deterministic, unit-testable logic over LLM judgment for anything regulatory or
patient-safety related.

The audit found the repository **far more complete than the brief assumes**. The
Smart Note compliance engine, denial guardrail, rule governance, AI provenance
registry, ADR center, denial-feedback loop, draft resilience, PDGM provenance
gating and dashboard "Today" queues are already built and tested. The genuine
gaps concentrate in five places:

1. **EMR handoff is not a first-class workflow.** Copying the finished note into
   the EMR — the single most important step in the product's stated purpose —
   was one unlabelled `Copy` button with no section-level copy, no failure
   recovery, no review acknowledgement, and no self-reported handoff state.
2. **The note-quality engine measures presence, not strength.** `requiredElements`
   asks "is homebound mentioned?", not "is the homebound statement actually
   defensible?" — so `Patient is homebound.` scored as documented.
3. **No copy-forward / cloning defence exists.** `visitComparison.js` compares
   *vitals*, not *text*.
4. **The OASIS item bank contains factually wrong CMS item attributions** — and,
   as a later item-by-item read of the CMS instrument established, answer
   choices that offer a code meaning something else on the official
   assessment for 18 of the 24 comparable items (§6.4).
5. **No consolidated Documentation Readiness view** for QA/office staff.

Three outright factual/regulatory defects were found and corrected (§6).

## 2. Current-state audit

Method: read `AGENTS.md`; read `main` at `fdc810d`; inspected 116 commits since
2026-08-01; read `docs/` and `docs/audits/`; read every module named in the
brief plus the surrounding feature paths.

### What is already built and working (do not rebuild)

| Area | Evidence |
| --- | --- |
| Deterministic required-element checking | `src/components/smartNote/compliance/requiredElements.js` (26 KB, 37 elements, per-service-line/visit-type matrices) + tests |
| Gap questions + answer adequacy | `answerAdequacy.js`, `presenceDetection.js`, `completenessCritic.js`, `criticReconcile.js` |
| Placeholder blocking | `placeholderGuard.js`, `draftScan.js`, `PlaceholderAlert.jsx`, hard-blocked at both step 1 and step 2 |
| Value guard / AI grounding | `valueGuard.js`, `generation.js` (`groundNote`), `provenance.js` |
| Chart cross-check + allergy conflict | `chartCrossCheck.js`, `ChartCrossCheckPanel.jsx` |
| Critical-vital detection | `noteEscalation.js`, `VitalSignValidator.jsx`, `visit/vitalEscalation.js` |
| Prior-visit comparison + sustained trends | `visitComparison.js` (`compareVisits`, `detectSustainedTrends`) |
| Denial-risk checks | `compliance/denialGuardrailEngine.js`, `DenialRiskPanel.jsx` |
| Facility documentation rules | `facilityDocRules.js`, `FacilityRequirementsChecklist.jsx`, critical-override ack trail |
| Deterministic coverage score | `coverageScore.js` |
| Follow-up task creation from a note | `generateFollowUpTasks`, `FollowUpTasksPanel.jsx` |
| Nurse acknowledgement controls | `AcknowledgeGate.jsx` + `ComplianceAudit.acknowledgment` |
| Draft restoration / per-patient isolation | `SmartNoteAssistant.jsx` `draftKeyFor(pid)` + `src/lib/draftNotes.js` (IndexedDB, commit-on-transaction) |
| Save-error handling | `OfflineSaveError`, `SaveBlockers.jsx` |
| Mobile sticky actions | `StickyActionBar.jsx` (+ the Aug 2026 shell-overflow fixes) |
| Medicare rule governance | `MedicareComplianceRule` entity (`cop_reference`, `effective_date`, `severity`, `validation_criteria`, `remediation_guidance`, `is_active`), `defaultMedicareRules.js`, `ruleLibrary.js` |
| Rule-version preservation on findings | `ComplianceAudit.rule_versions` written by `reportingFields.buildAuditFields` |
| AI provenance | `src/lib/aiProvenanceRegistry.js` + tests |
| ADR / audit assistance | `src/components/adr/**` (`adrRequirements`, `adrAnalysis`, `adrPacketReview`, `adrChecklistPrint`, `adrDeadlines`) + `ADRCenter.jsx` |
| Denial feedback loop | `src/components/billing/denialFeedback.js` + tests |
| Today / work queues | `dashboard/todayPriorities.js`, `dashboard/coreWorkQueues.js` + tests |
| PDGM provenance/gating | `pdgm/caseMixWeightsLoader.js`, `pdgmRates.js`, `hhCaseMixWeightsCy2026.js`, `paWageIndexCy2026.js`, parity tests |
| Targeted training from gaps | `training/DeficitAnalyzer.jsx`, `SkillGap` entity, `MicroLearningProgress` |
| PHI-minimisation policy | `src/lib/localPhiKeys.js` (+ deliberate draft-note exemption, documented) |

## 3. Current State Gap Matrix

Severity of "Risk if left unchanged" is graded R1 (patient-safety / regulatory
misstatement) → R3 (workflow friction).

| # | Recommendation | Current status | Already-implemented behaviour | Remaining gap | Files / modules | Risk if unchanged | Planned implementation | Test strategy |
|---|---|---|---|---|---|---|---|---|
| 1 | Never say "Medicare compliant" | **Implemented incorrectly** | Coverage score is deterministic and honest | Final screen headline read **"Medicare-Compliant Note Ready"** — PennSync certifying Medicare compliance, which it must never do | `smartNote/FinalNoteDisplay.jsx` | **R1** — asserts a regulatory conclusion PennSync cannot make | Replace with "Documentation review complete", state the coverage number as *PennSync rule coverage*, add the standing EMR disclaimer | Component test asserting the string is gone and the disclaimer renders |
| 2 | Phase 1A — EMR handoff as a first-class workflow | **Missing** | One `Copy` / `Copy All` button; clipboard failure toasts | No section-level copy, no per-section success state, no "Copy to EMR" primary action, no self-reported handoff status, no standing disclaimer | `smartNote/FinalNoteDisplay.jsx`, `SmartNoteAssistant.jsx` | **R2** — the product's core step is the least supported | New pure `emrHandoff.js` (section splitter + status model) + `EmrHandoffPanel.jsx`; `Visit.emr_handoff_status` / `emr_handoff_history` | Unit tests for the splitter and status machine; component test for copy success + clipboard failure |
| 3 | Phase 1B — review acknowledgement | **Missing** | Chart/denial/facility acks exist, but none covers "I reviewed the AI-assisted text" | No AI-review attestation, no note hash | same as 2 | R2 — AI-governance gap | Acknowledgement inside the handoff panel; stores user, time, note hash, ai_assisted flag | Unit test on the hash + record builder |
| 4 | Phase 1C — explain every flagged issue | **Partial** | Denial guardrail gives message + remediation; required elements give hint/question/example | Homebound/skilled-need/response/teaching findings had no *evidence* row (what in the note triggered this) | `compliance/requiredElements.js` | R2 — black-box findings | `documentationStrength.js` returns rule, trigger, evidence spans, what's missing, remediation | Unit tests per analyzer |
| 5 | Phase 1D — homebound helper | **Partial** | Presence regex + hint + example | `Patient is homebound.` passes the presence check and scores as documented | `requiredElements.js` | **R1** — the #1 home-health denial reason documented as satisfied | Deterministic strength grading (weak/partial/strong) over factor detection: medical reason, device, human assist, dyspnea, pain, weakness, cognitive/safety, taxing effort, leaves-home frequency | Unit tests over weak/partial/strong corpora |
| 6 | Phase 1E — skilled-need helper | **Partial** | Presence regex | No check that the *skill* is described (assessment performed, judgment, teaching, response) | `requiredElements.js` | **R1** | Same strength model, skilled-need factors | Unit tests |
| 7 | Phase 1F — patient response | **Partial** | Presence regex | No detection of *intervention without response* | `requiredElements.js` | R2 | Deterministic intervention-sentence detection + unmatched-response finding | Unit tests |
| 8 | Phase 1G — teaching / teach-back | **Partial** | Presence regex | "Education provided." passes | `requiredElements.js` | R2 | Strength model: topic, learner, method, teach-back, understanding, remaining need | Unit tests |
| 9 | Phase 1H / Phase 10 — cloning advisory | **Missing** | `visitComparison.js` compares *vitals only* | No text-similarity engine at all | new | **R1** — cloned notes are a top ADR/denial trigger | New `noteSimilarity.js`: normalized shingle Jaccard, repeated-sentence detection, per-category repeats (intervention/response/education/homebound/function), identical-vitals detection. Advisory, never accusatory, never blocking | Unit tests incl. a "legitimately similar but distinct" negative case |
| 10 | Phase 1I — change-in-condition helper | **Implemented** | `noteEscalation.js` + `compareVisits` + one-tap `onEscalate` → Task, with "Follow-up task created" wording (never "provider notified") | — | — | — | Marked complete | Existing tests |
| 11 | Phase 2 — Visit Prep | **Missing (field visits)** | `referral/socVisitPrep.js` exists for *intake/SOC only* | No pre-visit briefing for an ordinary field visit | new | R2 | Pure `visitPrep.js` briefing builder + progressive-disclosure panel with direct actions | Unit tests over the builder |
| 12 | Phase 3 — Today workflow | **Implemented** | `todayPriorities.js` + `coreWorkQueues.js` + `TodayPriorities.jsx`, each row action-linked | Documentation-readiness and unresolved-gap rows | `dashboard/*` | R3 | Feed readiness output into the existing queue rather than rebuild | Existing tests + new readiness tests |
| 13 | Phase 4 — OASIS assistance framing | **Partial** | Guidance, deterministic checks, suggestion panels, no iQIES submission anywhere | Center is titled/positioned as *completing* OASIS; item bank has no version metadata | `pages/OASISCenter.jsx`, `oasis/oasisQuestions.jsx` | R2 | Re-frame as **OASIS Review & Assistance Center** + versioned spec layer | Contract test over the spec registry |
| 14 | Phase 4 — item-bank correctness | **Implemented incorrectly** | 37 items | `M2102`→"Physical Therapy", `M2110`→"Occupational Therapy", `M2200`→"Speech-Language Pathology" are **wrong CMS attributions** (M2102/M2110 are assistance items; M2200 Therapy Need was retired under PDGM). The same repo contradicts itself at `AIProactiveOASISAssistant.jsx:138`. Response sets logged as "abbreviated" (M1020, M1030, M1100, M2420) — an item-by-item read against the CMS instrument later found 18 items whose codes carry a different meaning, not four that are merely short (see §6.4) | `oasis/oasisQuestions.jsx` | **R1** — a nurse could carry a wrong item number/response into the official record | Versioned `specs/` registry with per-item verification status; demote the three mis-numbered items to clearly-labelled PennSync internal screening items; flag abbreviated response sets in the UI. **No CMS content fabricated** | Contract test: every item is classified; no unverified item may be presented as an official CMS item |
| 15 | Phase 5 — note/OASIS/care-plan consistency | **Partial** | `oasisDeterministicChecks.js`, `dischargeComplianceEnforcer.js`, `comorbidityReconciler.js` | No cross-document (note ↔ OASIS ↔ care plan) finding model with source A/source B evidence | new | R2 | Deterministic `crossDocumentConsistency.js` | Unit tests per finding type |
| 16 | Phase 6 — medication reconciliation | **Partial** | `medication/drugInteractions.js` (deterministic, limited list), `MedicationReconciliation` entity, allergy cross-check | No normalization layer, no explicit "limited list" labelling, no external-knowledge adapter seam | `medication/**` | R2 | `medicationNormalize.js` + discrepancy engine + honest source labelling + adapter seam | Unit tests |
| 17 | Phase 7 — closed-loop provider follow-up | **Partial** | Full token lifecycle exists **for referrals** (`ProviderFollowUpToken`, `validateFollowUpToken`, `submitFollowUpResponse`); clinical escalation creates a `Task` and says "Follow-up task created" (correct wording) | No clinical-side lifecycle states beyond Task status | `tasks/**`, `referral/**` | R2 | Deterministic lifecycle model + unresolved queue derivation | Unit tests on the state machine |
| 18 | Phase 8 — Documentation Readiness | **Missing** | Individual signals exist and are persisted | Nothing aggregates them into a per-episode readiness view for QA | new | R2 | Pure `documentationReadiness.js` with the three mandated statuses + drill-down + disclaimer. Explicitly **not** a billing gate | Unit tests over each status transition |
| 19 | Phase 9 — Medicare rule engine governance | **Implemented** | IDs, category, CoP ref, service line, visit types, severity, criteria, remediation, examples, effective date, active flag, and `ComplianceAudit.rule_versions` snapshotting | Language audit only | `compliance/**` | R3 | Language sweep (see #1) | Existing tests |
| 20 | Phase 11 — low-connectivity draft protection | **Implemented** | Per-patient session + IndexedDB draft, commit-on-transaction, explicit `OfflineSaveError`, no false "charted" claim, deliberate PHI-purge exemption documented | — | `lib/draftNotes.js` | — | Marked complete | Existing tests |
| 21 | Phase 12 — PDGM assistance | **Implemented** | Loader with source/provenance/validation state; parity tests; estimates labelled | — | `pdgm/**` | — | Marked complete | Existing tests |
| 22 | Phase 13 — ADR/audit assistance | **Implemented** | Requirements, analysis, packet review, checklist print, deadlines | — | `adr/**` | — | Marked complete | Existing tests |
| 23 | Phase 14 — denial feedback | **Implemented** | `billing/denialFeedback.js` | — | — | — | Marked complete | Existing tests |
| 24 | Phase 15 — training from real gaps | **Implemented** | `DeficitAnalyzer.jsx`, `SkillGap`, `MicroLearningProgress` | — | — | — | Marked complete | Existing tests |
| 25 | Phase 16 — AI governance | **Implemented** | `aiProvenanceRegistry.js` (feature, model, actor, source record, status, hashes, reviewer) | Handoff acknowledgement should feed it | `lib/aiProvenanceRegistry.js` | R3 | Reuse, don't rebuild | Existing tests |
| 26 | Phase 17 — PHI minimisation | **Implemented (policy)** | `localPhiKeys.js`; note history retained deliberately for prior-note comparison | — | — | — | No change: removing note history would break #9 and the carry-forward pre-fill | — |
| 27 | Phase 18 — security / production readiness | **Partial, externally blocked** | RLS blocks on every entity, `securityGuardrails.test.js`, `HOSTED-RLS-PROOF.md` | Hosted RLS proof requires external validation — must stay marked outstanding | `base44/**`, `docs/HOSTED-RLS-PROOF.md` | R2 | Do not mark complete | Existing contract tests |
| 28 | Phase 19 — UX / mobile | **Implemented** | Aug 2026 sticky/scroll fixes, 44–48 px targets, `CollapsibleSection`, `StickyActionBar` | New surfaces must match | — | R3 | Build new panels on the existing primitives | a11y + component tests |

## 4. Features already complete (not rebuilt)

Rows 10, 12, 19, 20, 21, 22, 23, 24, 25, 26, 28 above. These were verified by
reading the implementation, not by trusting an older audit document.

## 5. Features changed

### 5.1 Smart Note — EMR handoff is now a first-class step (gap-matrix rows 2, 3)

`src/components/smartNote/emrHandoff.js` (new, pure) + `EmrHandoffPanel.jsx` (new).

- **Copy to EMR** is the primary action on the finished-note screen.
- **Per-section copy**: `splitNoteSections()` splits on an explicit heading when
  the note carries one (the copied text then matches what the nurse sees) and
  otherwise groups paragraphs with a deterministic topic label. The section BODY
  is always the untouched source text — a split never rewrites or drops content.
- **Clipboard failure is shown inline**, with the manual fallback and an explicit
  "nothing was lost". A toast that has already faded is not a recovery path.
- **Self-reported handoff statuses** (`Copied to EMR` → `Reviewed in EMR` →
  `Signed in EMR`). Forward-only, and every status carries "PennSync did not
  verify this" — there is no EMR integration and nothing may imply one.
- **Review acknowledgement**: user, time, note hash, `ai_assisted`,
  `nurse_edited`, and `is_clinical_signature: false`. It stores a hash, not a
  second copy of the note (PHI minimisation), and goes stale — visibly — if the
  nurse edits after acknowledging.
- The AI-assisted provenance badge stays visible right up to the copy, so an AI
  suggestion never becomes indistinguishable from clinician-confirmed text.

### 5.2 Documentation strength (rows 4–8)

`compliance/documentationStrength.js` (new, pure) + `DocumentationStrengthPanel.jsx`.

`presenceDetection` answers *"is homebound mentioned?"*. This answers *"does the
homebound statement carry the factual support a reviewer looks for?"* — so
`Patient is homebound.` grades **weak** rather than documented. Four analyzers
(homebound, skilled need, patient response, teaching) grade over their supporting
factors and produce the targeted questions for whatever is missing.

Two design commitments: a missing factor becomes a **question**, never a
suggested clinical fact; and every finding ships its rule, citation, the evidence
sentences from the note, what appears missing, and remediation — no black-box
score. Patient response is a *pairing* check: it names the specific intervention
that has no documented response, rather than saying "response missing" about the
whole note. Absent elements are left to the existing required-element gate so the
nurse is not nagged twice.

### 5.3 Copy-forward / cloning defence (rows 9)

`compliance/noteSimilarity.js` (new, pure) + `CopyForwardPanel.jsx`.

Shingled Jaccard similarity (5-word n-grams), exact repeated-sentence detection
with an 8-word floor, per-category repeats, and identical-vitals detection.
**Advisory throughout**: it never blocks a save and never alleges cloning or
misconduct. Notes on a stable patient are legitimately similar, so the panel
shows *what* repeats and lets the nurse judge. Vitals are only reported when a
whole set of three or more readings is byte-identical, and even then the prompt
asks to "confirm these readings were taken today".

### 5.4 Visit Prep (row 11)

`visit/visitPrep.js` (new, pure) + `VisitPrepPanel.jsx`, on the patient overview.

Assembled from the context `getPatientContext` already returns — no extra
round-trip, no LLM. Progressive disclosure lives in the data (items carry a
priority band; the panel opens the top two). Absent data reads as "not recorded
in PennSync", never as a clinical negative. Direct actions (Start Smart Note,
Visit Scribe, chart, medications, OASIS guidance) so common work does not require
walking back through several hubs.

### 5.5 Documentation Readiness (row 18)

`compliance/documentationReadiness.js` (new, pure) + `DocumentationReadinessPanel.jsx`.

The three mandated statuses only — **No PennSync issues detected / Review
recommended / Action needed**. Explicitly not a billing gate; the disclaimer
naming the EMR, billing system, agency QA and pre-bill review is always on
screen. Two distinctions the tests pin down: "PennSync has nothing recorded" is
its own finding rather than a silent pass, and the list of checks that *ran* is
shown even when nothing was found, so "we found nothing" and "we did not look"
never read the same.

### 5.6 Provider follow-up lifecycle (row 17)

`tasks/providerFollowUpLifecycle.js` (new, pure).

Ten states from `identified` to `resolved`, with `contact` **false through
`sent`** — dispatching a fax is not a person receiving it. Only a
channel-confirmed delivery establishes contact, and escalating because nobody
could be reached does not flip it. Each step records whether PennSync *observed*
it or a human *reported* it. Transitions are explicit rather than "any forward
move": escalation from any open state, a response phoned in before a delivery
receipt that may never arrive, and no silent reopening of a resolved item.
States map onto the existing `Task.status` enum without inventing enum values.

### 5.7 Medication reconciliation assistance (row 16)

`medication/medicationReconciliation.js` (new, pure) + `MedicationReconciliationPanel.jsx`.

Normalisation (name / strength / route / frequency / doses-per-day) plus
discrepancy detection: in the note but not the list, reported stopped, dose
change, frequency change, duplicate therapy, allergy conflict. Plus a
"Medication changes this visit" summary that can feed a provider follow-up.

`setMedicationKnowledgeAdapter()` is the seam for an authoritative external
service; nothing is wired by default and `describeKnowledgeSource()` reports the
built-in list as **unlicensed with a caveat**, so no screen can imply
authoritative backing that does not exist. Two false-alert guards: a stop phrase
only counts in the same sentence as its drug, and 1 g vs 1000 mg is not a dose
change — false alerts train nurses to dismiss the real ones.

### 5.8 Cross-document consistency (row 15)

`compliance/crossDocumentConsistency.js` (new, pure) + `CrossDocumentReviewPanel.jsx`.

Six deterministic checks across note ↔ OASIS ↔ care plan. Every finding shows
source A, source B, evidence sentences, severity and a suggested action. PennSync
never rewrites a record and never decides which side is right. Marking a finding
"not applicable" **requires a reason**, so a real finding cannot be dismissed
silently.

### 5.9 OASIS versioned reference layer (rows 13, 14)

`oasis/specs/` (new) + `OasisScopeNotice.jsx`, and the centre re-framed as the
**OASIS Review & Assistance Center**.

- `specs/e/index.js` — version metadata with effective date, source, source URL,
  and a `completeness: "partial"` field whose note states plainly that PennSync
  does not contain the authoritative CMS instrument.
- `specs/registry.js` — effective-date resolution; a date before every known
  version resolves to `null` rather than applying OASIS-E definitions to an
  assessment completed under an instrument PennSync does not hold.
- `specs/verification.js` — per-item classification (`verified` / `abbreviated` /
  `unverified` / `pennsync_screening`) that **fails closed**: an unregistered item
  is `unverified`, so a newly added item can never present itself as confirmed
  CMS content by omission.
- A standing scope notice states that the official OASIS is completed and
  submitted in the agency's EMR and that nothing reaches CMS or iQIES.

**No direct iQIES submission was built, and none exists anywhere in the repo.**

## 6. Regulatory / factual defects corrected

### 6.1 PennSync certified Medicare compliance (severity: R1)

`src/components/smartNote/FinalNoteDisplay.jsx:14` headed the finished-note
screen **"Medicare-Compliant Note Ready"**. PennSync is a documentation-assistance
tool — not the EMR, not agency QA, not a Medicare adjudicator — and must never
certify a Medicare conclusion.

Corrected to **"Documentation review complete"**, with the coverage number
re-labelled as *PennSync rule coverage … This is not a Medicare compliance
determination*. `"Save to chart"` became `"Save to PennSync"` so the working copy
cannot read as the legal record.

### 6.2 Three OASIS questions carried the wrong CMS item numbers (severity: R1)

`src/components/oasis/oasisQuestions.jsx` presented:

| Displayed | PennSync's content | Why it is wrong |
| --- | --- | --- |
| `M2102 — Physical Therapy` | PT need (yes/no) | M2102 is an assistance item in the CMS instrument — **this repository says so itself** at `AIProactiveOASISAssistant.jsx:138` ("M2102 (Types and Sources of Assistance)"), directly contradicting the item bank |
| `M2110 — Occupational Therapy` | OT need (yes/no) | M2110 is likewise an assistance item, not an OT-need question |
| `M2200 — Speech-Language Pathology` | SLP need (yes/no) | M2200 (Therapy Need) was discontinued under PDGM |

A nurse reading these could have carried a wrong item number into the official
assessment.

**Fix, and what it deliberately is not.** PennSync does not hold the
authoritative CMS instrument, so writing in the "correct" item content would
replace one fabrication with another. Instead the useful screening questions were
kept with the **false CMS attribution removed**: they are labelled PennSync
screening items, their internal ids are unchanged so stored responses keep
resolving, and the verification registry classifies them `pennsync_screening`
with `official_item: null`. A contract test enforces that an item may display an
M-number only where the registry permits one.

### 6.3 Answer choices diverge from the CMS response sets (severity: R1)

Originally logged as four items with "shortened response lists" and classified
`abbreviated`. A later item-by-item read of the CMS instrument (§6.4) found that
framing far too gentle: the problem is not length, and it is not four items.

### 6.4 18 items offer a code that means something else in the EMR (severity: R1)

The clinical sign-off states in its own text that response OPTIONS were not
individually verified. That caveat has now been closed, and it was carrying most
of the weight.

The guidance manual states response codes as prose coding instructions, which is
why the first check stopped at titles. CMS publishes the response sets
separately, in the **OASIS-E2 All Items instrument (12/11/2025)**. Every PennSync
item present there was read against it option by option — code set, code order,
and the *meaning* of each option's text.

Of the 24 items with an official response set to compare against:

| Verdict | Count | Items |
| --- | --- | --- |
| `matches` — reproduces the CMS set in order and meaning | 1 | M1800 |
| `abbreviated` — same codes, same order, looser wording | 5 | M1700, M1810, M1820, M1845, M1850 |
| `conflicts` — at least one code means something different, or the answer shape differs | **18** | M1033, M1100, M1306, M1340, M1400, M1610, M1620, M1630, M1740, M1830, M1840, M1860, M1870, M2001, M2010, M2020, M2401, M2420 |

**A matching code set is not a matching response set**, and that is the trap this
read exists to close. A comparison of code sets alone would have cleared several
of the worst cases:

| Item | Codes | What actually differs |
| --- | --- | --- |
| **M1340** | `{0,1,2}` — identical to CMS | PennSync's `2` is "Yes — infected"; the CMS `2` is "surgical wound known but **not observable**". Infection is not part of M1340. |
| **M2020** | `{0,1,2,3}` — identical to CMS | Codes **1 and 2 are transposed**. CMS `1` is "if dosages are prepared in advance", CMS `2` is "if given reminders". PennSync has them the other way round. |
| **M2010** | `{0,1,2}` | PennSync's `0` is "not applicable — no high-risk drugs", which is CMS **NA**. The CMS `0` is "**No** — education not provided". Entering PennSync's `0` records the opposite of what the nurse meant. |
| **M1860** | `{0..6}` — identical to CMS | The scale is **offset by one** from code 1 onward. PennSync inserts "minor difficulty on uneven surfaces", pushing one-handed device to `2` (CMS `1`), two-handed to `3` (CMS `2`), supervision to `4` (CMS `3`). |
| **M1840** | `{0..4}` — identical to CMS | Codes 2–3 use **M1850's** bear-weight/pivot language. CMS M1840 codes by *where* the patient can toilet (bedside commode, bedpan/urinal). |
| **M1610** | `{0..4}` | A frequency-graded scale that is not the current M1610. CMS has three responses, where `2` means **a catheter**; PennSync's `2` is "daily pads required". |
| **M1306** | `{0,1}` — identical to CMS | PennSync asks about a pressure ulcer "at any stage". CMS asks about **Stage 2 or higher or unstageable**, explicitly excluding Stage 1. |
| **M1100** | 4 options | CMS M1100 is a 3x5 grid with codes **01–15**. PennSync's printed `01` is CMS `05`; its `03` is CMS `10`. No congregate-living option exists. |
| **M1033**, **M1740** | single-select | Both CMS items are **check-all-that-apply**. No PennSync answer maps to a valid response. |
| **M2001** | `{0,1,2}` | Splits "issues found" by physician contact, which is the separate item **M2003**. CMS `9` (NA) is absent. |
| **M2401** | `{0,1,9}` | PennSync asks one medication question. CMS M2401 is a grid of falls / depression / pain / pressure-ulcer rows. Medication intervention is M2003/M2005. |
| **M2420** | `{1..5,9}` | The **pre-OASIS-D** disposition list. In the current instrument `2` is "remained in the community with HHA services", `3` is "non-institutional hospice", `4` is "moved out of the service area" — not hospital / rehab / nursing home. |

**The hazard is code carry-over.** A nurse reading a code off a PennSync screen
and typing it into the same-numbered item in the EMR would enter a wrong response
in each of those cases. Before this change the product actively encouraged that:
`officialItemNumber()` printed the CMS number and `describeVerification()`
returned a green "Verified item" badge for 23 of these items.

**What was deliberately NOT done.** The option lists were **not rewritten** to
the CMS wording. Stored assessments key off these values, and re-labelling
M2020's code 2 would silently change the meaning of every M2020 answer already
recorded — changing clinician-entered facts after the fact (brief rule 13). No
mapping was invented either. Instead the divergence is recorded as data and the
consequence is made deterministic:

- Each registry entry gains `response_set` (`matches` / `abbreviated` /
  `conflicts` / `not_applicable` / `unchecked`) and a `response_set_note` saying
  what the read found for that item.
- `mayCarryResponseToEmr(itemId)` — the question the read was for. It answers
  "may the nurse type the code they picked here into that item over there",
  which `officialItemNumber()` does not. True only for `matches`. Fails closed
  for anything unregistered.
- `describeVerification()` — a conflicting response set now **overrides** the
  identity badge. M1340 is a genuine current CMS item with the right title, so
  its `level` stays `verified`; a green badge beside answer choices whose code 2
  means something else is the exact reassurance a nurse must not be given.
- `responseSetCaveat()` / `itemDisclaimer()` carry the deterministic sentence
  "Do not carry this code into your EMR…".
- **`OasisItemNotice`** renders it *at the item*, beside the answer choices,
  because that is where the carry-over happens — not in a banner at the top of
  the page. Before this, `itemDisclaimer()` and `describeVerification()` had no
  UI consumer at all: the whole registry was invisible to the nurse.
- `responseSetStatus()` feeds the OASIS scope notice a computed count, so the
  on-screen number cannot drift from the registry.

`oasisScales.js` and `oasisScoringEngine.js` mirror these same scales
deliberately, so the app stays internally consistent with itself. What it is not
is a reproduction of the CMS instrument, and it no longer claims to be.

**This does not overturn the clinical sign-off, it bounds it.** Signing that an
option list is usable as a *screening prompt* is a different claim from saying it
is the CMS response set, and only the first was ever made. The signed
`review_source` text is left exactly as signed — a test still asserts its
"RESPONSE OPTIONS WERE NOT individually verified" caveat is present — and the
read is recorded separately in `RESPONSE_SET_CHECK`.

## 7. Files changed by area

**Smart Note (8)** — `emrHandoff.js`*, `emrHandoff.test.js`*, `EmrHandoffPanel.jsx`*,
`EmrHandoffPanel.spec.jsx`*, `FinalNoteDisplay.jsx`, `ConstrainedNoteReviewer.jsx`,
`DocumentationStrengthPanel.jsx`*, `CopyForwardPanel.jsx`*

**Smart Note compliance (4)** — `documentationStrength.js`*, `documentationStrength.test.js`*,
`noteSimilarity.js`*, `noteSimilarity.test.js`*

**OASIS (7)** — `specs/index.js`*, `specs/registry.js`*, `specs/e/index.js`*,
`specs/verification.js`*, `specs/verification.test.js`*, `specs/oasisItemBank.spec.js`*,
`OasisScopeNotice.jsx`*, `OasisItemNotice.jsx`*, `OasisItemNotice.test.jsx`*,
plus `oasisQuestions.jsx` and `hub-tabs/SmartOASISAssessment.jsx`

**Compliance (6)** — `documentationReadiness.js`*, `documentationReadiness.test.js`*,
`DocumentationReadinessPanel.jsx`*, `crossDocumentConsistency.js`*,
`crossDocumentConsistency.test.js`*, `CrossDocumentReviewPanel.jsx`*

**Visit (3)** — `visitPrep.js`*, `visitPrep.test.js`*, `VisitPrepPanel.jsx`*

**Medication (3)** — `medicationReconciliation.js`*, `medicationReconciliation.test.js`*,
`MedicationReconciliationPanel.jsx`*

**Tasks (2)** — `providerFollowUpLifecycle.js`*, `providerFollowUpLifecycle.test.js`*

**Pages (3)** — `SmartNoteAssistant.jsx`, `PatientDetails.jsx`, `OASISCenter.jsx`

**Backend / contracts (3)** — `base44/entities/Visit.jsonc`,
`base44/functions/getPatientContext/entry.ts`, `base44/schemaContract.test.js`

**Config / docs (2)** — `package.json` (test registration), this document

`*` = new file. 40 files, +6048 / −24.

## 8. Tests added

**~273 new tests across 14 suites**, all deterministic and offline.

| Suite | Tests | Focus |
| --- | --- | --- |
| `smartNote/emrHandoff.test.js` | 19 | disclaimer wording, forward-only status machine, section splitting, note hashing, acknowledgement staleness |
| `smartNote/EmrHandoffPanel.spec.jsx` | 12 | copy success, **clipboard failure**, per-section copy, self-reported labelling, stale-ack warning |
| `compliance/documentationStrength.test.js` | 24 | weak/partial/strong grading per element, question wording, hospice exclusion |
| `compliance/noteSimilarity.test.js` | 23 | similarity maths, **the legitimately-similar negative case**, tone guardrails, identical vitals |
| `oasis/specs/verification.test.js` | 32 | classification, fail-closed default, disclaimers, effective-date resolution, clinical sign-off tracking and the reviewer worksheet, **the response-set read: a matching code set is not a matching response set, and a conflict overrides a reassuring badge** |
| `compliance/thresholds.test.js` | 12 | uncalibrated-by-default provenance, override validation, hand-set ≠ calibrated |
| `compliance/calibrationHarness.test.js` | 13 | corpus scoring, candidate trade-offs, declining on a small or one-sided sample |
| `oasis/specs/oasisItemBank.spec.js` | 6 | contract: every item classified; an M-number only where permitted |
| `visit/visitPrep.test.js` | 20 | priority banding, recent-change windows, overflow truncation, determinism |
| `compliance/documentationReadiness.test.js` | 20 | each status transition, "nothing known ≠ nothing wrong", billing-language guard |
| `compliance/crossDocumentConsistency.test.js` | 22 | each finding type, resolution rules, ordering |
| `medication/medicationReconciliation.test.js` | 25 | normalisation, each discrepancy type, false-alert guards, adapter honesty |
| `tasks/providerFollowUpLifecycle.test.js` | 24 | contact semantics, transition legality, queue ordering, Task enum mapping |
| `oasis/OasisItemNotice.test.jsx` | 6 | the at-the-item caveat: alert for a conflicting code, silence for a faithful one, softer note for looser wording, no CMS number on a screening item |

All new `.test.js` files are registered in `package.json` `test:utils`
(`testRegistryContract` enforces this).

### Defects the tests caught while being written

1. **Section splitting dropped clinical text.** A permissive heading rule parsed
   `"Assessed the sacral wound: 2x3 cm, granulating"` as a heading and dropped the
   lead-in from the copied section. Fixed with a bounded heading vocabulary plus
   an ALL-CAPS rule; regression test added.
2. **Category double-counting.** `"Patient tolerated the dressing change without
   complaint"` counted as both response *and* intervention wording, polluting the
   intervention comparison and making the identical-wording signal unreachable.
   Fixed with single-assignment priority ordering.
3. **Over-broad provider-task matcher.** A bare `/order/` match swept
   `"Order new dressing supplies"` into the most urgent visit-prep band.

## 9. Validation results

Run on this branch at the final commit. Node 22.22.2 was the available runtime
(the repo targets ≥24.18.0); pnpm emits an engine warning and every command still
runs and passes.

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | ✅ clean |
| `pnpm run lint` | ✅ 0 errors, 0 warnings |
| `pnpm run typecheck:signal` (CI gate) | ✅ 0 high-signal diagnostics (16 290 total, all low-signal or in fixtures) |
| `pnpm test` → `test:utils` | ✅ 1912 / 1912 |
| `pnpm test` → `test:contracts` | ✅ 22 / 22 |
| `pnpm test` → `test:security` | ✅ 87 / 87 |
| `pnpm test` → `test:dedupe` | ✅ pass |
| `pnpm test` → `test:components` | ✅ 920 / 920 across 116 files |
| `pnpm run build` | ✅ succeeds |
| `pnpm run test:a11y` | ✅ 2 / 2 |
| `pnpm run check:backend-transpile` | ✅ 238 functions transpile cleanly |
| `pnpm run lint:actions` | ✅ 4 workflow files pass |

No regressions. No test was skipped, disabled or quarantined.

## 10. Remaining limitations

1. **PennSync still cannot see inside the EMR.** Every handoff status is
   self-reported. This is a product boundary, not a defect, and the UI states it
   at every step.
2. **The OASIS item set is a screening instrument, not the CMS one.** Item
   numbers, titles and now answer choices have all been read against the CMS
   manuals and the OASIS-E2 All Items instrument, and the divergence is recorded
   per item (§6.4) — but recording it is not fixing it. 18 of 24 comparable items
   still *offer* a code that means something else on the official assessment; the
   product's answer is to warn at the item and refuse to vouch for the code, not
   to correct the scale. Correcting one means re-labelling options that stored
   assessments key off, which is a data-migration decision with a clinical
   reviewer in the loop, not an edit — see §13.
3. **The medication knowledge base is a small deterministic list.** The adapter
   seam exists; no licensed service is wired.
4. **Similarity is lexical, not semantic.** A note rewritten in different words
   with the same absent detail will not be flagged. This is the correct trade for
   a deterministic, explainable engine, but it is a ceiling.
5. **Documentation strength is regex-based.** Unusual phrasing may under-detect a
   factor. It fails toward *asking a question*, never toward a false pass.
6. **`getPatientContext` grew two reads.** Bounded to 20 care plans and 10 OASIS
   rows; worth watching on very large charts.
7. **No hosted verification was possible.** This environment has no Base44
   credentials, so all evidence is from the automated suites.

## 11. Hosted / external dependencies

- **Deploy with the frontend**: `base44/entities/Visit.jsonc` (three new optional
  fields) and `base44/functions/getPatientContext/entry.ts` (two extra reads).
  Both are additive; existing visits read as `not_started` with no migration.
- **Hosted RLS proof remains outstanding** and is deliberately *not* marked
  complete — see `docs/HOSTED-RLS-PROOF.md`. No RLS or tenant-isolation rule was
  changed by this pass.
- **Optional future integrations**: a licensed medication-knowledge service
  (adapter seam ready) and the CMS OASIS specification (framework ready).

## 12. Recommendations intentionally not implemented

| Recommendation | Why not |
| --- | --- |
| Reconstruct the full CMS OASIS-E2 item bank | The repository does not contain the authoritative specification. Writing one from memory would fabricate regulatory content — the exact failure this pass was asked to prevent. The framework and the honest classification are delivered instead. |
| Direct iQIES submission | Explicitly forbidden by the brief. None exists in the repo. |
| Claims submission / "ready to bill" status | Explicitly forbidden. Documentation Readiness is deliberately not a billing gate. |
| A `ProviderCommunication` entity | The lifecycle model is delivered and tested, but a new hosted entity is a schema commitment that should follow a product decision on whether it supersedes `Task` or sits beside it. Recorded in §13. |
| Rebuild Today/dashboard queues, ADR centre, denial feedback, PDGM provenance, AI provenance, draft resilience, rule governance | **Already implemented and tested** (gap-matrix rows 10, 12, 19–26). Rebuilding would violate the brief's non-duplication rule. |
| Remove stored note history for PHI minimisation | It is load-bearing for prior-note comparison, carry-forward pre-fill and the new similarity engine. Removing it would break working features. |
| Auto-block a save on high similarity | The brief requires advisory-only unless a justified blocking policy already exists. None does for similarity, and a false block on a legitimately stable patient would be worse than the finding. |

## 13. Remaining backlog

1. Surface `providerFollowUpLifecycle` in a UI queue and decide the persistence
   model (extend `Task`, or add a `ProviderCommunication` entity).
2. Feed Documentation Readiness findings into the existing dashboard work queues
   (`dashboard/coreWorkQueues.js`) so office staff see them without opening each
   chart.
3. Wire `medicationReconciliation` into the Smart Note flow once its overlap with
   the existing `chartCrossCheck` medication findings is deduplicated — today it
   is surfaced on the patient documentation tab to avoid double-reporting.
4. **Decide what to do about the 18 divergent response sets (§6.4).** Recording
   the divergence stops the product vouching for a wrong code; it does not stop
   the form offering one. Each item is a separate call with a real cost on both
   sides, and none of them is a code edit:
   - *Align the scale to CMS* — most defensible for a nurse, but re-labelling an
     option changes the meaning of every answer already stored under that code.
     Needs a migration that versions the answers (`item_spec_version` is already
     stamped on save and gives the discriminator), plus clinical sign-off on the
     new labels.
   - *Keep the screening scale and drop the CMS number* — reclassify the item as
     `pennsync_screening`, as M2102/M2110/M2200 already are. Cheap and safe, but
     loses the cross-reference that makes the item useful for OASIS review.
   - *Keep both, as now* — the item warns and refuses to vouch for the code.
   The worst four to take first are the ones whose codes are silently wrong
   rather than merely different: **M2020** (codes transposed), **M2010** (`0`
   inverts to the CMS "No"), **M1860** (offset by one), **M1340** (`2` reads as
   "infected"). Work `docs/oasis/ITEM_REVIEW_WORKSHEET.md` and record each
   decision in `specs/verification.js`.
5. Populate `specs/e/` with verified item content. The registry, worksheet
   generator and contract test are ready, and the OASIS-E2 All Items instrument
   used for §6.4 is the source for the response sets.
6. Wire `setThresholdOverrides()` to `AgencySettings` so an admin can persist a
   calibrated threshold set, and add an admin surface over
   `calibrationHarness.js` for running the agency's own corpus.
7. Connect `documentationStrength` findings to the existing training
   recommendation engine (`training/DeficitAnalyzer.jsx`) so recurring weak
   elements drive targeted microlearning.
8. Add an admin rule-governance UI over the existing `MedicareComplianceRule`
   entity (governance data and rule-version snapshotting already exist).

## 14. Risks still requiring human / clinical / regulatory review

### Sign-off status — what is signed, and what deliberately is not

The single "reviewed" concept was conflating three different questions. They are
now recorded separately:

| Question | Status |
| --- | --- |
| **Factual** — does this item number exist in the current CMS manual, and what is its title? | **Done** (2026-09-01, three manuals) |
| **Classification** — is the level (`verified` / `retired` / `not_a_cms_item` / …) the right one, given that evidence? | **Signed off** — `classification_signed_off_by: "PennSync CMS source check"` |
| **Clinical** — is PennSync's *use* of this item appropriate, and are its response options safe as a screening prompt? | **Signed off 2026-09-01** by Kevin Deyarmin (`kdeyarmin@comcast.net`), all 36 items. |

**Who may write the third.** `reviewed_by` means a NAMED HUMAN confirmed this.
An automated check must never write to it — that would make the product assert
something untrue to a future auditor, the one thing the brief lists as
non-negotiable ("AI ... must never ... autonomously certify clinical/compliance
conclusions"). A test enforces it: any value matching an automated actor
(`pennsync`, `automated`, `source check`, `claude`, `ai`, `system`, `script`)
fails the suite.

The sign-off recorded on 2026-09-01 is a real human attestation, and
`review_source` records its scope on every item — including, verbatim, that
**response options were not individually verified against the CMS manual**. A
test asserts that caveat is present on any signed item, so the record can never
be read as broader than the review behind it. `responseSetVerified` stays
`false` at the time of signing: a signature does not retroactively verify what
was never checked. It was later established by reading the instrument (§6.4),
which is recorded as its own provenance rather than written into the signature.

An item added later inherits nothing — with no registry entry it reports as
pending, so a new question cannot become signed off by omission.

**Response sets have since been read** — see §6.4. The first attempt was
abandoned because the *guidance manual* states response codes as prose rather
than a parseable list; CMS publishes them separately in the OASIS-E2 All Items
instrument, and that read closed the gap on 2026-09-01. `responseSetVerified` is
no longer a blanket `false`: it is `true` for exactly the one item whose options
reproduce the CMS set, and a test asserts it tracks the per-item verdict rather
than the item's level.

**What the reviewer is now asked** is deliberately narrow — one question per item
rather than "re-check everything", because the latter is a job nobody does:

- current CMS items → "the options this form offers have now been read against
  the CMS response set (§6.4); are they safe and sufficient as a *screening
  prompt*, given how they diverge?"
- retired / non-CMS items → "is this still clinically worth asking as an internal
  prompt, or should it be removed from the form?"

`docs/oasis/ITEM_REVIEW_WORKSHEET.md` now states that the classification column
is already signed off and leaves only the clinical column open.

### CMS source check, 2026-09-01 — what it found

The OASIS classifications were re-checked against the published CMS manuals
(OASIS-E updated 01/01/2024, OASIS-E1 effective 01/01/2025, OASIS-E2 effective
04/01/2026). It found substantially more wrong than the three therapy items
originally demoted:

| Finding | Detail |
| --- | --- |
| **Wrong active version** | PennSync claimed OASIS-E with no retirement date. **OASIS-E2 has been in effect since 2026-04-01** — PennSync was two versions behind, so every "patterned after" statement in the UI was wrong. |
| **4 invented item numbers** | `M1020`, `M1300`, `M1350`, `M1900` appear in **none** of E, E1 or E2. Primary Diagnosis is **M1021** (M1023 is Other Diagnoses); Prior Functioning is **GG0100**. |
| **5 retired items** | `M1030`, `M1242`, `M1730`, `M1910`, `M0069`. The OASIS-E manual lists M1730 ("Depression Screening") and M1910 ("Falls Risk Assessment") explicitly as *Removed*. Depression is now D0150/D0160; falls are J1800/J1900; pain is J0510/J0520/J0530. |
| **M0069 doubly wrong** | It was **"Gender"**, not "Prognosis" as PennSync labelled it, and is replaced by **A0810 Sex** in E2. |
| **3 therapy demotions confirmed** | M2102 *is* "Types and Sources of Assistance"; M2200 was removed per CMS-1780-F; M2110 appears in no manual. The original inference was right. |

**9 of 36 items** are retired or are not CMS item numbers. All are kept — the
scoring engine and stored responses key off these ids — but they no longer
display a CMS item number, their notes say where the current item lives, and the
OASIS scope notice reports the count on screen.

**The source check is recorded separately from clinical sign-off.**
`source_verified_at` / `source_verified_against` record a *factual* lookup (does
this number exist, what is its title). `reviewed_by` / `reviewed_at` remain empty
for all 36: whether PennSync's *use* of an item is clinically appropriate is a
judgement, and an automated check must not masquerade as a reviewer.

### Scoring-engine follow-up — resolved, and an earlier claim corrected

**Correction:** an earlier draft of this document said remapping the scoring
engine "has PDGM implications". That was wrong. `pdgm/pdgmGrouper.js` derives its
scored item set from the **supplied CMS table's keys** and reports unmapped
responses instead of scoring them as zero; nothing in `oasisScoringEngine.js`
reaches a rate. The engine feeds care suggestions in `SmartOASISAssessment` only.

The real defect was elsewhere, in the save path. `SmartOASISAssessment` wrote
PennSync's **own form ids** straight into
`OASISAssessment.oasis_items[].item_number` — the field every downstream
consumer reads as a CMS item number. A saved assessment therefore contained
`item_number: "m1730"` (retired) and `"m1020"` (not a CMS number at all),
indistinguishable from real CMS responses.

Fixed by making the classification explicit rather than by inventing a mapping:

- `OASISAssessment.oasis_items[]` gains `item_source`
  (`cms_item` / `pennsync_screening` / `retired_cms_item` / `unknown`) and
  `item_spec_version`, both stamped on save from the verification registry.
- `cmsItemsOnly()` filters a saved assessment down to genuine CMS responses. A
  legacy row with no marker is classified against the registry, **never assumed
  official** — assuming is exactly how a screening answer would be read as the
  assessment.
- `oasisScoringEngine.js` now documents that its ids and response values are
  PennSync's form, not CMS; `evaluateOASIS(answers, { strict: true })` throws on
  CMS-shaped input rather than returning `[]`, because an empty result reads as
  "no concerns found" when the truth is "these answers could not be read".
- A test pins the exact set of non-CMS ids the engine reads, so a future edit
  cannot quietly reintroduce a CMS claim for one of them.

**Deliberately not done:** no mapping was invented from PennSync's picklists to
D0150/D0160, J1800/J1900, J0510–J0530, M1021 or GG0100. The later response-set
read (§6.4) strengthens this rather than unblocking it: PennSync's option lists
diverge from the CMS sets for 18 of 24 comparable items, so a mapping would have
to reconcile the scales as well as the numbers. A wrong mapping in a
care-suggestion engine would be worse than the current honest, limited state.

1. **The OASIS item classifications need clinical sign-off — now tracked, not
   assumed.** The three `pennsync_screening` demotions are supported by the
   repository's own internal contradiction and by PDGM's discontinuation of
   M2200, but no qualified OASIS reviewer has confirmed them, and the
   `unverified` items fail closed rather than having been examined.

   This is no longer only a note in this document. Every registry entry carries
   `reviewed_by` / `reviewed_at` / `review_source`, all of which ship empty and
   are asserted empty by test — a classification is not a sign-off, and the
   product must not imply one. `pendingClinicalReview()` lists what is
   outstanding, `clinicalReviewStatus()` produces the sentence the OASIS scope
   notice now shows on screen ("36 of 36 items have not been reviewed by a
   qualified OASIS reviewer"), and `node tools-oasis-review-worksheet.mjs`
   generates `docs/oasis/ITEM_REVIEW_WORKSHEET.md` — one row per item with what
   PennSync claims, the evidence behind it, and the reviewer's columns blank.
   `pnpm run check:oasis-worksheet` fails if it drifts from the item bank.

   **Still required from a human:** a qualified OASIS reviewer working the
   worksheet and recording each confirmation in `specs/verification.js`.

2. **Documentation-strength and similarity thresholds are judgements — now
   configurable and calibratable.** "Three of seven factors = strong" and the
   0.72 / 0.88 similarity bands are PennSync defaults chosen so a legitimately-
   updated note on a stable patient does not trip them (test-verified), not
   regulatory standards.

   They are no longer literals buried in the engines. `compliance/thresholds.js`
   holds all nine with `calibrated: false`, the basis they came from, and the
   rationale for moving them each way; `setThresholdOverrides()` accepts agency
   values, **rejects** unknown keys and out-of-range values rather than ignoring
   them, and refuses to mark a hand-set number as calibrated. The Smart Note
   panels now say on screen that the bands are uncalibrated defaults.
   `compliance/calibrationHarness.js` turns an agency corpus into the evidence
   to set them: the factor distribution, the caught/missed/false-alarm trade at
   each candidate, and a recommendation that **declines** when the sample is
   under 30 labelled notes or the outcomes are too one-sided — and that is
   framed as evidence for a human, never as a setting PennSync applies itself.

   **Still required from a human:** running a real labelled corpus through the
   harness and choosing the flag rate, which is an operational judgement about
   what a false flag costs a nurse's attention.

3. **The `verified` level means verified against PennSync's own scale table**,
   not against CMS. `review_source` states this explicitly for those ten items;
   a reviewer should not read `verified` as CMS-confirmed.
4. **The medication list is not a licensed drug database.** Every finding needs
   confirmation against the EMR profile and a medication reference. The UI says
   so; the risk is that it is trusted anyway.
5. **Hosted RLS validation remains outstanding.** Unchanged by this pass, and
   still required before go-live.
6. **Self-reported handoff statuses could be misread as verification** if a
   future screen renders them without their caveat. The caveats are asserted by
   tests; anyone building a new surface must keep them.

---

## Addendum (2026-09-01): OASIS response-schema remediation

The pass above fixed which CMS **instrument** PennSync claimed to follow. It did
not fix what PennSync's **own answer choices meant** — and a later read of the
final OASIS-E2 All-Item instrument found that on **18 items** at least one code
named something different than the same code on the official assessment.

Point 3 above ("`verified` means verified against PennSync's own scale table")
was the warning sign. `itemSourceFor()` treated that identity-level verification
as sufficient to stamp `item_source: "cms_item"`, so a conflicting row was
labelled official and every downstream path — the printed guide, the clipboard,
the referral packet, the analytics extractors, the outcome engine, the PDGM
calculator — read it as one. An item-level warning that downstream paths bypass
is not a control.

What changed:

- A **separate, append-only response-schema registry** records what the answer
  choices meant: `pennsync-oasis-response-v1-legacy` (frozen, display-only) and
  `pennsync-oasis-response-v2-cms-e2` (15 CMS-aligned definitions transcribed
  from the final instrument, plus 3 PennSync screening prompts demoted out of the
  M-number namespace).
- **P0 containment shipped unconditionally**, not behind the flag: a fail-closed
  output policy, AI that can no longer select or apply a response, and
  schema-gated analytics, outcomes and PDGM.
- A **protected backend write path** and scoped write RLS, because
  `OASISAssessment` had `"write": {}` and UI-level enforcement is not
  enforcement against a hosted entity endpoint.

Full detail, the 18-item decision table, the CMS source manifest with hashes,
the rollout and rollback procedure, and the outstanding gates are in
[`docs/oasis/OASIS_RESPONSE_SCHEMA_MIGRATION.md`](oasis/OASIS_RESPONSE_SCHEMA_MIGRATION.md).
The per-consumer disposition — including a named list of what is still
outstanding — is in [`docs/oasis/CONSUMER_MATRIX.md`](oasis/CONSUMER_MATRIX.md).

### Corrections to the statements above

- Point 3 stands, and is now enforced rather than merely documented: an item
  whose response set conflicts with CMS no longer resolves to `cms_item` at all.
- Point 5 (hosted RLS validation outstanding) is **unchanged and now also gates
  the new work**: v2 response entry stays disabled until hosted enforcement of
  the write-scoping is proven.
- The 2026-09-01 product-owner sign-off recorded in `specs/verification.js` is
  **not** option-level CMS approval. Its own recorded scope excludes individual
  response-option verification, and it must not be cited as clinical validation
  of the v2 response sets. Every v2 definition carries
  `clinical_review: "pending_named_sme_review"`.

### Still required from a human

1. **CMS source verification** — an independent re-read of the 15 response sets
   against the final instrument.
2. **Named clinical / OASIS SME validation** — no v2 definition has one.
3. **Hosted schema / RLS validation** — a release blocker.
4. **Deployment approval** — separate from all of the above.
