import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';

/** Authority-bound reminder scheduler. Kept release-gated with public signing. */
const SIGNATURE_REMINDER_RELEASE_ENABLED = false;
// Base44 does not currently expose an atomic unique constraint/create-if-absent
// primitive for schedule_key. Keep a separate literal proof gate so changing the
// product release flag alone can never make a query-then-create race dispatchable.
const SIGNATURE_REMINDER_ATOMIC_UNIQUENESS_PROVEN = false;
const MAX_BODY_BYTES = 10_000;
const MAX_IDENTIFIER_LENGTH = 200;
const EXACT_ROW_LIMIT = 10;
const MAX_FUTURE_DAYS = 90;
const MAX_PACKAGE_DOCUMENTS = 25;
const ALLOWED_ROLES = new Set(['agency_admin', 'manager']);

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

function validInstant(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function exactDigest(value: unknown) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : null;
}

function dueDateEnd(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const instant = Date.parse(`${value}T23:59:59.999Z`);
  if (!Number.isFinite(instant)) return null;
  const roundTrip = new Date(instant).toISOString().slice(0, 10);
  return roundTrip === value ? instant : null;
}

function deriveAuthorityDeadline(pkg: Record<string, any>, signatures: Array<Record<string, any>>) {
  const deadlines: number[] = [];
  if (pkg.due_date != null) {
    const packageDeadline = dueDateEnd(pkg.due_date);
    if (packageDeadline == null) throw new PublicError(409, 'Signature package deadline is invalid');
    deadlines.push(packageDeadline);
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

async function exactOne(entity: Record<string, any>, query: Record<string, any>, label: string) {
  const rows = requireRows(await entity.filter(query, undefined, EXACT_ROW_LIMIT), `${label}.filter`);
  if (rows.length !== 1) throw new PublicError(409, `${label} authority is ambiguous or unavailable`);
  for (const [key, value] of Object.entries(query)) {
    if (rows[0]?.[key] !== value) throw new PublicError(409, `${label} query scope could not be verified`);
  }
  return rows[0];
}

async function parseRequest(req: Request) {
  if (req.method !== 'POST') throw new PublicError(405, 'Method not allowed');
  const length = Number(req.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) throw new PublicError(413, 'Request body is too large');
  const raw = await req.text().catch(() => { throw new PublicError(400, 'Invalid JSON body'); });
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) throw new PublicError(413, 'Request body is too large');
  let body: unknown;
  try { body = JSON.parse(raw); } catch { throw new PublicError(400, 'Invalid JSON body'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new PublicError(400, 'Request body must be an object');
  const record = body as Record<string, unknown>;
  const allowed = new Set(['agency_id', 'package_id', 'signer_id', 'document_id', 'send_at', 'deadline_date', 'client_request_id']);
  if (Object.keys(record).some((key) => !allowed.has(key))) throw new PublicError(400, 'Request contains unsupported fields');
  const agencyId = exactIdentifier(record.agency_id);
  const packageId = exactIdentifier(record.package_id);
  const signerId = exactIdentifier(record.signer_id);
  const documentId = exactIdentifier(record.document_id);
  const clientRequestId = exactIdentifier(record.client_request_id);
  if (!agencyId || !packageId || !signerId || !documentId || !clientRequestId
      || !validInstant(record.send_at)
      || (record.deadline_date != null && !validInstant(record.deadline_date))) {
    throw new PublicError(400, 'Exact signature reminder fields are required');
  }
  const sendAt = new Date(record.send_at as string).toISOString();
  if (Date.parse(sendAt) > Date.now() + MAX_FUTURE_DAYS * 86_400_000
      || (record.deadline_date != null
        && Date.parse(record.deadline_date as string) > Date.now() + MAX_FUTURE_DAYS * 86_400_000)) {
    throw new PublicError(400, 'Signature reminder schedule is invalid');
  }
  return { agencyId, packageId, signerId, documentId, clientRequestId, sendAt };
}

function isPlatformOwner(user: Record<string, any>) {
  const configured = canonicalEmail(Deno.env.get('SUPER_ADMIN_EMAIL'));
  return user?.role === 'admin' && !!configured && canonicalEmail(user.email) === configured;
}

async function loadAuthority(base44: Record<string, any>, agencyId: string) {
  const user = await base44.auth.me().catch(() => null);
  if (!user) throw new PublicError(401, 'Unauthorized');
  if (user.is_active === false || user.disabled === true || user.is_service === true || user.is_verified === false) {
    throw new PublicError(403, 'Forbidden');
  }
  const userId = exactIdentifier(user.id);
  const email = canonicalEmail(user.email);
  if (!userId || !email) throw new PublicError(403, 'Forbidden');
  const entities = base44.asServiceRole.entities;
  if (user.role !== 'user' && !isPlatformOwner(user)) throw new PublicError(403, 'Forbidden');
  // Platform ownership is not tenant membership. An owner may schedule for an
  // agency only when the same immutable User has an exact active membership;
  // never combine the owner's User id with the package creator's membership.
  const membership = await exactOne(
    entities.AgencyMembership,
    { agency_id: agencyId, user_id: userId },
    'AgencyMembership',
  );
  if (!exactIdentifier(membership.id) || membership.membership_key !== `${agencyId}:${userId}`
      || canonicalEmail(membership.user_email_normalized) !== email || membership.status !== 'active'
      || !ALLOWED_ROLES.has(membership.tenant_role)
      || !Number.isSafeInteger(membership.version) || membership.version < 1) {
    throw new PublicError(403, 'No active reminder authority for agency');
  }
  const agency = await exactOne(entities.Agency, { id: agencyId }, 'Agency');
  if (!['active', 'trial'].includes(agency.status)) throw new PublicError(403, 'Agency is unavailable');
  return { entities, userId, email, membership };
}

async function loadReminderTarget(entities: Record<string, any>, input: Record<string, any>) {
  const pkg = await exactOne(entities.DocumentPackage,
    { id: input.packageId, agency_id: input.agencyId }, 'DocumentPackage');
  const patientId = exactIdentifier(pkg.patient_id);
  const creatorId = exactIdentifier(pkg.created_by_user_id);
  const creatorEmail = canonicalEmail(pkg.created_by_user_email_normalized);
  const creatorMembershipId = exactIdentifier(pkg.creator_membership_id);
  const documentIds = Array.isArray(pkg.document_signatures) ? pkg.document_signatures.map(exactIdentifier) : [];
  if (!patientId || !creatorId || !creatorEmail || !creatorMembershipId || !documentIds.includes(input.documentId)
      || documentIds.includes(null) || documentIds.length < 1 || documentIds.length > MAX_PACKAGE_DOCUMENTS
      || new Set(documentIds).size !== documentIds.length || pkg.signer_id !== input.signerId
      || !canonicalEmail(pkg.signer_email) || !Number.isSafeInteger(pkg.creator_membership_version)
      || !Number.isSafeInteger(pkg.authority_version) || pkg.authority_version < 1
      || !['pending', 'in_progress'].includes(pkg.status)) {
    throw new PublicError(409, 'Signature package integrity check failed');
  }
  const membership = await exactOne(entities.AgencyMembership,
    { id: creatorMembershipId, agency_id: input.agencyId, user_id: creatorId }, 'AgencyMembership');
  if (membership.status !== 'active' || membership.version !== pkg.creator_membership_version
      || canonicalEmail(membership.user_email_normalized) !== creatorEmail) {
    throw new PublicError(409, 'Signature request creator authority is no longer valid');
  }
  await exactOne(entities.Patient,
    { id: patientId, agency_id: input.agencyId, is_sample: false, is_archived: false }, 'Patient');
  const signature = await exactOne(entities.DocumentSignature,
    { id: input.documentId, agency_id: input.agencyId }, 'DocumentSignature');
  const signer = (Array.isArray(signature.signers) ? signature.signers : [])
    .find((candidate) => candidate?.signer_id === input.signerId);
  if (!signer || canonicalEmail(signer.email) !== canonicalEmail(pkg.signer_email)
      || signer.email !== canonicalEmail(signer.email) || signer.required !== true || signer.status !== 'pending'
      || signature.patient_id !== patientId || signature.created_by_user_id !== creatorId
      || signature.creator_membership_id !== creatorMembershipId
      || signature.creator_membership_version !== pkg.creator_membership_version
      || !exactIdentifier(signature.document_binding_id) || signature.document_binding_version !== 2
      || !exactDigest(signature.document_content_sha256)
      || !Number.isSafeInteger(signature.authority_version) || signature.authority_version < 1
      || signature.document_url != null || signature.document_content != null || signature.signed_pdf_url != null) {
    throw new PublicError(409, 'Signature reminder target is invalid');
  }
  const binding = await exactOne(entities.DocumentTenantBinding, {
    id: signature.document_binding_id, agency_id: input.agencyId, document_id: signature.document_id,
  }, 'DocumentTenantBinding');
  if (binding.patient_id !== patientId || binding.storage_mode !== 'private' || binding.version !== 2
      || binding.content_sha256 !== signature.document_content_sha256) {
    throw new PublicError(409, 'Signature reminder source binding is invalid');
  }
  const authoritySignatures = [signature];
  for (const memberId of documentIds) {
    if (memberId === input.documentId) continue;
    const member = await exactOne(entities.DocumentSignature,
      { id: memberId, agency_id: input.agencyId }, 'DocumentSignature');
    if (member.patient_id !== patientId || member.created_by_user_id !== creatorId
        || member.creator_membership_id !== creatorMembershipId
        || member.creator_membership_version !== pkg.creator_membership_version
        || !Number.isSafeInteger(member.authority_version) || member.authority_version < 1
        || member.document_url != null || member.document_content != null || member.signed_pdf_url != null) {
      throw new PublicError(409, 'Signature package member authority is invalid');
    }
    authoritySignatures.push(member);
  }
  const deadline = deriveAuthorityDeadline(pkg, authoritySignatures);
  if (Date.parse(input.sendAt) > Date.parse(deadline)) {
    throw new PublicError(400, 'Signature reminder cannot be scheduled after the signing deadline');
  }
  return { pkg, signature, signer, deadline };
}

function reminderMatchesRequest(
  row: Record<string, any>,
  input: Record<string, any>,
  authority: Record<string, any>,
  scheduleKey: string,
) {
  return exactIdentifier(row?.id) === row.id
    && row.agency_id === input.agencyId
    && row.package_id === input.packageId
    && row.signer_id === input.signerId
    && row.document_id === input.documentId
    && row.client_request_id === input.clientRequestId
    && row.schedule_key === scheduleKey
    && row.send_at === input.sendAt
    && row.deadline_date === input.deadline
    && row.requested_by === authority.email
    && row.requested_by_user_id === authority.userId
    && row.requesting_membership_id === authority.membership.id
    && row.requesting_membership_version === authority.membership.version
    && row.delivery_state === 'not_started'
    && row.claimed_by == null
    && row.claimed_at == null
    && row.delivery_attempt_id == null;
}

async function ensureScheduleAudit(
  entities: Record<string, any>,
  reminder: Record<string, any>,
  input: Record<string, any>,
  authority: Record<string, any>,
  target: Record<string, any>,
) {
  const eventKey = await sha256(`reminder_scheduled\0${reminder.id}\0${input.clientRequestId}`);
  const expected = {
    event_key: eventKey,
    agency_id: input.agencyId,
    package_id: input.packageId,
    document_signature_id: input.documentId,
    signer_id: input.signerId,
    action: 'reminder_scheduled',
    actor_type: 'authenticated_user',
    actor_user_id: authority.userId,
    membership_id: authority.membership.id,
    membership_version: authority.membership.version,
    request_id: input.clientRequestId,
    authority_version: 1,
    document_content_sha256: target.signature.document_content_sha256,
  };
  let rows = requireRows(
    await entities.SignatureAuditEvent.filter({ event_key: eventKey }, undefined, EXACT_ROW_LIMIT),
    'SignatureAuditEvent.filter',
  );
  if (rows.length > 1) throw new PublicError(409, 'Signature reminder audit identity is ambiguous');
  if (rows.length === 0) {
    try {
      await entities.SignatureAuditEvent.create({ ...expected, occurred_at: new Date().toISOString() });
    } catch {
      // A create response can be lost after commit. Exact readback below is the
      // only authority for making the reminder dispatchable.
    }
    rows = requireRows(
      await entities.SignatureAuditEvent.filter({ event_key: eventKey }, undefined, EXACT_ROW_LIMIT),
      'SignatureAuditEvent.filter',
    );
  }
  if (rows.length !== 1 || !exactIdentifier(rows[0]?.id) || !validInstant(rows[0]?.occurred_at)
      || Object.entries(expected).some(([key, value]) => rows[0]?.[key] !== value)) {
    throw new Error('Signature reminder audit could not be verified');
  }
  return rows[0];
}

Deno.serve(async (req) => {
  if (!SIGNATURE_REMINDER_RELEASE_ENABLED || !SIGNATURE_REMINDER_ATOMIC_UNIQUENESS_PROVEN) {
    return Response.json(
      { error: 'Signature reminders are temporarily unavailable.', code: 'signature_reminder_schedule_unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } },
    );
  }
  try {
    const input = await parseRequest(req);
    const base44 = createClientFromRequest(req);
    const authority = await loadAuthority(base44, input.agencyId);
    const target = await loadReminderTarget(authority.entities, input);
    const authorizedInput = { ...input, deadline: target.deadline };
    const scheduleKey = await sha256(`${input.agencyId}\0${input.packageId}\0${input.signerId}\0${input.clientRequestId}`);
    const existing = requireRows(await authority.entities.ScheduledSignatureReminder.filter(
      { schedule_key: scheduleKey }, undefined, EXACT_ROW_LIMIT,
    ), 'ScheduledSignatureReminder.filter');
    if (existing.length > 1) throw new PublicError(409, 'Signature reminder request is ambiguous');
    if (existing.length === 1) {
      if (!reminderMatchesRequest(existing[0], authorizedInput, authority, scheduleKey)
          || existing[0].status !== 'pending'
          || !exactIdentifier(existing[0].audit_event_id)
          || !validInstant(existing[0].audit_confirmed_at)) {
        throw new PublicError(409, 'Signature reminder request is not safely replayable');
      }
      return Response.json({ success: true, created: false, reminder_id: existing[0].id,
        status: existing[0].status, send_at: existing[0].send_at },
      { headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } });
    }
    const row = await authority.entities.ScheduledSignatureReminder.create({
      agency_id: input.agencyId, package_id: input.packageId, signer_id: input.signerId,
      schedule_key: scheduleKey, client_request_id: input.clientRequestId,
      document_id: input.documentId,
      document_name: String(target.signature.document_title || target.signature.document_name || 'Document').slice(0, 200),
      deadline_date: target.deadline, send_at: input.sendAt,
      requested_by: authority.email, requested_by_user_id: authority.userId,
      requesting_membership_id: authority.membership.id,
      requesting_membership_version: authority.membership.version,
      // A newly-created queue row is deliberately invisible to the dispatcher
      // until its immutable audit event is durably read back.
      status: 'pending_audit', attempts: 0, authority_version: 1, delivery_state: 'not_started',
    });
    const reminderId = exactIdentifier(row?.id);
    if (!reminderId) throw new Error('Signature reminder create did not return an id');
    const readback = await exactOne(authority.entities.ScheduledSignatureReminder,
      { id: reminderId, schedule_key: scheduleKey }, 'ScheduledSignatureReminder');
    if (readback.status !== 'pending_audit' || readback.authority_version !== 1
        || !validInstant(readback.updated_date)
        || !reminderMatchesRequest(readback, authorizedInput, authority, scheduleKey)) {
      throw new Error('Signature reminder persistence could not be verified');
    }
    const event = await ensureScheduleAudit(
      authority.entities,
      readback,
      authorizedInput,
      authority,
      target,
    );
    const auditConfirmedAt = new Date().toISOString();
    try {
      await authority.entities.ScheduledSignatureReminder.updateMany(
        {
          id: reminderId,
          schedule_key: scheduleKey,
          status: 'pending_audit',
          authority_version: 1,
          updated_date: readback.updated_date,
        },
        { $set: {
          status: 'pending',
          audit_event_id: event.id,
          audit_confirmed_at: auditConfirmedAt,
          authority_version: 2,
        } },
      );
    } catch {
      // Resolve a response lost after commit through exact readback.
    }
    const ready = await exactOne(authority.entities.ScheduledSignatureReminder,
      { id: reminderId, schedule_key: scheduleKey }, 'ScheduledSignatureReminder');
    if (ready.status !== 'pending' || ready.authority_version !== 2
        || ready.audit_event_id !== event.id || ready.audit_confirmed_at !== auditConfirmedAt
        || !reminderMatchesRequest(ready, authorizedInput, authority, scheduleKey)) {
      throw new Error('Signature reminder audit activation could not be verified');
    }
    return Response.json({ success: true, created: true, reminder_id: reminderId,
      status: 'pending', send_at: input.sendAt },
    { headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } });
  } catch (error) {
    const status = error instanceof PublicError ? error.status : 500;
    const message = error instanceof PublicError ? error.message : 'Unable to schedule signature reminder';
    return Response.json({ error: message }, { status,
      headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } });
  }
});
