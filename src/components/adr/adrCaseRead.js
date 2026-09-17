// Validate the shapes consumed by the ADR page and its retained step panels.
// Reject the whole read instead of dropping malformed cases or inventing totals.
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string';
const number = value => typeof value === 'number' && Number.isFinite(value);
const optional = (value, validate) => value == null || validate(value);
const texts = value => Array.isArray(value) && value.every(text);
const numbers = value => Array.isArray(value) && value.every(number);
const textFields = (value, fields) => object(value) && fields.every(key => optional(value[key], text));
const rows = (value, validate) => Array.isArray(value) && value.every(validate);

function checklistItem(value) {
  return textFields(value, ['id', 'source', 'title', 'letter_text', 'letter_details', 'category', 'severity', 'citation', 'what_to_include', 'when', 'audit_type'])
    && optional(value.seq, number) && optional(value.verification_points, texts);
}

function summary(value) {
  return object(value)
    && ['page_count', 'found_count', 'partial_count', 'missing_count', 'na_count', 'ai_confidence'].every(key => optional(value[key], number))
    && optional(value.readiness, readiness => textFields(readiness, ['level'])
      && optional(readiness.score, number)
      && optional(readiness.blocking, entries => rows(entries, entry => textFields(entry, ['id', 'title', 'reason', 'citation']))))
    && rows(value.items, item => textFields(item, ['id', 'title', 'citation', 'status', 'na_reason', 'evidence', 'reviewer_note'])
      && optional(item.seq, number) && numbers(item.pages)
      && rows(item.issues, issue => textFields(issue, ['severity', 'problem']) && optional(issue.page, number)))
    && optional(value.follow_ups, entries => rows(entries, entry => textFields(entry, ['id', 'severity', 'action', 'why', 'citation'])))
    && optional(value.unreadable_pages, numbers)
    && optional(value.overall_observations, texts);
}

export const ADR_CASE_READ_LIMIT = 200;

export function readAdrCases(value) {
  const ids = new Set();
  if (!rows(value, row => {
    if (!textFields(row, ['id', 'case_name', 'status', 'audit_type', 'patient_id', 'patient_name', 'contractor_name', 'claim_number', 'dates_of_service', 'letter_date', 'response_due_date', 'letter_file_url', 'packet_file_url', 'final_packet_url', 'outcome', 'decision_date', 'appeal_due_date', 'outcome_notes'])
      || !row.id || row.id.trim() !== row.id || ids.has(row.id)
      || !optional(row.checklist, entries => rows(entries, checklistItem))
      || !optional(row.letter_analysis, analysis => textFields(analysis, ['letter_summary'])
        && optional(analysis.special_instructions, texts) && optional(analysis.unclear_fields, texts))
      || !optional(row.verification_summary, summary)
      || !optional(row.submission_faxes, entries => rows(entries, entry => textFields(entry, ['date', 'to_name', 'to_number', 'sent_by'])))
      || !optional(row.packet_page_count, number) || !optional(row.final_packet_pages, number)) return false;
    ids.add(row.id);
    return true;
  }) || value.length > ADR_CASE_READ_LIMIT) {
    throw new Error('ADR_CASE_READ_INVALID');
  }
  return value;
}
