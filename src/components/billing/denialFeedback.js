const CATEGORY_RULES = [
  { category: 'documentation', modules: ['SmartNote', 'DocumentHub', 'ADRCenter'], terms: ['documentation', 'missing note', 'skilled need', 'homebound', 'signature'] },
  { category: 'oasis', modules: ['OASISCenter', 'PDGM'], terms: ['oasis', 'm0', 'functional', 'assessment'] },
  { category: 'coding', modules: ['PDGM', 'ReferralIntake'], terms: ['diagnosis', 'icd', 'coding', 'primary dx', 'case-mix'] },
  { category: 'authorization', modules: ['ReferralIntake', 'ADRCenter'], terms: ['authorization', 'eligibility', 'coverage', 'order'] },
];

function textOf(row = {}) {
  return [row.reason, row.reason_code, row.denial_reason, row.description, row.remark_code].filter(Boolean).join(' ').toLowerCase();
}

// Leading word boundary, matching presenceDetection's convention: raw
// substring matching misrouted "Panic disORDER" and "BORDERline" to
// authorization and "CM0234" to oasis. Terms stay stems ("m0" must still
// match "M0140"), so only the leading edge is anchored.
const termRegex = (term) => new RegExp(`\\b${String(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');

export function classifyDenialFeedback(row = {}) {
  const text = textOf(row);
  return CATEGORY_RULES.find((rule) => rule.terms.some((term) => termRegex(term).test(text))) || { category: 'other', modules: ['ReportsAnalytics'], terms: [] };
}

// Payer exports routinely format dollars ("$1,250.00") — Number() alone turned
// them into 0 and the denial dashboard under-reported as fact.
function parseAmount(value) {
  const amount = Number(String(value ?? 0).replace(/[$,\s]/g, ''));
  return Number.isFinite(amount) ? amount : 0;
}

export function normalizeDenialFeedbackRow(row = {}) {
  const classified = classifyDenialFeedback(row);
  const amount = parseAmount(row.amount_denied ?? row.denied_amount ?? row.amount ?? 0);
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
    amount_denied: amount,
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
  // Round at the summary so per-row float dust never shows up in the total.
  return { rows: normalized, totalRows: normalized.length, totalAmountDenied: Math.round(totalAmountDenied * 100) / 100, byCategory };
}
