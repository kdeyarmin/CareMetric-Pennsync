export const IMPROVEMENT_TIERS = {
  critical: { label: 'Critical', weight: 4 },
  high: { label: 'High', weight: 3 },
  medium: { label: 'Medium', weight: 2 },
  foundational: { label: 'Foundational', weight: 1 },
};

export const FEATURE_IMPROVEMENT_ROADMAP = [
  {
    id: 'oasis-quality-readiness',
    pillar: 'Clinical quality & OASIS readiness',
    tier: 'critical',
    source: 'CMS HH QRP / OASIS quality-measure guidance',
    why: 'Home health quality reporting depends heavily on OASIS data, so the app should make every assessment measurable, explainable, and audit-ready before submission.',
    enhancements: [
      'Add a pre-submit OASIS-E2 readiness checklist with missing-item severity, confidence, and reviewer sign-off.',
      'Show outcome-measure impact next to each corrected M-item so clinicians understand quality and reimbursement effects.',
      'Create a quality-measure watchlist for measures trending below agency targets and link directly to affected patients.'
    ],
    featureTargets: ['OASIS Analyzer', 'PDGM Revenue Analysis', 'Compliance Center', 'Predictive Analytics'],
    expectedOutcome: 'Fewer rejected assessments, faster QA review, and clearer quality-improvement priorities.'
  },
  {
    id: 'closed-loop-patient-safety',
    pillar: 'Closed-loop patient safety',
    tier: 'critical',
    source: 'AHRQ patient safety culture and safety-improvement tools',
    why: 'High-performing safety programs do not stop at alert creation; they track ownership, escalation, resolution, learning, and recurrence prevention.',
    enhancements: [
      'Convert high-risk alerts into closed-loop safety huddles with owner, due time, escalation path, and outcome documentation.',
      'Add incident recurrence analytics by patient, clinician, medication class, diagnosis, and care setting.',
      'Add post-incident learning cards that recommend micro-training, policy review, or care-plan updates.'
    ],
    featureTargets: ['Patient Alerts', 'Incident Reporting', 'Telehealth', 'Training & Education'],
    expectedOutcome: 'Earlier intervention, stronger accountability, and measurable learning after safety events.'
  },
  {
    id: 'hipaa-cyber-resilience',
    pillar: 'HIPAA-grade cyber resilience',
    tier: 'critical',
    source: 'HHS HIPAA Security Rule safeguards and OCR cybersecurity guidance',
    why: 'A clinical SPA that handles ePHI should surface privacy, access, audit, and data-integrity controls as first-class product features.',
    enhancements: [
      'Add an admin security posture dashboard for MFA coverage, stale users, risky roles, failed logins, and unresolved audit exceptions.',
      'Add sensitive-action confirmation and reason capture for exports, merges, deletions, and bulk document downloads.',
      'Add offline-data expiry, device re-authentication prompts, and sync conflict audit trails.'
    ],
    featureTargets: ['User Management', 'Offline Mode', 'Document Hub', 'Admin Operations'],
    expectedOutcome: 'Lower privacy risk, stronger audit readiness, and better operational control over ePHI workflows.'
  },
  {
    id: 'interoperability-fhir-first',
    pillar: 'Interoperability & data liquidity',
    tier: 'high',
    source: 'ONC USCDI / nationwide health information exchange priorities',
    why: 'The product becomes more valuable when its structured notes, incidents, education, and outcomes can map cleanly to standardized exchange concepts.',
    enhancements: [
      'Add a USCDI/FHIR mapping preview for patient demographics, problems, medications, allergies, vitals, notes, goals, and assessments.',
      'Add import validation that flags unmapped referral fields and suggests standardized terminology before intake acceptance.',
      'Add export packages for transition-of-care, physician follow-up, ADR packets, and quality reporting with provenance metadata.'
    ],
    featureTargets: ['Referral Intake', 'Patient Records', 'Document Hub', 'Physician Directory'],
    expectedOutcome: 'Cleaner referrals, less duplicate entry, and easier data exchange with EHR and partner systems.'
  },
  {
    id: 'clinician-experience-mobile',
    pillar: 'Field clinician experience',
    tier: 'high',
    source: 'Frontline workflow review and app feature inventory',
    why: 'The app already has voice, offline, templates, and quick navigation; the next leap is reducing every field-visit interruption and recovery step.',
    enhancements: [
      'Add a visit command center that combines route, patient risks, last note gaps, supplies, forms, and required signatures.',
      'Add resilient autosave with visible save state, conflict comparison, and one-click restore for long notes.',
      'Add voice-driven quick actions for vitals, supplies used, incident start, physician call, and patient education delivered.'
    ],
    featureTargets: ['Dashboard', 'Smart Note Assistant', 'Offline Mode', 'Visit Documentation'],
    expectedOutcome: 'Less cognitive load in the home, fewer lost notes, and faster visit closeout.'
  },
  {
    id: 'ai-governance-trust',
    pillar: 'AI governance & clinician trust',
    tier: 'high',
    source: 'Clinical safety review of AI-assisted documentation patterns',
    why: 'AI features are strongest when every suggestion is traceable, reviewable, and tuned from real clinician feedback without hiding responsibility.',
    enhancements: [
      'Add AI suggestion provenance that shows source note text, patient facts used, guideline/rule basis, confidence, and reviewer action.',
      'Add model-performance monitoring by feature: acceptance rate, override reason, hallucination reports, turnaround time, and safety flags.',
      'Add configurable agency guardrails for forbidden phrasing, required attestations, and high-risk AI edits that require second review.'
    ],
    featureTargets: ['Smart Note Assistant', 'AI Tools Center', 'Compliance Center', 'Admin Operations'],
    expectedOutcome: 'Higher clinician confidence, safer automation, and easier compliance review of AI-assisted work.'
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
