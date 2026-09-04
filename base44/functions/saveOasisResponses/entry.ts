import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Dormant validator and future protected write path for OASIS responses.
//
// WHY THIS FUNCTION EXISTS
// `OASISAssessment` is now source-locked to service-role writes. The former
// browser writer derived tenant scope from mutable User fields and did not prove
// Patient/chart access, so enabling a feature flag could have crossed the
// tenant boundary. The server-owned create-draft broker is implemented below,
// but this endpoint remains HARD PAUSED before body parsing, client creation,
// auth, settings reads, validation, or writes until hosted two-agency and
// exact-broker service-role mutation proofs pass. Activation also requires an
// atomic authorization/create boundary, an authority-bound idempotency key,
// and an approved semantic mapping between optional Visit rows and OASIS time
// points. There is deliberately no browser, admin, feature-flag, or
// environment-variable bypass.
//
// The request carries only definition ids and response values. Tenant scope,
// draft state, schema metadata, item metadata, clinician provenance, and write
// timestamps are derived here. The canonical rows are then re-validated by the
// shared response guard. It refuses:
//   * an unknown definition or obsolete/non-canonical response representation;
//   * an unresolved instrument (missing/invalid assessment date);
//   * an unresolved or inapplicable time point;
//   * an invalid code, response shape, or grid row;
//   * client-supplied schema, provenance, lifecycle, or assessment-id fields;
//   * update, submit, and approval operations without an atomic lifecycle/CAS
//     design.
//
// It never converts, recodes or repairs a value. A row that does not validate is
// rejected with a named reason so the client can tell the clinician what to fix.

// <<<BEGIN SHARED HELPER: oasisResponseGuard — generated, edit base44/_shared/backendHelpers.mjs>>>
const OASIS_RESPONSE_SCHEMA_V1_LEGACY = 'pennsync-oasis-response-v1-legacy';
const OASIS_RESPONSE_SCHEMA_V2_CMS_E2 = 'pennsync-oasis-response-v2-cms-e2';
const OASIS_KNOWN_RESPONSE_SCHEMAS = [OASIS_RESPONSE_SCHEMA_V1_LEGACY, OASIS_RESPONSE_SCHEMA_V2_CMS_E2];
// Only v2 accepts NEW writes. v1 is frozen history: permanently read-only.
const OASIS_WRITABLE_RESPONSE_SCHEMAS = [OASIS_RESPONSE_SCHEMA_V2_CMS_E2];

// Item applicability, derived from the final OASIS-E2 Time Point instruments
// (effective 2026-04-01). M2420 is agency-discharge only; an inpatient-facility
// transfer is M2410, which PennSync does not implement.
const OASIS_V2_APPLICABILITY = {
  m1100_cms_e2: ['SOC', 'ROC'],
  m1306_cms_e2: ['SOC', 'ROC', 'FU', 'DC'],
  m1340_cms_e2: ['SOC', 'ROC', 'DC'],
  m1400_cms_e2: ['SOC', 'ROC', 'DC'],
  m1620_cms_e2: ['SOC', 'ROC', 'DC'],
  m1740_cms_e2: ['SOC', 'ROC', 'DC'],
  m1830_cms_e2: ['SOC', 'ROC', 'FU', 'DC'],
  m1840_cms_e2: ['SOC', 'ROC', 'FU', 'DC'],
  m1860_cms_e2: ['SOC', 'ROC', 'FU', 'DC'],
  m1870_cms_e2: ['SOC', 'ROC', 'DC'],
  m2001_cms_e2: ['SOC', 'ROC'],
  m2010_cms_e2: ['SOC', 'ROC'],
  m2020_cms_e2: ['SOC', 'ROC', 'DC'],
  m2401_cms_e2: ['TRN', 'DC'],
  m2420_cms_e2: ['DC'],
  ps_hospitalization_risk_tier: ['SOC', 'ROC', 'FU', 'TRN', 'DC'],
  ps_urinary_incontinence_frequency: ['SOC', 'ROC', 'FU', 'TRN', 'DC'],
  ps_ostomy_self_management: ['SOC', 'ROC', 'FU', 'TRN', 'DC'],
};
const OASIS_V2_ITEM_NUMBERS = {
  m1100_cms_e2: 'M1100', m1306_cms_e2: 'M1306', m1340_cms_e2: 'M1340', m1400_cms_e2: 'M1400',
  m1620_cms_e2: 'M1620', m1740_cms_e2: 'M1740', m1830_cms_e2: 'M1830', m1840_cms_e2: 'M1840',
  m1860_cms_e2: 'M1860', m1870_cms_e2: 'M1870', m2001_cms_e2: 'M2001', m2010_cms_e2: 'M2010',
  m2020_cms_e2: 'M2020', m2401_cms_e2: 'M2401', m2420_cms_e2: 'M2420',
};
const OASIS_V2_CODES = {
  m1100_cms_e2: ['01','02','03','04','05','06','07','08','09','10','11','12','13','14','15'],
  m1306_cms_e2: ['0','1'],
  m1340_cms_e2: ['0','1','2'],
  m1400_cms_e2: ['0','1','2','3','4'],
  m1620_cms_e2: ['0','1','2','3','4','5','NA','UK'],
  m1740_cms_e2: ['1','2','3','4','5','6','7'],
  m1830_cms_e2: ['0','1','2','3','4','5','6'],
  m1840_cms_e2: ['0','1','2','3','4'],
  m1860_cms_e2: ['0','1','2','3','4','5','6'],
  m1870_cms_e2: ['0','1','2','3','4','5'],
  m2001_cms_e2: ['0','1','9'],
  m2010_cms_e2: ['0','1','NA'],
  m2020_cms_e2: ['0','1','2','3','NA'],
  m2401_cms_e2: ['0','1','NA'],
  m2420_cms_e2: ['1','2','3','4','UK'],
  ps_hospitalization_risk_tier: ['low','medium','high'],
  ps_urinary_incontinence_frequency: ['none','occasional_stress','daily_pads','continuous','catheter'],
  ps_ostomy_self_management: ['none','independent','needs_assistance'],
};
const OASIS_V2_SHAPES = {
  m1100_cms_e2: 'matrix_choice', m1740_cms_e2: 'multi_select', m2401_cms_e2: 'grid',
};
const OASIS_V2_GRID_ROWS = { m2401_cms_e2: ['b', 'c', 'd', 'e', 'f'] };
const OASIS_V2_EXCLUSIVE_CODES = { m1740_cms_e2: ['7'] };
// Codes CMS omits at a given time point (M1620's UK is omitted on DC).
const OASIS_V2_CODE_OMISSIONS = { m1620_cms_e2: { DC: ['UK'] } };
const OASIS_V2_SCREENING_IDS = [
  'ps_hospitalization_risk_tier', 'ps_urinary_incontinence_frequency', 'ps_ostomy_self_management',
];

function oasisVisitTypeToTimepoint(visitType) {
  switch (String(visitType || '').trim()) {
    case 'Start of Care': return 'SOC';
    case 'Resumption of Care': return 'ROC';
    case 'Recertification': return 'FU';
    case 'Transfer': return 'TRN';
    case 'Discharge': return 'DC';
    case 'Death at Home': return 'DAH';
    default: return null;
  }
}

function oasisResolveInstrument(assessmentDate) {
  if (assessmentDate === null || assessmentDate === undefined || String(assessmentDate).trim() === '') {
    return { resolved: false, reason: 'missing_assessment_date' };
  }
  const t = Date.parse(String(assessmentDate));
  if (!Number.isFinite(t)) return { resolved: false, reason: 'invalid_assessment_date' };
  if (t < Date.parse('2026-04-01')) return { resolved: false, reason: 'assessment_predates_oasis_e2' };
  return { resolved: true, instrument: 'oasis-e2' };
}

function oasisShapeOf(definitionId) {
  return OASIS_V2_SHAPES[definitionId] || 'single';
}

/**
 * Validate ONE incoming official/screening response row.
 * Returns null when valid, or a string reason. Never coerces a value.
 */
function validateOasisResponseRow(row, ctx) {
  if (!row || typeof row !== 'object') return 'row_not_an_object';
  const schemaId = row.response_schema_id;
  if (!schemaId) return 'missing_response_schema';
  if (!OASIS_KNOWN_RESPONSE_SCHEMAS.includes(schemaId)) return 'unknown_response_schema';
  // Stale client / obsolete schema: v1 is never writable again.
  if (!OASIS_WRITABLE_RESPONSE_SCHEMAS.includes(schemaId)) return 'obsolete_response_schema';

  const defId = row.definition_id;
  if (!defId || !Object.prototype.hasOwnProperty.call(OASIS_V2_CODES, defId)) return 'unknown_definition';

  const isScreening = OASIS_V2_SCREENING_IDS.includes(defId);
  if (isScreening && row.item_number) return 'screening_item_wearing_m_number';
  if (!isScreening) {
    const expected = OASIS_V2_ITEM_NUMBERS[defId];
    if (row.item_number && row.item_number !== expected) return 'item_number_mismatch';
    if (row.item_source !== 'cms_item') return 'inconsistent_item_source';
    if (row.item_spec_version !== ctx.instrument) return 'inconsistent_instrument_version';
  } else if (row.item_source !== 'pennsync_screening') {
    return 'inconsistent_item_source';
  }

  const applicable = OASIS_V2_APPLICABILITY[defId] || [];
  if (!ctx.timepoint) return 'unresolved_timepoint';
  if (!applicable.includes(ctx.timepoint)) return 'item_not_applicable_at_timepoint';

  const shape = oasisShapeOf(defId);
  if (row.response_shape && row.response_shape !== shape) return 'invalid_response_shape';
  const valid = OASIS_V2_CODES[defId];
  const omitted = (OASIS_V2_CODE_OMISSIONS[defId] || {})[ctx.timepoint] || [];
  const value = row.response_value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'invalid_response_shape';

  if (shape === 'multi_select') {
    const codes = value.codes;
    if (!Array.isArray(codes) || codes.length === 0) return 'invalid_response_shape';
    if (new Set(codes).size !== codes.length) return 'invalid_code';
    for (const c of codes) {
      if (typeof c !== 'string' || !valid.includes(c) || omitted.includes(c)) return 'invalid_code';
    }
    for (const ex of OASIS_V2_EXCLUSIVE_CODES[defId] || []) {
      if (codes.includes(ex) && codes.length > 1) return 'mutually_exclusive_response';
    }
  } else if (shape === 'grid') {
    const rows = value.rows;
    if (!Array.isArray(rows)) return 'invalid_response_shape';
    const required = OASIS_V2_GRID_ROWS[defId] || [];
    const seen = [];
    for (const r of rows) {
      if (!r || typeof r !== 'object') return 'invalid_grid_row';
      if (!required.includes(r.row_id)) return 'invalid_grid_row';
      if (seen.includes(r.row_id)) return 'invalid_grid_row';
      if (typeof r.code !== 'string' || !valid.includes(r.code) || omitted.includes(r.code)) return 'invalid_code';
      seen.push(r.row_id);
    }
    if (required.some((r) => !seen.includes(r))) return 'missing_grid_row';
  } else {
    const keys = Object.keys(value);
    if (keys.length !== 1 || keys[0] !== 'code') return 'invalid_response_shape';
    if (typeof value.code !== 'string' || !valid.includes(value.code) || omitted.includes(value.code)) return 'invalid_code';
  }

  if (row.response_origin !== 'clinician_selected') return 'response_not_clinician_selected';
  if (row.ai_suggested === true) return 'ai_originated_response';
  if (!row.selected_by || typeof row.selected_by !== 'string') return 'missing_selecting_clinician';
  if (!row.selected_at || Number.isNaN(Date.parse(String(row.selected_at)))) return 'missing_selection_timestamp';
  return null;
}

/**
 * Validate a whole incoming write. Returns { ok, errors: [{index, reason}] }.
 * Fails closed: an unresolved date or time point rejects every row.
 */
function validateOasisResponseWrite(payload) {
  const errors = [];
  const instrument = oasisResolveInstrument(payload && payload.assessment_date);
  if (!instrument.resolved) {
    return { ok: false, errors: [{ index: -1, reason: instrument.reason }] };
  }
  const timepoint = oasisVisitTypeToTimepoint(payload && payload.visit_type);
  if (!timepoint) return { ok: false, errors: [{ index: -1, reason: 'unresolved_timepoint' }] };
  if (payload && payload.response_schema_id
      && !OASIS_WRITABLE_RESPONSE_SCHEMAS.includes(payload.response_schema_id)) {
    return { ok: false, errors: [{ index: -1, reason: 'obsolete_response_schema' }] };
  }
  const rows = Array.isArray(payload && payload.oasis_items) ? payload.oasis_items : [];
  const ctx = { instrument: instrument.instrument, timepoint };
  const seenDefinitions = new Set();
  const seenItems = new Set();
  rows.forEach((row, index) => {
    const definitionKey = String(row?.definition_id || '').trim().toLowerCase();
    const itemKey = String(row?.item_number || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if ((definitionKey && seenDefinitions.has(definitionKey)) || (itemKey && seenItems.has(itemKey))) {
      errors.push({ index, reason: 'duplicate_item_or_definition' });
      return;
    }
    if (definitionKey) seenDefinitions.add(definitionKey);
    if (itemKey) seenItems.add(itemKey);
    const reason = validateOasisResponseRow(row, ctx);
    if (reason) errors.push({ index, reason });
  });
  return { ok: errors.length === 0, errors, instrument: instrument.instrument, timepoint };
}
// <<<END SHARED HELPER: oasisResponseGuard>>>

// Rollout flags remain flat AgencySettings fields. AgencySettings has no
// immutable agency_id yet, so this dormant broker binds exactly one settings
// row to the exact, unique Agency.agency_code loaded through immutable
// AgencyMembership.agency_id. It never uses User.agency_name or a global
// newest-row fallback.
const OASIS_V2_FLAG_FIELD = 'oasis_response_schema_v2_enabled';
const OASIS_WRITE_KILL_SWITCH_FIELD = 'oasis_response_writes_disabled';

// Release safety gate: keep this literal true. The dormant path rechecks
// authority after create so it never reports a raced write as success, but
// Base44 exposes no cross-entity transaction here: a revocation or kill-switch
// change after create can leave an unacknowledged draft. The request also has no
// idempotency key, so a retry after an ambiguous create can duplicate a draft.
// Finally, an optional Visit is scope-checked but its clinical type/status
// mapping to an OASIS time point still needs named review. Hosted two-agency,
// exact-OASIS service-role, atomicity/idempotency, and Visit-policy proofs are
// all activation blockers. Tests rewrite only an isolated transpiled copy;
// deployed code has no bypass.
const OASIS_V2_WRITES_PAUSED = true;

const MAX_BODY_BYTES = 100_000;
const MAX_IDENTIFIER_LENGTH = 200;
const MAX_OASIS_ITEMS = 500;
const MEMBERSHIP_SCAN_LIMIT = 100;
const EXACT_ROW_LIMIT = 10;
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

const OASIS_ASSESSMENT_VISIT_TYPES = new Set([
  'Start of Care',
  'Resumption of Care',
  'Recertification',
  'Discharge',
  'Transfer',
]);

const MEMBERSHIP_STATUSES = new Set(['pending', 'active', 'suspended', 'revoked']);
const TENANT_ROLES = new Set([
  'agency_admin',
  'manager',
  'clinician',
  'office_staff',
  'social_worker',
  'spiritual_care',
]);
const OASIS_WRITER_ROLES = new Set(['clinician']);
const VISIBLE_PATIENT_STATUSES = new Set(['active', 'hospitalized', 'discharged']);
const ASSIGNMENT_STATUSES = new Set(['active', 'suspended', 'revoked']);
const ASSIGNMENT_SOURCES = new Set([
  'manual',
  'patient_creator',
  'legacy_assigned_nurses',
  'legacy_provider_patient_assignment',
]);
const ASSIGNMENT_ACTIONS = new Set(['grant', 'activate', 'suspend', 'revoke']);
const VISIT_TYPES = new Set([
  'skilled_nursing',
  'admission',
  'recertification',
  'discharge',
  'routine_visit',
  'prn',
]);
const VISIT_STATUSES = new Set([
  'scheduled',
  'in_progress',
  'completed',
  'pending_review',
  'cancelled',
]);

const MEMBERSHIP_AUTHORITY_FIELDS = [
  'id',
  'membership_key',
  'agency_id',
  'user_id',
  'user_email_normalized',
  'tenant_role',
  'status',
  'created_by_user_id',
  'activated_at',
  'revoked_at',
  'revocation_reason',
  'last_transition_by_user_id',
  'last_transition_by_email_normalized',
  'last_transition_at',
  'last_transition_reason',
  'version',
];
const AGENCY_AUTHORITY_FIELDS = ['id', 'agency_code', 'status'];
const PATIENT_AUTHORITY_FIELDS = [
  'id',
  'agency_id',
  'created_by_user_id',
  'created_by_user_email_normalized',
  'created_by',
  'client_request_id',
  'patient_creation_key',
  'is_sample',
  'is_archived',
  'status',
  'updated_date',
];
const ASSIGNMENT_AUTHORITY_FIELDS = [
  'id',
  'assignment_key',
  'agency_id',
  'patient_id',
  'user_id',
  'user_email_normalized',
  'assignee_membership_id',
  'assignee_membership_version_at_enablement',
  'status',
  'source',
  'created_by_user_id',
  'created_by_user_email_normalized',
  'activated_at',
  'suspended_at',
  'revoked_at',
  'revocation_reason',
  'last_transition_by_user_id',
  'last_transition_by_email_normalized',
  'last_transition_at',
  'last_transition_reason',
  'last_transition_action',
  'last_transition_request_id',
  'last_transition_request_key',
  'version',
];
const VISIT_AUTHORITY_FIELDS = [
  'id',
  'agency_id',
  'patient_id',
  'created_by_user_id',
  'created_by_user_email_normalized',
  'created_by',
  'client_request_id',
  'is_sample',
  'visit_date',
  'visit_type',
  'status',
  'updated_date',
];
const SETTINGS_AUTHORITY_FIELDS = [
  'id',
  'agency_code',
  OASIS_V2_FLAG_FIELD,
  OASIS_WRITE_KILL_SWITCH_FIELD,
  'updated_date',
];
const WRITTEN_ASSESSMENT_FIELDS = [
  'id',
  'agency_id',
  'patient_id',
  'visit_id',
  'visit_type',
  'assessment_date',
  'oasis_items',
  'status',
  'response_schema_id',
  'instrument_version',
  'response_schema_source',
  'migration_status',
  'last_written_by',
  'last_written_at',
  'created_by',
  'created_date',
  'updated_date',
];

class PublicError extends Error {
  status: number;
  reason: string;
  errors: Array<Record<string, any>> | null;

  constructor(
    status: number,
    message: string,
    reason = 'request_rejected',
    errors: Array<Record<string, any>> | null = null,
  ) {
    super(message);
    this.name = 'PublicError';
    this.status = status;
    this.reason = reason;
    this.errors = errors;
  }
}

const normalizeEmail = (value: unknown) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

function canonicalEmail(value: unknown) {
  const normalized = normalizeEmail(value);
  if (!normalized || normalized.length > 320 || !normalized.includes('@') || /\s/.test(normalized)) {
    return null;
  }
  return normalized;
}

function exactIdentifier(value: unknown) {
  if (typeof value !== 'string') return null;
  if (!value || value.length > MAX_IDENTIFIER_LENGTH || value.trim() !== value) return null;
  if (value.startsWith('$')) return null;
  return value;
}

function validInstant(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validCalendarDate(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function boundedReason(value: unknown) {
  if (typeof value !== 'string') return null;
  const reason = value.trim();
  return reason && reason.length <= 500 ? reason : null;
}

function requireRows(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`${label} returned a non-array result`);
  return value as Array<Record<string, any>>;
}

function pickFields(row: Record<string, any>, fields: readonly string[]) {
  return Object.fromEntries(fields.map((field) => [field, row[field] ?? null]));
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalJson(nested)]),
    );
  }
  return value;
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

function plainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObjectKeys(value: unknown, keys: readonly string[]) {
  if (!plainObject(value)) return false;
  return sameValue(Object.keys(value).sort(), [...keys].sort());
}

function validateMinimalResponseValue(definitionId: string, value: unknown) {
  if (!plainObject(value)) return false;
  const shape = oasisShapeOf(definitionId);
  if (shape === 'multi_select') {
    return exactObjectKeys(value, ['codes'])
      && Array.isArray(value.codes)
      && value.codes.length > 0
      && value.codes.length <= 100;
  }
  if (shape === 'grid') {
    return exactObjectKeys(value, ['rows'])
      && Array.isArray(value.rows)
      && value.rows.length <= 500
      && value.rows.every((row) => exactObjectKeys(row, ['row_id', 'code']));
  }
  return exactObjectKeys(value, ['code']);
}

async function parseRequest(req: Request) {
  const contentLength = Number(req.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw new PublicError(413, 'Request body is too large', 'body_too_large');
  }
  let raw = '';
  try {
    raw = await req.text();
  } catch {
    throw new PublicError(400, 'Invalid JSON body', 'invalid_json');
  }
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    throw new PublicError(413, 'Request body is too large', 'body_too_large');
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new PublicError(400, 'Invalid JSON body', 'invalid_json');
  }
  if (!plainObject(body)) {
    throw new PublicError(400, 'Request body must be an object', 'invalid_request');
  }
  if (body.operation !== 'create_draft') {
    if (body.operation === 'update' || body.operation === 'submit' || body.operation === 'approve') {
      throw new PublicError(
        409,
        'OASIS assessment updates and lifecycle transitions remain unavailable.',
        'updates_paused',
      );
    }
    throw new PublicError(400, 'operation is invalid', 'invalid_operation');
  }
  const supported = [
    'operation',
    'agency_id',
    'patient_id',
    'visit_id',
    'visit_type',
    'assessment_date',
    'oasis_items',
  ];
  if (Object.keys(body).some((key) => !supported.includes(key))) {
    throw new PublicError(400, 'Request contains unsupported fields', 'unsupported_fields');
  }
  const agencyId = exactIdentifier(body.agency_id);
  const patientId = exactIdentifier(body.patient_id);
  const visitId = body.visit_id === undefined || body.visit_id === null
    ? null
    : exactIdentifier(body.visit_id);
  if (!agencyId) throw new PublicError(400, 'agency_id is invalid', 'invalid_identifier');
  if (!patientId) throw new PublicError(400, 'patient_id is invalid', 'invalid_identifier');
  if (body.visit_id !== undefined && body.visit_id !== null && !visitId) {
    throw new PublicError(400, 'visit_id is invalid', 'invalid_identifier');
  }
  const visitType = typeof body.visit_type === 'string' ? body.visit_type : '';
  if (!OASIS_ASSESSMENT_VISIT_TYPES.has(visitType)) {
    throw new PublicError(400, 'visit_type is invalid', 'invalid_visit_type');
  }
  if (!validCalendarDate(body.assessment_date)) {
    throw new PublicError(400, 'assessment_date is invalid', 'invalid_assessment_date');
  }
  const instrument = oasisResolveInstrument(body.assessment_date);
  if (!instrument.resolved) {
    throw new PublicError(422, 'Assessment date is outside the writable instrument.', instrument.reason);
  }
  if (
    !Array.isArray(body.oasis_items)
    || body.oasis_items.length < 1
    || body.oasis_items.length > MAX_OASIS_ITEMS
  ) {
    throw new PublicError(400, 'oasis_items must contain 1 to 500 rows', 'invalid_oasis_items');
  }
  const structuralErrors: Array<Record<string, any>> = [];
  body.oasis_items.forEach((row, index) => {
    if (!exactObjectKeys(row, ['definition_id', 'response_value'])) {
      structuralErrors.push({ index, reason: 'unsupported_response_fields' });
      return;
    }
    const definitionId = exactIdentifier(row.definition_id);
    if (!definitionId) {
      structuralErrors.push({ index, reason: 'unknown_definition' });
      return;
    }
    if (!validateMinimalResponseValue(definitionId, row.response_value)) {
      structuralErrors.push({ index, reason: 'invalid_response_shape' });
    }
  });
  if (structuralErrors.length > 0) {
    throw new PublicError(
      422,
      'One or more responses were rejected. No data was saved.',
      'validation_failed',
      structuralErrors,
    );
  }
  return {
    operation: 'create_draft',
    agencyId,
    patientId,
    visitId,
    visitType,
    assessmentDate: body.assessment_date as string,
    items: body.oasis_items as Array<Record<string, any>>,
  };
}

function validateMembershipRows(
  rawRows: Array<Record<string, any>>,
  userId: string,
  normalizedEmail: string,
) {
  if (rawRows.length >= MEMBERSHIP_SCAN_LIMIT) {
    throw new PublicError(409, 'Tenant membership is ambiguous', 'authority_integrity_failed');
  }
  if (rawRows.some((row) => row?.user_id !== userId)) {
    throw new PublicError(409, 'Tenant membership query scope could not be verified', 'authority_integrity_failed');
  }
  const ids = new Set<string>();
  const keys = new Set<string>();
  const agencyIds = new Set<string>();
  const validated: Array<Record<string, any>> = [];
  for (const row of rawRows) {
    const id = exactIdentifier(row.id);
    const agencyId = exactIdentifier(row.agency_id);
    const membershipKey = exactIdentifier(row.membership_key);
    const storedEmail = canonicalEmail(row.user_email_normalized);
    const transitionEmail = canonicalEmail(row.last_transition_by_email_normalized);
    const status = typeof row.status === 'string' ? row.status : '';
    if (
      !id
      || !agencyId
      || !membershipKey
      || !storedEmail
      || row.user_email_normalized !== storedEmail
      || storedEmail !== normalizedEmail
      || membershipKey !== `${agencyId}:${userId}`
      || !TENANT_ROLES.has(String(row.tenant_role || ''))
      || !MEMBERSHIP_STATUSES.has(status)
      || !Number.isSafeInteger(row.version)
      || row.version < 1
      || !exactIdentifier(row.created_by_user_id)
      || !exactIdentifier(row.last_transition_by_user_id)
      || !transitionEmail
      || row.last_transition_by_email_normalized !== transitionEmail
      || !validInstant(row.last_transition_at)
      || !boundedReason(row.last_transition_reason)
      || ((status === 'active' || status === 'suspended') && !validInstant(row.activated_at))
      || (status === 'pending' && row.activated_at != null)
      || (status === 'revoked' && (
        !validInstant(row.revoked_at) || !boundedReason(row.revocation_reason)
      ))
      || (status !== 'revoked' && (row.revoked_at != null || row.revocation_reason != null))
    ) {
      throw new PublicError(409, 'Tenant membership integrity check failed', 'authority_integrity_failed');
    }
    if (ids.has(id) || keys.has(membershipKey) || agencyIds.has(agencyId)) {
      throw new PublicError(409, 'Tenant membership is ambiguous', 'authority_integrity_failed');
    }
    ids.add(id);
    keys.add(membershipKey);
    agencyIds.add(agencyId);
    validated.push(row);
  }
  return validated;
}

async function loadExactActiveAgency(entities: Record<string, any>, agencyId: string) {
  const rows = requireRows(
    await entities.Agency.filter(
      { id: agencyId },
      undefined,
      EXACT_ROW_LIMIT,
      undefined,
      AGENCY_AUTHORITY_FIELDS,
    ),
    'Agency.filter',
  );
  if (rows.length >= EXACT_ROW_LIMIT) {
    throw new PublicError(409, 'Agency is ambiguous', 'authority_integrity_failed');
  }
  if (rows.some((row) => row?.id !== agencyId)) {
    throw new PublicError(409, 'Agency query scope could not be verified', 'authority_integrity_failed');
  }
  if (rows.length === 0 || rows[0].status !== 'active') {
    throw new PublicError(403, 'Agency is unavailable', 'agency_unavailable');
  }
  if (rows.length !== 1 || !exactIdentifier(rows[0].agency_code)) {
    throw new PublicError(409, 'Agency integrity check failed', 'authority_integrity_failed');
  }

  // AgencySettings has no agency_id. Prove the authoritative agency code is
  // unique before using it as the settings join key.
  const codeRows = requireRows(
    await entities.Agency.filter(
      { agency_code: rows[0].agency_code },
      undefined,
      EXACT_ROW_LIMIT,
      undefined,
      AGENCY_AUTHORITY_FIELDS,
    ),
    'Agency.filter',
  );
  if (
    codeRows.length !== 1
    || codeRows[0]?.id !== agencyId
    || codeRows[0]?.agency_code !== rows[0].agency_code
    || codeRows[0]?.status !== 'active'
  ) {
    throw new PublicError(409, 'Agency code is ambiguous', 'authority_integrity_failed');
  }
  return rows[0];
}

async function loadAuthority(
  base44: Record<string, any>,
  agencyId: string,
  expectedSnapshot: Record<string, any> | null = null,
) {
  const user = await base44.auth.me().catch(() => null);
  if (!user) throw new PublicError(401, 'Unauthorized', 'unauthorized');
  if (
    user.is_active === false
    || user.disabled === true
    || user.is_service === true
    || user.is_verified === false
    || user.role !== 'user'
  ) {
    throw new PublicError(403, 'Forbidden', 'forbidden');
  }
  const userId = exactIdentifier(user.id);
  const normalizedEmail = canonicalEmail(user.email);
  if (!userId || !normalizedEmail) throw new PublicError(403, 'Forbidden', 'forbidden');

  const entities = base44.asServiceRole.entities;
  const rawMemberships = requireRows(
    await entities.AgencyMembership.filter(
      { user_id: userId },
      '-updated_date',
      MEMBERSHIP_SCAN_LIMIT,
      undefined,
      MEMBERSHIP_AUTHORITY_FIELDS,
    ),
    'AgencyMembership.filter',
  );
  const memberships = validateMembershipRows(rawMemberships, userId, normalizedEmail);
  const selected = memberships.find(
    (row) => row.agency_id === agencyId && row.status === 'active',
  ) ?? null;
  if (!selected) {
    throw new PublicError(403, 'No active membership for agency', 'no_active_membership');
  }
  if (!OASIS_WRITER_ROLES.has(String(selected.tenant_role || ''))) {
    throw new PublicError(403, 'Tenant role cannot author OASIS responses', 'role_not_allowed');
  }
  const agency = await loadExactActiveAgency(entities, agencyId);
  const snapshot = {
    user: { id: userId, email: normalizedEmail, role: user.role },
    membership: pickFields(selected, MEMBERSHIP_AUTHORITY_FIELDS),
    agency: pickFields(agency, AGENCY_AUTHORITY_FIELDS),
  };
  if (expectedSnapshot && !sameValue(snapshot, expectedSnapshot)) {
    throw new PublicError(409, 'OASIS write authority changed during request', 'authority_changed');
  }
  return {
    agencyId,
    userId,
    normalizedEmail,
    tenantRole: String(selected.tenant_role),
    membership: selected,
    agency,
    snapshot,
  };
}

function validatePatientIntegrity(
  row: Record<string, any>,
  patientId: string,
  authority: Record<string, any>,
) {
  const creatorEmail = canonicalEmail(row.created_by_user_email_normalized);
  const platformCreatorEmail = canonicalEmail(row.created_by);
  const clientRequestId = exactIdentifier(row.client_request_id);
  if (
    row.id !== patientId
    || row.agency_id !== authority.agencyId
    || !exactIdentifier(row.created_by_user_id)
    || !creatorEmail
    || row.created_by_user_email_normalized !== creatorEmail
    || platformCreatorEmail !== creatorEmail
    || row.created_by !== creatorEmail
    || !clientRequestId
    || row.patient_creation_key
      !== `${authority.agencyId}:${row.created_by_user_id}:${clientRequestId}`
    || row.is_sample !== false
    || row.is_archived !== false
    || !VISIBLE_PATIENT_STATUSES.has(String(row.status || ''))
    || !validInstant(row.updated_date)
  ) {
    throw new PublicError(409, 'Patient authority integrity check failed', 'authority_integrity_failed');
  }
  return row;
}

async function loadExactPatient(
  entities: Record<string, any>,
  patientId: string,
  authority: Record<string, any>,
) {
  const rows = requireRows(
    await entities.Patient.filter(
      {
        id: patientId,
        agency_id: authority.agencyId,
        is_sample: false,
        is_archived: false,
      },
      undefined,
      EXACT_ROW_LIMIT,
      undefined,
      PATIENT_AUTHORITY_FIELDS,
    ),
    'Patient.filter',
  );
  if (rows.length >= EXACT_ROW_LIMIT) {
    throw new PublicError(409, 'Patient is ambiguous', 'authority_integrity_failed');
  }
  if (rows.some((row) => (
    row?.id !== patientId
    || row?.agency_id !== authority.agencyId
    || row?.is_sample !== false
    || row?.is_archived !== false
  ))) {
    throw new PublicError(409, 'Patient query scope could not be verified', 'authority_integrity_failed');
  }
  if (rows.length === 0) throw new PublicError(404, 'Patient unavailable', 'patient_unavailable');
  if (rows.length !== 1) {
    throw new PublicError(409, 'Patient is ambiguous', 'authority_integrity_failed');
  }
  return validatePatientIntegrity(rows[0], patientId, authority);
}

function assignmentKey(agencyId: string, patientId: string, userId: string) {
  return `${agencyId}:${patientId}:${userId}`;
}

function validateAssignmentIntegrity(
  row: Record<string, any>,
  patientId: string,
  authority: Record<string, any>,
) {
  const id = exactIdentifier(row?.id);
  const key = assignmentKey(authority.agencyId, patientId, authority.userId);
  const userEmail = canonicalEmail(row?.user_email_normalized);
  const creatorEmail = canonicalEmail(row?.created_by_user_email_normalized);
  const transitionEmail = canonicalEmail(row?.last_transition_by_email_normalized);
  const requestId = exactIdentifier(row?.last_transition_request_id);
  const status = typeof row?.status === 'string' ? row.status : '';
  const action = typeof row?.last_transition_action === 'string'
    ? row.last_transition_action
    : '';
  if (
    !id
    || row.assignment_key !== key
    || row.agency_id !== authority.agencyId
    || row.patient_id !== patientId
    || row.user_id !== authority.userId
    || !userEmail
    || row.user_email_normalized !== userEmail
    || userEmail !== authority.normalizedEmail
    || !authority.membership
    || row.assignee_membership_id !== authority.membership.id
    || row.assignee_membership_version_at_enablement !== authority.membership.version
    || !Number.isSafeInteger(row.assignee_membership_version_at_enablement)
    || row.assignee_membership_version_at_enablement < 1
    || !ASSIGNMENT_STATUSES.has(status)
    || !ASSIGNMENT_SOURCES.has(String(row.source || ''))
    || !exactIdentifier(row.created_by_user_id)
    || !creatorEmail
    || row.created_by_user_email_normalized !== creatorEmail
    || !validInstant(row.activated_at)
    || (row.suspended_at != null && !validInstant(row.suspended_at))
    || (status === 'suspended' && !validInstant(row.suspended_at))
    || (row.revoked_at != null && !validInstant(row.revoked_at))
    || (status === 'revoked' && (
      !validInstant(row.revoked_at) || !boundedReason(row.revocation_reason)
    ))
    || (status !== 'revoked' && (row.revoked_at != null || row.revocation_reason != null))
    || !exactIdentifier(row.last_transition_by_user_id)
    || !transitionEmail
    || row.last_transition_by_email_normalized !== transitionEmail
    || !validInstant(row.last_transition_at)
    || !boundedReason(row.last_transition_reason)
    || !ASSIGNMENT_ACTIONS.has(action)
    || (status === 'active' && action !== 'grant' && action !== 'activate')
    || (status === 'suspended' && action !== 'suspend')
    || (status === 'revoked' && action !== 'revoke')
    || !requestId
    || row.last_transition_request_key !== `${key}:${requestId}`
    || !Number.isSafeInteger(row.version)
    || row.version < 1
  ) {
    throw new PublicError(409, 'Care-team assignment integrity check failed', 'authority_integrity_failed');
  }
  return row;
}

async function loadExactAssignment(
  entities: Record<string, any>,
  patientId: string,
  authority: Record<string, any>,
) {
  const key = assignmentKey(authority.agencyId, patientId, authority.userId);
  const rows = requireRows(
    await entities.PatientCareTeamAssignment.filter(
      {
        assignment_key: key,
        agency_id: authority.agencyId,
        patient_id: patientId,
        user_id: authority.userId,
      },
      '-updated_date',
      EXACT_ROW_LIMIT,
      undefined,
      ASSIGNMENT_AUTHORITY_FIELDS,
    ),
    'PatientCareTeamAssignment.filter',
  );
  if (rows.length >= EXACT_ROW_LIMIT) {
    throw new PublicError(409, 'Care-team assignment is ambiguous', 'authority_integrity_failed');
  }
  if (rows.some((row) => (
    row?.assignment_key !== key
    || row?.agency_id !== authority.agencyId
    || row?.patient_id !== patientId
    || row?.user_id !== authority.userId
  ))) {
    throw new PublicError(409, 'Care-team assignment query scope could not be verified', 'authority_integrity_failed');
  }
  if (rows.length > 1) {
    throw new PublicError(409, 'Care-team assignment is ambiguous', 'authority_integrity_failed');
  }
  return rows.length === 1
    ? validateAssignmentIntegrity(rows[0], patientId, authority)
    : null;
}

function isPatientCreator(row: Record<string, any>, authority: Record<string, any>) {
  return row.created_by_user_id === authority.userId
    && row.created_by_user_email_normalized === authority.normalizedEmail;
}

async function loadPatientAccess(
  entities: Record<string, any>,
  patient: Record<string, any>,
  authority: Record<string, any>,
  expectedSnapshot: Record<string, any> | null = null,
) {
  let snapshot: Record<string, any>;
  if (isPatientCreator(patient, authority)) {
    snapshot = { basis: 'patient_creator', assignment: null };
  } else {
    const assignment = await loadExactAssignment(entities, patient.id, authority);
    if (!assignment || assignment.status !== 'active') {
      if (expectedSnapshot?.basis === 'care_team_assignment') {
        throw new PublicError(409, 'OASIS write authority changed during request', 'authority_changed');
      }
      throw new PublicError(404, 'Patient unavailable', 'patient_unavailable');
    }
    snapshot = {
      basis: 'care_team_assignment',
      assignment: pickFields(assignment, ASSIGNMENT_AUTHORITY_FIELDS),
    };
  }
  if (expectedSnapshot && !sameValue(snapshot, expectedSnapshot)) {
    throw new PublicError(409, 'OASIS write authority changed during request', 'authority_changed');
  }
  return snapshot;
}

function validateVisitIntegrity(
  row: Record<string, any>,
  visitId: string,
  patientId: string,
  authority: Record<string, any>,
) {
  const creatorEmail = canonicalEmail(row.created_by_user_email_normalized);
  const platformCreatorEmail = canonicalEmail(row.created_by);
  if (
    row.id !== visitId
    || row.agency_id !== authority.agencyId
    || row.patient_id !== patientId
    || !exactIdentifier(row.created_by_user_id)
    || !creatorEmail
    || row.created_by_user_email_normalized !== creatorEmail
    || platformCreatorEmail !== creatorEmail
    || row.created_by !== creatorEmail
    || (row.client_request_id != null && !exactIdentifier(row.client_request_id))
    || row.is_sample !== false
    || !validCalendarDate(row.visit_date)
    || !VISIT_TYPES.has(String(row.visit_type || ''))
    || !VISIT_STATUSES.has(String(row.status || ''))
    || !validInstant(row.updated_date)
  ) {
    throw new PublicError(409, 'Visit authority integrity check failed', 'authority_integrity_failed');
  }
  return row;
}

async function loadExactVisit(
  entities: Record<string, any>,
  visitId: string,
  patientId: string,
  authority: Record<string, any>,
) {
  const rows = requireRows(
    await entities.Visit.filter(
      {
        id: visitId,
        agency_id: authority.agencyId,
        patient_id: patientId,
        is_sample: false,
      },
      undefined,
      EXACT_ROW_LIMIT,
      undefined,
      VISIT_AUTHORITY_FIELDS,
    ),
    'Visit.filter',
  );
  if (rows.length >= EXACT_ROW_LIMIT) {
    throw new PublicError(409, 'Visit is ambiguous', 'authority_integrity_failed');
  }
  if (rows.some((row) => (
    row?.id !== visitId
    || row?.agency_id !== authority.agencyId
    || row?.patient_id !== patientId
    || row?.is_sample !== false
  ))) {
    throw new PublicError(409, 'Visit query scope could not be verified', 'authority_integrity_failed');
  }
  if (rows.length === 0) throw new PublicError(404, 'Visit unavailable', 'visit_unavailable');
  if (rows.length !== 1) {
    throw new PublicError(409, 'Visit is ambiguous', 'authority_integrity_failed');
  }
  return validateVisitIntegrity(rows[0], visitId, patientId, authority);
}

async function loadAgencySettings(
  entities: Record<string, any>,
  authority: Record<string, any>,
) {
  const agencyCode = exactIdentifier(authority.agency?.agency_code);
  if (!agencyCode) {
    throw new PublicError(409, 'Agency settings binding is unavailable', 'settings_integrity_failed');
  }
  const rows = requireRows(
    await entities.AgencySettings.filter(
      { agency_code: agencyCode },
      undefined,
      EXACT_ROW_LIMIT,
      undefined,
      SETTINGS_AUTHORITY_FIELDS,
    ),
    'AgencySettings.filter',
  );
  if (rows.length >= EXACT_ROW_LIMIT) {
    throw new PublicError(409, 'Agency settings are ambiguous', 'settings_integrity_failed');
  }
  if (rows.some((row) => row?.agency_code !== agencyCode)) {
    throw new PublicError(409, 'Agency settings query scope could not be verified', 'settings_integrity_failed');
  }
  if (rows.length === 0) {
    throw new PublicError(
      403,
      'CMS-aligned OASIS response entry is not enabled for this agency.',
      'feature_disabled',
    );
  }
  if (
    rows.length !== 1
    || !exactIdentifier(rows[0].id)
    || !validInstant(rows[0].updated_date)
    || (rows[0][OASIS_V2_FLAG_FIELD] !== undefined
      && typeof rows[0][OASIS_V2_FLAG_FIELD] !== 'boolean')
    || (rows[0][OASIS_WRITE_KILL_SWITCH_FIELD] !== undefined
      && typeof rows[0][OASIS_WRITE_KILL_SWITCH_FIELD] !== 'boolean')
  ) {
    throw new PublicError(409, 'Agency settings integrity check failed', 'settings_integrity_failed');
  }
  return rows[0];
}

function enforceSettingsPolicy(settings: Record<string, any>) {
  // Incident containment always wins, including during a snapshot drift.
  if (settings[OASIS_WRITE_KILL_SWITCH_FIELD] === true) {
    throw new PublicError(
      423,
      'OASIS response writes are temporarily disabled for this agency.',
      'write_kill_switch',
    );
  }
  if (settings[OASIS_V2_FLAG_FIELD] !== true) {
    throw new PublicError(
      403,
      'CMS-aligned OASIS response entry is not enabled for this agency.',
      'feature_disabled',
    );
  }
}

function patientSnapshot(row: Record<string, any>) {
  return pickFields(row, PATIENT_AUTHORITY_FIELDS);
}

function visitSnapshot(row: Record<string, any> | null) {
  return row ? pickFields(row, VISIT_AUTHORITY_FIELDS) : null;
}

function settingsSnapshot(row: Record<string, any>) {
  return pickFields(row, SETTINGS_AUTHORITY_FIELDS);
}

async function recheckWriteAccess(
  base44: Record<string, any>,
  entities: Record<string, any>,
  input: Record<string, any>,
  snapshots: Record<string, any>,
) {
  const authority = await loadAuthority(base44, input.agencyId, snapshots.authority);
  const patient = await loadExactPatient(entities, input.patientId, authority);
  if (!sameValue(patientSnapshot(patient), snapshots.patient)) {
    throw new PublicError(409, 'OASIS write authority changed during request', 'authority_changed');
  }
  const access = await loadPatientAccess(entities, patient, authority, snapshots.access);
  let visit = null;
  if (input.visitId) {
    visit = await loadExactVisit(entities, input.visitId, input.patientId, authority);
    if (!sameValue(visitSnapshot(visit), snapshots.visit)) {
      throw new PublicError(409, 'OASIS write authority changed during request', 'authority_changed');
    }
  }
  const settings = await loadAgencySettings(entities, authority);
  enforceSettingsPolicy(settings);
  if (!sameValue(settingsSnapshot(settings), snapshots.settings)) {
    throw new PublicError(409, 'OASIS write controls changed during request', 'settings_changed');
  }
  return { authority, patient, access, visit, settings };
}

function canonicalResponseRows(
  items: Array<Record<string, any>>,
  selectorEmail: string,
  selectedAt: string,
) {
  return items.map((item) => {
    const definitionId = String(item.definition_id);
    const screening = OASIS_V2_SCREENING_IDS.includes(definitionId);
    return {
      definition_id: definitionId,
      item_number: screening ? null : OASIS_V2_ITEM_NUMBERS[definitionId] ?? null,
      item_name: null,
      item_source: screening ? 'pennsync_screening' : 'cms_item',
      item_spec_version: screening ? null : 'oasis-e2',
      response_schema_id: OASIS_RESPONSE_SCHEMA_V2_CMS_E2,
      response_shape: oasisShapeOf(definitionId),
      response_value: item.response_value,
      response_origin: 'clinician_selected',
      selected_by: selectorEmail,
      selected_at: selectedAt,
      ai_suggested: false,
    };
  });
}

function expectedAssessmentRecord(
  input: Record<string, any>,
  authority: Record<string, any>,
  rows: Array<Record<string, any>>,
  nowIso: string,
) {
  return {
    agency_id: authority.agencyId,
    patient_id: input.patientId,
    visit_id: input.visitId,
    visit_type: input.visitType,
    assessment_date: input.assessmentDate,
    oasis_items: rows,
    status: 'draft',
    response_schema_id: OASIS_RESPONSE_SCHEMA_V2_CMS_E2,
    instrument_version: 'oasis-e2',
    response_schema_source: 'final-oasis-e2-all-item-04-01-2026',
    migration_status: 'native_v2',
    last_written_by: authority.normalizedEmail,
    last_written_at: nowIso,
  };
}

function validateWrittenAssessment(
  row: Record<string, any>,
  assessmentId: string,
  expected: Record<string, any>,
) {
  const stored = pickFields(row, Object.keys(expected));
  const createdBy = canonicalEmail(row.created_by);
  if (
    row.id !== assessmentId
    || !createdBy
    || row.created_by !== createdBy
    || !validInstant(row.created_date)
    || !validInstant(row.updated_date)
    || !sameValue(stored, expected)
  ) {
    throw new PublicError(409, 'Created OASIS assessment could not be verified', 'write_verification_failed');
  }
  return row;
}

async function loadExactWrittenAssessment(
  entities: Record<string, any>,
  assessmentId: string,
  expected: Record<string, any>,
) {
  const rows = requireRows(
    await entities.OASISAssessment.filter(
      {
        id: assessmentId,
        agency_id: expected.agency_id,
        patient_id: expected.patient_id,
      },
      undefined,
      EXACT_ROW_LIMIT,
      undefined,
      WRITTEN_ASSESSMENT_FIELDS,
    ),
    'OASISAssessment.filter',
  );
  if (rows.length >= EXACT_ROW_LIMIT) {
    throw new PublicError(409, 'Created OASIS assessment is ambiguous', 'write_verification_failed');
  }
  if (rows.some((row) => (
    row?.id !== assessmentId
    || row?.agency_id !== expected.agency_id
    || row?.patient_id !== expected.patient_id
  ))) {
    throw new PublicError(409, 'Created OASIS assessment scope could not be verified', 'write_verification_failed');
  }
  if (rows.length !== 1) {
    throw new PublicError(409, 'Created OASIS assessment could not be verified', 'write_verification_failed');
  }
  return validateWrittenAssessment(rows[0], assessmentId, expected);
}

function responseScope(
  authority: Record<string, any>,
  patientId: string,
  access: Record<string, any>,
) {
  return {
    agency_id: authority.agencyId,
    patient_id: patientId,
    membership_id: authority.membership.id,
    membership_version: authority.membership.version,
    tenant_role: authority.tenantRole,
    chart_access_basis: access.basis,
  };
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json(
        { error: 'Method not allowed' },
        { status: 405, headers: { ...NO_STORE_HEADERS, Allow: 'POST' } },
      );
    }

    if (OASIS_V2_WRITES_PAUSED) {
      return Response.json(
        {
          error: 'OASIS v2 response writes are temporarily unavailable pending tenant and patient-access security validation.',
          reason: 'tenant_security_validation_pending',
        },
        { status: 503, headers: NO_STORE_HEADERS },
      );
    }

    const input = await parseRequest(req);
    const base44 = createClientFromRequest(req);
    const initialAuthority = await loadAuthority(base44, input.agencyId);
    const entities = base44.asServiceRole.entities;
    const initialPatient = await loadExactPatient(entities, input.patientId, initialAuthority);
    const initialAccess = await loadPatientAccess(entities, initialPatient, initialAuthority);
    const initialVisit = input.visitId
      ? await loadExactVisit(entities, input.visitId, input.patientId, initialAuthority)
      : null;
    const initialSettings = await loadAgencySettings(entities, initialAuthority);
    enforceSettingsPolicy(initialSettings);

    const snapshots = {
      authority: initialAuthority.snapshot,
      patient: patientSnapshot(initialPatient),
      access: initialAccess,
      visit: visitSnapshot(initialVisit),
      settings: settingsSnapshot(initialSettings),
    };

    // Re-establish every mutable authority edge immediately before mutation.
    const prewrite = await recheckWriteAccess(base44, entities, input, snapshots);
    const nowIso = new Date().toISOString();
    const canonicalRows = canonicalResponseRows(
      input.items,
      prewrite.authority.normalizedEmail,
      nowIso,
    );
    const validation = validateOasisResponseWrite({
      assessment_date: input.assessmentDate,
      visit_type: input.visitType,
      oasis_items: canonicalRows,
    });
    if (!validation.ok) {
      throw new PublicError(
        422,
        'One or more responses were rejected. No data was saved.',
        'validation_failed',
        validation.errors,
      );
    }
    const record = expectedAssessmentRecord(input, prewrite.authority, canonicalRows, nowIso);
    const created = await entities.OASISAssessment.create(record);
    const assessmentId = exactIdentifier(created?.id);
    if (!assessmentId) {
      throw new PublicError(409, 'Created OASIS assessment could not be verified', 'write_verification_failed');
    }

    const firstReadback = await loadExactWrittenAssessment(entities, assessmentId, record);
    const postwrite = await recheckWriteAccess(base44, entities, input, snapshots);
    const finalReadback = await loadExactWrittenAssessment(entities, assessmentId, record);
    if (!sameValue(
      pickFields(firstReadback, WRITTEN_ASSESSMENT_FIELDS),
      pickFields(finalReadback, WRITTEN_ASSESSMENT_FIELDS),
    )) {
      throw new PublicError(409, 'Created OASIS assessment changed during request', 'write_verification_failed');
    }

    return Response.json(
      {
        ok: true,
        operation: 'create_draft',
        assessment: {
          id: assessmentId,
          patient_id: record.patient_id,
          visit_id: record.visit_id,
          visit_type: record.visit_type,
          assessment_date: record.assessment_date,
          status: 'draft',
          response_schema_id: record.response_schema_id,
          instrument_version: record.instrument_version,
          migration_status: record.migration_status,
        },
        written: canonicalRows.length,
        scope: responseScope(postwrite.authority, input.patientId, postwrite.access),
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    if (error instanceof PublicError) {
      return Response.json(
        {
          error: error.message,
          reason: error.reason,
          ...(error.errors ? { errors: error.errors } : {}),
        },
        { status: error.status, headers: NO_STORE_HEADERS },
      );
    }
    // Provider failures can contain predicates or PHI; never return them.
    console.error('saveOasisResponses failed');
    return Response.json(
      { error: 'Internal server error' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
});
