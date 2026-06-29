import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { document_id, reminder_days, deadline_date } = await req.json();

    if (!document_id || !reminder_days) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
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
    const sigRows = await base44.asServiceRole.entities.DocumentSignature.filter({ id: document_id });
    if (!sigRows || sigRows.length === 0) {
      return Response.json({ error: 'Document not found' }, { status: 404 });
    }
    const sig = sigRows[0];

    const patientRows = sig.patient_id
      ? await base44.asServiceRole.entities.Patient.filter({ id: sig.patient_id }).catch(() => [])
      : [];
    const patient = patientRows[0] || {};

    const role = user.role;
    const privilegedRole = role === 'admin' || role === 'clinician' || role === 'nurse_manager';
    const ownsSignature = sig.created_by === user.email
      || sig.requested_by === user.email
      || sig.sender_email === user.email;
    const assignedToPatient = patient.created_by === user.email
      || (Array.isArray(patient.assigned_nurses) && patient.assigned_nurses.includes(user.email));
    if (!privilegedRole && !ownsSignature && !assignedToPatient) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
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
    const reminderTime = deadlineTime - (reminder_days * 24 * 60 * 60 * 1000);
    const now = new Date().getTime();

    // If the computed reminder time is already in the past, schedule it for NOW
    // rather than silently dropping it.
    const immediate = reminderTime <= now;
    const reminderIso = new Date(immediate ? now : reminderTime).toISOString();

    for (const email of recipients) {
      await base44.asServiceRole.entities.Notification.create({
        user_email: email,
        title: 'Signature Pending — Document Due Soon',
        message: `You have a document pending signature. Please review and sign by ${new Date(deadline_date).toLocaleDateString()}.`,
        type: 'task_due_soon',
        priority: 'high',
        is_read: false,
      });
    }

    await base44.asServiceRole.entities.DocumentSignature.update(document_id, {
      reminder_sent: true
    });

    return Response.json({
      success: true,
      message: immediate ? 'Reminder date had passed; reminders created immediately' : 'Reminders scheduled successfully',
      reminder_count: recipients.length,
      reminder_date: reminderIso
    });
  } catch (error) {
    console.error('Error scheduling reminders:', error);
    return Response.json({ error: 'Failed to schedule reminders' }, { status: 500 });
  }
});