import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: pennsyncProductionAppId — generated, edit base44/_shared/backendHelpers.mjs>>>
const PENNSYNC_PRODUCTION_APP_ID = '694ec16e72e01b60d22f7cbf';
// <<<END SHARED HELPER: pennsyncProductionAppId>>>
// <<<BEGIN SHARED HELPER: base44ClientRequest — generated, edit base44/_shared/backendHelpers.mjs>>>
function pinnedBase44Request(req, expectedAppId, forwardUserCredential) {
  if (typeof expectedAppId !== 'string' || expectedAppId === '') {
    throw new Error('pinned Base44 request requires an expected Base44-App-Id');
  }
  // Read the inbound headers without ever throwing on the SHAPE of req. A production
  // request is always a real Request with a Headers bag; a bare object with no usable
  // headers (a test fixture, a malformed direct call) carries no inbound header, which
  // is the absent case handled below. Only a PRESENT, different app id throws, and that
  // requires a real header an attacker would have to set — so a real Request always
  // reaches this read and the refusal is never skipped by the tolerance.
  const inbound =
    req && req.headers && typeof req.headers.get === 'function' ? req.headers : null;
  const read = (name) => (inbound ? inbound.get(name) : null);
  const received = read('Base44-App-Id');
  // Refuse only an ACTIVE mismatch: a caller presenting a DIFFERENT app id is the
  // tenant-redirect attack, and that is the case the refusal exists for. An ABSENT
  // header is not a mismatch and selects no other tenant — it only means the request
  // did not arrive through the platform, which always injects this header. We SET the
  // pinned constant below either way, so absent falls back to the correct app exactly
  // as the dropped Base44-Api-Url falls back to the default serverUrl. Throwing on
  // absent would turn every anonymous denial into a 500 instead of a clean 403.
  if (received !== null && received !== expectedAppId) {
    throw new Error(
      'Base44-App-Id mismatch: expected ' + expectedAppId + ', received ' + received
    );
  }
  const headers = new Headers();
  // Load-bearing: SET the constant (never forward the inbound value). The SDK reads
  // appId from this header and throws of its own accord when it is absent, so pinning
  // requires setting it here — dropping the inbound header alone would not suffice.
  headers.set('Base44-App-Id', expectedAppId);
  const serviceAuth = read('Base44-Service-Authorization');
  if (serviceAuth !== null) headers.set('Base44-Service-Authorization', serviceAuth);
  if (forwardUserCredential) {
    const authorization = read('Authorization');
    if (authorization !== null) headers.set('Authorization', authorization);
    const dataEnv = read('X-Data-Env');
    if (dataEnv === 'dev' || dataEnv === 'prod') headers.set('X-Data-Env', dataEnv);
  }
  // Cosmetic URL: serverUrl comes from the dropped Base44-Api-Url, not from here.
  // No method: the SDK request factory reads only headers.get(...), never the
  // method, so the request defaults to GET. An explicit POST would be inert for the
  // SDK and would read as an outbound delivery primitive to the inventory scanner
  // once this block is inlined into the fax status pollers.
  return new Request('https://base44.app', { headers });
}
function userScopedClientRequest(req, expectedAppId) {
  return pinnedBase44Request(req, expectedAppId, true);
}
function serviceRoleClientRequest(req, expectedAppId) {
  return pinnedBase44Request(req, expectedAppId, false);
}
// <<<END SHARED HELPER: base44ClientRequest>>>
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

// <<<BEGIN SHARED HELPER: activeMembershipAuthz — generated, edit base44/_shared/backendHelpers.mjs>>>
const normalizeMembershipEmail = (value) => String(value || '').trim().toLowerCase();
async function hasExactActiveAgencyMembership(base44, user) {
  const userId = typeof user?.id === 'string' ? user.id.trim() : '';
  const userEmail = normalizeMembershipEmail(user?.email);
  if (!userId || !userEmail) return false;
  let rows;
  try {
    rows = await base44.asServiceRole.entities.AgencyMembership.filter(
      { user_id: userId, status: 'active' },
      undefined,
      2,
    );
  } catch {
    return false;
  }
  if (!Array.isArray(rows) || rows.length !== 1) return false;
  const row = rows[0];
  return !!row
    && String(row.user_id || '').trim() === userId
    && String(row.status || '') === 'active'
    && normalizeMembershipEmail(row.user_email_normalized) === userEmail
    && typeof row.agency_id === 'string'
    && !!row.agency_id.trim();
}
// <<<END SHARED HELPER: activeMembershipAuthz>>>

/**
 * setNurseDutyStatus — self-service duty toggle, scheduled time-off window, and
 * off-duty message editor. A nurse updates their own status; only the protected
 * platform owner may target another user.
 *
 * No Telnyx call is needed: the inbound VCA/SMS webhooks read duty_status and the
 * scheduled_off_duty_* window live at call/message time, so changes take effect
 * immediately and a schedule expires on its own (no cron).
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (user.disabled === true || user.is_service === true || user.is_verified === false) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!isProtectedSuperAdmin(user)
      && !(await hasExactActiveAgencyMembership(base44, user))) {
      return Response.json({ error: 'Forbidden: active agency membership required' }, { status: 403 });
    }
    const {
      duty_status,
      off_duty_message,
      target_user_email,
      scheduled_off_duty_start,
      scheduled_off_duty_end,
      scheduled_off_duty_recurring,
    } = await req.json();

    if (duty_status && !['on_duty', 'off_duty'].includes(duty_status)) {
      return Response.json({ error: 'duty_status must be "on_duty" or "off_duty"' }, { status: 400 });
    }

    // Validate the scheduled time-off window. Start and end must be supplied
    // together: both `null` clears it; both ISO strings set it. A one-sided
    // value is rejected rather than silently persisting a half-window.
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    const startProvided = scheduled_off_duty_start !== undefined;
    const endProvided = scheduled_off_duty_end !== undefined;
    if (startProvided !== endProvided) {
      return Response.json({ error: 'Provide scheduled_off_duty_start and scheduled_off_duty_end together.' }, { status: 400 });
    }
    let clearingSchedule = false;
    if (startProvided && endProvided) {
      const bothNull = scheduled_off_duty_start === null && scheduled_off_duty_end === null;
      const eitherNull = scheduled_off_duty_start === null || scheduled_off_duty_end === null;
      if (bothNull) {
        clearingSchedule = true;
      } else if (eitherNull) {
        return Response.json({ error: 'Both a start and end time are required to set a time-off window.' }, { status: 400 });
      } else {
        const s = new Date(scheduled_off_duty_start).getTime();
        const e = new Date(scheduled_off_duty_end).getTime();
        if (Number.isNaN(s) || Number.isNaN(e)) {
          return Response.json({ error: 'Scheduled start and end must both be valid dates.' }, { status: 400 });
        }
        if (e <= s) {
          return Response.json({ error: 'Scheduled end time must be after the start time.' }, { status: 400 });
        }
        if (scheduled_off_duty_recurring && e - s >= WEEK_MS) {
          return Response.json({ error: 'A repeating time-off window must be shorter than 7 days.' }, { status: 400 });
        }
      }
    }

    // Resolve who is being updated.
    let target = user;
    if (target_user_email && target_user_email !== user.email) {
      if (!isProtectedSuperAdmin(user)) {
        return Response.json({ error: 'Only the protected platform owner can change another user\'s duty status' }, { status: 403 });
      }
      const found = await base44.asServiceRole.entities.User.filter({ email: target_user_email }, undefined, 5000);
      if (!found[0]) return Response.json({ error: 'Target user not found' }, { status: 404 });
      target = found[0];
    }

    // The off-duty message is spoken to callers (TTS) and sent as an SMS
    // auto-reply, so sanitize on write: strip angle-bracket markup / control
    // chars (defends against SSML/markup injection) and cap the length.
    if (off_duty_message !== undefined && off_duty_message !== null && typeof off_duty_message !== 'string') {
      return Response.json({ error: 'off_duty_message must be a string' }, { status: 400 });
    }
    const cleanOffDuty = typeof off_duty_message === 'string'
      ? off_duty_message.replace(/[<>]/g, "").replace(/[\u0000-\u001F\u007F]/g, " ").slice(0, 320)
      : off_duty_message;

    const update = {};
    if (duty_status) {
      update.duty_status = duty_status;
      // Stamp when they toggled ON so the on-duty state expires nightly on its
      // own (the webhook treats a toggle set on an earlier day as off). Clear it
      // when toggling off.
      update.duty_on_since = duty_status === 'on_duty' ? new Date().toISOString() : null;
    }
    if (off_duty_message !== undefined) update.off_duty_message = cleanOffDuty;
    // Clear with null, set with an ISO string. Stored as-is and read live by the
    // inbound call/SMS webhooks, so the schedule needs no cron to take effect.
    if (scheduled_off_duty_start !== undefined) update.scheduled_off_duty_start = scheduled_off_duty_start || null;
    if (scheduled_off_duty_end !== undefined) update.scheduled_off_duty_end = scheduled_off_duty_end || null;
    if (scheduled_off_duty_recurring !== undefined) update.scheduled_off_duty_recurring = !!scheduled_off_duty_recurring;
    // Clearing the window also drops any recurrence so it can't linger.
    if (clearingSchedule) update.scheduled_off_duty_recurring = false;
    if (Object.keys(update).length === 0) {
      return Response.json({ error: 'Nothing to update' }, { status: 400 });
    }

    await base44.asServiceRole.entities.User.update(target.id, update);

    await base44.asServiceRole.entities.UserActivity.create({
      user_email: user.email,
      user_name: user.full_name,
      action: 'duty_status_changed',
      entity_type: 'User',
      entity_id: target.id,
      details: {
        duty_status: update.duty_status ?? target.duty_status,
        off_duty_message_set: off_duty_message !== undefined,
        scheduled_off_duty_recurring: update.scheduled_off_duty_recurring,
      },
      status: 'success',
    }).catch((err) => console.error('Failed to log activity:', err));

    return Response.json({ success: true, duty_status: update.duty_status ?? target.duty_status });
  } catch (error) {
    console.error('setNurseDutyStatus error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
