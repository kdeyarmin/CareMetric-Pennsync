import { base44 } from '@/api/base44Client';

const MAX_IDENTIFIER_LENGTH = 200;
const MAX_LIST_LIMIT = 5000;
const STATUSES = new Set([
  'new', 'pending', 'processing', 'awaiting_info', 'active', 'declined',
  'ready_for_admission', 'soc_completed',
]);
const INTAKE_ROLES = new Set(['agency_admin', 'manager', 'office_staff']);
const REFERRAL_RESPONSE_FIELDS = new Set([
  'id', 'agency_id', 'version', 'created_date', 'updated_date',
  'patient_name', 'patient_id', 'patient_dob', 'diagnosis', 'referral_source',
  'referral_date', 'estimated_start_date', 'document_type', 'priority', 'status',
  'soc_date', 'first_visit_date', 'document_url', 'processed_document_url',
  'page_range', 'detection_confidence', 'manually_confirmed',
  'requires_manual_review', 'assigned_to', 'match_confidence', 'match_factors',
  'match_suggestions', 'match_analysis', 'analysis_results',
  'missing_information', 'discrepancies', 'ai_generated_tasks', 'extracted_data',
  'diagnosis_coding', 'follow_up_requests', 'follow_up_notes', 'rejection_date',
  'rejected_by', 'soc_completed_by', 'assigned_to_user_id',
  'assigned_to_membership_id', 'assigned_to_membership_version', 'assigned_at',
  'assigned_by_user_id', 'assigned_by_user_email_normalized',
]);
const ASSIGNEE_ROLES = new Set(['agency_admin', 'manager', 'clinician']);

function exactIdentifier(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_IDENTIFIER_LENGTH
    && value.trim() === value
    && !value.startsWith('$');
}

function plainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function canonicalEmail(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized && normalized.includes('@') && !/\s/.test(normalized)
    ? normalized
    : null;
}

function exactKeys(value, keys) {
  if (!plainObject(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function validScope(scope, agencyId) {
  return exactKeys(scope, ['agency_id', 'membership_id', 'membership_version', 'tenant_role'])
    && scope.agency_id === agencyId
    && exactIdentifier(scope.membership_id)
    && Number.isSafeInteger(scope.membership_version)
    && scope.membership_version >= 1
    && INTAKE_ROLES.has(scope.tenant_role);
}

function validReferral(referral, agencyId) {
  return plainObject(referral)
    && Object.keys(referral).every((field) => REFERRAL_RESPONSE_FIELDS.has(field))
    && exactIdentifier(referral.id)
    && referral.agency_id === agencyId
    && Number.isSafeInteger(referral.version)
    && referral.version >= 1
    && (referral.status === undefined || STATUSES.has(referral.status))
    && Number.isFinite(Date.parse(referral.created_date))
    && Number.isFinite(Date.parse(referral.updated_date));
}

function validAssignee(assignee) {
  return exactKeys(assignee, [
    'user_id', 'email', 'full_name', 'tenant_role', 'membership_id',
    'membership_version',
  ])
    && exactIdentifier(assignee.user_id)
    && canonicalEmail(assignee.email) === assignee.email
    && (assignee.full_name === null || (
      typeof assignee.full_name === 'string'
      && assignee.full_name.trim() === assignee.full_name
      && assignee.full_name.length > 0
      && assignee.full_name.length <= 200
    ))
    && ASSIGNEE_ROLES.has(assignee.tenant_role)
    && exactIdentifier(assignee.membership_id)
    && Number.isSafeInteger(assignee.membership_version)
    && assignee.membership_version >= 1;
}

function unwrap(response) {
  return response?.data ?? response;
}

async function invoke(payload) {
  return unwrap(await base44.functions.invoke('manageAuthorizedReferral', payload));
}

export function createReferralRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `referral-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function listAuthorizedReferrals({
  agencyId,
  limit = 200,
  patientId,
  status,
  assignedTo,
} = {}) {
  if (!exactIdentifier(agencyId)) throw new Error('agencyId is required');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
    throw new Error('limit is invalid');
  }
  if (patientId !== undefined && !exactIdentifier(patientId)) {
    throw new Error('patientId is invalid');
  }
  if (status !== undefined && !STATUSES.has(status)) throw new Error('status is invalid');
  const normalizedAssignedTo = assignedTo === undefined ? undefined : canonicalEmail(assignedTo);
  if (assignedTo !== undefined && !normalizedAssignedTo) throw new Error('assignedTo is invalid');
  const result = await invoke({
    action: 'list',
    agency_id: agencyId,
    limit,
    ...(patientId === undefined ? {} : { patient_id: patientId }),
    ...(status === undefined ? {} : { status }),
    ...(normalizedAssignedTo === undefined ? {} : { assigned_to: normalizedAssignedTo }),
  });
  if (
    !exactKeys(result, ['success', 'action', 'referrals', 'scope'])
    || result.success !== true
    || result.action !== 'list'
    || !Array.isArray(result.referrals)
    || result.referrals.length > limit
    || result.referrals.some((row) => (
      !validReferral(row, agencyId)
      || (patientId !== undefined && row.patient_id !== patientId)
      || (status !== undefined && row.status !== status)
      || (normalizedAssignedTo !== undefined && row.assigned_to !== normalizedAssignedTo)
    ))
    || !validScope(result.scope, agencyId)
  ) {
    throw new Error(result?.error || 'Referral list failed integrity validation');
  }
  return result;
}

export async function getAuthorizedReferral({ agencyId, referralId } = {}) {
  if (!exactIdentifier(agencyId)) throw new Error('agencyId is required');
  if (!exactIdentifier(referralId)) throw new Error('referralId is required');
  const result = await invoke({
    action: 'get',
    agency_id: agencyId,
    referral_id: referralId,
  });
  if (
    !exactKeys(result, ['success', 'action', 'referral', 'scope'])
    || result.success !== true
    || result.action !== 'get'
    || !validReferral(result.referral, agencyId)
    || result.referral.id !== referralId
    || !validScope(result.scope, agencyId)
  ) {
    throw new Error(result?.error || 'Referral read failed integrity validation');
  }
  return result;
}

export async function listAuthorizedReferralAssignees({ agencyId } = {}) {
  if (!exactIdentifier(agencyId)) throw new Error('agencyId is required');
  const result = await invoke({
    action: 'list_assignees',
    agency_id: agencyId,
  });
  if (
    !exactKeys(result, ['success', 'action', 'assignees', 'scope'])
    || result.success !== true
    || result.action !== 'list_assignees'
    || !Array.isArray(result.assignees)
    || result.assignees.length >= 100
    || result.assignees.some((row) => !validAssignee(row))
    || new Set(result.assignees.map((row) => row.membership_id)).size !== result.assignees.length
    || new Set(result.assignees.map((row) => row.user_id)).size !== result.assignees.length
    || new Set(result.assignees.map((row) => row.email)).size !== result.assignees.length
    || !validScope(result.scope, agencyId)
  ) {
    throw new Error(result?.error || 'Referral assignee list failed integrity validation');
  }
  return result;
}

export async function createAuthorizedReferral(
  referral,
  { agencyId, clientRequestId = createReferralRequestId() } = {},
) {
  if (!plainObject(referral)) throw new Error('referral must be an object');
  if (!exactIdentifier(agencyId)) throw new Error('agencyId is required');
  if (!exactIdentifier(clientRequestId)) throw new Error('clientRequestId is invalid');
  const result = await invoke({
    action: 'create',
    agency_id: agencyId,
    client_request_id: clientRequestId,
    referral,
  });
  if (
    !exactKeys(result, ['success', 'action', 'created', 'referral', 'scope'])
    || result.success !== true
    || result.action !== 'create'
    || typeof result.created !== 'boolean'
    || !validReferral(result.referral, agencyId)
    || !validScope(result.scope, agencyId)
  ) {
    throw new Error(result?.error || 'Referral creation failed integrity validation');
  }
  return result.referral;
}

export async function updateAuthorizedReferral({ agencyId, referralId, changes } = {}) {
  if (!exactIdentifier(agencyId)) throw new Error('agencyId is required');
  if (!exactIdentifier(referralId)) throw new Error('referralId is required');
  if (!plainObject(changes) || Object.keys(changes).length === 0) {
    throw new Error('changes must be a non-empty object');
  }
  const result = await invoke({
    action: 'update',
    agency_id: agencyId,
    referral_id: referralId,
    changes,
  });
  if (
    !exactKeys(result, ['success', 'action', 'referral', 'scope'])
    || result.success !== true
    || result.action !== 'update'
    || !validReferral(result.referral, agencyId)
    || result.referral.id !== referralId
    || !validScope(result.scope, agencyId)
  ) {
    throw new Error(result?.error || 'Referral update failed integrity validation');
  }
  return result.referral;
}

export async function deleteAuthorizedReferral({ agencyId, referralId } = {}) {
  if (!exactIdentifier(agencyId)) throw new Error('agencyId is required');
  if (!exactIdentifier(referralId)) throw new Error('referralId is required');
  const result = await invoke({
    action: 'delete',
    agency_id: agencyId,
    referral_id: referralId,
  });
  if (
    !exactKeys(result, ['success', 'action', 'archived', 'referral_id', 'scope'])
    || result.success !== true
    || result.action !== 'delete'
    || result.archived !== true
    || result.referral_id !== referralId
    || !validScope(result.scope, agencyId)
  ) {
    throw new Error(result?.error || 'Referral removal failed integrity validation');
  }
  return result;
}
