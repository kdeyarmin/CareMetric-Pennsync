import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';

/**
 * Recipient-only notification inbox broker.
 *
 * Notification is service-role-only. This broker exposes a bounded projection
 * of version-1, tenant-bound rows to their exact authenticated recipient and
 * permits only read-state or dismissal transitions. Immutable delivery,
 * workflow, dedupe, tenant, recipient, content, and action fields are never
 * accepted from the browser and Notification rows are never deleted.
 */

const MAX_BODY_BYTES = 2_000;
const MAX_IDENTIFIER_LENGTH = 200;
const MAX_TITLE_LENGTH = 500;
const MAX_MESSAGE_LENGTH = 5_000;
const MAX_ACTION_URL_LENGTH = 1_000;
const MAX_ACTION_LABEL_LENGTH = 200;
const MAX_NOTIFICATION_ROWS = 100;
const NOTIFICATION_SCAN_LIMIT = MAX_NOTIFICATION_ROWS + 1;
const EXACT_ROW_LIMIT = 10;
const MEMBERSHIP_SCAN_LIMIT = 10;
const AUTHORITY_VERSION = 1;
const AUTHORITY_STATE = 'active';

const ACTIONS = new Set(['list', 'mark_read', 'mark_all_read', 'dismiss']);
const ENABLED_AGENCY_STATUSES = new Set(['active', 'trial']);
const TENANT_ROLES = new Set([
  'agency_admin',
  'manager',
  'clinician',
  'office_staff',
  'social_worker',
  'spiritual_care',
]);
const NOTIFICATION_TYPES = new Set([
  'report_ready', 'compliance_alert', 'critical_alert', 'patient_alert',
  'task_assigned', 'task_due_soon', 'new_referral', 'referral_urgent',
  'training_due', 'system_update', 'message_received', 'sms_failed',
  'sms_urgent', 'sms_received', 'fax_delivered', 'fax_failed', 'voicemail',
  'info', 'expiration_warning', 'credential_expiration',
  'admin_expiration_summary', 'care_plan_proposal', 'signature_request',
]);
const PRIORITIES = new Set(['low', 'medium', 'high', 'critical']);
const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store',
  Pragma: 'no-cache',
};

class PublicError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'PublicError';
    this.status = status;
  }
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: NO_STORE_HEADERS });
}

function exactIdentifier(value: unknown) {
  if (
    typeof value !== 'string'
    || !value
    || value.length > MAX_IDENTIFIER_LENGTH
    || value.trim() !== value
    || value.startsWith('$')
    || /[\u0000-\u001f\u007f]/.test(value)
  ) return null;
  return value;
}

function canonicalEmail(value: unknown) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email && email.length <= 320 && email.includes('@') && !/\s/.test(email)
    ? email
    : null;
}

function validInstant(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function boundedText(value: unknown, maximum: number) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximum
    && !/[\u0000\u007f]/.test(value)
    ? value
    : null;
}

function safeActionUrl(value: unknown) {
  if (value == null) return null;
  if (
    typeof value !== 'string'
    || !value.startsWith('/')
    || value.startsWith('//')
    || value.includes('\\')
    || value.length > MAX_ACTION_URL_LENGTH
    || /[\u0000-\u001f\u007f]/.test(value)
  ) return null;
  return value;
}

function requireRows(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`${label} returned a non-array result`);
  return value as Array<Record<string, any>>;
}

function exactKeys(value: Record<string, unknown>, expected: string[]) {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length
    && expected.every((key, index) => actual[index] === [...expected].sort()[index]);
}

async function parseRequest(req: Request) {
  if (req.method !== 'POST') throw new PublicError(405, 'Method not allowed');
  const statedLength = req.headers.get('content-length');
  if (statedLength !== null) {
    if (!/^(0|[1-9]\d*)$/.test(statedLength)) throw new PublicError(400, 'Invalid Content-Length');
    const length = Number(statedLength);
    if (!Number.isSafeInteger(length) || length < 0) throw new PublicError(400, 'Invalid Content-Length');
    if (length > MAX_BODY_BYTES) throw new PublicError(413, 'Request body is too large');
  }
  const raw = await req.text().catch(() => { throw new PublicError(400, 'Invalid JSON body'); });
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    throw new PublicError(413, 'Request body is too large');
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new PublicError(400, 'Invalid JSON body'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new PublicError(400, 'Request body must be an object');
  }
  const body = parsed as Record<string, unknown>;
  const action = typeof body.action === 'string' ? body.action : '';
  if (!ACTIONS.has(action)) throw new PublicError(400, 'Notification action is invalid');
  const expectedKeys = action === 'list' || action === 'mark_all_read'
    ? ['action', 'agency_id']
    : ['action', 'agency_id', 'notification_id', 'expected_version'];
  if (!exactKeys(body, expectedKeys)) throw new PublicError(400, 'Request contains unsupported or missing fields');

  const agencyId = exactIdentifier(body.agency_id);
  if (!agencyId) throw new PublicError(400, 'agency_id is invalid');
  if (action === 'list' || action === 'mark_all_read') {
    return { action, agencyId, notificationId: null, expectedVersion: null };
  }
  const notificationId = exactIdentifier(body.notification_id);
  const expectedVersion = body.expected_version;
  if (!notificationId || !Number.isSafeInteger(expectedVersion) || Number(expectedVersion) < 1) {
    throw new PublicError(400, 'Notification identity is invalid');
  }
  return {
    action,
    agencyId,
    notificationId,
    expectedVersion: Number(expectedVersion),
  };
}

function isProtectedPlatformOwner(user: Record<string, any>) {
  const configured = canonicalEmail(Deno.env.get('SUPER_ADMIN_EMAIL'));
  return !!configured
    && user.role === 'admin'
    && canonicalEmail(user.email) === configured;
}

function validateCaller(user: Record<string, any>) {
  const userId = exactIdentifier(user?.id);
  const email = canonicalEmail(user?.email);
  if (
    !userId
    || !email
    || user.email !== email
    || user.is_active === false
    || user.disabled === true
    || user.is_service === true
    || user.is_verified === false
  ) throw new PublicError(403, 'Forbidden');
  return { userId, email, isPlatformOwner: isProtectedPlatformOwner(user) };
}

async function loadScope(
  entities: Record<string, any>,
  caller: { userId: string; email: string; isPlatformOwner: boolean },
  agencyId: string,
) {
  const agencyRows = requireRows(
    await entities.Agency.filter({ id: agencyId }, undefined, EXACT_ROW_LIMIT),
    'Agency.filter',
  );
  if (
    agencyRows.length !== 1
    || agencyRows.some((row) => row?.id !== agencyId)
    || !ENABLED_AGENCY_STATUSES.has(String(agencyRows[0]?.status || ''))
  ) throw new PublicError(403, 'Agency is unavailable');

  const membershipRows = requireRows(
    await entities.AgencyMembership.filter(
      { agency_id: agencyId, user_id: caller.userId },
      '-updated_date',
      MEMBERSHIP_SCAN_LIMIT,
    ),
    'AgencyMembership.filter',
  );
  if (
    membershipRows.length >= MEMBERSHIP_SCAN_LIMIT
    || membershipRows.some((row) => row?.agency_id !== agencyId || row?.user_id !== caller.userId)
    || membershipRows.length > 1
  ) throw new PublicError(409, 'Notification recipient membership is ambiguous');

  if (membershipRows.length === 0) throw new PublicError(403, 'Forbidden');

  const membership = membershipRows[0];
  const membershipId = exactIdentifier(membership.id);
  const membershipEmail = canonicalEmail(membership.user_email_normalized);
  if (
    !membershipId
    || membership.membership_key !== `${agencyId}:${caller.userId}`
    || membershipEmail !== caller.email
    || membership.user_email_normalized !== membershipEmail
    || membership.status !== 'active'
    || !TENANT_ROLES.has(String(membership.tenant_role || ''))
    || !Number.isSafeInteger(membership.version)
    || membership.version < 1
  ) throw new PublicError(403, 'Notification recipient membership is unavailable');

  return {
    ...caller,
    agencyId,
    membershipId,
    membershipVersion: membership.version,
  };
}

function sameScope(left: Record<string, any>, right: Record<string, any>) {
  return left.userId === right.userId
    && left.email === right.email
    && left.agencyId === right.agencyId
    && left.membershipId === right.membershipId
    && left.membershipVersion === right.membershipVersion;
}

async function revalidateScope(
  entities: Record<string, any>,
  caller: { userId: string; email: string; isPlatformOwner: boolean },
  expectedScope: Record<string, any>,
) {
  const currentScope = await loadScope(entities, caller, expectedScope.agencyId);
  if (!sameScope(currentScope, expectedScope)) {
    throw new PublicError(403, 'Notification recipient authority changed');
  }
  return currentScope;
}

function authorityFilter(scope: Record<string, any>) {
  return {
    agency_id: scope.agencyId,
    recipient_user_id: scope.userId,
    recipient_membership_id: scope.membershipId,
    recipient_membership_version: scope.membershipVersion,
    user_email: scope.email,
    authority_version: AUTHORITY_VERSION,
    authority_state: AUTHORITY_STATE,
  };
}

function validateNotification(row: Record<string, any>, scope: Record<string, any>) {
  const id = exactIdentifier(row?.id);
  const email = canonicalEmail(row?.user_email);
  const title = boundedText(row?.title, MAX_TITLE_LENGTH);
  const message = boundedText(row?.message, MAX_MESSAGE_LENGTH);
  const actionUrl = safeActionUrl(row?.action_url);
  const actionLabel = row?.action_label == null
    ? null
    : boundedText(row.action_label, MAX_ACTION_LABEL_LENGTH);
  if (
    !id
    || row.agency_id !== scope.agencyId
    || row.recipient_user_id !== scope.userId
    || email !== scope.email
    || row.user_email !== email
    || row?.recipient_membership_id !== scope.membershipId
    || row?.recipient_membership_version !== scope.membershipVersion
    || row.authority_version !== AUTHORITY_VERSION
    || row.authority_state !== AUTHORITY_STATE
    || !Number.isSafeInteger(row.version)
    || row.version < 1
    || !title
    || !message
    || !NOTIFICATION_TYPES.has(String(row.type || ''))
    || !PRIORITIES.has(String(row.priority || ''))
    || !validInstant(row.created_date)
    || typeof row.is_read !== 'boolean'
    || (row.is_read ? !validInstant(row.read_at) : row.read_at != null)
    || typeof row.dismissed !== 'boolean'
    || (row.dismissed ? !validInstant(row.dismissed_at) : row.dismissed_at != null)
    || (row.action_url != null && !actionUrl)
    || (row.action_label != null && !actionLabel)
  ) throw new PublicError(409, 'Notification integrity check failed');

  return {
    ...row,
    id,
    title,
    message,
    actionUrl,
    actionLabel,
  };
}

function projectNotification(row: Record<string, any>) {
  return {
    id: row.id,
    agency_id: row.agency_id,
    title: row.title,
    message: row.message,
    type: row.type,
    priority: row.priority,
    created_date: row.created_date,
    is_read: row.is_read,
    read_at: row.read_at ?? null,
    dismissed: row.dismissed,
    dismissed_at: row.dismissed_at ?? null,
    action_url: row.actionUrl,
    action_label: row.actionLabel,
    version: row.version,
  };
}

async function listRows(entities: Record<string, any>, scope: Record<string, any>) {
  const rows = requireRows(
    await entities.Notification.filter(
      {
        ...authorityFilter(scope),
        dismissed: false,
      },
      '-created_date',
      NOTIFICATION_SCAN_LIMIT,
    ),
    'Notification.filter',
  );
  return {
    rows: rows.slice(0, MAX_NOTIFICATION_ROWS),
    complete: rows.length <= MAX_NOTIFICATION_ROWS,
  };
}

async function loadExactRow(
  entities: Record<string, any>,
  scope: Record<string, any>,
  notificationId: string,
) {
  const rows = requireRows(
    await entities.Notification.filter(
      {
        id: notificationId,
        ...authorityFilter(scope),
      },
      undefined,
      EXACT_ROW_LIMIT,
    ),
    'Notification.filter',
  );
  if (rows.length > 1 || rows.length >= EXACT_ROW_LIMIT) {
    throw new PublicError(409, 'Notification identity is ambiguous');
  }
  if (rows.length !== 1) throw new PublicError(404, 'Notification not found');
  return validateNotification(rows[0], scope);
}

async function transitionRow(
  entities: Record<string, any>,
  caller: { userId: string; email: string; isPlatformOwner: boolean },
  scope: Record<string, any>,
  notificationId: string,
  expectedVersion: number,
  action: 'mark_read' | 'dismiss',
) {
  let currentScope = await revalidateScope(entities, caller, scope);
  const before = await loadExactRow(entities, currentScope, notificationId);
  currentScope = await revalidateScope(entities, caller, scope);
  const alreadyApplied = action === 'mark_read' ? before.is_read : before.dismissed;
  if (alreadyApplied) {
    return { row: before, idempotent: true };
  }
  if (before.version !== expectedVersion) {
    throw new PublicError(409, 'Notification changed; refresh and retry');
  }

  const now = new Date().toISOString();
  const patch = action === 'mark_read'
    ? { is_read: true, read_at: now }
    : {
      dismissed: true,
      dismissed_at: now,
      is_read: true,
      read_at: before.is_read ? before.read_at : now,
    };
  const result = await entities.Notification.updateMany(
    {
      id: before.id,
      ...authorityFilter(currentScope),
      version: expectedVersion,
    },
    { $set: patch, $inc: { version: 1 } },
  );
  if (
    !result
    || typeof result !== 'object'
    || result.success !== true
    || result.updated !== 1
    || result.has_more !== false
  ) throw new PublicError(409, 'Notification changed; refresh and retry');

  currentScope = await revalidateScope(entities, caller, scope);
  const after = await loadExactRow(entities, currentScope, notificationId);
  await revalidateScope(entities, caller, scope);
  if (
    after.version !== expectedVersion + 1
    || !after.is_read
    || !validInstant(after.read_at)
    || (action === 'dismiss' && (!after.dismissed || !validInstant(after.dismissed_at)))
  ) throw new Error('Notification transition verification failed');
  return { row: after, idempotent: false };
}

Deno.serve(async (req) => {
  try {
    const input = await parseRequest(req);
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) throw new PublicError(401, 'Unauthorized');
    const caller = validateCaller(user);
    const entities = base44.asServiceRole.entities;
    const scope = await loadScope(entities, caller, input.agencyId);

    if (input.action === 'list') {
      let currentScope = await revalidateScope(entities, caller, scope);
      const page = await listRows(entities, currentScope);
      currentScope = await revalidateScope(entities, caller, scope);
      const notifications = page.rows.map((row) =>
        projectNotification(validateNotification(row, currentScope))
      );
      await revalidateScope(entities, caller, scope);
      return jsonResponse({
        success: true,
        action: 'list',
        agency_id: scope.agencyId,
        notifications,
        complete: page.complete,
      });
    }

    if (input.action === 'mark_all_read') {
      let currentScope = await revalidateScope(entities, caller, scope);
      const page = await listRows(entities, currentScope);
      currentScope = await revalidateScope(entities, caller, scope);
      const rows = page.rows.map((row) => validateNotification(row, currentScope));
      await revalidateScope(entities, caller, scope);
      let marked = 0;
      for (const row of rows) {
        if (row.is_read) continue;
        const transition = await transitionRow(
          entities,
          caller,
          scope,
          row.id,
          row.version,
          'mark_read',
        );
        if (!transition.idempotent) marked += 1;
      }
      await revalidateScope(entities, caller, scope);
      return jsonResponse({
        success: true,
        action: 'mark_all_read',
        agency_id: scope.agencyId,
        marked,
        complete: page.complete,
      });
    }

    const transition = await transitionRow(
      entities,
      caller,
      scope,
      input.notificationId as string,
      input.expectedVersion as number,
      input.action as 'mark_read' | 'dismiss',
    );
    const notification = projectNotification(transition.row);
    await revalidateScope(entities, caller, scope);
    return jsonResponse({
      success: true,
      action: input.action,
      agency_id: scope.agencyId,
      idempotent: transition.idempotent,
      notification,
    });
  } catch (error) {
    if (error instanceof PublicError) {
      return jsonResponse(
        { error: error.message },
        error.status,
      );
    }
    console.error('manageMyNotifications failed', error instanceof Error ? error.name : 'UnknownError');
    return jsonResponse({ error: 'Notification operation failed' }, 500);
  }
});
