const CATEGORY_RULES = [
  { category: 'documentation', modules: ['SmartNote', 'DocumentHub', 'ADRCenter'], terms: ['documentation', 'missing note', 'skilled need', 'homebound', 'signature'] },
  { category: 'oasis', modules: ['OASISCenter', 'PDGM'], terms: ['oasis', 'm0', 'functional', 'assessment'] },
  { category: 'coding', modules: ['PDGM', 'ReferralIntake'], terms: ['diagnosis', 'icd', 'coding', 'primary dx', 'case-mix'] },
  { category: 'authorization', modules: ['ReferralIntake', 'ADRCenter'], terms: ['authorization', 'eligibility', 'coverage', 'order'] },
];

function textOf(row = {}) {
  return [row.reason, row.reason_code, row.denial_reason, row.description, row.remark_code].filter(Boolean).join(' ').toLowerCase();
}

export function classifyDenialFeedback(row = {}) {
  const text = textOf(row);
  return CATEGORY_RULES.find((rule) => rule.terms.some((term) => text.includes(term))) || { category: 'other', modules: ['ReportsAnalytics'], terms: [] };
}

export function normalizeDenialFeedbackRow(row = {}) {
  const classified = classifyDenialFeedback(row);
  const amount = Number(row.amount_denied ?? row.denied_amount ?? row.amount ?? 0);
  return {
    claim_id: row.claim_id || row.claim || null,
    patient_id: row.patient_id || null,
    visit_id: row.visit_id || null,
    oasis_assessment_id: row.oasis_assessment_id || null,
    denial_date: row.denial_date || row.date || null,
    reason_code: row.reason_code || row.remark_code || null,
    reason: row.reason || row.denial_reason || row.description || '',
    category: classified.category,
    affected_modules: classified.modules,
    amount_denied: Number.isFinite(amount) ? amount : 0,
    source: row.source || 'payer_import',
  };
}

export function summarizeDenialFeedback(rows = []) {
  const normalized = (Array.isArray(rows) ? rows : []).map(normalizeDenialFeedbackRow);
  const byCategory = {};
  let totalAmountDenied = 0;
  for (const row of normalized) {
    byCategory[row.category] = (byCategory[row.category] || 0) + 1;
    totalAmountDenied += row.amount_denied;
  }
  return { rows: normalized, totalRows: normalized.length, totalAmountDenied, byCategory };
}
