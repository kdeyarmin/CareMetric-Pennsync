import { lazy } from 'react';
import { NAV_MANIFEST } from '@/lib/nav.manifest';
import { logger } from '@/lib/logger';

// Single source of truth for the app's authenticated routes.
//
// Routes are DERIVED from the navigation manifest (src/lib/nav.manifest.js) so
// the route table, the sidebar, the command palette and breadcrumbs can never
// drift apart: a page is reachable iff it has a manifest entry. App.jsx renders
// ROUTES and NavigationTracker reads PAGE_NAMES for analytics.
//
// IMPORTANT (bundle size): NavigationTracker is always mounted and imports this
// module, so this file must never eagerly import page components. Every page is
// wired through `import.meta.glob` in lazy mode — Vite turns each match into its
// own dynamically-imported chunk that is not fetched until the route renders, so
// the always-loaded code stays small. (Eagerly importing the old auto-generated
// page map here is what previously produced a ~7.8 MB initial chunk.)

// Dashboard is the landing page, so it is eager (no extra round-trip on first
// paint). Every other page is lazy.
import Dashboard from '@/pages/Dashboard';

// Lazy factory per page file. Keys look like './pages/Patients.jsx'.
// Spec/test files live alongside the pages and are never routed, but an
// unfiltered glob still emits a chunk for each one — publishing test code and
// fixtures to the asset host. Exclude them from the glob.
const pageModules = import.meta.glob(['./pages/*.jsx', '!./pages/*.spec.jsx', '!./pages/*.test.jsx']);
const factoryFor = (name) => pageModules[`./pages/${name}.jsx`];

// NOTE: stale-chunk auto-recovery (the "Failed to fetch dynamically imported
// module" error after a Vite dev-server restart) is handled centrally by the
// ErrorBoundary in App.jsx, which is always loaded as part of the app shell.
// Do NOT add a second reload mechanism here — using the same sessionStorage
// key as the ErrorBoundary creates a reload loop (each layer removes the key
// the other set). Plain lazy() lets the error bubble to the single boundary.

// Pages that are NOT authenticated, manifest-driven routes:
//  - Dashboard is added eagerly above.
//  - JoinTelehealth / SignerPortal are public, token-gated pages rendered
//    without an app login directly in App.jsx, so they are intentionally absent
//    from the manifest and handled there.
const NON_MANIFEST_ROUTES = new Set(['Dashboard']);

/**
 * Authenticated routes. `name` is both the path segment (routes are PascalCase,
 * e.g. /Dashboard) and the analytics page name. React Router matches paths
 * case-insensitively, so createPageUrl()'s lowercase output still resolves here.
 */
export const ROUTES = [
  { name: 'Dashboard', Component: Dashboard, adminOnly: false, superAdminOnly: false },
  ...NAV_MANIFEST
    .filter((entry) => !NON_MANIFEST_ROUTES.has(entry.page))
    .map((entry) => ({ name: entry.page, factory: factoryFor(entry.page), adminOnly: !!entry.adminOnly, superAdminOnly: !!entry.superAdminOnly }))
    .filter((entry, index, all) => {
      // Guard against a manifest entry whose page file does not exist (lazy()
      // would crash). Surface it in dev so the mismatch is fixed at the source.
      if (!entry.factory) {
        logger.debug(`[routes] manifest page "${entry.name}" has no src/pages/${entry.name}.jsx — skipping route`);
        return false;
      }
      // De-dupe defensively in case a page appears twice in the manifest.
      return all.findIndex((e) => e.name === entry.name) === index;
    })
    // `adminOnly` mirrors the manifest so App.jsx can gate admin routes at the
    // router level (non-admins typing the URL get blocked, not just hidden from
    // the sidebar). Client-side defense in depth; server RLS is the real gate.
    .map((entry) => ({ name: entry.name, Component: lazy(entry.factory), adminOnly: entry.adminOnly, superAdminOnly: entry.superAdminOnly })),
];

/**
 * Permanent redirects from retired/renamed page paths to their current home.
 * Add an entry here (instead of leaving a dead link) whenever a page is
 * consolidated, so existing links and bookmarks never hit PageNotFound.
 */
export const REDIRECTS = [
  { from: '/StaffTrainingHub', to: '/AdminTraining' },
  { from: '/IncidentReporting', to: '/Incidents' },
  // Renamed/consolidated pages — point old links and bookmarks at the current page.
  { from: '/AdminDashboard', to: '/AdminOperations' },
  { from: '/ComplianceDashboard', to: '/ComplianceCenter' },
  { from: '/Reports', to: '/ReportsAnalytics' },
  { from: '/Support', to: '/Help' },
  // QualityDashboard is an empty placeholder; its quality metrics live in the
  // Compliance Center, so send links there instead of an empty page.
  { from: '/QualityDashboard', to: '/ComplianceCenter' },
  // MedicareComplianceDashboard duplicates ComplianceCenter's audit metrics.
  // (Removed from the manifest so this redirect is no longer shadowed by a route.)
  { from: '/MedicareComplianceDashboard', to: '/ComplianceCenter' },

  // ─── Admin console consolidation ───────────────────────────────────────────
  // These standalone admin pages were thin wrappers/duplicates of tools that now
  // live inside an existing hub. Redirect old links/bookmarks to the canonical
  // home (deep-linking the exact Admin Console tab where applicable).
  { from: '/TrainingManagement', to: '/AdminTraining' },
  { from: '/ComplianceRegulatory', to: '/ComplianceCenter' },
  { from: '/DataQualityMonitor', to: '/AdminOperations?tab=data-quality' },
  { from: '/SystemHealthMonitor', to: '/AdminOperations?tab=system-health' },
  // SystemMonitoring was an Activity + Jobs wrapper; Activity now lives in the
  // Admin Console "User Activity" tab and the job monitor is its own page.
  { from: '/SystemMonitoring', to: '/SystemJobMonitor' },

  // ─── OASIS Center consolidation ──────────────────────────────────────────────
  // The standalone OASIS assessment/analysis/review pages are now tabs of
  // /OASISCenter. "assessment" is the default tab, so the analyzer must pin its
  // own tab. (RedirectTo preserves incoming ?query and router state onto the tab.)
  { from: '/SmartOASISAssessment', to: '/OASISCenter' },
  { from: '/OASISAnalyzer', to: '/OASISCenter?tab=analyze' },
  { from: '/OASISReview', to: '/OASISCenter?tab=review' },
  { from: '/OASISClinicalReview', to: '/OASISCenter?tab=clinical' },
  { from: '/OASISComplianceReview', to: '/OASISCenter?tab=quality' },
  { from: '/OASISDocumentationReview', to: '/OASISCenter?tab=quality' },
  { from: '/OASISRevenueAnalysis', to: '/OASISCenter?tab=revenue' },
  { from: '/OASISAnalyticsDashboard', to: '/OASISCenter?tab=analytics' },
  { from: '/OASISAuditDashboard', to: '/OASISCenter?tab=audit' },

  // ─── Clinical Notes consolidation ────────────────────────────────────────────
  // Visit Scribe is now the Clinical Notes "Visit Scribe" choice (record/dictation).
  { from: '/VisitScribe', to: '/ClinicalDocumentation?tab=visit-scribe' },

  // ─── Document Hub consolidation ──────────────────────────────────────────────
  // Signature, storage/intake, discharge and audit pages are now Document Hub tabs.
  { from: '/DocumentSignatures', to: '/DocumentHub?tab=signatures' },
  { from: '/CreateSignatureRequest', to: '/DocumentHub?tab=signatures&view=create' },
  { from: '/BulkSignatureRequests', to: '/DocumentHub?tab=signatures&view=bulk' },
  { from: '/DocumentManagement', to: '/DocumentHub?tab=documents' },
  { from: '/DocumentIngestion', to: '/DocumentHub?tab=documents&view=intake' },
  { from: '/DischargeSummaries', to: '/DocumentHub?tab=discharge' },
  { from: '/DocumentAuditLogs', to: '/DocumentHub?tab=audit' },

  // ─── Patient Education Hub consolidation ─────────────────────────────────────
  { from: '/PatientEducation', to: '/PatientEducationHub?tab=teachback' },
  { from: '/PatientEducationPortal', to: '/PatientEducationHub?tab=tracking' },

  // ─── Referral Intake consolidation ───────────────────────────────────────────
  // Processor and Admission Note are now steps (tabs) of the intake workflow.
  { from: '/ReferralProcessor', to: '/ReferralIntake?tab=process' },
  { from: '/ReferralAdmissionNote', to: '/ReferralIntake?tab=admission' },

  // ─── Fax Center consolidation ────────────────────────────────────────────────
  // Contacts, logs and analytics are now tabs of the Fax sender (/SendFax).
  { from: '/FaxDashboard', to: '/SendFax' },
  { from: '/FaxLogsDashboard', to: '/SendFax?tab=logs' },
  { from: '/FaxContacts', to: '/SendFax?tab=contacts' },
  { from: '/FaxAddressBook', to: '/SendFax?tab=contacts' },
  { from: '/FaxAnalytics', to: '/SendFax?tab=analytics' },

  // ─── Compliance Center consolidation ─────────────────────────────────────────
  // Monitoring, regulatory and security pages are now Compliance Center tabs.
  { from: '/ComplianceMonitoringDashboard', to: '/ComplianceCenter?tab=dashboard&view=monitoring' },
  { from: '/RealTimeComplianceDashboard', to: '/ComplianceCenter?tab=dashboard&view=realtime' },
  { from: '/RegulatoryCompliance', to: '/ComplianceCenter?tab=regulatory' },
  { from: '/SecurityCompliance', to: '/ComplianceCenter?tab=security' },
  { from: '/SecurityPolicy', to: '/ComplianceCenter?tab=security&view=policies' },

  // ─── Learning consolidation ──────────────────────────────────────────────────
  // My Learning was merged into the Learning Center (the canonical learner hub):
  // its My Courses / In-Services / Annual Education / Transcripts views are now
  // tabs there. NurseTraining is a tab of the Nurse Training Hub.
  { from: '/MyLearning', to: '/LearningCenter?tab=courses' },
  { from: '/MyTraining', to: '/LearningCenter?tab=inservices' },
  { from: '/MyAnnualEducation', to: '/LearningCenter?tab=annual' },
  { from: '/AnnualMandatoryEducation', to: '/LearningCenter?tab=annual' },
  { from: '/AnnualEducationTranscript', to: '/LearningCenter?tab=transcripts' },
  { from: '/EmployeeTranscript', to: '/LearningCenter?tab=transcripts' },
  { from: '/NurseTraining', to: '/NurseTrainingHub?tab=documentation' },

  // ─── Misc hub consolidations ─────────────────────────────────────────────────
  { from: '/AdminReportsCenter', to: '/ReportsAnalytics?tab=reports-center' },
  // Analytics Dashboard (Performance Analytics) folded into Reports & Analytics.
  { from: '/AnalyticsDashboard', to: '/ReportsAnalytics?tab=perf-dashboard' },

  // ─── Feature-audit consolidation ─────────────────────────────────────────────
  // Redundant standalone pages folded into their canonical homes — see
  // docs/feature-audit.md. The redirects below are kept so old links/bookmarks
  // resolve to the current home. (Some page files — ClinicalChart, MyLearning,
  // ClinicalInsightsDashboard, NurseEducationVideos — were re-ported from the
  // live PENNSync app for content parity but stay unrouted, mirroring the live
  // app, which also redirects these paths; route one by adding a manifest entry.)
  //   ClinicalChart       → its vitals / care-plan / OASIS tabs already live in
  //                          PatientDetails; sent to the patient list (no id ctx).
  //   MedicalScribe       → same record→transcribe→review pipeline as the Clinical
  //                          Notes "Visit Scribe" choice (a strict superset).
  //   ClinicalInsights    → population/risk views duplicated by Predictive Analytics.
  //   DocumentationTraining / NurseEducationVideos → consolidated under the Nurse
  //                          Training Hub. (See doc for the unique-content caveat.)
  { from: '/ClinicalChart', to: '/Patients' },
  // DocumentVisit (the separate visit-bound page with its own manual/AI-workflow
  // tabs) retired in favor of the unified Clinical Notes hub's Smart Note / Visit
  // Scribe choice. The hub selects the patient/visit itself, so the old ?visitId
  // binding and DocumentVisit's vitals/template extras are not carried over.
  // The dead page file and its ~40 single-use components were removed once the
  // consolidation proved stable; the redirect below is kept so old links resolve.
  { from: '/DocumentVisit', to: '/ClinicalDocumentation' },
  { from: '/MedicalScribe', to: '/ClinicalDocumentation?tab=visit-scribe' },
  { from: '/ClinicalInsightsDashboard', to: '/PredictiveAnalytics' },
  { from: '/DocumentationTraining', to: '/NurseTrainingHub?tab=documentation' },
  { from: '/NurseEducationVideos', to: '/NurseTrainingHub' },

  // Offline mode was removed. Its retired paths, and the two even older ones
  // that used to forward into it, land on Clinical Notes — the documentation
  // home that replaces them.
  { from: '/OfflineMode', to: '/ClinicalDocumentation' },
  { from: '/OfflineVisitDocumentation', to: '/ClinicalDocumentation' },
  { from: '/OfflineDocumentation', to: '/ClinicalDocumentation' },
  { from: '/UserActivityLog', to: '/UserActivityReport?tab=log' },
  { from: '/PDFTemplateLibrary', to: '/TemplateManagement?tab=pdf' },

  // NOTE: the Care Plans feature (CarePlanManagement, CarePlanBuilder,
  // AutomaticCarePlans, their components, backend functions and data entities)
  // was ported back from the live PENNSync app, so those paths are real
  // manifest-derived routes again — their former removal redirects are gone.
];

export const MAIN_PAGE = 'Dashboard';

export const PAGE_NAMES = ROUTES.map((route) => route.name);

export const ROUTER_PATHS = [
  '/',
  '/join',
  '/signer',
  '/followup',
  '/privacy',
  ...PAGE_NAMES.map((name) => `/${name}`),
  ...REDIRECTS.map(({ from }) => from),
];
