import { base44 } from '@/api/base44Client';

const ACTIONS = new Set(['inspect', 'grant', 'activate', 'suspend', 'revoke']);
const TRANSITIONS = new Set(['activate', 'suspend', 'revoke']);
const STATUSES = new Set(['active', 'suspended', 'revoked']);
const SCOPE_ROLES = new Set(['platform_owner', 'agency_admin', 'manager']);
const MAX_IDENTIFIER_LENGTH = 200;
const MAX_REASON_LENGTH = 500;

const COMMON_KEYS = ['action', 'agencyId', 'patientId', 'targetUserId', 'functions'];
const MUTATION_KEYS = [...COMMON_KEYS, 'clientRequestId', 'reason'];
const TRANSITION_KEYS = [...MUTATION_KEYS, 'expectedVersion'];

function containsIdentifierControl(value) {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

function containsReasonControl(value) {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127;
  });
}

function exactIdentifier(value) {
  if (
    typeof value !== 'string'
    || !value
    || value.length > MAX_IDENTIFIER_LENGTH
    || value.trim() !== value
    || value.startsWith('$')
    || containsIdentifierControl(value)
  ) {
    return null;
  }
  return value;
}

function boundedReason(value) {
  if (typeof value !== 'string') return null;
  const reason = value.trim();
  if (
    !reason
    || reason.length > MAX_REASON_LENGTH
    || containsReasonControl(reason)
  ) {
    return null;
  }
  return reason;
}

function validInstant(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return JSON.stringify(actual) === JSON.stringify([...expected].sort());
}

export function createCareTeamAssignmentRequestId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `care-team-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function validateOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('Care-team assignment options must be an object');
  }
  const action = typeof options.action === 'string' ? options.action : '';
  if (!ACTIONS.has(action)) throw new Error('Care-team assignment action is invalid');

  const allowed = action === 'inspect'
    ? COMMON_KEYS
    : action === 'grant'
      ? MUTATION_KEYS
      : TRANSITION_KEYS;
  const unsupported = Object.keys(options).filter((key) => !allowed.includes(key));
  if (unsupported.length) {
    throw new Error(`Unsupported care-team assignment options: ${unsupported.join(', ')}`);
  }

  const agencyId = exactIdentifier(options.agencyId);
  const patientId = exactIdentifier(options.patientId);
  const targetUserId = exactIdentifier(options.targetUserId);
  if (!agencyId || !patientId || !targetUserId) {
    throw new Error('Exact agencyId, patientId, and targetUserId are required');
  }

  if (options.functions != null && typeof options.functions?.invoke !== 'function') {
    throw new Error('functions must expose invoke');
  }

  if (action === 'inspect') {
    return { action, agencyId, patientId, targetUserId, functions: options.functions };
  }

  const reason = boundedReason(options.reason);
  if (!reason) throw new Error('A bounded transition reason is required');
  const clientRequestId = options.clientRequestId == null
    ? createCareTeamAssignmentRequestId()
    : exactIdentifier(options.clientRequestId);
  if (!clientRequestId) throw new Error('clientRequestId is invalid');

  if (TRANSITIONS.has(action)
    && (!Number.isSafeInteger(options.expectedVersion) || options.expectedVersion < 1)) {
    throw new Error('A positive expectedVersion is required for assignment transitions');
  }

  return {
    action,
    agencyId,
    patientId,
    targetUserId,
    clientRequestId,
    reason,
    expectedVersion: TRANSITIONS.has(action) ? options.expectedVersion : null,
    functions: options.functions,
  };
}

function validateResult(result, input) {
  const topKeys = ['success', 'action', 'idempotent', 'assignment', 'scope'];
  const assignmentKeys = [
    'id', 'agency_id', 'patient_id', 'user_id', 'status', 'version',
    'activated_at', 'suspended_at', 'revoked_at', 'last_transition_at',
  ];
  const scopeKeys = ['agency_id', 'membership_id', 'membership_version', 'tenant_role'];
  if (
    !exactKeys(result, topKeys)
    || result.success !== true
    || result.action !== input.action
    || typeof result.idempotent !== 'boolean'
    || !exactKeys(result.assignment, assignmentKeys)
    || !exactKeys(result.scope, scopeKeys)
  ) {
    throw new Error(result?.error || 'Care-team assignment request failed');
  }

  const assignment = result.assignment;
  const scope = result.scope;
  const expectedStatus = input.action === 'grant' || input.action === 'activate'
    ? 'active'
    : input.action === 'suspend'
      ? 'suspended'
      : input.action === 'revoke'
        ? 'revoked'
        : null;
  const expectedResultVersion = input.action === 'grant'
    ? 1
    : TRANSITIONS.has(input.action)
      ? input.expectedVersion + 1
      : null;
  if (
    !exactIdentifier(assignment.id)
    || assignment.agency_id !== input.agencyId
    || assignment.patient_id !== input.patientId
    || assignment.user_id !== input.targetUserId
    || !STATUSES.has(assignment.status)
    || (expectedStatus && assignment.status !== expectedStatus)
    || !Number.isSafeInteger(assignment.version)
    || assignment.version < 1
    || (expectedResultVersion !== null && assignment.version !== expectedResultVersion)
    || !validInstant(assignment.activated_at)
    || !validInstant(assignment.last_transition_at)
    || (assignment.suspended_at !== null && !validInstant(assignment.suspended_at))
    || (assignment.revoked_at !== null && !validInstant(assignment.revoked_at))
    || (assignment.status === 'suspended' && !validInstant(assignment.suspended_at))
    || (assignment.status === 'revoked' && !validInstant(assignment.revoked_at))
    || scope.agency_id !== input.agencyId
    || !SCOPE_ROLES.has(scope.tenant_role)
  ) {
    throw new Error('Care-team assignment response failed integrity validation');
  }
  if (scope.tenant_role === 'platform_owner') {
    if (scope.membership_id !== null || scope.membership_version !== null) {
      throw new Error('Care-team assignment scope failed integrity validation');
    }
  } else if (
    !exactIdentifier(scope.membership_id)
    || !Number.isSafeInteger(scope.membership_version)
    || scope.membership_version < 1
  ) {
    throw new Error('Care-team assignment scope failed integrity validation');
  }

  return {
    success: true,
    action: result.action,
    idempotent: result.idempotent,
    assignment: { ...assignment },
    scope: { ...scope },
  };
}

/**
 * Invoke the unwired, server-owned care-team assignment lifecycle broker.
 * Immutable User ids are the only assignee selector; email and role claims are
 * intentionally not accepted here.
 */
export async function managePatientCareTeamAssignment(options) {
  const input = validateOptions(options);
  const payload = {
    action: input.action,
    agency_id: input.agencyId,
    patient_id: input.patientId,
    target_user_id: input.targetUserId,
    ...(input.action === 'inspect' ? {} : {
      client_request_id: input.clientRequestId,
      reason: input.reason,
    }),
    ...(TRANSITIONS.has(input.action) ? { expected_version: input.expectedVersion } : {}),
  };
  const response = input.functions
    ? await input.functions.invoke('managePatientCareTeamAssignment', payload)
    : await base44.functions.invoke('managePatientCareTeamAssignment', payload);
  return validateResult(response?.data ?? response, input);
}
