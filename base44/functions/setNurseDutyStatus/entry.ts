import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * setNurseDutyStatus — self-service duty toggle, scheduled time-off window, and
 * off-duty message editor. A nurse updates their own status; an admin may target
 * another user.
 *
 * No Twilio call is needed: the inbound VCA/SMS webhooks read duty_status and the
 * scheduled_off_duty_* window live at call/message time, so changes take effect
 * immediately and a schedule expires on its own (no cron).
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

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
      if (user.role !== 'admin') {
        return Response.json({ error: 'Only administrators can change another user\'s duty status' }, { status: 403 });
      }
      const found = await base44.asServiceRole.entities.User.filter({ email: target_user_email });
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

    await base44.entities.UserActivity.create({
      user_email: user.email,
      user_name: user.full_name,
      action: 'duty_status_changed',
      entity_type: 'User',
      entity_id: target.id,
      details: {
        target_user_email: target.email,
        duty_status: update.duty_status ?? target.duty_status,
        off_duty_message_set: off_duty_message !== undefined,
        scheduled_off_duty_start: update.scheduled_off_duty_start,
        scheduled_off_duty_end: update.scheduled_off_duty_end,
        scheduled_off_duty_recurring: update.scheduled_off_duty_recurring,
        timestamp: new Date().toISOString(),
      },
      status: 'success',
    }).catch((err) => console.error('Failed to log activity:', err));

    return Response.json({ success: true, duty_status: update.duty_status ?? target.duty_status });
  } catch (error) {
    console.error('setNurseDutyStatus error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});