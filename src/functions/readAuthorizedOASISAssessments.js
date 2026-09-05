import { base44 } from '@/api/base44Client';

const MAX_IDENTIFIER_LENGTH = 200;
const MAX_TEXT_LENGTH = 300;
const MAX_CODE_LENGTH = 100;
const DEFAULT_LIST_LIMIT = 10;
const MAX_LIST_LIMIT = 25;
const MAX_OASIS_ITEMS = 500;
const MAX_MULTI_SELECT_CODES = 100;
const MAX_GRID_ROWS = 500;
const VISIT_TYPES = new Set([
  'Start of Care',
  'Resumption of Care',
  'Recertification',
  'Discharge',
  'Transfer',
]);
const STATUSES = new Set(['draft', 'in_progress', 'completed', 'submitted']);
const RESPONSE_SCHEMAS = new Set([
  'pennsync-oasis-response-v1-legacy',
  'pennsync-oasis-response-v2-cms-e2',
]);
const MIGRATION_STATUSES = new Set([
  'native_v2',
  'legacy_unconverted',
  'legacy_provenance_annotated',
]);
const VERIFIED_RESPONSE_SCHEMA = 'pennsync-oasis-response-v2-cms-e2';
const VERIFIED_INSTRUMENT = 'oasis-e2';
const VERIFIED_SCHEMA_SOURCE = 'final-oasis-e2-all-item-04-01-2026';
const RESPONSE_SHAPES = new Set(['single', 'multi_select', 'matrix_choice', 'grid']);
const SUMMARY_KEYS = [
  'id',
  'patient_id',
  'visit_id',
  'visit_type',
  'assessment_date',
  'status',
  'completion_percentage',
  'response_schema_id',
  'instrument_version',
  'migration_status',
  'created_date',
  'updated_date',
];
const VERIFIED_KEYS = [
  ...SUMMARY_KEYS,
  'response_schema_source',
  'last_written_by',
  'last_written_at',
  'oasis_items',
];
const VERIFIED_ITEM_KEYS = [
  'definition_id',
  'item_number',
  'item_name',
  'item_source',
  'item_spec_version',
  'response_schema_id',
  'response_shape',
  'response_value',
  'response_origin',
  'selected_by',
  'selected_at',
  'ai_suggested',
];
const SCOPE_KEYS = [
  'agency_id',
  'patient_id',
  'membership_id',
  'membership_version',
  'tenant_role',
  'chart_access_basis',
];

function exactIdentifier(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_IDENTIFIER_LENGTH
    && value.trim() === value
    && !value.startsWith('$');
}

function canonicalEmail(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized
    && normalized.length <= 320
    && normalized.includes('@')
    && !/\s/.test(normalized)
    ? normalized
    : null;
}

function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function validInstant(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validCode(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_CODE_LENGTH
    && value.trim() === value;
}

function validResponseValue(shape, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (shape === 'single' || shape === 'matrix_choice') {
    return exactKeys(value, ['code']) && validCode(value.code);
  }
  if (shape === 'multi_select') {
    return exactKeys(value, ['codes'])
      && Array.isArray(value.codes)
      && value.codes.length >= 1
      && value.codes.length <= MAX_MULTI_SELECT_CODES
      && value.codes.every(validCode)
      && new Set(value.codes).size === value.codes.length;
  }
  if (shape === 'grid') {
    if (
      !exactKeys(value, ['rows'])
      || !Array.isArray(value.rows)
      || value.rows.length < 1
      || value.rows.length > MAX_GRID_ROWS
    ) {
      return false;
    }
    const ids = new Set();
    for (const row of value.rows) {
      if (
        !exactKeys(row, ['row_id', 'code'])
        || !exactIdentifier(row.row_id)
        || !validCode(row.code)
        || ids.has(row.row_id)
      ) {
        return false;
      }
      ids.add(row.row_id);
    }
    return true;
  }
  return false;
}

function validSummary(assessment, patientId) {
  if (!exactKeys(assessment, SUMMARY_KEYS)) return false;
  return exactIdentifier(assessment.id)
    && assessment.patient_id === patientId
    && (assessment.visit_id === null || exactIdentifier(assessment.visit_id))
    && VISIT_TYPES.has(assessment.visit_type)
    && validCalendarDate(assessment.assessment_date)
    && STATUSES.has(assessment.status)
    && (assessment.completion_percentage === null || (
      typeof assessment.completion_percentage === 'number'
      && Number.isFinite(assessment.completion_percentage)
      && assessment.completion_percentage >= 0
      && assessment.completion_percentage <= 100
    ))
    && (assessment.response_schema_id === null
      || RESPONSE_SCHEMAS.has(assessment.response_schema_id))
    && (assessment.instrument_version === null
      || assessment.instrument_version === VERIFIED_INSTRUMENT)
    && (assessment.migration_status === null
      || MIGRATION_STATUSES.has(assessment.migration_status))
    && validInstant(assessment.created_date)
    && validInstant(assessment.updated_date);
}

function validVerifiedItem(item, lastWriter, lastWrittenAt, seenDefinitions, seenItems) {
  if (!exactKeys(item, VERIFIED_ITEM_KEYS)) return false;
  const selectedBy = canonicalEmail(item.selected_by);
  const itemNumber = item.item_number;
  const normalizedItem = typeof itemNumber === 'string'
    ? itemNumber.toLowerCase().replace(/[^a-z0-9]/g, '')
    : '';
  if (
    !exactIdentifier(item.definition_id)
    || (item.item_source !== 'cms_item' && item.item_source !== 'pennsync_screening')
    || (item.item_source === 'cms_item' && (
      !exactIdentifier(itemNumber) || item.item_spec_version !== VERIFIED_INSTRUMENT
    ))
    || (item.item_source === 'pennsync_screening' && (
      itemNumber !== null || item.item_spec_version !== null
    ))
    || (item.item_name !== null && (
      typeof item.item_name !== 'string'
      || item.item_name.length > MAX_TEXT_LENGTH
      || item.item_name.trim() !== item.item_name
    ))
    || item.response_schema_id !== VERIFIED_RESPONSE_SCHEMA
    || !RESPONSE_SHAPES.has(item.response_shape)
    || !validResponseValue(item.response_shape, item.response_value)
    || item.response_origin !== 'clinician_selected'
    || !selectedBy
    || item.selected_by !== selectedBy
    || selectedBy !== lastWriter
    || !validInstant(item.selected_at)
    || Date.parse(item.selected_at) > Date.parse(lastWrittenAt)
    || item.ai_suggested !== false
    || seenDefinitions.has(item.definition_id)
    || (normalizedItem && seenItems.has(normalizedItem))
  ) {
    return false;
  }
  seenDefinitions.add(item.definition_id);
  if (normalizedItem) seenItems.add(normalizedItem);
  return true;
}

function validAssessment(assessment, patientId, purpose) {
  if (purpose === 'summary') return validSummary(assessment, patientId);
  if (!exactKeys(assessment, VERIFIED_KEYS)) return false;
  const summary = Object.fromEntries(SUMMARY_KEYS.map((key) => [key, assessment[key]]));
  const lastWriter = canonicalEmail(assessment.last_written_by);
  if (
    !validSummary(summary, patientId)
    || assessment.response_schema_id !== VERIFIED_RESPONSE_SCHEMA
    || assessment.instrument_version !== VERIFIED_INSTRUMENT
    || assessment.migration_status !== 'native_v2'
    || assessment.response_schema_source !== VERIFIED_SCHEMA_SOURCE
    || !lastWriter
    || assessment.last_written_by !== lastWriter
    || !validInstant(assessment.last_written_at)
    || !Array.isArray(assessment.oasis_items)
    || assessment.oasis_items.length > MAX_OASIS_ITEMS
  ) {
    return false;
  }
  const seenDefinitions = new Set();
  const seenItems = new Set();
  return assessment.oasis_items.every((item) => validVerifiedItem(
    item,
    lastWriter,
    assessment.last_written_at,
    seenDefinitions,
    seenItems,
  ));
}

function validScope(scope, agencyId, patientId) {
  if (
    !exactKeys(scope, SCOPE_KEYS)
    || scope.agency_id !== agencyId
    || scope.patient_id !== patientId
  ) {
    return false;
  }
  if (scope.tenant_role === 'platform_owner') {
    return scope.membership_id === null
      && scope.membership_version === null
      && scope.chart_access_basis === 'agency_wide';
  }
  if (
    !['agency_admin', 'manager', 'clinician'].includes(scope.tenant_role)
    || !exactIdentifier(scope.membership_id)
    || !Number.isSafeInteger(scope.membership_version)
    || scope.membership_version < 1
  ) {
    return false;
  }
  if (scope.tenant_role === 'agency_admin' || scope.tenant_role === 'manager') {
    return scope.chart_access_basis === 'agency_wide';
  }
  return scope.chart_access_basis === 'patient_creator'
    || scope.chart_access_basis === 'care_team_assignment';
}

function validateOptions(options, allowed) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('OASIS read options must be an object');
  }
  if (Object.keys(options).some((key) => !allowed.includes(key))) {
    throw new Error('OASIS read contains unsupported options');
  }
  if (!exactIdentifier(options.agencyId)) throw new Error('agencyId is required');
  if (!exactIdentifier(options.patientId)) throw new Error('patientId is required');
}

async function invokeOASISReadBroker(payload) {
  return base44.functions.invoke('readAuthorizedOASISAssessments', payload);
}

/**
 * Exact OASISAssessment retrieval through the tenant and chart read broker.
 * This source-only wrapper is intentionally not imported by a UI component.
 */
export async function getAuthorizedOASISAssessment(options = {}) {
  validateOptions(options, ['agencyId', 'patientId', 'assessmentId', 'purpose']);
  const { agencyId, patientId, assessmentId, purpose } = options;
  if (!exactIdentifier(assessmentId)) throw new Error('assessmentId is required');
  if (purpose !== 'summary' && purpose !== 'verified_responses') {
    throw new Error('purpose is required');
  }
  const response = await invokeOASISReadBroker({
    operation: 'get',
    agency_id: agencyId,
    patient_id: patientId,
    assessment_id: assessmentId,
    purpose,
  });
  const result = response?.data ?? response;
  if (
    !exactKeys(result, ['success', 'operation', 'purpose', 'assessment', 'scope'])
    || result.success !== true
    || result.operation !== 'get'
    || result.purpose !== purpose
    || !validAssessment(result.assessment, patientId, purpose)
    || result.assessment.id !== assessmentId
    || !validScope(result.scope, agencyId, patientId)
  ) {
    throw new Error(result?.error || 'OASIS assessment lookup failed');
  }
  return result;
}

/**
 * Bounded newest-first OASISAssessment metadata retrieval. Response-bearing
 * list reads are deliberately unavailable; callers must exact-read one row.
 */
export async function listAuthorizedOASISAssessments(options = {}) {
  validateOptions(options, ['agencyId', 'patientId', 'purpose', 'limit']);
  const {
    agencyId,
    patientId,
    purpose,
    limit = DEFAULT_LIST_LIMIT,
  } = options;
  if (purpose !== 'summary') throw new Error('purpose must be summary');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
    throw new Error('limit is invalid');
  }
  const response = await invokeOASISReadBroker({
    operation: 'list',
    agency_id: agencyId,
    patient_id: patientId,
    purpose: 'summary',
    limit,
  });
  const result = response?.data ?? response;
  if (
    !exactKeys(result, [
      'success', 'operation', 'purpose', 'assessments', 'page', 'scope',
    ])
    || result.success !== true
    || result.operation !== 'list'
    || result.purpose !== 'summary'
    || !Array.isArray(result.assessments)
    || result.assessments.length > limit
    || !result.assessments.every((row) => validSummary(row, patientId))
    || new Set(result.assessments.map((row) => row.id)).size !== result.assessments.length
    || result.assessments.some((row, index) => (
      index > 0 && row.assessment_date > result.assessments[index - 1].assessment_date
    ))
    || !exactKeys(result.page, ['limit', 'returned', 'has_more'])
    || result.page.limit !== limit
    || result.page.returned !== result.assessments.length
    || typeof result.page.has_more !== 'boolean'
    || !validScope(result.scope, agencyId, patientId)
  ) {
    throw new Error(result?.error || 'OASIS assessment list failed');
  }
  return result;
}
