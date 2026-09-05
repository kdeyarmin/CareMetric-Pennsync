import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

// Static release checkpoint. Message has no immutable selected-tenant
// provenance yet; the dormant implementation is retained for contract tests.
const SECURE_MESSAGE_DOMAIN_PAUSED = true;
const secureMessageUnavailable = () => Response.json(
  {
    error: 'Secure messaging is temporarily unavailable',
    code: 'secure_message_tenant_broker_required',
  },
  { status: 503, headers: { 'Cache-Control': 'no-store' } },
);

function errorResponse(error, status) {
  return Response.json({ error }, { status });
}

function isParticipant(message, email) {
  const caller = normalizeEmail(email);
  return normalizeEmail(message?.sender_email) === caller
    || normalizeEmail(message?.created_by) === caller
    || (Array.isArray(message?.recipients)
      && message.recipients.some((recipient) => normalizeEmail(recipient) === caller));
}

async function loadExactMessage(entities, id) {
  const rows = await entities.Message.filter({ id }, '-created_date', 2);
  if (!Array.isArray(rows)) throw new Error('Message read returned a non-array result');
  const exact = rows.filter((candidate) => candidate?.id === id);
  if (exact.length === 0) return null;
  if (rows.length !== 1 || exact.length !== 1) {
    throw new Error('Message read returned an ambiguous result');
  }
  return exact[0];
}

function requireReconcilableUpdate(outcome) {
  if (
    !outcome
    || outcome.success !== true
    || !Number.isInteger(outcome.updated)
    || outcome.updated < 0
    || outcome.updated > 1
    || outcome.has_more !== false
  ) {
    throw new Error('Message update returned an ambiguous result');
  }
}

async function requireExactReadback(entities, id) {
  const message = await loadExactMessage(entities, id);
  if (!message) throw new Error('Message update readback was missing');
  return message;
}

Deno.serve(async (req) => {
  if (SECURE_MESSAGE_DOMAIN_PAUSED) return secureMessageUnavailable();

  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return errorResponse('Unauthorized', 401);
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return errorResponse('Invalid JSON body', 400);
    }
    const keys = Object.keys(body);
    if (keys.length !== 1 || keys[0] !== 'id'
      || typeof body.id !== 'string' || !body.id.trim() || body.id.length > 200) {
      return errorResponse('id is required and is the only accepted field', 400);
    }

    const entities = base44.asServiceRole.entities;
    const messageId = body.id.trim();
    const message = await loadExactMessage(entities, messageId);
    if (!message) return errorResponse('Message not found', 404);
    if (!isParticipant(message, user.email)) return errorResponse('Forbidden', 403);

    // Message content and participants are immutable. This endpoint is the only
    // browser-reachable mutation and writes only the two read-state fields.
    // Read first so ordinary retries are write-free. The server-side $addToSet
    // still avoids a client read/overwrite sequence when the caller is absent.
    const caller = normalizeEmail(user.email);
    let updated = message;
    let readers = new Set(
      (Array.isArray(updated.read_by) ? updated.read_by : []).map(normalizeEmail),
    );
    if (!readers.has(caller)) {
      const readUpdate = await entities.Message.updateMany(
        { id: message.id },
        { $addToSet: { read_by: String(user.email).trim() } },
      );
      // Base44 has reported `updated` as either a matched-row or modified-row
      // count across hosted paths. Zero is therefore inconclusive: a competing
      // retry may already have applied this idempotent write. Only an exact
      // readback of the requested state makes either zero or one safe to accept.
      requireReconcilableUpdate(readUpdate);
      updated = await requireExactReadback(entities, message.id);
      if (!isParticipant(updated, user.email)) {
        throw new Error('Message participants changed during read update');
      }
      readers = new Set(
        (Array.isArray(updated.read_by) ? updated.read_by : []).map(normalizeEmail),
      );
      if (!readers.has(caller)) {
        throw new Error('Message read-state update could not be reconciled');
      }
    }
    const recipients = Array.isArray(updated.recipients) ? updated.recipients : [];
    const everyRecipientRead = recipients.length > 0
      && recipients.every((recipient) => readers.has(normalizeEmail(recipient)));
    if (everyRecipientRead && updated.is_read !== true) {
      const completionUpdate = await entities.Message.updateMany(
        { id: message.id },
        { $set: { is_read: true } },
      );
      requireReconcilableUpdate(completionUpdate);
      updated = await requireExactReadback(entities, message.id);
      const completedReaders = new Set(
        (Array.isArray(updated.read_by) ? updated.read_by : []).map(normalizeEmail),
      );
      const completedRecipients = Array.isArray(updated.recipients) ? updated.recipients : [];
      if (
        !isParticipant(updated, user.email)
        || !completedReaders.has(caller)
        || completedRecipients.length === 0
        || !completedRecipients.every((recipient) => completedReaders.has(normalizeEmail(recipient)))
        || updated.is_read !== true
      ) {
        throw new Error('Message completion update could not be reconciled');
      }
    }
    return Response.json(updated);
  } catch (error) {
    console.error('markMessageRead error:', error?.message);
    return errorResponse('Failed to mark message read', 500);
  }
});
