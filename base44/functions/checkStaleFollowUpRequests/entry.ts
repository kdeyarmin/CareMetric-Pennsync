import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';

// Deployment is intentionally harmless until the notification authority and
// hosted scheduler/CAS evidence have been reviewed. The native workflow owns
// the schedule, but this handler needs a separate explicit runtime release.
const STALE_FOLLOW_UP_WORKFLOW_ENABLED =
  String(Deno.env.get('WORKFLOW_RELEASE_CHECK_STALE_FOLLOW_UP_REQUESTS') || '').trim() === 'enabled-v1';

// <<<BEGIN SHARED HELPER: schedulerAuth — generated, edit base44/_shared/backendHelpers.mjs>>>
const SCHEDULER_SECRET_HEADER = 'x-internal-secret';
function isSchedulerAdmin(user) {
  return !!user && user.role === 'admin';
}
// Constant-time string compare for the shared-secret check (mirrors
// createTelehealthToken's timingSafeEqual). A plain === short-circuits on the
// first differing character, so response timing could leak how much of the
// secret matched. Dependency-free char-code XOR so the identical source runs
// under Deno (consumers) and Node (tests).
function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
function getSchedulerAuthError(req, user) {
  if (isSchedulerAdmin(user)) return null;
  const expectedSecret = String(Deno.env.get('INTERNAL_FN_SECRET') || '').trim();
  if (!expectedSecret) {
    return Response.json(
      { error: 'Server misconfigured: INTERNAL_FN_SECRET is required for scheduled/internal functions' },
      { status: 500 },
    );
  }
  const providedSecret = String(req.headers.get(SCHEDULER_SECRET_HEADER) || '').trim();
  if (timingSafeEqualStr(providedSecret, expectedSecret)) return null;
  return Response.json(
    { error: user ? 'Forbidden: admin or scheduler secret required' : 'Unauthorized: scheduler secret required' },
    { status: user ? 403 : 401 },
  );
}
// <<<END SHARED HELPER: schedulerAuth>>>

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

const DEFAULT_STALE_DAYS = 4;
const MAX_BODY_BYTES = 10_000;
const MAX_IDENTIFIER_LENGTH = 200;
const MAX_REFERRAL_SCAN = 5000;
const MAX_AGENCY_SCAN = 1000;
const EXACT_ROW_LIMIT = 10;
const MEMBERSHIP_SCAN_LIMIT = 100;
const NOTIFICATION_SCAN_LIMIT = 10;
const CLAIM_LEASE_MS = 10 * 60 * 1000;
const ENABLED_AGENCY_STATUSES = new Set(['active', 'trial']);
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
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'PublicError';
    this.status = status;
  }
}

function exactIdentifier(value: unknown) {
  if (typeof value !== 'string') return null;
  if (
    !value
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

function plainObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function requireRows(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`${label} returned a non-array result`);
  return value as Array<Record<string, any>>;
}

function validInstant(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function boundedReason(value: unknown) {
  if (typeof value !== 'string') return null;
  const reason = value.trim();
  return reason && reason.length <= 500 ? reason : null;
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function parseInput(req: Request) {
  if (req.method !== 'POST') throw new PublicError(405, 'Method not allowed');
  const statedLength = Number(req.headers.get('content-length'));
  if (Number.isFinite(statedLength) && statedLength > MAX_BODY_BYTES) {
    throw new PublicError(413, 'Request body is too large');
  }
  let raw = '';
  try {
    raw = await req.text();
  } catch {
    throw new PublicError(400, 'Invalid JSON body');
  }
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    throw new PublicError(413, 'Request body is too large');
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new PublicError(400, 'Invalid JSON body');
  }
  if (!plainObject(body)) throw new PublicError(400, 'Request body must be an object');
  if (Object.keys(body).some((key) => !['agency_id', 'stale_days'].includes(key))) {
    throw new PublicError(400, 'Request contains unsupported fields');
  }
  const agencyId = body.agency_id === undefined ? null : exactIdentifier(body.agency_id);
  const staleDays = body.stale_days === undefined ? DEFAULT_STALE_DAYS : Number(body.stale_days);
  if (body.agency_id !== undefined && !agencyId) {
    throw new PublicError(400, 'agency_id is invalid');
  }
  if (!Number.isSafeInteger(staleDays) || staleDays < 1 || staleDays > 30) {
    throw new PublicError(400, 'stale_days is invalid');
  }
  return { agencyId, staleDays };
}

async function loadScheduledAgencyIds(entities: Record<string, any>) {
  const ids = new Set<string>();
  for (const status of ENABLED_AGENCY_STATUSES) {
    const rows = requireRows(
      await entities.Agency.filter({ status }, undefined, MAX_AGENCY_SCAN),
      'Agency.filter',
    );
    if (rows.length >= MAX_AGENCY_SCAN) {
      throw new PublicError(409, 'Agency scan is incomplete');
    }
    for (const row of rows) {
      const id = exactIdentifier(row?.id);
      if (!id || row?.id !== id || row?.status !== status || ids.has(id)) {
        throw new PublicError(409, 'Agency scan scope could not be verified');
      }
      ids.add(id);
    }
  }
  return [...ids].sort();
}

async function loadEnabledAgency(entities: Record<string, any>, agencyId: string) {
  const rows = requireRows(
    await entities.Agency.filter({ id: agencyId }, undefined, EXACT_ROW_LIMIT),
    'Agency.filter',
  );
  if (rows.length >= EXACT_ROW_LIMIT) throw new PublicError(409, 'Agency is ambiguous');
  if (rows.some((row) => row?.id !== agencyId)) {
    throw new PublicError(409, 'Agency query scope could not be verified');
  }
  if (rows.length !== 1 || !ENABLED_AGENCY_STATUSES.has(String(rows[0].status || ''))) {
    throw new PublicError(403, 'Agency is unavailable');
  }
  return rows[0];
}

function validateReferral(row: Record<string, any>, agencyId: string) {
  const id = exactIdentifier(row?.id);
  const creatorId = exactIdentifier(row?.created_by_user_id);
  const creatorEmail = canonicalEmail(row?.created_by_user_email_normalized);
  const requestId = exactIdentifier(row?.client_request_id);
  if (
    !id
    || row.agency_id !== agencyId
    || !creatorId
    || !creatorEmail
    || row.created_by_user_email_normalized !== creatorEmail
    // Current hosted records may omit the legacy creator email. When present,
    // each platform identity must agree with the immutable broker provenance.
    || (row.created_by_id == null && row.created_by == null)
    || (row.created_by_id != null && row.created_by_id !== creatorId)
    || (row.created_by != null && canonicalEmail(row.created_by) !== creatorEmail)
    || !requestId
    || row.referral_creation_key !== `${agencyId}:${creatorId}:${requestId}`
    || !Number.isSafeInteger(row.version)
    || row.version < 1
    || !validInstant(row.created_date)
    || !validInstant(row.updated_date)
    || row.archived_at != null
  ) {
    throw new PublicError(409, 'Referral integrity check failed');
  }
  return row;
}

async function loadExactReferral(entities: Record<string, any>, agencyId: string, referralId: string) {
  const rows = requireRows(
    await entities.Referral.filter(
      { id: referralId, agency_id: agencyId },
      undefined,
      EXACT_ROW_LIMIT,
    ),
    'Referral.filter',
  );
  if (rows.length >= EXACT_ROW_LIMIT) throw new PublicError(409, 'Referral is ambiguous');
  if (rows.some((row) => row?.id !== referralId || row?.agency_id !== agencyId)) {
    throw new PublicError(409, 'Referral query scope could not be verified');
  }
  if (rows.length !== 1) throw new PublicError(409, 'Referral changed during escalation');
  return validateReferral(rows[0], agencyId);
}

async function loadActiveRecipient(
  entities: Record<string, any>,
  agencyId: string,
  userId: string,
  normalizedEmail: string,
) {
  const rows = requireRows(
    await entities.AgencyMembership.filter(
      { agency_id: agencyId, user_id: userId },
      '-updated_date',
      MEMBERSHIP_SCAN_LIMIT,
    ),
    'AgencyMembership.filter',
  );
  if (rows.length >= MEMBERSHIP_SCAN_LIMIT) {
    throw new PublicError(409, 'Notification recipient membership is ambiguous');
  }
  if (rows.some((row) => row?.agency_id !== agencyId || row?.user_id !== userId)) {
    throw new PublicError(409, 'Notification recipient query scope could not be verified');
  }
  if (rows.length !== 1) return null;
  const row = rows[0];
  const storedEmail = canonicalEmail(row.user_email_normalized);
  const transitionEmail = canonicalEmail(row.last_transition_by_email_normalized);
  const status = String(row.status || '');
  if (
    !exactIdentifier(row.id)
    || row.membership_key !== `${agencyId}:${userId}`
    || storedEmail !== normalizedEmail
    || row.user_email_normalized !== storedEmail
    || !TENANT_ROLES.has(String(row.tenant_role || ''))
    || !MEMBERSHIP_STATUSES.has(status)
    || !exactIdentifier(row.created_by_user_id)
    || !exactIdentifier(row.last_transition_by_user_id)
    || !transitionEmail
    || row.last_transition_by_email_normalized !== transitionEmail
    || !validInstant(row.last_transition_at)
    || !boundedReason(row.last_transition_reason)
    || !Number.isSafeInteger(row.version)
    || row.version < 1
    || ((status === 'active' || status === 'suspended') && !validInstant(row.activated_at))
    || (status === 'revoked' && (!validInstant(row.revoked_at) || !boundedReason(row.revocation_reason)))
  ) {
    throw new PublicError(409, 'Notification recipient membership integrity check failed');
  }
  return status === 'active' ? row : null;
}

function followUpNotificationKey(agencyId: string, referralId: string, sentAt: string) {
  const sentMs = Date.parse(sentAt);
  if (!Number.isFinite(sentMs)) throw new PublicError(409, 'Referral follow-up timestamp is invalid');
  return `referral-stale:${agencyId}:${referralId}:${sentMs}`;
}

function expectedNotification(
  agencyId: string,
  referralId: string,
  recipient: Record<string, any>,
  key: string,
  staleDays: number,
) {
  return {
    agency_id: agencyId,
    dedupe_key: key,
    recipient_user_id: recipient.user_id,
    recipient_membership_id: recipient.id,
    recipient_membership_version: recipient.version,
    authority_version: 1,
    authority_state: 'active',
    version: 1,
    user_email: recipient.user_email_normalized,
    title: 'Provider follow-up request unanswered',
    message: `A provider information request has had no response for ${staleDays}+ days. Review it before the start-of-care deadline.`,
    type: 'info',
    priority: 'high',
    metadata: {
      agency_id: agencyId,
      related_entity: 'Referral',
      related_entity_id: referralId,
      workflow: 'stale_provider_follow_up',
    },
    is_read: false,
    dismissed: false,
    action_url: `/ReferralFollowUp?id=${encodeURIComponent(referralId)}`,
  };
}

function notificationMatches(row: Record<string, any>, expected: Record<string, any>) {
  return row?.agency_id === expected.agency_id
    && row?.dedupe_key === expected.dedupe_key
    && row?.recipient_user_id === expected.recipient_user_id
    && row?.recipient_membership_id === expected.recipient_membership_id
    && row?.recipient_membership_version === expected.recipient_membership_version
    && row?.authority_version === expected.authority_version
    && row?.authority_state === expected.authority_state
    && Number.isSafeInteger(row?.version)
    && row.version >= 1
    && canonicalEmail(row?.user_email) === expected.user_email
    && row?.title === expected.title
    && row?.message === expected.message
    && row?.type === expected.type
    && row?.priority === expected.priority
    && sameJson(row?.metadata, expected.metadata)
    && typeof row?.is_read === 'boolean'
    && (row.is_read ? validInstant(row.read_at) : row.read_at == null)
    && typeof row?.dismissed === 'boolean'
    && (row.dismissed ? validInstant(row.dismissed_at) : row.dismissed_at == null)
    && row?.action_url === expected.action_url;
}

async function findNotification(
  entities: Record<string, any>,
  expected: Record<string, any>,
) {
  const rows = requireRows(
    await entities.Notification.filter(
      {
        agency_id: expected.agency_id,
        dedupe_key: expected.dedupe_key,
        recipient_user_id: expected.recipient_user_id,
        user_email: expected.user_email,
      },
      '-created_date',
      NOTIFICATION_SCAN_LIMIT,
    ),
    'Notification.filter',
  );
  if (rows.length >= NOTIFICATION_SCAN_LIMIT || rows.length > 1) {
    throw new PublicError(409, 'Referral follow-up notification is ambiguous');
  }
  if (rows.some((row) => !notificationMatches(row, expected))) {
    throw new PublicError(409, 'Referral follow-up notification integrity check failed');
  }
  return rows[0] || null;
}

async function conditionalFollowUpUpdate(
  entities: Record<string, any>,
  referral: Record<string, any>,
  followUpRequests: Record<string, any>,
) {
  const result = await entities.Referral.updateMany(
    {
      id: referral.id,
      agency_id: referral.agency_id,
      version: referral.version,
      updated_date: referral.updated_date,
    },
    { $set: { follow_up_requests: followUpRequests }, $inc: { version: 1 } },
  );
  return plainObject(result)
    && result.success === true
    && result.updated === 1
    && result.has_more === false;
}

async function processAgency(
  entities: Record<string, any>,
  agencyId: string,
  staleDays: number,
  runId: string,
) {
  await loadEnabledAgency(entities, agencyId);

  const referrals = requireRows(
    await entities.Referral.filter(
      { agency_id: agencyId, $or: [{ archived_at: { $exists: false } }, { archived_at: null }] },
      '-created_date',
      MAX_REFERRAL_SCAN,
    ),
    'Referral.filter',
  );
  if (referrals.length >= MAX_REFERRAL_SCAN) {
    throw new PublicError(409, 'Referral scan is incomplete');
  }
  if (referrals.some((row) => row?.agency_id !== agencyId || row?.archived_at != null)) {
    throw new PublicError(409, 'Referral scan scope could not be verified');
  }

  const cutoffMs = Date.now() - staleDays * 24 * 60 * 60 * 1000;
  let escalated = 0;
  let skippedWithoutRecipient = 0;
  let failed = 0;

  for (const candidate of referrals) {
    try {
      const followUp = candidate.follow_up_requests;
      if (!plainObject(followUp) || followUp.status !== 'sent') {
        continue;
      }
      const referral = validateReferral(candidate, agencyId);
      if (!validInstant(followUp.generated_at)) throw new PublicError(409, 'Invalid follow-up generation');
      const sentMs = Date.parse(followUp.generated_at);
      if (sentMs > cutoffMs) continue;
      if (validInstant(followUp.stale_notified_at)
        && Date.parse(followUp.stale_notified_at) >= sentMs) continue;
      if (followUp.stale_notification_publish_started_at == null
        && validInstant(followUp.stale_notification_claimed_at)
        && Date.parse(followUp.stale_notification_claimed_at) > Date.now() - CLAIM_LEASE_MS) continue;

      const recipient = await loadActiveRecipient(
        entities,
        agencyId,
        referral.created_by_user_id,
        referral.created_by_user_email_normalized,
      );
      if (!recipient) {
        skippedWithoutRecipient += 1;
        continue;
      }
      const key = followUpNotificationKey(agencyId, referral.id, followUp.generated_at);
      if (followUp.stale_notification_publish_started_at != null && (
        !validInstant(followUp.stale_notification_publish_started_at)
        || followUp.stale_notification_key !== key
      )) throw new PublicError(409, 'Invalid notification publication state');
      const claimAt = new Date().toISOString();
      const claimedFollowUp = {
        ...followUp,
        stale_notification_key: key,
        stale_notification_claimed_by: runId,
        stale_notification_claimed_at: claimAt,
      };

      const current = await loadExactReferral(entities, agencyId, referral.id);
      if (!sameJson(current.follow_up_requests, followUp)) continue;
      const claimWon = await conditionalFollowUpUpdate(entities, current, claimedFollowUp);
      if (!claimWon) continue;
      const claimed = await loadExactReferral(entities, agencyId, referral.id);
      if (
        claimed.follow_up_requests?.stale_notification_claimed_by !== runId
        || claimed.follow_up_requests?.stale_notification_key !== key
      ) continue;

      const notification = expectedNotification(
        agencyId,
        referral.id,
        recipient,
        key,
        staleDays,
      );
      let existing = await findNotification(entities, notification);
      if (!existing) {
        // A create can commit after its caller times out. Once publication has
        // started, no later lease owner may create again. Reconcile a returned
        // row, or report the unresolved attempt for operator investigation.
        if (followUp.stale_notification_publish_started_at != null) {
          failed += 1;
          continue;
        }
        await loadEnabledAgency(entities, agencyId);
        const currentRecipient = await loadActiveRecipient(
          entities, agencyId, referral.created_by_user_id, referral.created_by_user_email_normalized,
        );
        if (!currentRecipient || currentRecipient.id !== recipient.id
          || currentRecipient.version !== recipient.version) {
          skippedWithoutRecipient += 1;
          continue;
        }
        const publishingFollowUp = {
          ...claimedFollowUp,
          stale_notification_publish_started_at: new Date().toISOString(),
        };
        if (!await conditionalFollowUpUpdate(entities, claimed, publishingFollowUp)) continue;
        // The successful version/revision CAS is the publication decision.
        // Start create immediately: an additional read here could fail after
        // persisting intent and strand an alert that was never attempted.
        try {
          await entities.Notification.create(notification);
        } catch {
          // Read back after an uncertain response; never roll back the durable
          // intent, even if the read below has not observed the create yet.
        }
        existing = await findNotification(entities, notification);
        if (!existing) {
          failed += 1;
          continue;
        }
      }

      await loadEnabledAgency(entities, agencyId);
      const beforeFinalize = await loadExactReferral(entities, agencyId, referral.id);
      if (
        beforeFinalize.follow_up_requests?.stale_notification_claimed_by !== runId
        || beforeFinalize.follow_up_requests?.stale_notification_key !== key
      ) continue;
      const finalizedFollowUp = { ...beforeFinalize.follow_up_requests };
      delete finalizedFollowUp.stale_notification_claimed_by;
      delete finalizedFollowUp.stale_notification_claimed_at;
      finalizedFollowUp.stale_notified_at = new Date().toISOString();
      finalizedFollowUp.stale_notification_key = key;
      const finalized = await conditionalFollowUpUpdate(
        entities,
        beforeFinalize,
        finalizedFollowUp,
      );
      if (!finalized) continue;
      const verified = await loadExactReferral(entities, agencyId, referral.id);
      if (
        verified.follow_up_requests?.stale_notification_key !== key
        || !validInstant(verified.follow_up_requests?.stale_notified_at)
        || verified.follow_up_requests?.stale_notification_claimed_by != null
      ) throw new Error('Referral stale notification finalization failed');
      escalated += 1;
    } catch {
      failed += 1;
    }
  }

  return {
    scanned: referrals.length,
    escalated,
    skipped_without_active_recipient: skippedWithoutRecipient,
    failed,
  };
}

Deno.serve(async (req) => {
  if (!STALE_FOLLOW_UP_WORKFLOW_ENABLED) {
    return Response.json(
      {
        error: 'Stale follow-up processing is disabled pending hosted validation',
        code: 'stale_follow_up_workflow_disabled',
      },
      { status: 503, headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } },
    );
  }
  try {
    const base44 = createClientFromRequest(req);
    const me = await base44.auth.me().catch(() => null);
    const authError = getSchedulerAuthError(req, me);
    if (authError) {
      authError.headers.set('Cache-Control', 'no-store');
      return authError;
    }
    if (isDeactivatedUser(me)) {
      const response = DEACTIVATED_USER_RESPONSE();
      response.headers.set('Cache-Control', 'no-store');
      return response;
    }
    const { agencyId, staleDays } = await parseInput(req);
    const entities = base44.asServiceRole.entities;
    const agencyIds = agencyId ? [agencyId] : await loadScheduledAgencyIds(entities);
    const runRoot = typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const totals = {
      scanned: 0,
      escalated: 0,
      skipped_without_active_recipient: 0,
      failed: 0,
    };
    for (const scheduledAgencyId of agencyIds) {
      try {
        const result = await processAgency(
          entities,
          scheduledAgencyId,
          staleDays,
          `referral-stale:${scheduledAgencyId}:${runRoot}`,
        );
        totals.scanned += result.scanned;
        totals.escalated += result.escalated;
        totals.skipped_without_active_recipient += result.skipped_without_active_recipient;
        totals.failed += result.failed;
      } catch (error) {
        // Explicit single-agency requests retain their actionable error. A
        // scheduled scan must still attempt the remaining independent tenants.
        if (agencyId) throw error;
        totals.failed += 1;
      }
    }

    const result = {
      success: true,
      agency_id: agencyId,
      agencies_processed: agencyIds.length,
      stale_days: staleDays,
      ...totals,
    };
    if (totals.failed > 0) {
      return Response.json({
        ...result,
        success: false,
        error: 'One or more stale follow-up escalations failed',
      }, {
        status: 500,
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof PublicError) {
      return Response.json(
        { error: error.message },
        {
          status: error.status,
          headers: {
            'Cache-Control': 'no-store',
            ...(error.status === 405 ? { Allow: 'POST' } : {}),
          },
        },
      );
    }
    console.error('checkStaleFollowUpRequests failed');
    return Response.json(
      { error: 'Stale follow-up check failed' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
});
