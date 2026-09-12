import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';

// <<<BEGIN SHARED HELPER: outboundDeliveryGate — generated, edit base44/_shared/backendHelpers.mjs>>>
const OUTBOUND_DELIVERY_RELEASE_ENV = 'OUTBOUND_DELIVERY_RELEASE';
const OUTBOUND_DELIVERY_RELEASE_VALUE = 'enabled-v1';
function outboundDeliveryReleased() {
  return Deno.env.get(OUTBOUND_DELIVERY_RELEASE_ENV)
    === OUTBOUND_DELIVERY_RELEASE_VALUE;
}
function outboundDeliveryPausedResponse(channel = 'outbound') {
  return Response.json({
    error: 'Outbound delivery is disabled in this environment.',
    code: 'OUTBOUND_DELIVERY_RELEASE_PAUSED',
    channel,
    retryable: false,
  }, {
    status: 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
// <<<END SHARED HELPER: outboundDeliveryGate>>>

/**
 * Exact, one-attempt scheduled signature reminder dispatcher.
 *
 * A provider-call exception is an indeterminate delivery, never a retryable
 * failure. This prevents a scheduler replay from emailing two bearer links.
 */
const SIGNATURE_REMINDER_DISPATCH_ENABLED = false;
const SIGNATURE_REMINDER_ATOMIC_UNIQUENESS_PROVEN = true;
const MAX_IDENTIFIER_LENGTH = 200;
const EXACT_ROW_LIMIT = 10;
const BATCH_LIMIT = 100;
const MAX_PACKAGE_DOCUMENTS = 25;
const CLAIM_LEASE_MS = 20 * 60 * 1000;

class PublicError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'PublicError';
    this.status = status;
  }
}

function exactIdentifier(value: unknown) {
  if (typeof value !== 'string' || !value || value.length > MAX_IDENTIFIER_LENGTH
      || value.trim() !== value || value.startsWith('$')
      || [...value].some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)) return null;
  return value;
}

function canonicalEmail(value: unknown) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email && email.length <= 320 && email.includes('@') && !/\s/.test(email) ? email : null;
}

// <<<BEGIN SHARED HELPER: signatureFileAndDeadline — generated, edit base44/_shared/backendHelpers.mjs>>>
function isPrivateFileUri(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096
    && !/\s/.test(value) && ![...value].some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)
    && (value.startsWith('private/') || value.startsWith('private://')
      || /^mp\/private\/[a-f0-9]{24}\/[^?#]+$/.test(value));
}

function dueDateEnd(value) {
  if (typeof value !== 'string') return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (!dateOnly && !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const calendar = value.slice(0, 10);
  const calendarMillis = Date.parse(calendar + 'T00:00:00.000Z');
  if (!Number.isFinite(calendarMillis) || new Date(calendarMillis).toISOString().slice(0, 10) !== calendar) return null;
  const millis = Date.parse(dateOnly ? value + 'T23:59:59.999Z' : value);
  return Number.isFinite(millis) ? millis : null;
}
// <<<END SHARED HELPER: signatureFileAndDeadline>>>

function validInstant(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function exactDigest(value: unknown) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : null;
}

function deriveAuthorityDeadline(pkg: Record<string, any>, signatures: Array<Record<string, any>>) {
  const deadlines: number[] = [];
  if (pkg.due_date != null) {
    const packageDeadline = dueDateEnd(pkg.due_date);
    if (packageDeadline == null) throw new PublicError(409, 'Signature package deadline is invalid');
    deadlines.push(packageDeadline);
  }
  for (const field of ['expires_at', 'expiration_date']) {
    if (pkg[field] == null) continue;
    if (!validInstant(pkg[field])) throw new PublicError(409, 'Signature package deadline is invalid');
    deadlines.push(Date.parse(pkg[field]));
  }
  for (const signature of signatures) {
    if (signature?.due_date != null) {
      const signatureDue = dueDateEnd(signature.due_date);
      if (signatureDue == null) throw new PublicError(409, 'Signature document due date is invalid');
      deadlines.push(signatureDue);
    }
    for (const field of ['expires_at', 'expiration_date']) {
      const value = signature?.[field];
      if (value == null) continue;
      if (!validInstant(value)) throw new PublicError(409, 'Signature document deadline is invalid');
      deadlines.push(Date.parse(value));
    }
  }
  if (!deadlines.length) throw new PublicError(409, 'Signature deadline authority is unavailable');
  const deadline = Math.min(...deadlines);
  if (deadline <= Date.now()) throw new PublicError(409, 'Signature package has expired');
  return new Date(deadline).toISOString();
}

function requireRows(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`${label} returned a non-array result`);
  return value as Array<Record<string, any>>;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(left: string, right: string) {
  if (!left || left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

function isPlatformOwner(user: Record<string, any> | null) {
  const configured = canonicalEmail(Deno.env.get('SUPER_ADMIN_EMAIL'));
  return !!user && user.role === 'admin' && !!configured && canonicalEmail(user.email) === configured
    && user.is_active !== false && user.disabled !== true && user.is_service !== true && user.is_verified !== false;
}

function schedulerAuthorized(req: Request, user: Record<string, any> | null) {
  if (isPlatformOwner(user)) return true;
  const expected = String(Deno.env.get('INTERNAL_FN_SECRET') || '').trim();
  const provided = String(req.headers.get('x-internal-secret') || '').trim();
  if (!expected) throw new PublicError(500, 'Scheduler authentication is not configured');
  return timingSafeEqual(provided, expected);
}

function signerPortalOrigin() {
  const raw = String(Deno.env.get('APP_PUBLIC_URL') || '').trim();
  let url: URL;
  try { url = new URL(raw); } catch { throw new PublicError(500, 'Signer portal is not configured'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new PublicError(500, 'Signer portal is not configured');
  }
  return url.origin;
}

function generateToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function exactOne(entity: Record<string, any>, query: Record<string, any>, label: string) {
  const rows = requireRows(await entity.filter(query, undefined, EXACT_ROW_LIMIT), `${label}.filter`);
  if (rows.length !== 1) throw new PublicError(409, `${label} authority is ambiguous or unavailable`);
  for (const [key, value] of Object.entries(query)) {
    if (rows[0]?.[key] !== value) throw new PublicError(409, `${label} query scope could not be verified`);
  }
  return rows[0];
}

function validateReminder(row: Record<string, any>) {
  const id = exactIdentifier(row.id);
  const agencyId = exactIdentifier(row.agency_id);
  const packageId = exactIdentifier(row.package_id);
  const signerId = exactIdentifier(row.signer_id);
  const documentId = exactIdentifier(row.document_id);
  const requestId = exactIdentifier(row.client_request_id);
  const requesterId = exactIdentifier(row.requested_by_user_id);
  const requesterEmail = canonicalEmail(row.requested_by);
  const membershipId = exactIdentifier(row.requesting_membership_id);
  const auditEventId = exactIdentifier(row.audit_event_id);
  if (!id || !agencyId || !packageId || !signerId || !documentId || !requestId || !requesterId
      || !requesterEmail || row.requested_by !== requesterEmail || !membershipId || !auditEventId
      || !exactIdentifier(row.creation_claim_token) || !exactIdentifier(row.audit_write_operation_id)
      || !exactDigest(row.schedule_key) || !validInstant(row.send_at) || !validInstant(row.deadline_date)
      || !validInstant(row.audit_confirmed_at)
      || row.status !== 'pending' || row.delivery_state !== 'not_started'
      || row.claimed_by != null || row.claimed_at != null || row.delivery_attempt_id != null
      || !Number.isSafeInteger(row.attempts) || row.attempts < 0
      || !Number.isSafeInteger(row.authority_version) || row.authority_version < 1
      || !Number.isSafeInteger(row.requesting_membership_version) || row.requesting_membership_version < 1) {
    throw new PublicError(409, 'Scheduled signature reminder integrity is invalid');
  }
  return { ...row, id, agencyId, packageId, signerId, documentId, requestId,
    requesterId, requesterEmail, membershipId, auditEventId };
}

async function loadDispatchTarget(entities: Record<string, any>, reminder: Record<string, any>) {
  const agency = await exactOne(entities.Agency, { id: reminder.agencyId }, 'Agency');
  if (!['active', 'trial'].includes(agency.status)) throw new PublicError(409, 'Agency is unavailable');
  const requesterMembership = await exactOne(entities.AgencyMembership,
    { id: reminder.membershipId, agency_id: reminder.agencyId, user_id: reminder.requesterId }, 'AgencyMembership');
  if (requesterMembership.status !== 'active' || requesterMembership.version !== reminder.requesting_membership_version
      || canonicalEmail(requesterMembership.user_email_normalized) !== reminder.requesterEmail
      || !['agency_admin', 'manager'].includes(requesterMembership.tenant_role)) {
    throw new PublicError(409, 'Reminder requester authority is no longer valid');
  }
  const pkg = await exactOne(entities.DocumentPackage,
    { id: reminder.packageId, agency_id: reminder.agencyId }, 'DocumentPackage');
  if (pkg.reminder_creation_claims?.[reminder.schedule_key] !== reminder.creation_claim_token) {
    throw new PublicError(409, 'Signature reminder creation authority is invalid');
  }
  const patientId = exactIdentifier(pkg.patient_id);
  const creatorId = exactIdentifier(pkg.created_by_user_id);
  const creatorEmail = canonicalEmail(pkg.created_by_user_email_normalized);
  const creatorMembershipId = exactIdentifier(pkg.creator_membership_id);
  const documentIds = Array.isArray(pkg.document_signatures) ? pkg.document_signatures.map(exactIdentifier) : [];
  const signerEmail = canonicalEmail(pkg.signer_email);
  if (!patientId || !creatorId || !creatorEmail || !creatorMembershipId || !signerEmail
      || pkg.signer_id !== reminder.signerId || !documentIds.includes(reminder.documentId)
      || documentIds.includes(null) || documentIds.length < 1 || documentIds.length > MAX_PACKAGE_DOCUMENTS
      || new Set(documentIds).size !== documentIds.length
      || !Number.isSafeInteger(pkg.creator_membership_version) || pkg.creator_membership_version < 1
      || !Number.isSafeInteger(pkg.authority_version) || pkg.authority_version < 1
      || !['pending', 'in_progress'].includes(pkg.status)) {
    throw new PublicError(409, 'Signature package integrity check failed');
  }
  const creatorMembership = await exactOne(entities.AgencyMembership,
    { id: creatorMembershipId, agency_id: reminder.agencyId, user_id: creatorId }, 'AgencyMembership');
  if (creatorMembership.status !== 'active' || creatorMembership.version !== pkg.creator_membership_version
      || canonicalEmail(creatorMembership.user_email_normalized) !== creatorEmail) {
    throw new PublicError(409, 'Signature creator authority is no longer valid');
  }
  await exactOne(entities.Patient,
    { id: patientId, agency_id: reminder.agencyId, is_sample: false, is_archived: false }, 'Patient');

  let pending = false;
  let documentTitle = 'Document';
  let sourceDigest = null;
  const authoritySignatures: Array<Record<string, any>> = [];
  for (const signatureId of documentIds as string[]) {
    const signature = await exactOne(entities.DocumentSignature,
      { id: signatureId, agency_id: reminder.agencyId }, 'DocumentSignature');
    const signer = (Array.isArray(signature.signers) ? signature.signers : [])
      .find((candidate) => candidate?.signer_id === reminder.signerId);
    if (!signer || canonicalEmail(signer.email) !== signerEmail || signer.email !== signerEmail
        || signer.required !== true || !['pending', 'completed'].includes(signer.status)
        || signature.patient_id !== patientId || signature.created_by_user_id !== creatorId
        || signature.creator_membership_id !== creatorMembershipId
        || signature.creator_membership_version !== pkg.creator_membership_version
        || !exactIdentifier(signature.document_id) || !exactIdentifier(signature.document_binding_id)
        || signature.document_binding_version !== 2 || !exactDigest(signature.document_content_sha256)
        || !Number.isSafeInteger(signature.authority_version) || signature.authority_version < 1
        || signature.document_url != null || signature.document_content != null || signature.signed_pdf_url != null) {
      throw new PublicError(409, 'Signature document integrity check failed');
    }
    const binding = await exactOne(entities.DocumentTenantBinding, {
      id: signature.document_binding_id, agency_id: reminder.agencyId, document_id: signature.document_id,
    }, 'DocumentTenantBinding');
    if (binding.patient_id !== patientId || binding.storage_mode !== 'private' || binding.version !== 2
        || !isPrivateFileUri(binding.file_uri)
        || binding.content_sha256 !== signature.document_content_sha256) {
      throw new PublicError(409, 'Signature source binding is invalid');
    }
    authoritySignatures.push(signature);
    if (signatureId === reminder.documentId) {
      pending = signer.status === 'pending';
      documentTitle = String(signature.document_title || signature.document_name || 'Document').slice(0, 200);
      sourceDigest = signature.document_content_sha256;
    }
  }
  const deadline = deriveAuthorityDeadline(pkg, authoritySignatures);
  if (reminder.deadline_date !== deadline || Date.parse(reminder.send_at) > Date.parse(deadline)) {
    throw new PublicError(409, 'Signature reminder deadline authority changed');
  }
  const scheduleEventKey = await sha256(
    `reminder_scheduled\0${reminder.id}\0${reminder.requestId}`,
  );
  const scheduleAudit = await exactOne(entities.SignatureAuditEvent, {
    id: reminder.auditEventId,
    event_key: scheduleEventKey,
  }, 'SignatureAuditEvent');
  if (scheduleAudit.agency_id !== reminder.agencyId
      || scheduleAudit.package_id !== reminder.packageId
      || scheduleAudit.document_signature_id !== reminder.documentId
      || scheduleAudit.signer_id !== reminder.signerId
      || scheduleAudit.action !== 'reminder_scheduled'
      || scheduleAudit.actor_type !== 'authenticated_user'
      || scheduleAudit.actor_user_id !== reminder.requesterId
      || scheduleAudit.membership_id !== reminder.membershipId
      || scheduleAudit.membership_version !== reminder.requesting_membership_version
      || scheduleAudit.request_id !== reminder.requestId
      || scheduleAudit.authority_version !== 1
      || scheduleAudit.document_content_sha256 !== sourceDigest
      || !validInstant(scheduleAudit.occurred_at)
      || Date.parse(scheduleAudit.occurred_at) > Date.parse(reminder.audit_confirmed_at)) {
    throw new PublicError(409, 'Signature reminder schedule audit is invalid');
  }
  return { pkg, patientId, creatorId, creatorMembershipId, signerEmail,
    signerName: String(pkg.signer_name || 'Signer').slice(0, 200), documentIds,
    pending, documentTitle, sourceDigest, deadline };
}

async function audit(entities: Record<string, any>, payload: Record<string, any>) {
  let existing = requireRows(await entities.SignatureAuditEvent.filter(
    { event_key: payload.event_key }, undefined, EXACT_ROW_LIMIT,
  ), 'SignatureAuditEvent.filter');
  if (existing.length > 1) throw new Error('Signature audit identity is ambiguous');
  if (existing.length === 0) {
    try { await entities.SignatureAuditEvent.create(payload); } catch {
      // A create response may be lost after commit. Exact readback below is the
      // only evidence that this audit identity is durable and unambiguous.
    }
    existing = requireRows(await entities.SignatureAuditEvent.filter(
      { event_key: payload.event_key }, undefined, EXACT_ROW_LIMIT,
    ), 'SignatureAuditEvent.filter');
  }
  if (existing.length !== 1 || !exactIdentifier(existing[0]?.id)
      || Object.entries(payload).some(([key, value]) => existing[0]?.[key] !== value)) {
    throw new Error('Signature audit could not be verified');
  }
  return existing[0];
}

function htmlEscape(value: unknown) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function settleReminder(entities: Record<string, any>, reminder: Record<string, any>, values: Record<string, any>) {
  const result = await entities.ScheduledSignatureReminder.updateMany(
    { id: reminder.id, status: 'sending', claimed_by: reminder.claimed_by,
      authority_version: reminder.authority_version },
    { $set: { ...values, authority_version: reminder.authority_version + 1 } },
  );
  return result?.updated === 1;
}

async function quarantinePendingReminder(
  entities: Record<string, any>,
  row: Record<string, any>,
  reason: string,
) {
  const id = exactIdentifier(row?.id);
  if (!id || row?.status !== 'pending' || !validInstant(row?.updated_date)) return false;
  const version = Number.isSafeInteger(row?.authority_version) && row.authority_version >= 1
    ? row.authority_version
    : 0;
  const result = await entities.ScheduledSignatureReminder.updateMany(
    { id, status: 'pending', updated_date: row.updated_date },
    { $set: {
      status: 'failed', delivery_state: 'rejected', claimed_by: null, claimed_at: null,
      failure_reason: reason, attempts: Number.isSafeInteger(row?.attempts) && row.attempts >= 0
        ? row.attempts + 1
        : 1,
      authority_version: version + 1,
    } },
  ).catch(() => null);
  return result?.updated === 1;
}

async function quarantineDuplicateReminderKey(
  entities: Record<string, any>,
  row: Record<string, any>,
) {
  return quarantinePendingReminder(
    entities,
    row,
    'Duplicate reminder schedule identity; automatic delivery is blocked',
  );
}

async function quarantineStaleReminderClaims(entities: Record<string, any>) {
  const staleBefore = new Date(Date.now() - CLAIM_LEASE_MS).toISOString();
  const rows = requireRows(await entities.ScheduledSignatureReminder.filter(
    { status: 'sending', delivery_state: 'pending' }, 'claimed_at', BATCH_LIMIT,
  ), 'ScheduledSignatureReminder.filter');
  let quarantined = 0;
  for (const row of rows) {
    const id = exactIdentifier(row?.id);
    const claimId = exactIdentifier(row?.claimed_by);
    const deliveryAttemptId = exactIdentifier(row?.delivery_attempt_id);
    const validClaim = !!id && !!claimId && !!deliveryAttemptId && validInstant(row?.claimed_at)
      && Number.isSafeInteger(row?.authority_version) && row.authority_version >= 1
      && Number.isSafeInteger(row?.attempts) && row.attempts >= 0;
    if (!validClaim) {
      if (!id || !validInstant(row?.updated_date)) continue;
      const version = Number.isSafeInteger(row?.authority_version) && row.authority_version >= 1
        ? row.authority_version
        : 0;
      const invalid = await entities.ScheduledSignatureReminder.updateMany(
        { id, status: 'sending', updated_date: row.updated_date },
        { $set: {
          status: 'indeterminate', delivery_state: 'indeterminate', claimed_by: null,
          claimed_at: null, failure_reason: 'Invalid dispatch claim; automatic resend is blocked',
          attempts: Number.isSafeInteger(row?.attempts) && row.attempts >= 0 ? row.attempts + 1 : 1,
          authority_version: version + 1,
        } },
      ).catch(() => null);
      if (invalid?.updated === 1) quarantined += 1;
      continue;
    }
    if (row.claimed_at >= staleBefore) continue;
    const result = await entities.ScheduledSignatureReminder.updateMany(
      {
        id,
        status: 'sending',
        delivery_state: 'pending',
        claimed_by: claimId,
        claimed_at: row.claimed_at,
        delivery_attempt_id: deliveryAttemptId,
        authority_version: row.authority_version,
      },
      { $set: {
        status: 'indeterminate',
        delivery_state: 'indeterminate',
        claimed_by: null,
        claimed_at: null,
        attempts: row.attempts + 1,
        failure_reason: 'Dispatch claim expired; provider delivery may have started and automatic resend is blocked',
        authority_version: row.authority_version + 1,
      } },
    ).catch(() => null);
    if (result?.updated !== 1) continue;
    quarantined += 1;
    if (exactIdentifier(row.agency_id) && exactIdentifier(row.package_id)
        && exactIdentifier(row.document_id) && exactIdentifier(row.signer_id)) {
      await audit(entities, {
        event_key: await sha256(`reminder_stale_indeterminate\0${id}\0${deliveryAttemptId}`),
        agency_id: row.agency_id,
        package_id: row.package_id,
        document_signature_id: row.document_id,
        signer_id: row.signer_id,
        action: 'reminder_indeterminate',
        actor_type: 'scheduler',
        request_id: deliveryAttemptId,
        authority_version: row.authority_version + 1,
        occurred_at: new Date().toISOString(),
      }).catch(() => null);
    }
  }
  return quarantined;
}

Deno.serve(async (req) => {
  if (!SIGNATURE_REMINDER_DISPATCH_ENABLED || !SIGNATURE_REMINDER_ATOMIC_UNIQUENESS_PROVEN) {
    return Response.json(
      { error: 'Signature reminders are temporarily unavailable.', code: 'signature_reminder_dispatch_unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } },
    );
  }
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!schedulerAuthorized(req, user)) throw new PublicError(user ? 403 : 401, 'Scheduler authorization required');
    if (!outboundDeliveryReleased()) return outboundDeliveryPausedResponse('email');
    const entities = base44.asServiceRole.entities;
    const staleIndeterminate = await quarantineStaleReminderClaims(entities);
    const pendingRows = requireRows(await entities.ScheduledSignatureReminder.filter(
      { status: 'pending', delivery_state: 'not_started' }, 'send_at', BATCH_LIMIT,
    ), 'ScheduledSignatureReminder.filter');
    const summary = { checked: pendingRows.length, processed: 0, sent: 0, canceled: 0,
      indeterminate: staleIndeterminate, stale_indeterminate: staleIndeterminate,
      quarantined: 0, audit_failures: 0 };
    for (const candidate of pendingRows) {
      let reminder: Record<string, any>;
      try { reminder = validateReminder(candidate); } catch {
        if (await quarantinePendingReminder(
          entities,
          candidate,
          'Invalid reminder provenance; automatic delivery is blocked',
        )) summary.quarantined += 1;
        continue;
      }
      if (Date.parse(reminder.send_at) > Date.now()) continue;
      const duplicateRows = requireRows(await entities.ScheduledSignatureReminder.filter(
        { schedule_key: reminder.schedule_key }, undefined, EXACT_ROW_LIMIT,
      ), 'ScheduledSignatureReminder.filter');
      if (duplicateRows.length !== 1 || duplicateRows[0]?.id !== reminder.id) {
        for (const duplicate of duplicateRows) {
          if (await quarantineDuplicateReminderKey(entities, duplicate)) summary.quarantined += 1;
        }
        continue;
      }
      const runId = crypto.randomUUID();
      const deliveryAttemptId = crypto.randomUUID();
      const claimAt = new Date().toISOString();
      const claim = await entities.ScheduledSignatureReminder.updateMany(
        { id: reminder.id, status: 'pending', delivery_state: 'not_started',
          authority_version: reminder.authority_version },
        { $set: { status: 'sending', delivery_state: 'pending', claimed_by: runId,
          claimed_at: claimAt, delivery_attempt_id: deliveryAttemptId,
          authority_version: reminder.authority_version + 1 } },
      ).catch(() => null);
      if (claim?.updated !== 1) continue;
      reminder = { ...reminder, status: 'sending', delivery_state: 'pending', claimed_by: runId,
        claimed_at: claimAt, delivery_attempt_id: deliveryAttemptId,
        authority_version: reminder.authority_version + 1 };
      summary.processed += 1;
      const postClaimDuplicates = requireRows(await entities.ScheduledSignatureReminder.filter(
        { schedule_key: reminder.schedule_key }, undefined, EXACT_ROW_LIMIT,
      ), 'ScheduledSignatureReminder.filter');
      if (postClaimDuplicates.length !== 1 || postClaimDuplicates[0]?.id !== reminder.id) {
        await settleReminder(entities, reminder, {
          status: 'indeterminate', delivery_state: 'indeterminate',
          failure_reason: 'Duplicate reminder identity appeared after claim; delivery was not attempted',
          attempts: reminder.attempts + 1,
        }).catch(() => false);
        for (const duplicate of postClaimDuplicates) {
          if (duplicate?.id !== reminder.id
              && await quarantineDuplicateReminderKey(entities, duplicate)) summary.quarantined += 1;
        }
        summary.indeterminate += 1;
        continue;
      }
      let target: Record<string, any>;
      try { target = await loadDispatchTarget(entities, reminder); } catch {
        await settleReminder(entities, reminder, {
          status: 'canceled', delivery_state: 'rejected', canceled_at: new Date().toISOString(),
          failure_reason: 'Signature authority is no longer valid', attempts: reminder.attempts + 1,
        }).catch(() => false);
        summary.canceled += 1;
        continue;
      }
      if (!target.pending) {
        await settleReminder(entities, reminder, {
          status: 'canceled', delivery_state: 'rejected', canceled_at: new Date().toISOString(),
          failure_reason: 'Signer completed before reminder dispatch', attempts: reminder.attempts + 1,
        }).catch(() => false);
        await audit(entities, {
          event_key: await sha256(`reminder_canceled\0${reminder.id}\0${deliveryAttemptId}`),
          agency_id: reminder.agencyId, package_id: reminder.packageId,
          document_signature_id: reminder.documentId, signer_id: reminder.signerId,
          action: 'reminder_canceled', actor_type: 'scheduler', request_id: deliveryAttemptId,
          authority_version: reminder.authority_version + 1, occurred_at: new Date().toISOString(),
        }).catch(() => null);
        summary.canceled += 1;
        continue;
      }

      let tokenId = null;
      let externalStarted = false;
      try {
        const oldTokens = requireRows(await entities.DocumentPackageToken.filter(
          { agency_id: reminder.agencyId, package_id: reminder.packageId,
            signer_id: reminder.signerId, status: 'active' }, '-created_date', EXACT_ROW_LIMIT,
        ), 'DocumentPackageToken.filter');
        if (oldTokens.length >= EXACT_ROW_LIMIT) throw new PublicError(409, 'Active signer-token identity is ambiguous');
        for (const old of oldTokens) {
          if (!exactIdentifier(old.id) || !Number.isSafeInteger(old.authority_version)) {
            throw new PublicError(409, 'Active signer-token identity is invalid');
          }
          const revoked = await entities.DocumentPackageToken.updateMany(
            { id: old.id, status: 'active', authority_version: old.authority_version },
            { $set: { status: 'revoked', is_active: false, revoked_at: new Date().toISOString(),
              authority_version: old.authority_version + 1 } },
          );
          if (revoked?.updated !== 1) throw new PublicError(409, 'Active signer token changed during rotation');
        }
        const plaintext = generateToken();
        const tokenDigest = await sha256(plaintext);
        const now = new Date().toISOString();
        const expiresAt = new Date(Math.min(
          Date.now() + 72 * 60 * 60 * 1000,
          Date.parse(target.deadline),
        )).toISOString();
        if (Date.parse(expiresAt) <= Date.now()) throw new PublicError(409, 'Signature deadline has expired');
        const token = await entities.DocumentPackageToken.create({
          agency_id: reminder.agencyId, package_id: reminder.packageId,
          document_ids: target.documentIds, token: tokenDigest, token_hashed: true,
          signer_id: reminder.signerId, signer_email: target.signerEmail, signer_name: target.signerName,
          status: 'active', authority_version: 1, created_by_user_id: target.creatorId,
          creator_membership_id: target.creatorMembershipId,
          creator_membership_version: target.pkg.creator_membership_version,
          token_request_id: deliveryAttemptId, token_created_at: now, expires_at: expiresAt,
          is_active: true, access_count: 0,
        });
        tokenId = exactIdentifier(token?.id);
        if (!tokenId) throw new Error('Reminder token create did not return an id');
        const tokenReadback = await exactOne(entities.DocumentPackageToken,
          { id: tokenId, token: tokenDigest, token_hashed: true }, 'DocumentPackageToken');
        if (tokenReadback.status !== 'active' || tokenReadback.signer_id !== reminder.signerId
            || tokenReadback.token_request_id !== deliveryAttemptId) throw new Error('Reminder token could not be verified');
        await audit(entities, {
          event_key: await sha256(`token_minted\0${tokenId}\0${deliveryAttemptId}`),
          agency_id: reminder.agencyId, package_id: reminder.packageId,
          document_signature_id: reminder.documentId, signer_id: reminder.signerId,
          token_id: tokenId, action: 'token_minted', actor_type: 'scheduler',
          request_id: deliveryAttemptId, authority_version: 1,
          document_content_sha256: target.sourceDigest, occurred_at: now,
        });
        const link = `${signerPortalOrigin()}/signer?token=${encodeURIComponent(plaintext)}`;
        externalStarted = true;
        await base44.asServiceRole.integrations.Core.SendEmail({
          to: target.signerEmail,
          from_name: 'PennSync by CareMetric',
          subject: 'Reminder: a document is waiting for your signature',
          body: `<!doctype html><html><body><p>Hello ${htmlEscape(target.signerName)},</p>`
            + `<p>A document is waiting for your review and signature.</p>`
            + `<p><a href="${htmlEscape(link)}">Review and sign securely</a></p>`
            + '<p>Do not forward this private link. If you did not expect it, contact your care team.</p></body></html>',
        });
        const settled = await settleReminder(entities, reminder, {
          status: 'sent', delivery_state: 'accepted', sent_at: new Date().toISOString(),
          reminder_count: 1, attempts: reminder.attempts + 1, failure_reason: null,
        });
        if (!settled) {
          const current = await exactOne(entities.ScheduledSignatureReminder,
            { id: reminder.id, schedule_key: reminder.schedule_key }, 'ScheduledSignatureReminder');
          if (current.status !== 'sent' || current.delivery_state !== 'accepted'
              || current.delivery_attempt_id !== deliveryAttemptId) {
            await settleReminder(entities, reminder, {
              status: 'indeterminate', delivery_state: 'indeterminate',
              failure_reason: 'Provider accepted the request but the durable state transition was not verified',
              attempts: reminder.attempts + 1,
            }).catch(() => false);
            summary.indeterminate += 1;
            continue;
          }
        }
        try {
          await audit(entities, {
            event_key: await sha256(`reminder_accepted\0${reminder.id}\0${deliveryAttemptId}`),
            agency_id: reminder.agencyId, package_id: reminder.packageId,
            document_signature_id: reminder.documentId, signer_id: reminder.signerId,
            token_id: tokenId, action: 'reminder_accepted', actor_type: 'scheduler',
            request_id: deliveryAttemptId, authority_version: reminder.authority_version + 1,
            document_content_sha256: target.sourceDigest, occurred_at: new Date().toISOString(),
          });
        } catch {
          summary.audit_failures += 1;
        }
        summary.sent += 1;
      } catch {
        if (externalStarted) {
          await settleReminder(entities, reminder, {
            status: 'indeterminate', delivery_state: 'indeterminate',
            failure_reason: 'Email provider outcome is unknown; automatic retry is blocked',
            attempts: reminder.attempts + 1,
          }).catch(() => false);
          await audit(entities, {
            event_key: await sha256(`reminder_indeterminate\0${reminder.id}\0${deliveryAttemptId}`),
            agency_id: reminder.agencyId, package_id: reminder.packageId,
            document_signature_id: reminder.documentId, signer_id: reminder.signerId,
            token_id: tokenId, action: 'reminder_indeterminate', actor_type: 'scheduler',
            request_id: deliveryAttemptId, authority_version: reminder.authority_version + 1,
            document_content_sha256: target.sourceDigest, occurred_at: new Date().toISOString(),
          }).catch(() => null);
          summary.indeterminate += 1;
        } else {
          if (tokenId) {
            const tokenRows = requireRows(await entities.DocumentPackageToken.filter(
              { id: tokenId }, undefined, EXACT_ROW_LIMIT,
            ), 'DocumentPackageToken.filter');
            if (tokenRows.length === 1 && tokenRows[0].status === 'active') {
              await entities.DocumentPackageToken.updateMany(
                { id: tokenId, status: 'active', authority_version: tokenRows[0].authority_version },
                { $set: { status: 'revoked', is_active: false, revoked_at: new Date().toISOString(),
                  authority_version: tokenRows[0].authority_version + 1 } },
              ).catch(() => null);
            }
          }
          await settleReminder(entities, reminder, {
            status: 'failed', delivery_state: 'rejected',
            failure_reason: 'Reminder could not be prepared safely', attempts: reminder.attempts + 1,
          }).catch(() => false);
          summary.quarantined += 1;
        }
      }
    }
    const degraded = summary.audit_failures > 0;
    return Response.json({ success: !degraded, degraded, ...summary, checked_at: new Date().toISOString() },
      { status: degraded ? 503 : 200,
        headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } });
  } catch (error) {
    const status = error instanceof PublicError ? error.status : 500;
    const message = error instanceof PublicError ? error.message : 'Unable to dispatch signature reminders';
    return Response.json({ error: message }, { status,
      headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } });
  }
});
