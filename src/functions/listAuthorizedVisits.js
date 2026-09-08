import { base44 } from '@/api/base44Client';

const MAX_IDENTIFIER_LENGTH = 200;
const CURSOR_VERSION = 1;
const PAGE_SORT = 'id_asc';
const VISIT_TYPES = new Set([
  'skilled_nursing', 'admission', 'recertification', 'discharge', 'routine_visit', 'prn',
]);
const VISIT_STATUSES = new Set([
  'scheduled', 'in_progress', 'completed', 'pending_review', 'cancelled',
]);
const PURPOSE_FIELDS = Object.freeze({
  schedule: new Set([
    'id', 'patient_id', 'visit_date', 'visit_time', 'visit_type', 'status',
    'start_time', 'end_time', 'updated_date',
  ]),
  compliance_review: new Set([
    'id', 'patient_id', 'visit_date', 'visit_type', 'status', 'compliance_score',
    'grounding_pending', 'updated_date',
  ]),
  activity: new Set([
    'id', 'patient_id', 'visit_date', 'visit_type', 'status', 'created_date',
    'updated_date',
  ]),
  documentation: new Set([
    'id', 'patient_id', 'visit_date', 'visit_time', 'visit_type', 'status',
    'nurse_notes', 'raw_transcription', 'vital_signs', 'documentation_source',
    'grounding_pending', 'updated_date',
  ]),
  vitals_trend: new Set([
    'id', 'patient_id', 'visit_date', 'visit_type', 'status', 'vital_signs',
    'updated_date',
  ]),
  operations_analytics: new Set([
    'id', 'patient_id', 'visit_date', 'visit_type', 'status', 'start_time',
    'end_time', 'created_by', 'created_date', 'updated_date',
  ]),
  reporting: new Set([
    'id', 'patient_id', 'visit_date', 'visit_type', 'status', 'start_time',
    'end_time', 'nurse_notes', 'vital_signs', 'created_by', 'created_date',
    'updated_date',
  ]),
  data_quality: new Set([
    'id', 'patient_id', 'visit_date', 'visit_type', 'status', 'nurse_notes',
    'vital_signs', 'homebound_justification', 'updated_date',
  ]),
  compliance_monitoring: new Set([
    'id', 'patient_id', 'visit_date', 'visit_type', 'status', 'nurse_notes',
    'compliance_score', 'compliance_issues', 'homebound_status_verified',
    'skilled_intervention_documented', 'homebound_justification',
    'grounding_pending', 'created_by', 'updated_date',
  ]),
  ai_tagging: new Set([
    'id', 'patient_id', 'visit_date', 'visit_type', 'status', 'nurse_notes',
    'ai_tags', 'updated_date',
  ]),
  hospitalization_risk: new Set([
    'id', 'patient_id', 'visit_date', 'visit_type', 'status', 'nurse_notes',
    'vital_signs', 'updated_date',
  ]),
  clinical_insights: new Set([
    'id', 'patient_id', 'visit_date', 'visit_type', 'status', 'vital_signs',
    'created_by', 'updated_date',
  ]),
  deduplication: new Set([
    'id', 'patient_id', 'visit_date', 'visit_type', 'status', 'created_by',
    'created_date', 'updated_date',
  ]),
});
export const AUTHORIZED_VISIT_LIST_PURPOSES = Object.freeze(Object.keys(PURPOSE_FIELDS));
export function isAuthorizedVisitListPurpose(value) {
  return typeof value === 'string' && Object.hasOwn(PURPOSE_FIELDS, value);
}
const PURPOSE_MAX_PAGE_SIZE = Object.freeze({
  schedule: 50,
  compliance_review: 25,
  activity: 50,
  documentation: 25,
  vitals_trend: 50,
  operations_analytics: 50,
  reporting: 25,
  data_quality: 25,
  compliance_monitoring: 25,
  ai_tagging: 25,
  hospitalization_risk: 25,
  clinical_insights: 50,
  deduplication: 25,
});
export function authorizedVisitListPageSize(purpose) {
  return PURPOSE_MAX_PAGE_SIZE[purpose] ?? null;
}

export function isAuthorizedVisitListSort(purpose, sort) {
  if (!isAuthorizedVisitListPurpose(purpose)) return false;
  if (sort === null || sort === undefined) return true;
  if (typeof sort !== 'string' || sort.length === 0 || sort.startsWith('--')) return false;
  return PURPOSE_FIELDS[purpose].has(sort.replace(/^-/, ''));
}
const PURPOSE_ROLES = Object.freeze({
  schedule: new Set(['platform_owner', 'agency_admin', 'manager', 'clinician']),
  compliance_review: new Set(['platform_owner', 'agency_admin', 'manager', 'clinician']),
  activity: new Set(['platform_owner', 'agency_admin', 'manager', 'clinician']),
  documentation: new Set(['platform_owner', 'agency_admin', 'manager', 'clinician']),
  vitals_trend: new Set(['platform_owner', 'agency_admin', 'manager', 'clinician']),
  operations_analytics: new Set(['platform_owner', 'agency_admin', 'manager', 'clinician']),
  reporting: new Set(['platform_owner', 'agency_admin', 'manager', 'clinician']),
  data_quality: new Set(['platform_owner', 'agency_admin', 'manager', 'clinician']),
  compliance_monitoring: new Set(['platform_owner', 'agency_admin', 'manager', 'clinician']),
  ai_tagging: new Set(['platform_owner', 'agency_admin', 'manager', 'clinician']),
  hospitalization_risk: new Set(['platform_owner', 'agency_admin', 'manager', 'clinician']),
  clinical_insights: new Set(['platform_owner', 'agency_admin', 'manager', 'clinician']),
  deduplication: new Set(['platform_owner', 'agency_admin', 'manager', 'clinician']),
});
const CURSOR_KEYS = [
  'version',
  'after_id',
  'agency_id',
  'patient_id',
  'purpose',
  'status',
  'sort',
  'page_size',
  'subject_user_id',
  'membership_id',
  'membership_version',
  'tenant_role',
  'access_basis',
  'assignment_id',
  'assignment_version',
];

function exactIdentifier(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_IDENTIFIER_LENGTH
    && value.trim() === value
    && !value.startsWith('$');
}

function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function validCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validProjectedField(field, value) {
  if (field === 'id' || field === 'patient_id') return exactIdentifier(value);
  if (field === 'visit_date') return validCalendarDate(value);
  if (field === 'visit_type') return VISIT_TYPES.has(value);
  if (field === 'status') return VISIT_STATUSES.has(value);
  if (field === 'updated_date' || field === 'created_date') {
    return typeof value === 'string' && Number.isFinite(Date.parse(value));
  }
  if (field === 'created_by') {
    return typeof value === 'string'
      && value.length <= 320
      && value.includes('@')
      && value.trim() === value
      && value.toLowerCase() === value;
  }
  if (['visit_time', 'start_time', 'end_time'].includes(field)) {
    return typeof value === 'string' && value.length <= 100;
  }
  if (field === 'compliance_score') {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
  }
  if (field === 'grounding_pending') return typeof value === 'boolean';
  if (
    field === 'homebound_status_verified'
    || field === 'skilled_intervention_documented'
  ) return typeof value === 'boolean';
  if (field === 'nurse_notes' || field === 'raw_transcription') {
    return typeof value === 'string' && value.length <= 250_000;
  }
  if (field === 'homebound_justification') {
    return typeof value === 'string' && value.length <= 20_000;
  }
  if (field === 'vital_signs') {
    return value && typeof value === 'object' && !Array.isArray(value)
      && Object.keys(value).every((key) => [
        'temperature', 'blood_pressure_systolic', 'blood_pressure_diastolic',
        'heart_rate', 'respiratory_rate', 'oxygen_saturation', 'pain_level', 'weight',
      ].includes(key))
      && Object.values(value).every((item) => (
        typeof item === 'number' && Number.isFinite(item) && Math.abs(item) <= 1_000_000
      ));
  }
  if (field === 'documentation_source') {
    return ['smart_note', 'audio', 'manual'].includes(value);
  }
  if (field === 'compliance_issues') {
    return Array.isArray(value) && value.length <= 100
      && value.every((item) => typeof item === 'string' && item.length <= 2_000);
  }
  if (field === 'ai_tags') {
    return Array.isArray(value) && value.length <= 64
      && value.every((item) => typeof item === 'string' && item.length <= 128);
  }
  return false;
}

function validVisits(visits, purpose, maximumCount, afterId, patientId) {
  if (!Array.isArray(visits) || visits.length > maximumCount) return false;
  const fields = PURPOSE_FIELDS[purpose];
  const required = ['id', 'patient_id', 'visit_date', 'visit_type', 'status', 'updated_date'];
  let previousId = afterId;
  return visits.every((visit) => {
    if (!visit || typeof visit !== 'object' || Array.isArray(visit)) return false;
    const keys = Object.keys(visit);
    if (
      !required.every((field) => Object.hasOwn(visit, field))
      || keys.some((field) => !fields.has(field) || !validProjectedField(field, visit[field]))
      || (patientId !== null && visit.patient_id !== patientId)
      || (previousId !== null && visit.id <= previousId)
    ) {
      return false;
    }
    previousId = visit.id;
    return true;
  });
}

function validScope(scope, context) {
  if (
    !exactKeys(scope, [
      'agency_id',
      'membership_id',
      'membership_version',
      'tenant_role',
      'patient_id',
      'access_basis',
      'assignment_id',
      'assignment_version',
    ])
    || scope.agency_id !== context.agency_id
    || scope.patient_id !== context.patient_id
    || !PURPOSE_ROLES[context.purpose]?.has(scope.tenant_role)
  ) {
    return false;
  }
  if (scope.tenant_role === 'platform_owner') {
    return scope.membership_id === null
      && scope.membership_version === null
      && scope.access_basis === 'agency_wide'
      && scope.assignment_id === null
      && scope.assignment_version === null;
  }
  if (
    !exactIdentifier(scope.membership_id)
    || !Number.isSafeInteger(scope.membership_version)
    || scope.membership_version < 1
  ) {
    return false;
  }
  if (scope.tenant_role === 'clinician') {
    return exactIdentifier(scope.patient_id)
      && scope.access_basis === 'care_team_assignment'
      && exactIdentifier(scope.assignment_id)
      && Number.isSafeInteger(scope.assignment_version)
      && scope.assignment_version >= 1;
  }
  return (scope.tenant_role === 'agency_admin' || scope.tenant_role === 'manager')
    && scope.access_basis === 'agency_wide'
    && scope.assignment_id === null
    && scope.assignment_version === null;
}

// The cursor is an unsigned context echo, never an authorization credential.
// The server re-resolves the user, membership, agency, patient, and assignment.
function validCursor(cursor, context, scope = null) {
  if (!exactKeys(cursor, CURSOR_KEYS)) return false;
  if (
    cursor.version !== CURSOR_VERSION
    || !exactIdentifier(cursor.after_id)
    || cursor.agency_id !== context.agency_id
    || cursor.patient_id !== context.patient_id
    || cursor.purpose !== context.purpose
    || cursor.status !== context.status
    || cursor.sort !== PAGE_SORT
    || cursor.page_size !== context.page_size
    || !exactIdentifier(cursor.subject_user_id)
    || !PURPOSE_ROLES[context.purpose]?.has(cursor.tenant_role)
  ) {
    return false;
  }
  if (cursor.tenant_role === 'platform_owner') {
    if (cursor.membership_id !== null || cursor.membership_version !== null) return false;
  } else if (
    !exactIdentifier(cursor.membership_id)
    || !Number.isSafeInteger(cursor.membership_version)
    || cursor.membership_version < 1
  ) {
    return false;
  }
  if (cursor.tenant_role === 'clinician') {
    if (
      !exactIdentifier(cursor.patient_id)
      || cursor.access_basis !== 'care_team_assignment'
      || !exactIdentifier(cursor.assignment_id)
      || !Number.isSafeInteger(cursor.assignment_version)
      || cursor.assignment_version < 1
    ) {
      return false;
    }
  } else if (
    cursor.access_basis !== 'agency_wide'
    || cursor.assignment_id !== null
    || cursor.assignment_version !== null
  ) {
    return false;
  }
  return scope === null || (
    cursor.membership_id === scope.membership_id
    && cursor.membership_version === scope.membership_version
    && cursor.tenant_role === scope.tenant_role
    && cursor.access_basis === scope.access_basis
    && cursor.assignment_id === scope.assignment_id
    && cursor.assignment_version === scope.assignment_version
  );
}

function validPage(page, payload, visits, scope) {
  if (!exactKeys(page, ['page_size', 'sort', 'after_id', 'has_more', 'next_cursor'])) {
    return false;
  }
  const expectedAfterId = payload.cursor?.after_id ?? null;
  if (
    page.page_size !== payload.page_size
    || page.sort !== PAGE_SORT
    || page.after_id !== expectedAfterId
    || typeof page.has_more !== 'boolean'
  ) {
    return false;
  }
  if (!page.has_more) return page.next_cursor === null;
  if (
    visits.length !== payload.page_size
    || page.next_cursor?.after_id !== visits[visits.length - 1]?.id
  ) {
    return false;
  }
  return validCursor(page.next_cursor, {
    agency_id: payload.agency_id,
    patient_id: payload.patient_id ?? null,
    purpose: payload.purpose,
    status: payload.status ?? null,
    sort: PAGE_SORT,
    page_size: payload.page_size,
  }, scope);
}

export async function listAuthorizedVisits(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('Visit list options must be an object');
  }
  const allowed = [
    'agencyId', 'patientId', 'purpose', 'status', 'sort', 'pageSize', 'cursor',
  ];
  if (Object.keys(options).some((key) => !allowed.includes(key))) {
    throw new Error('Visit list contains unsupported options');
  }
  const {
    agencyId,
    patientId = null,
    purpose,
    status = null,
    sort = PAGE_SORT,
    pageSize = 25,
    cursor = null,
  } = options;
  if (!exactIdentifier(agencyId)) throw new Error('agencyId is required');
  if (patientId !== null && !exactIdentifier(patientId)) throw new Error('patientId is invalid');
  if (!Object.hasOwn(PURPOSE_FIELDS, purpose)) throw new Error('purpose is required');
  if (status !== null && !VISIT_STATUSES.has(status)) throw new Error('status is invalid');
  if (sort !== PAGE_SORT) throw new Error('sort is invalid');
  if (
    !Number.isSafeInteger(pageSize)
    || pageSize < 1
    || pageSize > PURPOSE_MAX_PAGE_SIZE[purpose]
  ) {
    throw new Error('pageSize is invalid');
  }
  const payload = {
    agency_id: agencyId,
    ...(patientId === null ? {} : { patient_id: patientId }),
    purpose,
    ...(status === null ? {} : { status }),
    sort,
    page_size: pageSize,
    cursor,
  };
  const context = {
    agency_id: agencyId,
    patient_id: patientId,
    purpose,
    status,
    sort,
    page_size: pageSize,
  };
  if (cursor !== null && !validCursor(cursor, context)) throw new Error('cursor is invalid');

  const response = await base44.functions.invoke('listAuthorizedVisits', payload);
  const result = response?.data ?? response;
  if (
    !exactKeys(result, ['success', 'purpose', 'visits', 'scope', 'page'])
    || result.success !== true
    || result.purpose !== purpose
    || !validScope(result.scope, context)
    || (cursor !== null && !validCursor(cursor, context, result.scope))
    || !validVisits(result.visits, purpose, pageSize, cursor?.after_id ?? null, patientId)
    || !validPage(result.page, payload, result.visits, result.scope)
  ) {
    throw new Error(result?.error || 'Visit list failed');
  }
  return result;
}

const MAX_AUTHORIZED_VISITS = 10_000;

function compareVisits(sort) {
  if (!sort) return null;
  const descending = sort.startsWith('-');
  const field = descending ? sort.slice(1) : sort;
  return (left, right) => {
    const leftValue = left?.[field];
    const rightValue = right?.[field];
    if (leftValue == null && rightValue == null) {
      return String(left?.id || '').localeCompare(String(right?.id || ''));
    }
    if (leftValue == null) return 1;
    if (rightValue == null) return -1;
    const compared = String(leftValue).localeCompare(String(rightValue), undefined, {
      numeric: true,
      sensitivity: 'base',
    });
    if (compared !== 0) return descending ? -compared : compared;
    return String(left?.id || '').localeCompare(String(right?.id || ''));
  };
}

function sameTenantScope(scope, expectedScope) {
  if (!expectedScope) return true;
  return scope?.agency_id === expectedScope.agency_id
    && scope?.membership_id === expectedScope.membership_id
    && scope?.membership_version === expectedScope.membership_version
    && scope?.tenant_role === expectedScope.tenant_role;
}

/**
 * Collect reviewed keyset pages for a UI surface, then apply a projection-safe
 * display sort and cap. Arbitrary entity filters and field selection are not
 * accepted: patientId and status are the complete filter vocabulary.
 */
export async function collectAuthorizedVisits(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('Authorized Visit collection options must be an object');
  }
  const allowed = [
    'agencyId', 'patientId', 'purpose', 'status', 'sort', 'limit', 'expectedScope',
  ];
  if (Object.keys(options).some((key) => !allowed.includes(key))) {
    throw new Error('Authorized Visit collection contains unsupported options');
  }
  const {
    agencyId,
    patientId = null,
    purpose,
    status = null,
    sort = '-visit_date',
    limit = 500,
    expectedScope = null,
  } = options;
  if (!exactIdentifier(agencyId)) throw new Error('agencyId is required');
  if (patientId !== null && !exactIdentifier(patientId)) throw new Error('patientId is invalid');
  if (!isAuthorizedVisitListPurpose(purpose)) throw new Error('purpose is required');
  if (status !== null && !VISIT_STATUSES.has(status)) throw new Error('status is invalid');
  const sortField = sort ? sort.replace(/^-/, '') : null;
  if (sortField && !PURPOSE_FIELDS[purpose].has(sortField)) {
    throw new Error('sort is invalid for purpose');
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_AUTHORIZED_VISITS) {
    throw new Error('limit is invalid');
  }

  const rows = [];
  const seenIds = new Set();
  let cursor = null;
  const pageSize = PURPOSE_MAX_PAGE_SIZE[purpose];
  while (true) {
    const result = await listAuthorizedVisits({
      agencyId,
      patientId,
      purpose,
      status,
      sort: PAGE_SORT,
      pageSize,
      cursor,
    });
    if (!sameTenantScope(result.scope, expectedScope)) {
      throw new Error('Visit list authority changed during collection');
    }
    for (const visit of result.visits) {
      if (seenIds.has(visit.id)) {
        throw new Error('Visit list returned a duplicate keyset row');
      }
      seenIds.add(visit.id);
      rows.push(visit);
    }
    if (!result.page.has_more) break;
    if (rows.length >= MAX_AUTHORIZED_VISITS) {
      throw new Error('Visit list exceeds the reviewed UI read limit');
    }
    cursor = result.page.next_cursor;
  }

  const comparator = compareVisits(sort);
  const ordered = comparator ? [...rows].sort(comparator) : rows;
  return ordered.slice(0, limit);
}
