import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: schedulerAuth — generated, edit base44/_shared/backendHelpers.mjs>>>
const SCHEDULER_SECRET_HEADER = 'x-internal-secret';
function isSchedulerAdmin(user) {
  return !!user && (
    user.role === 'admin' || user.account_type === 'agency_admin' ||
    user.account_type === 'super_admin'
  );
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

/**
 * dispatchScheduledSignatureReminders — cron job that delivers due
 * ScheduledSignatureReminder rows (queued by scheduleSignatureReminders).
 * Configure a schedule (e.g. every 15 minutes) for this function in the Base44
 * dashboard.
 *
 * For each pending row whose send_at has passed it: claims the row (pending ->
 * sending) so overlapping runs don't double-notify, re-loads the
 * DocumentSignature, re-derives the recipients from the document's CURRENT
 * pending signers (signers who completed after scheduling are not reminded;
 * a fully-signed document cancels the reminder), creates the in-app
 * Notification rows, and stamps the reminder bookkeeping on the document.
 *
 * A late dispatch (cron downtime) still delivers as long as the document has
 * pending signers — unlike SMS there is no double-send risk against an external
 * provider, and the message adapts to overdue wording past the deadline.
 */

const BATCH_LIMIT = 100;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Authorization: privileged cron job (service-role reads/writes, no end
    // user). A real scheduler runs unauthenticated and passes; a logged-in
    // non-admin is always rejected (so no user can force-dispatch reminders
    // off-schedule).
    const me = await base44.auth.me().catch(() => null);
    const authError = getSchedulerAuthError(req, me);
    if (authError) return authError;

    // A unique id for THIS cron run, used to claim rows (see the claim below).
    const runId = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    // Pending rows that are due. (Base44 filter operators may vary; fetch a
    // batch of pending rows and filter by time in code to stay portable.)
    const pending = await base44.asServiceRole.entities.ScheduledSignatureReminder
      .filter({ status: 'pending' }, 'send_at', BATCH_LIMIT).catch(() => []);
    const due = pending.filter((r) => r.send_at && r.send_at <= nowIso);

    const result = { processed: 0, sent: 0, failed: 0, canceled: 0, skipped: 0 };

    for (const row of due) {
      // Claim with a per-run token, then RE-READ to confirm we still own it, so
      // overlapping runs don't create duplicate notifications for the same row
      // (the loser sees the winner's token and skips).
      try {
        await base44.asServiceRole.entities.ScheduledSignatureReminder.update(row.id, {
          status: 'sending', claimed_by: runId, claimed_at: new Date().toISOString(),
        });
      } catch {
        result.skipped++;
        continue;
      }
      const claimCheck = await base44.asServiceRole.entities.ScheduledSignatureReminder
        .filter({ id: row.id }, '-created_date', 1).catch(() => []);
      if (!claimCheck[0] || claimCheck[0].claimed_by !== runId) {
        result.skipped++;
        continue;
      }
      // Cancel can race the claim (offboard stamps canceled_at). Claim may
      // overwrite status to 'sending' but canceled_at survives — honor it.
      if (claimCheck[0].canceled_at || claimCheck[0].status === 'canceled') {
        await base44.asServiceRole.entities.ScheduledSignatureReminder.update(row.id, {
          status: 'canceled', claimed_by: '', claimed_at: null,
        }).catch(() => {});
        result.canceled++;
        continue;
      }
      result.processed++;

      const fail = async (reason) => {
        result.failed++;
        await base44.asServiceRole.entities.ScheduledSignatureReminder.update(row.id, {
          status: 'failed', failure_reason: reason, attempts: (row.attempts || 0) + 1,
        }).catch(() => {});
      };
      const cancel = async (reason) => {
        result.canceled++;
        await base44.asServiceRole.entities.ScheduledSignatureReminder.update(row.id, {
          status: 'canceled', failure_reason: reason, attempts: (row.attempts || 0) + 1,
        }).catch(() => {});
      };

      const sigRows = await base44.asServiceRole.entities.DocumentSignature
        .filter({ id: row.document_id }, undefined, 5000).catch(() => []);
      const sig = sigRows[0];
      if (!sig) {
        await fail('Signature request no longer exists');
        continue;
      }
      if (sig.status === 'completed' || sig.status === 'signed' || sig.status === 'cancelled' || sig.status === 'canceled') {
        await cancel(`Signature request is ${sig.status}; no reminder needed`);
        continue;
      }

      // Recipients come from the document's CURRENT pending signers — a signer
      // who completed between scheduling and dispatch is not re-nagged.
      const recipients = (Array.isArray(sig.signers) ? sig.signers : [])
        .filter((s) => s && s.email && s.status !== 'completed')
        .map((s) => String(s.email).trim())
        .filter(Boolean);
      if (recipients.length === 0) {
        await cancel('All signers completed before the reminder was due');
        continue;
      }

      const documentName = row.document_name || sig.document_name || sig.document_title || sig.document_type || 'Document';
      const deadline = row.deadline_date ? new Date(row.deadline_date) : null;
      const isOverdue = !!(deadline && deadline.getTime() < Date.now());
      const deadlineText = deadline ? ` by ${deadline.toLocaleDateString()}` : '';

      let created = 0;
      for (const email of recipients) {
        try {
          await base44.asServiceRole.entities.Notification.create({
            user_email: email,
            title: isOverdue
              ? 'Signature Overdue — Document Needs Your Signature'
              : 'Signature Pending — Document Due Soon',
            message: isOverdue
              ? `"${documentName}" is overdue for your signature. Please review and sign as soon as possible.`
              : `You have a document pending signature ("${documentName}"). Please review and sign${deadlineText}.`,
            type: 'task_due_soon',
            priority: isOverdue ? 'critical' : 'high',
            is_read: false,
            metadata: { signature_id: sig.id, document_name: documentName, scheduled_reminder_id: row.id },
          });
          created++;
        } catch (err) {
          console.error('Scheduled signature reminder notification create failed:', err?.message || err);
        }
      }

      if (created === 0) {
        await fail('Failed to create any signer notifications');
        continue;
      }

      await base44.asServiceRole.entities.DocumentSignature.update(sig.id, {
        reminder_sent: true,
        last_reminder_sent_at: new Date().toISOString(),
        reminder_sent_count: (Number(sig.reminder_sent_count) || 0) + 1,
      }).catch(() => {});

      await base44.asServiceRole.entities.ScheduledSignatureReminder.update(row.id, {
        status: 'sent',
        sent_at: new Date().toISOString(),
        reminder_count: created,
        attempts: (row.attempts || 0) + 1,
        failure_reason: created < recipients.length
          ? `Delivered ${created} of ${recipients.length} signer notifications`
          : null,
      }).catch(() => {});
      result.sent++;
    }

    return Response.json({ success: true, ...result, checked_at: nowIso });
  } catch (error) {
    console.error('dispatchScheduledSignatureReminders error:', error);
    return Response.json({ error: 'Failed to dispatch scheduled signature reminders' }, { status: 500 });
  }
});
