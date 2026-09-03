import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';

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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PRIORITIES = new Set(['normal', 'high', 'urgent']);
const MAX_RECIPIENTS = 25;
const MAX_ATTACHMENTS = 10;

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

function errorResponse(error, status) {
  return Response.json({ error }, { status });
}

function boundedString(value, name, maxLength, { required = false } = {}) {
  if (value === null || value === undefined) {
    if (required) throw new Error(`${name} is required`);
    return null;
  }
  if (typeof value !== 'string') throw new Error(`${name} must be a string`);
  const result = value.trim();
  if (required && !result) throw new Error(`${name} is required`);
  if (result.length > maxLength) throw new Error(`${name} is too long`);
  return result || null;
}

function uniqueEmails(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (typeof value !== 'string') throw new Error('recipients must contain only email addresses');
    const email = value.trim();
    const key = normalizeEmail(email);
    if (!EMAIL_RE.test(key)) throw new Error('recipients contains an invalid email address');
    if (!seen.has(key)) {
      seen.add(key);
      result.push(email);
    }
  }
  return result;
}

function makeUserLookup(entities) {
  const cache = new Map();
  return async (email) => {
    const key = normalizeEmail(email);
    if (!key) return null;
    if (!cache.has(key)) {
      cache.set(key, (async () => {
        const exact = String(email || '').trim();
        const rows = await entities.User.filter({ email: exact }, '-created_date', 5);
        return (Array.isArray(rows) ? rows : []).find(
          (candidate) => normalizeEmail(candidate?.email) === key,
        ) || null;
      })());
    }
    return cache.get(key);
  };
}

/** Mirrors the explicit patient-access helper used by patient-context functions. */
function assertPatientAccess(user, patient) {
  if (!patient) return errorResponse('Patient not found', 404);
  const caller = normalizeEmail(user.email);
  const assigned = Array.isArray(patient.assigned_nurses) ? patient.assigned_nurses : [];
  if (normalizeEmail(patient.created_by) === caller
    || assigned.some((email) => normalizeEmail(email) === caller)) {
    return null;
  }
  return isProtectedSuperAdmin(user) ? null : errorResponse('Forbidden', 403);
}

function assertReferralAccess(user, referral, patientWasAuthorized) {
  if (!referral) return errorResponse('Referral not found', 404);
  const caller = normalizeEmail(user.email);
  if (normalizeEmail(referral.created_by) === caller
    || normalizeEmail(referral.assigned_to) === caller
    || patientWasAuthorized
    || isProtectedSuperAdmin(user)) {
    return null;
  }
  return errorResponse('Forbidden', 403);
}

function optionalStoredIdentifier(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return null;
  if (!value || value.length > 200 || value.trim() !== value || value.startsWith('$')) return null;
  return value;
}

function hasStoredIdentifier(value) {
  return value !== undefined && value !== null && value !== '';
}

function assertDocumentAccess(user, document) {
  if (!document) return errorResponse('Document not found', 404);
  const caller = normalizeEmail(user.email);
  if (normalizeEmail(document.created_by) === caller
    || isProtectedSuperAdmin(user)) {
    return null;
  }
  return errorResponse('Forbidden', 403);
}

async function getById(entity, id) {
  if (!id) return null;
  const rows = await entity.filter({ id }, '-created_date', 1);
  return (Array.isArray(rows) ? rows : []).find((row) => row?.id === id) || null;
}

function isParticipant(message, email) {
  const key = normalizeEmail(email);
  return normalizeEmail(message?.sender_email) === key
    || normalizeEmail(message?.created_by) === key
    || (Array.isArray(message?.recipients)
      && message.recipients.some((recipient) => normalizeEmail(recipient) === key));
}

function addParticipants(target, values) {
  for (const value of values) {
    const email = normalizeEmail(value);
    if (email) target.add(email);
  }
}

async function loadAndValidateThread(entities, user, threadId, patientId, relatedType, relatedId) {
  if (!threadId) return { denied: null, messages: [] };
  const [threadRows, rootRows] = await Promise.all([
    entities.Message.filter({ thread_id: threadId }, '-created_date', 100),
    entities.Message.filter({ id: threadId }, '-created_date', 1),
  ]);
  // Treat server-side filters as an optimization, not an authorization fact.
  // Recheck identity in memory before any returned row can confer access.
  const existing = [
    ...(Array.isArray(threadRows)
      ? threadRows.filter((message) => message?.thread_id === threadId)
      : []),
    ...(Array.isArray(rootRows)
      ? rootRows.filter((message) => message?.id === threadId)
      : []),
  ];
  if (existing.length === 0) return { denied: null, messages: [] };
  if (!isProtectedSuperAdmin(user)
    && !existing.some((message) => isParticipant(message, user.email))) {
    return { denied: errorResponse('Forbidden', 403), messages: existing };
  }
  if (patientId && existing.some(
    (message) => message.patient_id && message.patient_id !== patientId,
  )) {
    return {
      denied: errorResponse('thread_id belongs to a different patient', 409),
      messages: existing,
    };
  }
  if (!patientId && existing.some((message) => message.patient_id)) {
    return {
      denied: errorResponse('patient_id is required for this thread', 400),
      messages: existing,
    };
  }
  if (relatedType && relatedId && existing.some((message) =>
    message.related_event_type === relatedType
      && message.related_event_id
      && message.related_event_id !== relatedId)) {
    return {
      denied: errorResponse('thread_id belongs to a different related record', 409),
      messages: existing,
    };
  }
  return { denied: null, messages: existing };
}

function validateAttachments(attachments, allowedUrls) {
  if (!Array.isArray(attachments)) throw new Error('attachments must be an array');
  if (attachments.length > MAX_ATTACHMENTS) throw new Error('too many attachments');
  const result = [];
  const seen = new Set();
  for (const value of attachments) {
    if (typeof value !== 'string') throw new Error('attachments must contain only URLs');
    const url = value.trim();
    if (!url || !url.startsWith('https://')) throw new Error('attachments must use HTTPS');
    if (!allowedUrls.has(url)) throw new Error('attachment is not part of the authorized record');
    if (!seen.has(url)) {
      seen.add(url);
      result.push(url);
    }
  }
  return result;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    // The hosted SDK rejects (rather than returning null) for an anonymous
    // request. Normalize that expected authentication failure before the outer
    // operational-error handler so callers receive 401 and no service-role
    // entity is touched.
    const user = await base44.auth.me().catch(() => null);
    if (!user?.email) return errorResponse('Unauthorized', 401);
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return errorResponse('Invalid JSON body', 400);
    }

    let recipients;
    let subject;
    let messageText;
    let patientId;
    let threadId;
    let relatedId;
    let relatedType;
    let referralId;
    let documentId;
    try {
      if (!Array.isArray(body.recipients) || body.recipients.length === 0) {
        throw new Error('recipients is required');
      }
      if (body.recipients.length > MAX_RECIPIENTS) throw new Error('too many recipients');
      recipients = uniqueEmails(body.recipients);
      if (recipients.some((email) => normalizeEmail(email) === normalizeEmail(user.email))) {
        throw new Error('sender cannot also be a recipient');
      }
      subject = boundedString(body.subject, 'subject', 300) || 'No Subject';
      messageText = boundedString(body.message_text, 'message_text', 20000, { required: true });
      patientId = boundedString(body.patient_id, 'patient_id', 200);
      threadId = boundedString(body.thread_id, 'thread_id', 300);
      relatedId = boundedString(body.related_event_id, 'related_event_id', 200);
      relatedType = boundedString(body.related_event_type, 'related_event_type', 30);
      referralId = boundedString(body.referral_id, 'referral_id', 200);
      documentId = boundedString(body.document_id, 'document_id', 200);
      if (relatedId !== null && relatedType === null) throw new Error('related_event_type is required');
      if (relatedType !== null && !['referral', 'document'].includes(relatedType)) {
        throw new Error('related_event_type is not supported');
      }
      if (relatedType === 'referral') {
        if (!relatedId) throw new Error('related_event_id is required');
        if (referralId && referralId !== relatedId) throw new Error('referral identifiers do not match');
        referralId = relatedId;
      }
      if (relatedType === 'document') {
        if (!relatedId) throw new Error('related_event_id is required');
        if (documentId && documentId !== relatedId) throw new Error('document identifiers do not match');
        documentId = relatedId;
      }
      if (referralId && documentId) throw new Error('only one related record may be sent');
      if (referralId && !relatedId) {
        relatedId = referralId;
        relatedType = 'referral';
      }
      if (documentId && !relatedId) {
        relatedId = documentId;
        relatedType = 'document';
      }
    } catch (error) {
      return errorResponse(error?.message || 'Invalid message', 400);
    }

    const entities = base44.asServiceRole.entities;
    const findUser = makeUserLookup(entities);
    const recipientUsers = await Promise.all(recipients.map((email) => findUser(email)));
    if (recipientUsers.some((candidate) =>
      !candidate || candidate.is_active === false || !candidate.email)) {
      return errorResponse('One or more recipients are unavailable', 403);
    }
    recipients = recipientUsers.map((candidate) => String(candidate.email).trim());

    const [referral, document] = await Promise.all([
      getById(entities.Referral, referralId),
      getById(entities.Document, documentId),
    ]);
    if (referralId && !referral) return errorResponse('Referral not found', 404);
    if (documentId && !document) return errorResponse('Document not found', 404);

    const referralPatientId = optionalStoredIdentifier(referral?.patient_id);
    const documentPatientId = optionalStoredIdentifier(document?.patient_id);
    if (referral && hasStoredIdentifier(referral.patient_id) && !referralPatientId) {
      return errorResponse('Referral patient linkage is invalid', 409);
    }
    if (document && hasStoredIdentifier(document.patient_id) && !documentPatientId) {
      return errorResponse('Document patient linkage is invalid', 409);
    }
    if (documentId && patientId && !documentPatientId) {
      return errorResponse('Document is not linked to the requested patient', 409);
    }
    const linkedPatientId = referralPatientId || documentPatientId;
    if (patientId && linkedPatientId && patientId !== linkedPatientId) {
      return errorResponse('Related record belongs to a different patient', 409);
    }
    patientId = patientId || linkedPatientId;
    const patient = await getById(entities.Patient, patientId);
    let authorizedPatientId = null;
    if (patientId) {
      const denied = assertPatientAccess(user, patient);
      if (denied) return denied;
      authorizedPatientId = patient.id;
    }

    if (referralId) {
      const denied = assertReferralAccess(user, referral, !!authorizedPatientId);
      if (denied) return denied;
    }
    if (documentId) {
      const denied = assertDocumentAccess(user, document);
      if (denied) return denied;
    }

    const allowedAttachmentUrls = new Set([
      referral?.document_url,
      referral?.processed_document_url,
      document?.file_url,
    ].filter(Boolean));
    let attachments;
    try {
      attachments = validateAttachments(body.attachments || [], allowedAttachmentUrls);
    } catch (error) {
      return errorResponse(error?.message || 'Invalid attachments', 400);
    }

    const thread = await loadAndValidateThread(
      entities,
      user,
      threadId,
      patientId,
      relatedType,
      relatedId,
    );
    if (thread.denied) return thread.denied;

    // Until tenant membership is backed by an immutable authority, PHI can be
    // addressed only to users already named on the chart/record/thread. Custom
    // User agency/account_type fields never grant cross-user authority here.
    const allowedParticipants = new Set();
    if (patient) {
      addParticipants(allowedParticipants, [
        patient.created_by,
        ...(Array.isArray(patient.assigned_nurses) ? patient.assigned_nurses : []),
      ]);
    }
    if (referral) {
      addParticipants(allowedParticipants, [referral.created_by, referral.assigned_to]);
    }
    if (document) {
      // uploaded_by is a legacy client-writable data field and cannot confer
      // authorization or recipient membership. Base44's immutable created_by
      // provenance and an exact authorized Document→Patient link can.
      addParticipants(allowedParticipants, [document.created_by]);
    }
    for (const message of thread.messages) {
      addParticipants(allowedParticipants, [
        message.sender_email,
        message.created_by,
        ...(Array.isArray(message.recipients) ? message.recipients : []),
      ]);
    }
    if (!isProtectedSuperAdmin(user)
      && recipients.some((email) => !allowedParticipants.has(normalizeEmail(email)))) {
      return errorResponse('One or more recipients are unavailable', 403);
    }

    const priority = PRIORITIES.has(body.priority) ? body.priority : 'normal';
    const senderEmail = String(user.email).trim();
    const record = {
      created_by: senderEmail,
      sender_email: senderEmail,
      sender_name: String(user.full_name || senderEmail).trim(),
      recipients,
      subject,
      message_text: messageText,
      priority,
      read_by: [senderEmail],
      is_read: false,
      ...(patientId ? { patient_id: patientId } : {}),
      ...(threadId ? { thread_id: threadId } : {}),
      ...(attachments.length ? { attachments } : {}),
      ...(relatedId ? { related_event_id: relatedId, related_event_type: relatedType } : {}),
    };

    const created = await entities.Message.create(record);
    return Response.json(created);
  } catch (error) {
    console.error('sendMessage error:', error?.message);
    return errorResponse('Failed to send message', 500);
  }
});
