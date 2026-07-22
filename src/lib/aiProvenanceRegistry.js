const OUTCOME_STATUSES = new Set(['draft', 'accepted', 'rejected', 'corrected', 'escalated']);

export function normalizeAiProvenanceEntry(entry = {}) {
  const createdAt = entry.created_at || entry.createdAt || new Date().toISOString();
  return {
    id: entry.id || entry.request_id || null,
    feature: String(entry.feature || entry.workflow || '').trim(),
    model: String(entry.model || entry.model_name || '').trim(),
    actor_email: entry.actor_email || entry.user_email || null,
    patient_id: entry.patient_id || null,
    source_record_type: entry.source_record_type || entry.record_type || null,
    source_record_id: entry.source_record_id || entry.record_id || null,
    status: OUTCOME_STATUSES.has(entry.status) ? entry.status : 'draft',
    created_at: Number.isFinite(Date.parse(createdAt)) ? new Date(createdAt).toISOString() : null,
    prompt_hash: entry.prompt_hash || null,
    output_hash: entry.output_hash || null,
    reviewer_email: entry.reviewer_email || null,
    reviewed_at: entry.reviewed_at || null,
    risk_flags: Array.isArray(entry.risk_flags) ? entry.risk_flags.filter(Boolean) : [],
  };
}

export function validateAiProvenanceEntry(entry = {}) {
  const normalized = normalizeAiProvenanceEntry(entry);
  const missing = [];
  for (const field of ['feature', 'model', 'status', 'created_at']) {
    if (!normalized[field]) missing.push(field);
  }
  if (!normalized.prompt_hash && !normalized.output_hash) missing.push('prompt_hash or output_hash');
  return { valid: missing.length === 0, missing, entry: normalized };
}

export function filterAiProvenanceEntries(entries = [], { feature, status, patientId, actorEmail } = {}) {
  return (Array.isArray(entries) ? entries : [])
    .map(normalizeAiProvenanceEntry)
    .filter((entry) => !feature || entry.feature === feature)
    .filter((entry) => !status || entry.status === status)
    .filter((entry) => !patientId || entry.patient_id === patientId)
    .filter((entry) => !actorEmail || entry.actor_email === actorEmail)
    .sort((a, b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0));
}

export function toAiProvenanceExportRow(entry = {}) {
  const normalized = normalizeAiProvenanceEntry(entry);
  return {
    id: normalized.id,
    feature: normalized.feature,
    model: normalized.model,
    actor_email: normalized.actor_email,
    patient_id: normalized.patient_id,
    source_record_type: normalized.source_record_type,
    source_record_id: normalized.source_record_id,
    status: normalized.status,
    created_at: normalized.created_at,
    reviewer_email: normalized.reviewer_email,
    reviewed_at: normalized.reviewed_at,
    risk_flags: normalized.risk_flags.join('|'),
    prompt_hash: normalized.prompt_hash,
    output_hash: normalized.output_hash,
  };
}
