import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * offboardUser — interim server-side staff offboarding.
 *
 * Client-side User.update(is_active:false) alone is insufficient:
 *   1. Patient.assigned_nurses still grants PHI via RLS
 *   2. Work numbers keep routing to the offboarded nurse
 *   3. On-call shifts remain assigned
 *   4. Layout blocks the browser shell, but entity API access needs platform policy
 *
 * Body: { user_id, reason }  OR  { action: 'reactivate', user_id }
 *
 * Reactivation source remains below for historical review, but the route is
 * hard-paused before client creation. Revoked membership alone cannot prove
 * that legacy creator/email grants will not restore PHI when User.is_active is
 * turned back on.
 */

/**
 * Ceiling for the patient-assignment sweep. This is a guard against an
 * unbounded read, not a page size: reaching it means the sweep may be
 * incomplete, which the response reports via results.sweep_truncated.
 */
// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

// <<<BEGIN SHARED HELPER: protectedUserAuthz — generated, edit base44/_shared/backendHelpers.mjs>>>
const normalizeProtectedEmail = (value) => String(value || '').trim().toLowerCase();
const isProtectedAdmin = (user) => !!user && user.role === 'admin';
function isProtectedSuperAdmin(user) {
  const configuredEmail = normalizeProtectedEmail(Deno.env.get('SUPER_ADMIN_EMAIL'));
  return !!configuredEmail
    && isProtectedAdmin(user)
    && normalizeProtectedEmail(user.email) === configuredEmail;
}
// <<<END SHARED HELPER: protectedUserAuthz>>>

// <<<BEGIN SHARED HELPER: requireAgencyAdminAgency — generated, edit base44/_shared/backendHelpers.mjs>>>
function agencyAdminMissingAgencyResponse(user) {
  if (user && user.account_type === 'agency_admin' && !String(user.agency_name || '').trim()) {
    return Response.json({ error: 'Forbidden: agency_name is required.' }, { status: 403 });
  }
  return null;
}
// <<<END SHARED HELPER: requireAgencyAdminAgency>>>


const PATIENT_SWEEP_LIMIT = 5000;
const MEMBERSHIP_SCAN_LIMIT = 100;
const USER_SCAN_LIMIT = 10;
const MAX_IDENTIFIER_LENGTH = 200;
const MAX_MEMBERSHIP_REASON_LENGTH = 500;
const USER_PROVIDER_MUTATED_FIELDS = new Set(['updated_date']);
const MEMBERSHIP_WRITER_FIELDS = [
  'id',
  'membership_key',
  'agency_id',
  'user_id',
  'user_email_normalized',
  'tenant_role',
  'status',
  'invitation_id',
  'created_by_user_id',
  'last_transition_by_user_id',
  'last_transition_by_email_normalized',
  'last_transition_at',
  'last_transition_reason',
  'activated_at',
  'revoked_at',
  'revocation_reason',
  'version',
];
const MEMBERSHIP_STATUSES = new Set(['pending', 'active', 'suspended', 'revoked']);
const TENANT_ROLES = new Set([
  'agency_admin',
  'manager',
  'clinician',
  'office_staff',
  'social_worker',
  'spiritual_care',
]);

class PublicError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'PublicError';
    this.status = status;
  }
}

function exactIdentifier(value) {
  if (typeof value !== 'string') return null;
  if (!value || value.length > MAX_IDENTIFIER_LENGTH || value.trim() !== value) return null;
  return value;
}

function canonicalEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > 320 || !email.includes('@') || /\s/.test(email)) return null;
  return email;
}

async function requireSameProtectedOwner(base44, actorId, actorEmail, message) {
  const freshUser = await base44.auth.me().catch(() => null);
  if (
    !freshUser
    || exactIdentifier(freshUser.id) !== actorId
    || canonicalEmail(freshUser.email) !== actorEmail
    || !isProtectedSuperAdmin(freshUser)
    || freshUser.is_active !== true
    || freshUser.disabled === true
    || freshUser.is_service === true
    || freshUser.is_verified === false
  ) {
    throw new PublicError(403, message);
  }
  return freshUser;
}

function boundedMembershipReason(value) {
  if (typeof value !== 'string') return null;
  const reason = value.trim();
  if (!reason || reason.length > MAX_MEMBERSHIP_REASON_LENGTH) return null;
  return reason;
}

function requireRows(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} returned a non-array result`);
  return value;
}

function validateMembershipRecord(row, userId, targetEmail) {
  const id = exactIdentifier(row?.id);
  const agencyId = exactIdentifier(row?.agency_id);
  const membershipKey = exactIdentifier(row?.membership_key);
  const storedEmail = canonicalEmail(row?.user_email_normalized);
  const createdBy = exactIdentifier(row?.created_by_user_id);
  const transitionedBy = exactIdentifier(row?.last_transition_by_user_id);
  const transitionEmail = canonicalEmail(row?.last_transition_by_email_normalized);
  const transitionAt = Date.parse(String(row?.last_transition_at || ''));
  const transitionReason = boundedMembershipReason(row?.last_transition_reason);
  const activatedAt = Date.parse(String(row?.activated_at || ''));
  const revokedAt = Date.parse(String(row?.revoked_at || ''));
  const revocationReason = boundedMembershipReason(row?.revocation_reason);
  if (
    !id
    || !agencyId
    || !membershipKey
    || row.user_id !== userId
    || membershipKey !== `${agencyId}:${userId}`
    || !storedEmail
    || row.user_email_normalized !== storedEmail
    || storedEmail !== targetEmail
    || !TENANT_ROLES.has(row.tenant_role)
    || !MEMBERSHIP_STATUSES.has(row.status)
    || !Number.isSafeInteger(row.version)
    || row.version < 1
    || !createdBy
    || !transitionedBy
    || !transitionEmail
    || row.last_transition_by_email_normalized !== transitionEmail
    || !Number.isFinite(transitionAt)
    || !transitionReason
    || (
      (row.status === 'active' || row.status === 'suspended')
      && !Number.isFinite(activatedAt)
    )
    || (
      row.status === 'revoked'
      && (!Number.isFinite(revokedAt) || !revocationReason)
    )
  ) {
    throw new PublicError(409, 'Tenant membership integrity check failed; User was not changed');
  }
  return row;
}

async function loadExactTargetUser(entities, userId) {
  const rows = requireRows(
    await entities.User.filter({ id: userId }, '-created_date', USER_SCAN_LIMIT),
    'User.filter',
  );
  if (rows.length >= USER_SCAN_LIMIT) throw new PublicError(409, 'Target User is ambiguous');
  const exact = rows.filter((row) => row?.id === userId);
  if (exact.length === 0) throw new PublicError(404, 'User not found');
  if (exact.length !== 1) throw new PublicError(409, 'Target User is ambiguous');
  const normalizedEmail = canonicalEmail(exact[0].email);
  if (!normalizedEmail) throw new PublicError(409, 'Target User identity is invalid');
  return { targetUser: exact[0], normalizedEmail };
}

function canonicalJsonValue(value) {
  if (value === null) return 'n';
  if (value === undefined) return 'u';
  if (typeof value === 'string') return `s:${JSON.stringify(value)}`;
  if (typeof value === 'boolean') return value ? 'b:1' : 'b:0';
  if (typeof value === 'number') return Number.isFinite(value) ? `d:${JSON.stringify(value)}` : null;
  if (Array.isArray(value)) {
    const items = value.map(canonicalJsonValue);
    if (items.some((item) => item === null)) return null;
    return `a:[${items.join(',')}]`;
  }
  if (typeof value !== 'object') return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const entries = [];
  for (const key of Object.keys(value).sort()) {
    const item = canonicalJsonValue(value[key]);
    if (item === null) return null;
    entries.push(`${JSON.stringify(key)}:${item}`);
  }
  return `o:{${entries.join(',')}}`;
}

function hasSameCanonicalJsonValue(left, right) {
  const leftCanonical = canonicalJsonValue(left);
  return leftCanonical !== null && leftCanonical === canonicalJsonValue(right);
}

function matchesRecordSnapshot(before, after, expectedChanges = {}, providerMutatedFields = new Set()) {
  if (!after || after.id !== before.id) return false;
  const allowedAfterFields = new Set([
    ...Object.keys(before),
    ...Object.keys(expectedChanges),
    ...providerMutatedFields,
  ]);
  if (Object.keys(after).some((field) => !allowedAfterFields.has(field))) return false;
  for (const [field, value] of Object.entries(expectedChanges)) {
    if (!hasSameCanonicalJsonValue(after[field], value)) return false;
  }
  const changedFields = new Set(Object.keys(expectedChanges));
  return Object.entries(before).every(([field, value]) => (
    changedFields.has(field)
    || providerMutatedFields.has(field)
    || (
      Object.prototype.hasOwnProperty.call(after, field)
      && hasSameCanonicalJsonValue(after[field], value)
    )
  ));
}

function matchesUserSnapshot(before, after, expectedChanges = {}) {
  if (
    !after
    || after.id !== before.id
    || canonicalEmail(after.email) !== canonicalEmail(before.email)
  ) {
    return false;
  }
  return matchesRecordSnapshot(
    before,
    after,
    expectedChanges,
    USER_PROVIDER_MUTATED_FIELDS,
  );
}

async function updateExactTargetUser(
  entities,
  before,
  expectedChanges,
  messages,
  beforeWrite = null,
) {
  // This closes the previous trust in User.update's return value: re-read the
  // exact built-in User immediately before and after the write, preserving its
  // identity and every observed preimage field outside the explicit patch.
  // Base44 still has no conditional User update, so a write can race after this
  // preimage check; hosted CAS/transaction proof remains a release blocker.
  let preimage;
  try {
    ({ targetUser: preimage } = await loadExactTargetUser(entities, before.id));
  } catch {
    throw new PublicError(409, messages.preimage);
  }
  if (!matchesUserSnapshot(before, preimage)) {
    throw new PublicError(409, messages.preimage);
  }

  if (beforeWrite) await beforeWrite();

  let writeFailed = false;
  try {
    await entities.User.update(before.id, expectedChanges);
  } catch {
    // A transport error can arrive after the hosted write committed. Only an
    // exact readback may distinguish that outcome from a true failed write.
    writeFailed = true;
  }

  let after;
  try {
    ({ targetUser: after } = await loadExactTargetUser(entities, before.id));
  } catch {
    throw new PublicError(409, writeFailed ? messages.write : messages.readback);
  }
  if (!matchesUserSnapshot(before, after, expectedChanges)) {
    throw new PublicError(409, writeFailed ? messages.write : messages.readback);
  }
  return after;
}

async function loadExactSweepRecord(entity, before, label) {
  const id = exactIdentifier(before?.id);
  if (!id) throw new Error(`${label} identity is invalid`);
  const rows = requireRows(
    await entity.filter({ id }, '-updated_date', USER_SCAN_LIMIT),
    `${label}.filter`,
  );
  if (rows.length >= USER_SCAN_LIMIT) throw new Error(`${label} readback is ambiguous`);
  const exact = rows.filter((row) => row?.id === id);
  if (exact.length !== 1 || exact.length !== rows.length) {
    throw new Error(`${label} readback is ambiguous`);
  }
  return exact[0];
}

async function updateExactSweepRecord(entity, before, expectedChanges, label) {
  const preimage = await loadExactSweepRecord(entity, before, label);
  if (!matchesRecordSnapshot(before, preimage, {}, USER_PROVIDER_MUTATED_FIELDS)) {
    throw new Error(`${label} changed before update`);
  }
  await entity.update(before.id, expectedChanges);
  const after = await loadExactSweepRecord(entity, before, label);
  if (!matchesRecordSnapshot(before, after, expectedChanges, USER_PROVIDER_MUTATED_FIELDS)) {
    throw new Error(`${label} update could not be reconciled`);
  }
  return after;
}

async function loadTargetMemberships(entities, userId, targetEmail) {
  const rows = requireRows(
    await entities.AgencyMembership.filter(
      { user_id: userId },
      '-updated_date',
      MEMBERSHIP_SCAN_LIMIT,
    ),
    'AgencyMembership.filter',
  );
  if (rows.length >= MEMBERSHIP_SCAN_LIMIT) {
    throw new PublicError(409, 'Tenant membership is ambiguous; User was not changed');
  }

  const exact = rows.filter((row) => row?.user_id === userId);
  if (exact.length !== rows.length) {
    throw new PublicError(409, 'Tenant membership query scope could not be verified; User was not changed');
  }
  const ids = new Set();
  const keys = new Set();
  const agencyIds = new Set();
  for (const row of exact) {
    validateMembershipRecord(row, userId, targetEmail);
    if (ids.has(row.id) || keys.has(row.membership_key) || agencyIds.has(row.agency_id)) {
      throw new PublicError(409, 'Tenant membership is ambiguous; User was not changed');
    }
    ids.add(row.id);
    keys.add(row.membership_key);
    agencyIds.add(row.agency_id);
  }
  return exact;
}

async function loadExactMembershipForReadback(entities, before, targetEmail) {
  const rows = requireRows(
    await entities.AgencyMembership.filter(
      { agency_id: before.agency_id, user_id: before.user_id },
      '-updated_date',
      MEMBERSHIP_SCAN_LIMIT,
    ),
    'AgencyMembership.filter',
  );
  if (rows.length >= MEMBERSHIP_SCAN_LIMIT) {
    throw new PublicError(409, 'Membership revocation could not be reconciled; User was not changed');
  }
  const exact = rows.filter(
    (row) => row?.agency_id === before.agency_id && row?.user_id === before.user_id,
  );
  if (exact.length !== 1 || exact.length !== rows.length) {
    throw new PublicError(409, 'Membership revocation could not be reconciled; User was not changed');
  }
  return validateMembershipRecord(exact[0], before.user_id, targetEmail);
}

function matchesMembershipSnapshot(before, after, expectedChanges = {}) {
  return MEMBERSHIP_WRITER_FIELDS.every((field) => {
    const expectedValue = Object.prototype.hasOwnProperty.call(expectedChanges, field)
      ? expectedChanges[field]
      : before[field];
    return after[field] === expectedValue;
  });
}

async function requireExactRevokedMembershipSet(
  entities,
  expectedMemberships,
  targetUserId,
  targetEmail,
  message,
) {
  let currentMemberships;
  try {
    currentMemberships = await loadTargetMemberships(entities, targetUserId, targetEmail);
  } catch {
    throw new PublicError(409, message);
  }
  const expectedById = new Map(expectedMemberships.map((row) => [row.id, row]));
  if (
    currentMemberships.length !== expectedMemberships.length
    || currentMemberships.some((row) => {
      const expected = expectedById.get(row.id);
      return !expected
        || row.status !== 'revoked'
        || !matchesMembershipSnapshot(expected, row);
    })
  ) {
    throw new PublicError(409, message);
  }
  return currentMemberships;
}

async function revokeMembershipsBeforeOffboard(
  entities,
  memberships,
  targetUserId,
  targetEmail,
  actorId,
  actorEmail,
  reason,
  at,
  requireOwnerAuth,
) {
  const revocable = memberships.filter((row) => row.status !== 'revoked');
  const expectedMemberships = new Map(memberships.map((row) => [row.id, row]));
  if (revocable.some((row) => row.version >= Number.MAX_SAFE_INTEGER)) {
    throw new PublicError(409, 'Membership version capacity is exhausted; User was not changed');
  }

  let ownerRechecked = false;
  for (const row of revocable) {
    const preimage = await loadExactMembershipForReadback(entities, row, targetEmail);
    if (!matchesMembershipSnapshot(row, preimage)) {
      throw new PublicError(409, 'Membership changed during revocation; User was not changed');
    }
    const expected = {
      status: 'revoked',
      version: row.version + 1,
      revoked_at: at,
      revocation_reason: reason,
      last_transition_by_user_id: actorId,
      last_transition_by_email_normalized: actorEmail,
      last_transition_at: at,
      last_transition_reason: reason,
    };
    if (!ownerRechecked) {
      await requireOwnerAuth();
      ownerRechecked = true;
    }
    try {
      await entities.AgencyMembership.update(row.id, expected);
    } catch {
      throw new PublicError(409, 'Membership revocation failed; User was not changed');
    }
    const after = await loadExactMembershipForReadback(entities, row, targetEmail);
    if (
      after.id !== row.id
      || !matchesMembershipSnapshot(row, after, expected)
    ) {
      throw new PublicError(409, 'Membership revocation could not be reconciled; User was not changed');
    }
    expectedMemberships.set(row.id, after);
  }
  const finalMemberships = await requireExactRevokedMembershipSet(
    entities,
    [...expectedMemberships.values()],
    targetUserId,
    targetEmail,
    'Membership revocation set could not be reconciled; User was not changed',
  );
  return {
    summary: {
      memberships_revoked: revocable.length,
      memberships_already_revoked: memberships.length - revocable.length,
    },
    expectedMemberships: finalMemberships,
  };
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { Allow: 'POST' } });
    }
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || 'offboard');
    if (action === 'reactivate') {
      // Hard default-off before createClientFromRequest/auth/service-role use.
      // Legacy creator/email grants can independently restore PHI even when
      // every AgencyMembership row remains revoked. Only a separately reviewed
      // rehire broker may make the preserved reactivateUser implementation
      // reachable again.
      return Response.json({
        error: 'User reactivation is temporarily unavailable pending retirement of legacy PHI grants',
        code: 'USER_REACTIVATION_PAUSED',
      }, { status: 503 });
    }
    const base44 = createClientFromRequest(req);
    const currentUser = await base44.auth.me().catch(() => null);
    if (!currentUser) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const isAdmin = isProtectedAdmin(currentUser);
    if (!isAdmin) {
      return Response.json({ error: 'Unauthorized - Admin access required' }, { status: 403 });
    }

    // Offboarding clears is_active but deliberately leaves role/account_type
    // intact (history and audit joins key off them), so an offboarded admin
    // still satisfies the isAdmin gate above. The platform does not yet reject
    // entity-API calls from an inactive session, so refuse them here rather
    // than letting a deactivated administrator keep driving this function.
    if (currentUser.is_active !== true) {
      return Response.json({ error: 'Unauthorized - account is deactivated' }, { status: 403 });
    }
    if (
      currentUser.disabled === true
      || currentUser.is_service === true
      || currentUser.is_verified === false
    ) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const callerIsSuperAdmin = isProtectedSuperAdmin(currentUser);
    if (!callerIsSuperAdmin) {
      return Response.json({ error: 'Only the protected platform owner may manage offboarding' }, { status: 403 });
    }
    const actorId = exactIdentifier(currentUser.id);
    const actorEmail = canonicalEmail(currentUser.email);
    if (!actorId || !actorEmail) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (action !== 'offboard') {
      return Response.json({ error: 'Invalid action' }, { status: 400 });
    }

    return await offboardUser(
      base44,
      currentUser,
      body,
      callerIsSuperAdmin,
      actorId,
      actorEmail,
    );
  } catch (error) {
    if (error instanceof PublicError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error('offboardUser error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});

async function offboardUser(
  base44,
  currentUser,
  params,
  callerIsSuperAdmin,
  actorId,
  actorEmail,
) {
  const { user_id, reason } = params;
  const userId = exactIdentifier(user_id);
  if (!userId) {
    return Response.json({ error: 'user_id is required' }, { status: 400 });
  }
  const note = String(reason || '').trim();
  if (!note) {
    return Response.json({ error: 'offboarding reason is required' }, { status: 400 });
  }

  const entities = base44.asServiceRole.entities;
  const { targetUser, normalizedEmail: targetEmailNormalized } = await loadExactTargetUser(
    entities,
    userId,
  );
  if (targetUser.id === actorId) {
    return Response.json({ error: 'You cannot offboard your own account.' }, { status: 400 });
  }

  // Custom account_type is self-mutable and cannot shield an account from
  // offboarding. Only Base44's protected built-in admin role is privileged.
  const targetIsPrivileged = targetUser.role === 'admin';
  if (targetIsPrivileged && !callerIsSuperAdmin) {
    return Response.json({ error: 'Only a super admin can offboard another administrator.' }, { status: 403 });
  }

  const at = new Date().toISOString();
  const targetEmail = targetUser.email;
  const memberships = await loadTargetMemberships(entities, userId, targetEmailNormalized);
  const {
    summary: membershipResults,
    expectedMemberships,
  } = await revokeMembershipsBeforeOffboard(
    entities,
    memberships,
    userId,
    targetEmailNormalized,
    actorId,
    actorEmail,
    note.slice(0, MAX_MEMBERSHIP_REASON_LENGTH),
    at,
    () => requireSameProtectedOwner(
      base44,
      actorId,
      actorEmail,
      'Protected owner authorization changed before membership revocation; User was not changed',
    ),
  );

  const recheckRevokedMemberships = (message) => requireExactRevokedMembershipSet(
    entities,
    expectedMemberships,
    userId,
    targetEmailNormalized,
    message,
  );

  await updateExactTargetUser(entities, targetUser, {
    is_active: false,
    duty_status: 'off_duty',
    personal_cell_e164: '',
    scheduled_off_duty_start: '',
    scheduled_off_duty_end: '',
    work_phone_number: '',
    twilio_phone_number_sid: '',
    offboarded_at: at,
    offboarded_by: actorEmail,
    offboarding_reason: note.slice(0, 1000),
  }, {
    preimage: 'Target User changed during offboarding; memberships remain revoked and no User update was attempted',
    write: 'User deactivation failed; memberships remain revoked',
    readback: 'User deactivation could not be reconciled; memberships remain revoked',
  }, async () => {
    await recheckRevokedMemberships(
      'Membership set changed during offboarding; User was not deactivated',
    );
    await requireSameProtectedOwner(
      base44,
      actorId,
      actorEmail,
      'Protected owner authorization changed before User deactivation; User was not changed',
    );
  });
  await recheckRevokedMemberships(
    'Membership set changed after User deactivation; offboarding requires reconciliation',
  );
  await requireSameProtectedOwner(
    base44,
    actorId,
    actorEmail,
    'Protected owner authorization changed before legacy cleanup; cleanup was not attempted',
  );

  const results = {
    user_deactivated: true,
    ...membershipResults,
    patients_unassigned: 0,
    work_numbers_released: 0,
    on_call_shifts_cleared: 0,
    invitations_cancelled: 0,
    scheduled_sms_canceled: 0,
    scheduled_faxes_canceled: 0,
    signature_reminders_canceled: 0,
    // A revocation sweep that partly failed must not read as a clean one: these
    // counts land in the UserActivity audit record below, where an auditor
    // treats them as proof that PHI access was actually withdrawn.
    failures: 0,
    sweep_truncated: false,
  };

  /** Run one revocation write, counting it only if it actually succeeded. */
  const revoke = async (label, entity, before, expectedChanges) => {
    try {
      await updateExactSweepRecord(entity, before, expectedChanges, label);
      return true;
    } catch (err) {
      console.error(`${label} failed`, before?.id, err?.message || err);
      results.failures += 1;
      return false;
    }
  };

  try {
    // The canonical identity is the authorization key. A legacy User row may
    // retain different casing/whitespace, and old Patient assignments may have
    // stored either representation, so issue at most two bounded exact queries.
    // Never broaden this to a Patient.list scan or in-process canonical match.
    const assignmentEmails = targetEmail === targetEmailNormalized
      ? [targetEmailNormalized]
      : [targetEmailNormalized, targetEmail];
    const patientsById = new Map();
    for (const assignmentEmail of assignmentEmails) {
      const patients = await base44.asServiceRole.entities.Patient.filter(
        { assigned_nurses: assignmentEmail },
        '-updated_date',
        PATIENT_SWEEP_LIMIT,
      ).catch((err) => {
        // An empty result and a failed query are not the same thing: swallowing
        // this into [] reports "no assignments to revoke" and the sweep comes
        // back clean while PHI access is untouched.
        console.error('patient sweep query failed:', assignmentEmail, err?.message || err);
        results.failures += 1;
        return null;
      });
      if (!patients) continue;
      if (patients.length >= PATIENT_SWEEP_LIMIT) {
        // Hitting either exact-query ceiling means unseen assignments may remain.
        results.sweep_truncated = true;
        console.error(
          'patient unassign sweep hit the row ceiling; assignments may remain',
          assignmentEmail,
        );
      }
      for (const patient of patients) {
        const id = exactIdentifier(patient?.id);
        const nurses = Array.isArray(patient?.assigned_nurses)
          ? patient.assigned_nurses
          : null;
        if (!id || !nurses?.includes(assignmentEmail)) {
          throw new Error('patient assignment query scope could not be verified');
        }
        const observed = patientsById.get(id);
        if (observed && !hasSameCanonicalJsonValue(observed, patient)) {
          throw new Error('patient assignment changed between exact queries');
        }
        patientsById.set(id, patient);
      }
    }
    for (const p of patientsById.values()) {
      const nurses = Array.isArray(p.assigned_nurses) ? p.assigned_nurses : [];
      const next = nurses.filter((email) => !assignmentEmails.includes(email));
      const ok = await revoke(
        'patient unassign',
        entities.Patient,
        p,
        { assigned_nurses: next },
      );
      if (ok) results.patients_unassigned += 1;
    }
  } catch (err) {
    console.error('patient unassign sweep failed:', err?.message || err);
    results.failures += 1;
  }

  try {
    const poolRows = await base44.asServiceRole.entities.PhoneNumber.filter(
      { assigned_to_email: targetEmail },
      undefined,
      5000,
    ).catch((err) => {
      console.error('phone pool query failed:', err?.message || err);
      results.failures += 1;
      return null;
    });
    for (const row of (poolRows || [])) {
      const ok = await revoke(
        'phone release',
        entities.PhoneNumber,
        row,
        {
          status: 'available',
          assigned_to_email: '',
        },
      );
      if (ok) results.work_numbers_released += 1;
    }
  } catch (err) {
    console.error('phone pool release failed:', err?.message || err);
    results.failures += 1;
  }

  try {
    const shifts = await base44.asServiceRole.entities.OnCallShift.filter(
      { assigned_user_email: targetEmail },
      undefined,
      5000,
    ).catch((err) => {
      console.error('on-call query failed:', err?.message || err);
      results.failures += 1;
      return null;
    });
    for (const shift of (shifts || [])) {
      const priorNotes = shift.notes ? String(shift.notes) : '';
      const clearedNote = `Cleared on offboard ${at} by ${currentUser.email}`;
      const ok = await revoke(
        'on-call clear',
        entities.OnCallShift,
        shift,
        {
          assigned_user_email: '',
          assigned_user_name: '',
          notes: [priorNotes, clearedNote].filter(Boolean).join(' | ').slice(0, 1000),
        },
      );
      if (ok) results.on_call_shifts_cleared += 1;
    }
  } catch (err) {
    console.error('on-call clear failed:', err?.message || err);
    results.failures += 1;
  }

  try {
    const invites = await base44.asServiceRole.entities.UserInvitation.filter(
      { email: targetEmail, status: 'pending' },
      undefined,
      5000,
    ).catch((err) => {
      console.error('invitation query failed:', err?.message || err);
      results.failures += 1;
      return null;
    });
    for (const inv of (invites || [])) {
      const ok = await revoke(
        'invitation cancel',
        entities.UserInvitation,
        inv,
        { status: 'cancelled' },
      );
      if (ok) results.invitations_cancelled += 1;
    }
  } catch (err) {
    console.error('invitation cancel failed:', err?.message || err);
    results.failures += 1;
  }

  // Cancel outbound schedules that would still fire after phone/work number clear.
  // dispatchScheduledSms uses the row's stored from_number — clearing User.work_phone
  // alone does not stop pending PHI texts.
  try {
    const pendingSms = await base44.asServiceRole.entities.ScheduledSms.filter(
      { nurse_email: targetEmail, status: 'pending' },
      undefined,
      5000,
    ).catch((err) => {
      console.error('scheduled SMS query failed:', err?.message || err);
      results.failures += 1;
      return null;
    });
    const canceledAt = at;
    for (const row of (pendingSms || [])) {
      const ok = await revoke(
        'scheduled SMS cancel',
        entities.ScheduledSms,
        row,
        {
          status: 'canceled',
          canceled_at: canceledAt,
          canceled_by: currentUser.email,
        },
      );
      if (ok) results.scheduled_sms_canceled += 1;
    }
  } catch (err) {
    console.error('scheduled SMS cancel failed:', err?.message || err);
    results.failures += 1;
  }

  try {
    const pendingFaxes = await base44.asServiceRole.entities.ScheduledFax.filter(
      { created_by: targetEmail, status: 'pending' },
      undefined,
      5000,
    ).catch((err) => {
      console.error('scheduled fax query failed:', err?.message || err);
      results.failures += 1;
      return null;
    });
    for (const row of (pendingFaxes || [])) {
      const ok = await revoke(
        'scheduled fax cancel',
        entities.ScheduledFax,
        row,
        {
          status: 'cancelled',
          // Durable cancel stamp — claim may overwrite status to 'processing'
          // but must not clear canceled_at (parity with ScheduledSms).
          canceled_at: at,
          canceled_by: currentUser.email,
        },
      );
      if (ok) results.scheduled_faxes_canceled += 1;
    }
  } catch (err) {
    console.error('scheduled fax cancel failed:', err?.message || err);
    results.failures += 1;
  }

  try {
    const pendingSigReminders = await base44.asServiceRole.entities.ScheduledSignatureReminder.filter(
      { requested_by: targetEmail, status: 'pending' },
      undefined,
      5000,
    ).catch((err) => {
      console.error('signature reminder query failed:', err?.message || err);
      results.failures += 1;
      return null;
    });
    for (const row of (pendingSigReminders || [])) {
      const ok = await revoke(
        'signature reminder cancel',
        entities.ScheduledSignatureReminder,
        row,
        {
          status: 'canceled',
          canceled_at: at,
          canceled_by: currentUser.email,
        },
      );
      if (ok) results.signature_reminders_canceled += 1;
    }
  } catch (err) {
    console.error('signature reminder cancel failed:', err?.message || err);
    results.failures += 1;
  }

  await recheckRevokedMemberships(
    'Membership set changed before offboarding completion; reconciliation is required',
  );

  await base44.asServiceRole.entities.UserActivity.create({
    user_email: currentUser.email,
    user_name: currentUser.full_name,
    action: 'user_offboarded',
    details: {
      target_user_email: targetEmail,
      target_user_id: userId,
      reason: note.slice(0, 200),
      ...results,
      platform_session_revocation: 'client_shell_blocked; entity_api_policy_pending',
    },
    page: 'UserManagement',
    entity_type: 'User',
    entity_id: userId,
  }).catch((err) => console.error('offboard audit failed:', err?.message || err));

  // The account is deactivated either way, but a caller who is told the cleanup
  // succeeded will not go looking for leftover access. Report partial sweeps.
  const clean = results.failures === 0 && !results.sweep_truncated;
  return Response.json({
    success: true,
    complete: clean,
    message: clean
      ? 'User offboarded: account deactivated, patients unassigned, work number released, on-call cleared.'
      : 'User deactivated, but some access revocation did not complete. Review the offboarding audit entry and re-run.',
    results,
  });
}

async function reactivateUser(
  base44,
  currentUser,
  params,
  callerIsSuperAdmin,
  actorId,
  actorEmail,
) {
  const { user_id } = params;
  const userId = exactIdentifier(user_id);
  if (!userId) {
    return Response.json({ error: 'user_id is required' }, { status: 400 });
  }

  const entities = base44.asServiceRole.entities;
  const { targetUser, normalizedEmail } = await loadExactTargetUser(entities, userId);
  if (targetUser.is_active !== false) {
    throw new PublicError(409, 'User is already active');
  }

  const targetIsPrivileged = targetUser.role === 'admin';
  // No self-exemption here on purpose. Reactivating yourself is exactly the
  // move an offboarded administrator would make to undo their own offboarding,
  // and offboardUser() already refuses self-targeting for the same reason.
  if (targetIsPrivileged && !callerIsSuperAdmin) {
    return Response.json({
      error: 'Only a super admin can reactivate an administrator account, including your own.',
    }, { status: 403 });
  }

  const memberships = await loadTargetMemberships(entities, userId, normalizedEmail);
  if (memberships.some((row) => row.status !== 'revoked')) {
    throw new PublicError(
      409,
      'User cannot be reactivated while a non-revoked tenant membership remains',
    );
  }

  const recheckRevokedMemberships = (message) => requireExactRevokedMembershipSet(
    entities,
    memberships,
    userId,
    normalizedEmail,
    message,
  );

  const reactivatedUser = await updateExactTargetUser(entities, targetUser, {
    is_active: true,
    duty_status: 'available',
    offboarded_at: '',
    offboarded_by: '',
    offboarding_reason: '',
  }, {
    preimage: 'Target User changed during reactivation; tenant authority remains revoked and no User update was attempted',
    write: 'User reactivation failed; tenant authority remains revoked',
    readback: 'User reactivation could not be reconciled; tenant authority remains revoked',
  }, () => recheckRevokedMemberships(
    'Membership set changed during reactivation; User was not reactivated',
  ));

  try {
    await recheckRevokedMemberships(
      'Membership set changed after User reactivation',
    );
  } catch {
    try {
      await updateExactTargetUser(entities, reactivatedUser, {
        is_active: false,
        duty_status: 'off_duty',
        offboarded_at: typeof targetUser.offboarded_at === 'string' ? targetUser.offboarded_at : '',
        offboarded_by: typeof targetUser.offboarded_by === 'string' ? targetUser.offboarded_by : '',
        offboarding_reason: typeof targetUser.offboarding_reason === 'string'
          ? targetUser.offboarding_reason
          : '',
      }, {
        preimage: 'Membership set changed during reactivation; User rollback preimage changed and requires manual intervention',
        write: 'Membership set changed during reactivation; User rollback failed and requires manual intervention',
        readback: 'Membership set changed during reactivation; User rollback could not be reconciled and requires manual intervention',
      });
    } catch (rollbackError) {
      if (rollbackError instanceof PublicError) throw rollbackError;
      throw new PublicError(
        409,
        'Membership set changed during reactivation; User rollback failed and requires manual intervention',
      );
    }
    throw new PublicError(
      409,
      'Membership set changed during reactivation; User was deactivated again',
    );
  }

  await base44.asServiceRole.entities.UserActivity.create({
    user_email: actorEmail,
    user_name: currentUser.full_name,
    action: 'user_reactivated',
    details: {
      target_user_email: targetUser.email,
      target_user_id: userId,
      membership_authority_restored: false,
      membership_reprovisioning_required: true,
      membership_reprovisioning_available: false,
      reactivated_by_user_id: actorId,
    },
    page: 'UserManagement',
    entity_type: 'User',
    entity_id: userId,
  }).catch(() => {});

  return Response.json({
    success: true,
    membership_authority_restored: false,
    membership_reprovisioning_required: true,
    membership_reprovisioning_available: false,
    message: 'User identity reactivated without tenant authority. Revoked memberships remain terminal until a separate owner-controlled rehire workflow is implemented.',
  });
}
