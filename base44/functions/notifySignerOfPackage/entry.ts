import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { data } = await req.json();

    // Entity-trigger (fires on DocumentPackage create): invoked by the platform
    // with no identity / no custom header, so a secret gate would 403 the
    // legitimate trigger when INTERNAL_FN_SECRET is set. Defense for a trigger:
    // re-fetch the canonical package by id and use ITS signer fields (never the
    // posted body), so the 30-day signing credential can only be minted for a real
    // package and can't be redirected to an attacker-chosen address.
    if (!data || !data.id) {
      return Response.json({ error: 'No package data provided' }, { status: 400 });
    }

    const pkg = await base44.asServiceRole.entities.DocumentPackage.get(data.id).catch(() => null);
    if (!pkg) {
      return Response.json({ success: true, skipped: 'package not found' });
    }
    if (!pkg.signer_email) {
      return Response.json({ success: true, skipped: 'No signer email' });
    }

    // Generate token for this signer. functions.invoke wraps the body under
    // `.data` (same convention as gradeTrainingAttempt's certResult.data), so
    // reading token.success/token.token directly was always undefined — the
    // function 500'd even on success and never emailed the signer.
    const tokenResult = await base44.asServiceRole.functions.invoke('generateSignerToken', {
      package_id: pkg.id,
      signer_email: pkg.signer_email,
      signer_name: pkg.signer_name,
    });

    const tokenData = tokenResult?.data || tokenResult;
    if (!tokenData?.success || !tokenData?.token) {
      return Response.json({ error: 'Failed to generate signer token' }, { status: 500 });
    }

    // Get patient name — tolerate a missing/stale patient_id (mirror sibling fetches)
    // so a deleted patient doesn't 500 a notification that can still be sent.
    const patient = pkg.patient_id
      ? await base44.asServiceRole.entities.Patient.get(pkg.patient_id).catch(() => null)
      : null;
    const patientName = patient ? `${patient.first_name} ${patient.last_name}` : 'a patient';

    // Send email notification
    const dueDate = pkg.due_date ? new Date(pkg.due_date).toLocaleDateString() : 'soon';
    const signerPortalLink = `${Deno.env.get('APP_URL') || 'https://app.base44.io'}/signer?token=${tokenData.token}`;

    const subject = `${pkg.package_name} - Documents Ready for Signature`;
    const body = `
Hello ${pkg.signer_name},

A new document package has been assigned to you for ${patientName}.

Package Name: ${pkg.package_name}
Due Date: ${dueDate}
Documents: ${pkg.document_signatures?.length || 0} document(s) to review and sign

Click the link below to access your secure signing portal:
${signerPortalLink}

This link is unique to you and is securely authenticated. It will expire in 30 days.

Please review and sign all documents at your earliest convenience.

If you have any questions, please contact the healthcare provider.

Thank you,
Document Management System
    `;

    await base44.integrations.Core.SendEmail({
      to: pkg.signer_email,
      subject,
      body,
      from_name: 'Document Management',
    });

    return Response.json({ success: true, email_sent: true });
  } catch (error) {
    console.error('Error sending signer notification:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});