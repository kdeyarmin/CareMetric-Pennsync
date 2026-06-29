# PennSync Feature Audit

_Audit of overlapping/redundant app surfaces, with keep / merge / cut decisions._
_Last updated: 2026-06-21 (branch `claude/app-functions-audit-963reb`)._

## Summary

The codebase is already cleanly consolidated: of ~120 page files only the two public
token-gated pages (`JoinTelehealth`, `SignerPortal`) sit outside the nav manifest, ~16
retired pages are redirect-only (deleted), and ~39 are reused as hub tabs. There is **no
dead code** to remove — the open question is purely **which capabilities to keep**.

This audit focuses on the four overlapping clusters. The redirect-based cuts below are
**done** on this branch; the larger UI merges are left as a **plan** (they need real work).

---

## Done on this branch (redirect-based cuts)

Each retired page was removed from `src/lib/nav.manifest.js` (so it drops out of the
sidebar, command palette, breadcrumbs and Admin Console directory automatically) and a
redirect was added to `src/routes.jsx`. Most retired page files **remain on disk** (kept
where reachable via the redirect target or reused as an embedded component), so those
cuts are reversible by restoring the manifest entry. Exceptions deleted outright are
called out below (`DocumentationTraining`, and the orphaned `UnifiedDocumentReview`).

| Cut page | Redirects to | Rationale |
|---|---|---|
| `ClinicalChart` | `/Patients` | Its Vitals / Care Plan / OASIS panes already exist as tabs in `PatientDetails`. No inbound links. |
| `MedicalScribe` | `/ClinicalDocumentation?tab=visit-scribe` | Identical record→transcribe (`generateNoteFromRecording`)→review (`ConstrainedNoteReviewer`) pipeline; the Visit Scribe choice is a strict superset. Mirrors the existing `/VisitScribe` redirect. (Legacy `?tab=record` still normalizes to `visit-scribe`.) |
| `ClinicalInsightsDashboard` | `/PredictiveAnalytics` | Population-trend / disease-progression views duplicate Predictive Analytics. Admin-only. |
| `DocumentationTraining` | `/NurseTrainingHub?tab=documentation` | Standalone documentation-training page; **file deleted** (content confirmed not wanted). See note below. |
| `NurseEducationVideos` | `/NurseTrainingHub` | 9 hard-coded YouTube links with client-side checkboxes; no DB backing. |

Supporting cleanups:
- `nav.manifest.js`: dropped now-unused `Activity` and `Mic` icon imports.
- `AdminConsoleDirectory.jsx`: removed the dead `ClinicalInsightsDashboard` entry.
- `MobileHeader.jsx`: removed `ClinicalChart` from the back-button `BACK_PAGES` list.

### DocumentationTraining — deleted

`DocumentationTraining` was **not** embedded in `NurseTrainingHub` (the Hub's
"documentation" tab renders the separate `NurseTraining` page), so it was a genuinely
standalone page. Its content (InteractiveTutorials, PracticeNoteSubmission,
ScenarioSimulator, AISkillAssessment) was reviewed and confirmed not wanted, so the page
file `src/pages/DocumentationTraining.jsx` has been **deleted**. The
`/DocumentationTraining → /NurseTrainingHub?tab=documentation` redirect is retained so old
links/bookmarks still resolve.

---

## Larger merges (done)

These combined real components, so they were done after confirming the canonical page.

### Analytics: 5 pages → 3 ✅ done

Direction chosen: fold **AnalyticsDashboard** into **ReportsAnalytics**.

| Page | Decision | Notes |
|---|---|---|
| `ReportsAnalytics` | **Canonical** (single operational dashboard) | Now hosts a **"Performance Dashboard"** tab that lazy-embeds AnalyticsDashboard (via `EmbeddedPage`, so no duplicate header). Its old **Population Health tab (on-demand `invokeLLM`) was removed** — see the AI-cost cleanup below. |
| `AnalyticsDashboard` | **Folded in** ✅ | `/AnalyticsDashboard → /ReportsAnalytics?tab=perf-dashboard`. File kept (rendered as the embedded tab). |
| `PredictiveAnalytics` | **Keep** (risk/forecast home) | |
| `AgencyAnalytics` | **Keep** (business: financial + training) | Genuinely distinct; no LLM. |
| `ClinicalInsightsDashboard` | **Cut** ✅ | Redirected to Predictive Analytics. |

**AI-cost win:** population/risk analysis previously lived in three places
(`ReportsAnalytics` Population Health, `PredictiveAnalytics`, `ClinicalInsightsDashboard`).
`ClinicalInsightsDashboard` was cut and **`ReportsAnalytics`' on-demand `invokeLLM`
Population Health tab was removed**, consolidating population/risk insight on Predictive
Analytics (the single largest recurring AI-cost reduction in this work).

### Training: 6 pages → 2 (+ EducationLibrary reclassified) ✅ done

Direction chosen: **LearningCenter** is canonical; **MyLearning** folded in.

| Page | Decision | Notes |
|---|---|---|
| `LearningCenter` (1,376 lines) | **Canonical hub** | Converted to controlled `?tab=` tabs; added **My Courses / In-Services / Annual Education / Transcripts** tabs that lazy-embed the former MyLearning spokes. |
| `MyLearning` | **Folded in** ✅ | `/MyLearning → /LearningCenter`; its sub-page redirects (MyTraining, MyAnnualEducation, AnnualMandatoryEducation, Annual/Employee transcripts) now deep-link to the matching LearningCenter tab. Removed from the sidebar. |
| `NurseTrainingHub` | **Keep** | AI-personalized hub. |
| `DocumentationTraining` | **Cut + file deleted** ✅ | |
| `NurseEducationVideos` | **Cut** ✅ | |
| `EducationLibrary` | **Keep** | Not staff training — it manages **patient** education materials. (Recategorization under Patient Care still recommended; not yet moved.) |

`TrainingCoursePlayer`'s breadcrumb parent and its "Back to My Learning" / "View All
Certificates" buttons were repointed from MyLearning to the LearningCenter tabs.

### Patient views: 4 → 3 (done)

`ClinicalChart` cut (above). `PatientDetails`, `PatientRecordDashboard`, and
`PatientAlerts` are distinct (full record / browse-all / alert monitoring) and stay.
Optional later: extract a shared patient-selector component used by RecordDashboard and
Alerts.

---

## Visit documentation → two choices (done)

Goal: documenting a visit should be a single, clear choice between **Smart Note** and
**Visit Scribe**.

- **Clinical Notes hub (`ClinicalDocumentation`)** restructured from a flat four-tab
  layout (Smart Notes / Live Dictation / Record / Quick Guide) to **two top-level
  choices**:
  - **Smart Note** — `SmartNoteAssistant` (write rough notes; AI compliance + polish).
  - **Visit Scribe** — Record / Upload (`AudioVisitCapture`) and Live Dictation
    (`RealTimeDictationScribe`) as sub-modes; both transcribe into a compliant note.
  - Legacy `?tab=record` / `?tab=live-dictation` deep-links and the Visit Scribe /
    Medical Scribe redirects (now → `?tab=visit-scribe`) still resolve. Quick Guide
    tab dropped.
- **`DocumentVisit` retired** (chosen direction: redirect into the hub). It was a
  separate visit-bound page (`?visitId`) with its own manual "Documentation" + "AI
  Workflow" tabs, vitals entry, template generation, and offline support. Now
  `/DocumentVisit → /ClinicalDocumentation` (the redirect preserves an incoming
  `?visitId`); removed from the sidebar and the mobile back-button list.
- **Visit binding preserved** (review follow-up): the Clinical Notes hub now reads
  `?visitId` and passes it to the active flow, which loads that visit, pre-selects its
  patient + visit type, and **completes the existing visit on save instead of creating a
  duplicate** (`persistVisitNote` updates it and sets `status: "completed"`). The
  "Document this visit" / "Document Now" links in `PatientDetails` and
  `ComplianceAlertAggregator` pass `?visitId`, so documenting an overdue scheduled visit
  closes it and clears the alert. `TemplateLibrary`'s "Use in Visit" copies the generated
  template to the clipboard before navigating (the hub composes the note itself).
  Remaining gap: DocumentVisit's offline-first vitals/template authoring is not
  reproduced; the audio path also still has no offline visit-binding (online completes
  in place, offline queues a new visit).
- **Vitals restored** in the Smart Note flow (`SmartNoteAssistant`): a structured
  `VitalSignsForm` (canonical `vital_signs` shape — temp, BP, HR, resp rate, O2, pain)
  is captured in step 1 and saved onto the Visit (`Visit.create`/`update` and the
  offline `CREATE_VISIT` queue), so vitals reach the chart, vitals trends, and
  critical-vitals escalation just as Document Visit did. Vitals reset on patient switch
  and on reset, so one patient's readings never carry onto another's chart.
  - **Visit Scribe (audio) now saves too** (follow-up done): `AudioVisitCapture` gained
    its own patient selection, visit type, and `VitalSignsForm`, and now reviews the
    transcribed note through `ConstrainedNoteReviewer` + `FinalNoteDisplay` and saves to
    the chart — so an audio-documented visit lands the same Visit / NoteConversion /
    ComplianceAudit records **and vitals** as a typed Smart Note.
  - The shared chart-write path was extracted to
    `src/components/smartNote/persistVisitNote.js` (used by both flows; covered by
    `persistVisitNote.spec.js`), and the prior-note / note-section helpers to
    `noteHelpers.js`. The now-orphaned `UnifiedDocumentReview` was deleted.

## Analytics AI-cost cleanup (done)

- **Removed the Population Health tab** from `ReportsAnalytics` along with its on-demand
  `invokeLLM()` call (the largest recurring AI cost in analytics) and the now-unused
  patients/visits/incidents queries. Population/risk insight now lives solely in
  Predictive Analytics.

---

## Verification

- `nav.manifest.js` and `routes.jsx` remain the single sources of truth; sidebar, palette,
  breadcrumbs, and Admin Console directory all derive from the manifest, so the cuts
  propagate automatically.
- Old links/bookmarks to the cut/folded pages resolve via the new redirects (no
  PageNotFound).
- Verified on this branch: `npm run build` (exit 0), `npm run test:utils` (594 pass),
  `npm run test:components` (81 pass, incl. the nav-page mount tests — DocumentVisit
  left the nav-mount set when it was retired).
