import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

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

Deno.serve(async (req) => {
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
    const rows = await entities.Message.filter({ id: body.id.trim() }, '-created_date', 1);
    const message = (Array.isArray(rows) ? rows : []).find(
      (candidate) => candidate?.id === body.id.trim(),
    ) || null;
    if (!message) return errorResponse('Message not found', 404);
    if (!isParticipant(message, user.email)) return errorResponse('Forbidden', 403);

    // Message content and participants are immutable. This endpoint is the only
    // browser-reachable mutation and writes only the two read-state fields.
    // $addToSet makes concurrent reads lossless; a read/get/update sequence can
    // overwrite another recipient who marked the same message at the same time.
    await entities.Message.updateMany(
      { id: message.id },
      { $addToSet: { read_by: String(user.email).trim() } },
    );

    const refreshedRows = await entities.Message.filter({ id: message.id }, '-created_date', 1);
    let updated = (Array.isArray(refreshedRows) ? refreshedRows : []).find(
      (candidate) => candidate?.id === message.id,
    ) || message;
    const readers = new Set(
      (Array.isArray(updated.read_by) ? updated.read_by : []).map(normalizeEmail),
    );
    const recipients = Array.isArray(updated.recipients) ? updated.recipients : [];
    const everyRecipientRead = recipients.length > 0
      && recipients.every((recipient) => readers.has(normalizeEmail(recipient)));
    if (everyRecipientRead && updated.is_read !== true) {
      await entities.Message.updateMany(
        { id: message.id },
        { $set: { is_read: true } },
      );
      updated = { ...updated, is_read: true };
    }
    return Response.json(updated);
  } catch (error) {
    console.error('markMessageRead error:', error?.message);
    return errorResponse('Failed to mark message read', 500);
  }
});
