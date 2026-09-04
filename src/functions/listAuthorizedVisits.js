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
});
const PURPOSE_MAX_PAGE_SIZE = Object.freeze({
  schedule: 50,
  compliance_review: 25,
});
const PURPOSE_ROLES = Object.freeze({
  schedule: new Set(['platform_owner', 'agency_admin', 'manager', 'clinician']),
  compliance_review: new Set(['platform_owner', 'agency_admin', 'manager', 'clinician']),
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
  if (field === 'updated_date') {
    return typeof value === 'string' && Number.isFinite(Date.parse(value));
  }
  if (['visit_time', 'start_time', 'end_time'].includes(field)) {
    return typeof value === 'string' && value.length <= 100;
  }
  if (field === 'compliance_score') {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
  }
  if (field === 'grounding_pending') return typeof value === 'boolean';
  return false;
}

function validVisits(visits, purpose, maximumCount, afterId) {
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
    || !validVisits(result.visits, purpose, pageSize, cursor?.after_id ?? null)
    || !validPage(result.page, payload, result.visits, result.scope)
  ) {
    throw new Error(result?.error || 'Visit list failed');
  }
  return result;
}
