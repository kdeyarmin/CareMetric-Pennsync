import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

// <<<BEGIN SHARED HELPER: requireAgencyAdminAgency — generated, edit base44/_shared/backendHelpers.mjs>>>
function agencyAdminMissingAgencyResponse(user) {
  if (user && user.account_type === 'agency_admin' && !String(user.agency_name || '').trim()) {
    return Response.json({ error: 'Forbidden: agency_name is required.' }, { status: 403 });
  }
  return null;
}
// <<<END SHARED HELPER: requireAgencyAdminAgency>>>


Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    {
      const _agencyAdminGate = agencyAdminMissingAgencyResponse(user);
      if (_agencyAdminGate) return _agencyAdminGate;
    }
    const { document_id, reminder_days, deadline_date } = await req.json();

    if (!document_id || !reminder_days) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }
    // reminder_days feeds the reminder-time math below; a non-numeric value makes
    // reminderTime NaN and new Date(NaN).toISOString() throw a 500, and a negative
    // value would schedule the reminder AFTER the deadline. Require a finite >= 0.
    const reminderDays = Number(reminder_days);
    if (!Number.isFinite(reminderDays) || reminderDays < 0) {
      return Response.json({ error: 'reminder_days must be a non-negative number' }, { status: 400 });
    }
    // deadline_date drives the reminder-time math below; reject a missing/unparseable
    // value with a 400 rather than letting new Date(NaN).toISOString() throw a 500.
    if (!deadline_date || Number.isNaN(new Date(deadline_date).getTime())) {
      return Response.json({ error: 'A valid deadline_date is required' }, { status: 400 });
    }

    // Load the signature request and authorize the caller against IT. Previously
    // this trusted a caller-supplied document_id + signer_emails, so any logged-in
    // user could send trusted-system "please sign" notifications to ARBITRARY
    // addresses (platform-blessed phishing) and flip reminder_sent on any
    // document they don't own. Mirror sendSignatureReminder's ownership model and
    // derive recipients from the document's own signer list.
    const sigRows = await base44.asServiceRole.entities.DocumentSignature.filter({ id: document_id }, undefined, 5000);
    if (!sigRows || sigRows.length === 0) {
      return Response.json({ error: 'Document not found' }, { status: 404 });
    }
    const sig = sigRows[0];

    const patientRows = sig.patient_id
      ? await base44.asServiceRole.entities.Patient.filter({ id: sig.patient_id }, undefined, 5000).catch(() => [])
      : [];
    const patient = patientRows[0] || {};

    const isAdminLike = user.role === 'admin'
      || user.account_type === 'agency_admin'
      || user.account_type === 'super_admin';
    const ownsSignature = sig.created_by === user.email
      || sig.requested_by === user.email
      || sig.sender_email === user.email;
    const assignedToPatient = patient.created_by === user.email
      || (Array.isArray(patient.assigned_nurses) && patient.assigned_nurses.includes(user.email));
    if (!isAdminLike && !ownsSignature && !assignedToPatient) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    // Agency-scoped admins may not schedule reminders for other tenants' charts.
    const isAgencyScopedAdmin = user.account_type !== 'super_admin'
      && user.agency_name
      && (user.account_type === 'agency_admin' || user.role === 'admin');
    if (isAgencyScopedAdmin && !ownsSignature && !assignedToPatient) {
      const agencyUsers = await base44.asServiceRole.entities.User.list('-created_date', 5000).catch(() => []);
      const agencyEmails = new Set(
        (agencyUsers || [])
          .filter((u) => u.agency_name === user.agency_name && u.email)
          .map((u) => u.email),
      );
      const inAgency = (patient.created_by && agencyEmails.has(patient.created_by))
        || (Array.isArray(patient.assigned_nurses) && patient.assigned_nurses.some((e) => agencyEmails.has(e)));
      if (!inAgency) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    // Recipients come from the document's own pending signers, NOT the request
    // body — so the caller can't redirect reminders to arbitrary inboxes.
    const recipients = (Array.isArray(sig.signers) ? sig.signers : [])
      .filter((s) => s && s.email && s.status !== 'completed')
      .map((s) => String(s.email).trim())
      .filter(Boolean);
    if (recipients.length === 0) {
      return Response.json({ error: 'No pending signers with an email to remind' }, { status: 400 });
    }

    const deadlineTime = new Date(deadline_date).getTime();
    const reminderTime = deadlineTime - (reminderDays * 24 * 60 * 60 * 1000);
    const now = new Date().getTime();

    // If the computed reminder time is already in the past, deliver NOW rather
    // than silently dropping it. A future reminder is QUEUED as a
    // ScheduledSignatureReminder row for dispatchScheduledSignatureReminders
    // (cron) — previously the notifications were created immediately no matter
    // how far out the reminder time was, so "schedule for 3 days before the
    // deadline" pinged every signer the moment the request was made.
    const immediate = reminderTime <= now;
    const reminderIso = new Date(immediate ? now : reminderTime).toISOString();

    if (!immediate) {
      const documentName = sig.document_name || sig.document_title || sig.document_type || 'Document';
      await base44.asServiceRole.entities.ScheduledSignatureReminder.create({
        document_id,
        document_name: documentName,
        deadline_date: new Date(deadline_date).toISOString(),
        send_at: reminderIso,
        requested_by: user.email,
        status: 'pending',
        attempts: 0,
      });
      return Response.json({
        success: true,
        message: 'Reminders scheduled successfully',
        scheduled: true,
        // Recipients are re-derived from the document's pending signers at send
        // time, so signers who complete before send_at aren't reminded.
        reminder_count: recipients.length,
        reminder_date: reminderIso
      });
    }

    // Stamp FIRST (claim), then notify — notify-before-stamp duplicated
    // reminders when the stamp failed or concurrent clicks raced.
    const claimAt = new Date().toISOString();
    const priorCount = Number(sig.reminder_sent_count) || 0;
    await base44.asServiceRole.entities.DocumentSignature.update(document_id, {
      reminder_sent: true,
      last_reminder_sent_at: claimAt,
      reminder_sent_count: priorCount + 1,
    });
    const claimCheck = await base44.asServiceRole.entities.DocumentSignature
      .filter({ id: document_id }, undefined, 1)
      .catch(() => []);
    if (!claimCheck[0] || claimCheck[0].last_reminder_sent_at !== claimAt) {
      return Response.json({
        success: true,
        message: 'Reminder already claimed by a concurrent request',
        scheduled: false,
        reminder_count: 0,
        reminder_date: reminderIso,
      });
    }

    let created = 0;
    for (const email of recipients) {
      try {
        await base44.asServiceRole.entities.Notification.create({
          user_email: email,
          title: 'Signature Pending — Document Due Soon',
          message: `You have a document pending signature. Please review and sign by ${new Date(deadline_date).toLocaleDateString()}.`,
          type: 'task_due_soon',
          priority: 'high',
          is_read: false,
        });
        created += 1;
      } catch (err) {
        console.error('Immediate signature reminder notify failed:', err?.message || err);
      }
    }

    return Response.json({
      success: true,
      message: 'Reminder date had passed; reminders created immediately',
      scheduled: false,
      reminder_count: created,
      reminder_date: reminderIso
    });
  } catch (error) {
    console.error('Error scheduling reminders:', error);
    return Response.json({ error: 'Failed to schedule reminders' }, { status: 500 });
  }
});