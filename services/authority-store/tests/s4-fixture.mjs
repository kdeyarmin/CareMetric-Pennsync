// Synthetic, reviewed-result DTO only. No AI or clinical truth is inferred.
export function s4Fields(overrides = {}) {
  return {
    visit_date: '2026-09-18', visit_type: 'skilled_nursing', status: 'completed',
    nurse_notes: 'Synthetic reviewed note. 🩺', raw_transcription: 'Synthetic draft. 🩺',
    vital_signs: { heart_rate: 72, weight: null }, compliance_score: 92, draft_presence_score: 68,
    homebound_status_verified: false, skilled_intervention_documented: false,
    homebound_justification: '', documentation_source: 'smart_note', grounding_pending: false,
    compliance_issues: [], ai_tags: [], chart_findings: [], denial_findings: [], sustained_trends: [],
    acknowledgment: null, rule_versions: [], diagnosis: '', ...overrides,
  };
}
export const s4Tables = ['s4_visit', 's4_note_history', 's4_note_conversion', 's4_compliance_audit', 's4_create_receipt'];
