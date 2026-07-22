export const IMPROVEMENT_TIERS = {
  critical: { label: 'Critical', weight: 4 },
  high: { label: 'High', weight: 3 },
  medium: { label: 'Medium', weight: 2 },
  foundational: { label: 'Foundational', weight: 1 },
};

export const FEATURE_IMPROVEMENT_ROADMAP = [
  {
    id: "visit-command-center",
    pillar: "Field visit command center",
    tier: "critical",
    source: "Frontline workflow audit and dashboard/visit inventory",
    why: "Clinicians need one place to run the visit safely instead of scanning dashboard widgets, route tools, alerts, care plans, forms, and documentation pages.",
    enhancements: [
      "Add a unified Today Visit Command Center that combines schedule, route, patient risks, last-note gaps, supplies, required signatures, OASIS prompts, offline readiness, and one-tap clinical actions."
    ],
    featureTargets: ["Dashboard", "Patients", "PatientDetails", "ClinicalDocumentation", "Offline Mode"],
    expectedOutcome: "Clinicians start every visit with the right context and fewer missed tasks."
  },
  {
    id: "universal-draft-recovery",
    pillar: "Resilient documentation autosave",
    tier: "critical",
    source: "Field clinician mobile/offline workflow review",
    why: "Long notes, incidents, telehealth documentation, and referral narratives are high-risk work products that must survive connectivity loss, timeout, refresh, and device interruption.",
    enhancements: [
      "Add visible autosave, draft recovery, sync state, conflict comparison, and one-click restore across Smart Notes, Visit Scribe, incidents, referrals, telehealth, and offline documentation."
    ],
    featureTargets: ["Smart Note Assistant", "ClinicalDocumentation", "Offline Mode", "Telehealth", "Referral Intake"],
    expectedOutcome: "Fewer lost notes, less rework, and higher confidence documenting in the field."
  },
  {
    id: "oasis-readiness-checklist",
    pillar: "Clinical quality & OASIS readiness",
    tier: "critical",
    source: "CMS HH QRP / OASIS quality-measure guidance",
    why: "Home health quality reporting depends heavily on OASIS data, so every assessment should be measurable, explainable, and audit-ready before submission.",
    enhancements: [
      "Add a pre-submit OASIS readiness checklist with missing-item severity, rationale, confidence, PDGM and outcome-measure impact, jump-to-item links, and reviewer sign-off."
    ],
    featureTargets: ["OASIS Center", "OASIS Analyzer", "PDGM Revenue Analysis", "Compliance Center", "Predictive Analytics"],
    expectedOutcome: "Fewer rejected assessments, faster QA review, and clearer quality-improvement priorities."
  },
  {
    id: "ai-provenance-governance",
    pillar: "AI governance & clinician trust",
    tier: "critical",
    source: "Clinical safety review of AI-assisted documentation patterns",
    why: "AI features are safest when every suggestion is traceable, reviewable, and tuned from real clinician feedback without hiding clinician responsibility.",
    enhancements: [
      "Add AI suggestion provenance showing source note text, patient facts used, guideline or rule basis, confidence, reviewer action, override reason, hallucination report path, and high-risk second-review triggers."
    ],
    featureTargets: ["Smart Note Assistant", "AI Tools Center", "Compliance Center", "Admin Operations", "ClinicalDocumentation"],
    expectedOutcome: "Higher clinician confidence, safer automation, and easier compliance review of AI-assisted work."
  },
  {
    id: "closed-loop-safety-alerts",
    pillar: "Closed-loop patient safety",
    tier: "critical",
    source: "AHRQ patient safety culture and safety-improvement tools",
    why: "High-performing safety programs do not stop at alert creation; they track ownership, escalation, resolution, learning, and recurrence prevention.",
    enhancements: [
      "Convert high-risk alerts into closed-loop safety workflows with owner, due time, escalation path, intervention documentation, resolution outcome, recurrence prevention, and post-event learning recommendations."
    ],
    featureTargets: ["Patient Alerts", "Incidents", "Incident Review", "Telehealth", "Training & Education"],
    expectedOutcome: "Earlier intervention, stronger accountability, and measurable learning after safety events."
  },
  {
    id: "mobile-clinical-quick-actions",
    pillar: "Mobile-first clinical quick actions",
    tier: "high",
    source: "Frontline mobile usability review",
    why: "Field clinicians need fast, thumb-friendly access to frequent actions while standing in the patient home, often under time pressure.",
    enhancements: [
      "Add a role-aware mobile floating action button for start or resume visit, record note, add vitals, call patient, message office, report incident, capture document, and open offline chart."
    ],
    featureTargets: ["Layout", "Dashboard", "ClinicalDocumentation", "Phone Center", "Offline Mode"],
    expectedOutcome: "Fewer taps and less context switching during visits."
  },
  {
    id: "universal-patient-timeline",
    pillar: "Unified patient timeline",
    tier: "high",
    source: "Patient record workflow inventory",
    why: "Patient context is distributed across notes, alerts, incidents, calls, faxes, telehealth, education, documents, and care plans, which makes the story hard to reconstruct quickly.",
    enhancements: [
      "Add a patient timeline that unifies notes, OASIS, vitals, alerts, incidents, calls, SMS, faxes, telehealth sessions, documents, education, care-plan updates, and referral events."
    ],
    featureTargets: ["PatientDetails", "PatientRecordDashboard", "Patients", "Messages", "Document Hub"],
    expectedOutcome: "Clinicians and managers understand the patient story without opening many modules."
  },
  {
    id: "next-best-action-dashboard",
    pillar: "Next-best-action dashboard",
    tier: "high",
    source: "Dashboard prioritization and clinical operations review",
    why: "A dashboard should not only summarize work; it should rank the most important actions and make them directly actionable.",
    enhancements: [
      "Add ranked next-best-action cards for overdue notes, OASIS due items, provider follow-up, high-risk alerts, offline sync, time-off approvals, timesheets, and credential expirations."
    ],
    featureTargets: ["Dashboard", "OASIS Center", "Referral Follow-Up", "Time Off", "Timesheets"],
    expectedOutcome: "Users know exactly what to do next and can complete priority work faster."
  },
  {
    id: "patient-caregiver-portal",
    pillar: "Patient and caregiver self-service portal",
    tier: "high",
    source: "Public token-gated route review",
    why: "The app already supports public token-gated experiences; expanding them can reduce office calls and improve patient readiness.",
    enhancements: [
      "Expand public token pages into a patient and caregiver portal for visit prep, telehealth device check, document signing, education handouts, teach-back, medication questions, satisfaction, symptom check-ins, and secure uploads."
    ],
    featureTargets: ["JoinTelehealth", "SignerPortal", "ProviderFollowUpPortal", "Patient Education", "Document Hub"],
    expectedOutcome: "Patients and caregivers complete more tasks without staff intervention."
  },
  {
    id: "role-based-onboarding",
    pillar: "Role-based guided onboarding",
    tier: "high",
    source: "User onboarding and training workflow review",
    why: "The product has a large feature surface, so new users need a guided path matched to their role and responsibilities.",
    enhancements: [
      "Add role-based onboarding tours and checklists for nurses, intake, QA, managers, admins, and super admins with first-task walkthroughs and completion tracking."
    ],
    featureTargets: ["Dashboard", "Learning Center", "Admin Operations", "User Settings", "Help"],
    expectedOutcome: "New users become productive faster with less live training."
  },
  {
    id: "workflow-completion-state",
    pillar: "Workflow completion indicators",
    tier: "high",
    source: "Tabbed hub and multi-step workflow review",
    why: "Users need to know whether a workflow is finished, blocked, waiting on someone else, or safe to submit.",
    enhancements: [
      "Add completion indicators for referral intake, OASIS readiness, note compliance, incident review, document packets, offline sync, training progress, and admin setup."
    ],
    featureTargets: ["Referral Intake", "OASIS Center", "ClinicalDocumentation", "Document Hub", "Learning Center"],
    expectedOutcome: "Users can resume and finish work confidently."
  },
  {
    id: "previsit-risk-digest",
    pillar: "Pre-visit patient risk digest",
    tier: "high",
    source: "Clinical safety and visit-prep review",
    why: "Clinicians need a compact digest of what changed and what to watch before entering the home.",
    enhancements: [
      "Generate a pre-visit risk digest with changes since last visit, top risks, abnormal vitals, medication concerns, open incidents, care-plan goals, education needs, and provider follow-up status."
    ],
    featureTargets: ["Dashboard", "PatientDetails", "Patient Alerts", "Care Plans", "ClinicalDocumentation"],
    expectedOutcome: "Safer visits and faster preparation."
  },
  {
    id: "offline-readiness-expiry",
    pillar: "Offline readiness and PHI expiry",
    tier: "high",
    source: "HIPAA security and offline workflow review",
    why: "Offline PHI should be reliable enough for field work and controlled enough for shared-device and lost-device risk.",
    enhancements: [
      "Add offline preflight checks, last-sync status, missing-cache warnings, offline PHI expiration, device re-auth prompts, and sync conflict audit trails."
    ],
    featureTargets: ["Offline Mode", "Layout", "PatientDetails", "ClinicalDocumentation", "Admin Operations"],
    expectedOutcome: "More reliable field work with stronger privacy safeguards."
  },
  {
    id: "global-clinical-search",
    pillar: "Global clinical and operational search",
    tier: "high",
    source: "Navigation and findability review",
    why: "The command palette helps navigate pages, but users also need one search box for patient, task, document, provider, message, note, referral, and admin content.",
    enhancements: [
      "Add global search across patients, MRNs, providers, documents, fax contacts, referrals, notes, incidents, training, settings, and help, with type filters and recent-result shortcuts."
    ],
    featureTargets: ["Layout", "Patients", "Document Hub", "Physician Directory", "Help"],
    expectedOutcome: "Users find records and tasks faster without memorizing module locations."
  },
  {
    id: "role-personalized-homepages",
    pillar: "Role-personalized homepages",
    tier: "medium",
    source: "Role model and dashboard review",
    why: "A nurse, intake coordinator, QA reviewer, manager, and admin all need different first-screen priorities.",
    enhancements: [
      "Personalize dashboard content by job function so clinicians see visits and notes, intake sees referrals, QA sees review queues, managers see workload and incidents, and admins see KPIs and configuration exceptions."
    ],
    featureTargets: ["Dashboard", "Admin Operations", "Reports & Analytics", "Referral Intake", "OASIS Center"],
    expectedOutcome: "Users see less irrelevant information and more of their own work."
  },
  {
    id: "explainable-analytics",
    pillar: "Explainable metrics and drill-downs",
    tier: "medium",
    source: "Admin analytics review",
    why: "Metrics should explain what changed, why it matters, who or what drove it, and what action to take next.",
    enhancements: [
      "Add explain-this-metric panels, driver drill-downs, benchmark context, underlying-record exports, and recommended actions for KPI, performance, referral, OASIS, and PDGM dashboards."
    ],
    featureTargets: ["Reports & Analytics", "Agency Analytics", "Predictive Analytics", "KPI Dashboard", "Nurse Performance"],
    expectedOutcome: "Analytics become actionable management workflows rather than passive charts."
  },
  {
    id: "admin-action-queues",
    pillar: "Admin action queues",
    tier: "medium",
    source: "Admin console workflow review",
    why: "Admins manage by exception, so passive dashboards should surface prioritized queues of records needing intervention.",
    enhancements: [
      "Add admin action queues for pending users, expiring credentials, failed jobs, data-quality exceptions, unresolved incidents, stale referrals, unsynced offline items, incomplete training, and security exceptions."
    ],
    featureTargets: ["Admin Operations", "User Management", "Credential Compliance", "System Job Monitor", "Compliance Center"],
    expectedOutcome: "Administrators can resolve operational risk faster."
  },
  {
    id: "sensitive-action-safeguards",
    pillar: "Sensitive-action safeguards",
    tier: "medium",
    source: "HIPAA security and data-governance review",
    why: "Exports, merges, deletes, and bulk downloads can affect many records or expose PHI, so they need consistent safeguards.",
    enhancements: [
      "Add reason capture, affected-record preview, role-aware confirmation, audit trail entries, optional second approval, and safe undo windows for exports, merges, deletions, and bulk document downloads."
    ],
    featureTargets: ["Patients", "Duplicate Patients", "Document Hub", "Reports & Analytics", "Patient Data Management"],
    expectedOutcome: "Lower accidental data-loss and privacy risk."
  },
  {
    id: "provider-relationship-intelligence",
    pillar: "Provider relationship intelligence",
    tier: "medium",
    source: "Referral and physician communication workflow review",
    why: "Provider responsiveness and document quality directly affect referral conversion, SOC timing, and compliance completion.",
    enhancements: [
      "Enhance provider records with preferred channel, response time, missing-document patterns, referral volume, face-to-face quality, best contact by request type, escalation contacts, and auto-suggested follow-up."
    ],
    featureTargets: ["Physician Directory", "Referral Intake", "Referral Follow-Up", "SendFax", "Messages"],
    expectedOutcome: "Less phone and fax chase with faster referral completion."
  },
  {
    id: "document-packet-control-board",
    pillar: "Document packet status control board",
    tier: "medium",
    source: "Document Hub and e-sign workflow review",
    why: "Office users need a single board showing where every packet stands and what is blocking completion.",
    enhancements: [
      "Add a document packet board for sent, viewed, signed, declined, expired, missing signer, missing required field, ready for upload, needs resend, and aging by payer, referral, patient, or provider."
    ],
    featureTargets: ["Document Hub", "SignerPortal", "SignDocument", "SendFax", "Referral Intake"],
    expectedOutcome: "Faster signature turnaround and fewer delayed starts of care."
  },
  {
    id: "inline-documentation-nudges",
    pillar: "Inline clinical quality nudges",
    tier: "medium",
    source: "Clinical documentation quality review",
    why: "Clinicians should see missing quality elements while writing, not only after the note is submitted for review.",
    enhancements: [
      "Add inline nudges for wound measurements, oxygen SpO2, pain intervention and response, medication-change notification, fall-risk follow-up, and care-plan updates while documenting."
    ],
    featureTargets: ["ClinicalDocumentation", "Smart Note Assistant", "OASIS Center", "Facility Documentation Rules", "Compliance Center"],
    expectedOutcome: "Better first-pass notes with less QA back-and-forth."
  },
  {
    id: "intake-to-soc-timeline",
    pillar: "Referral intake-to-SOC timeline",
    tier: "medium",
    source: "Referral operations review",
    why: "Referrals stall when teams cannot see exactly which intake, compliance, provider, and scheduling steps are blocking SOC.",
    enhancements: [
      "Add a visual intake-to-SOC timeline covering referral receipt, extraction, patient verification, insurance or MBI check, face-to-face validation, provider follow-up, SOC scheduling, OASIS start, and blockers."
    ],
    featureTargets: ["Referral Intake", "Referral Follow-Up", "ProviderFollowUpPortal", "Patients", "OASIS Center"],
    expectedOutcome: "Fewer referrals stall silently and more starts of care happen on time."
  },
  {
    id: "adaptive-training-recommendations",
    pillar: "Adaptive training recommendations",
    tier: "medium",
    source: "Learning and quality-improvement review",
    why: "Training is most useful when triggered by real workflow misses instead of delivered as generic content only.",
    enhancements: [
      "Recommend micro-training based on repeated OASIS misses, wound documentation gaps, medication reconciliation issues, infection-control gaps, fall-risk follow-up misses, telehealth documentation gaps, and incident reporting omissions."
    ],
    featureTargets: ["Learning Center", "Nurse Training Hub", "Admin Training", "Manager Skill Gap Dashboard", "Compliance Center"],
    expectedOutcome: "Training becomes timely, personalized, and tied to measurable quality improvement."
  },
  {
    id: "demo-sandbox-mode",
    pillar: "Demo and sandbox data mode",
    tier: "foundational",
    source: "Evaluation, training, and local testing review",
    why: "A safe synthetic-data mode helps users evaluate, train, and test workflows without backend credentials or real PHI.",
    enhancements: [
      "Add a clearly labeled demo mode with synthetic patients, visits, OASIS gaps, referrals, documents, training progress, and analytics that never persists real PHI."
    ],
    featureTargets: ["Dashboard", "Patients", "OASIS Center", "Referral Intake", "Reports & Analytics"],
    expectedOutcome: "Prospects, trainers, and QA can explore the app safely and consistently."
  },
  {
    id: "release-notes-center",
    pillar: "User-facing release notes center",
    tier: "foundational",
    source: "Change management and adoption review",
    why: "A broad clinical operations app changes often, so users need clear explanations of new features and moved workflows.",
    enhancements: [
      "Add a What Changed center with role-targeted release notes, workflow-change explanations, short tutorials, agency announcements, and try-it-now deep links."
    ],
    featureTargets: ["Features", "About", "Help", "Admin Operations", "Learning Center"],
    expectedOutcome: "Users adopt improvements faster with less confusion and fewer support questions."
  }
];

const normalizeForSearch = (value) => String(value || '')
  .toLowerCase()
  .replace(/&/g, 'and')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const tokenSet = (value) => new Set(normalizeForSearch(value).split(' ').filter(Boolean));

const hasTokenOverlap = (left, right) => {
  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);
  if (!leftTokens.size || !rightTokens.size) return false;
  return [...leftTokens].some((token) => rightTokens.has(token));
};

export function summarizeImprovementRoadmap(roadmap = FEATURE_IMPROVEMENT_ROADMAP) {
  return roadmap.reduce((summary, item) => {
    summary.totalInitiatives += 1;
    summary.totalEnhancements += item.enhancements.length;
    summary.byTier[item.tier] = (summary.byTier[item.tier] || 0) + 1;
    item.featureTargets.forEach((target) => summary.uniqueFeatureTargets.add(target));
    return summary;
  }, { totalInitiatives: 0, totalEnhancements: 0, byTier: {}, uniqueFeatureTargets: new Set() });
}

export function getRoadmapForFeature(featureName, roadmap = FEATURE_IMPROVEMENT_ROADMAP) {
  const normalized = normalizeForSearch(featureName);
  if (!normalized) return [];

  return roadmap.filter((item) => item.featureTargets.some((target) => {
    const normalizedTarget = normalizeForSearch(target);
    return normalized.includes(normalizedTarget)
      || normalizedTarget.includes(normalized)
      || hasTokenOverlap(normalized, normalizedTarget);
  }));
}

export function getFeatureEnhancementSuggestions(featureName, categoryName, roadmap = FEATURE_IMPROVEMENT_ROADMAP) {
  const searchContext = [featureName, categoryName].filter(Boolean).join(' ');
  return getRoadmapForFeature(searchContext, roadmap)
    .flatMap((item) => item.enhancements.map((enhancement, index) => ({
      initiativeId: item.id,
      pillar: item.pillar,
      tier: item.tier,
      source: item.source,
      enhancement,
      rank: IMPROVEMENT_TIERS[item.tier]?.weight || 0,
      order: index
    })))
    .sort((a, b) => b.rank - a.rank || a.order - b.order);
}
