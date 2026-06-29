import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { jsPDF } from 'npm:jspdf@2.5.1';

// Operational logs are gated behind FUNCTIONS_DEBUG so they don't run in
// production by default. console.error/warn remain ungated for visibility.
const DEBUG = !!Deno.env.get('FUNCTIONS_DEBUG');
const debugLog = (...args) => { if (DEBUG) console.log(...args); };

// Canonical, human-readable report body. Mirrors the format the
// StateReportableForm previously built client-side so emails + the stored PDF
// stay consistent regardless of which screen submitted the report.
function buildReportText(p) {
  return `
STATE REPORTABLE EVENT REPORT
==============================
Patient: ${p.patient_name || p.patient_id}
Date of Event: ${p.event_date || ''}
Time of Event: ${p.event_time || ''}
Event Type: ${p.event_type || ''}
Location of Event: ${p.location_of_event || ''}

Medications (Name & Frequency):
${p.medications || 'Not provided'}

Diagnosis of Patient:
${p.diagnosis || 'Not provided'}

Factual Description:
${p.factual_description || ''}

Description of Follow-up Action:
${p.followup_action || ''}

Submitted By: ${p.submitted_by_name || 'Unknown'}${p.submitted_by_title ? ` (${p.submitted_by_title})` : ''}
Submitted On: ${new Date().toLocaleString()}
  `.trim();
}

// Render the report text into a paginated PDF and return its bytes.
function renderReportPdf(reportText) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 18;
  const maxWidth = pageWidth - margin * 2;
  let y = margin;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(185, 28, 28);
  doc.text('STATE REPORTABLE EVENT REPORT', margin, y);
  y += 8;
  doc.setDrawColor(185, 28, 28);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);

  // The title is already rendered above; drop it from the body text.
  const body = reportText.replace(/^STATE REPORTABLE EVENT REPORT\s*=*\s*/i, '').trim();
  const lines = doc.splitTextToSize(body, maxWidth);
  const lineHeight = 6;
  for (const line of lines) {
    if (y > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
    doc.text(line, margin, y);
    y += lineHeight;
  }
  return doc.output('arraybuffer');
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await req.json();

    if (
      !payload.patient_id ||
      !payload.event_type ||
      !payload.event_date ||
      !(payload.factual_description || payload.report_text)
    ) {
      return Response.json({ error: 'Missing required state-reportable event fields' }, { status: 400 });
    }

    const reportText = payload.report_text || buildReportText(payload);

    // 1) Persist the incident FIRST so the record is retained even if a later
    //    step (PDF, email) fails. If this throws, the outer catch returns 500
    //    and the nurse can retry.
    const incident = await base44.entities.Incident.create({
      patient_id: payload.patient_id,
      patient_name: payload.patient_name || payload.patient_id,
      incident_type: 'other',
      incident_name: `State Reportable: ${payload.event_type}`,
      incident_date: payload.event_date,
      incident_time: payload.event_time || '',
      severity: 'high',
      report: reportText,
      state_reportable: true,
      status: 'reported',
      office_notified: true,
      alert_triggered: true,
      details: {
        state_reportable: true,
        event_type: payload.event_type,
        event_type_id: payload.event_type_id,
        location_of_event: payload.location_of_event,
        medications: payload.medications,
        diagnosis: payload.diagnosis,
        factual_description: payload.factual_description,
        followup_action: payload.followup_action,
        submitted_by_name: payload.submitted_by_name || user.full_name,
        submitted_by_title: payload.submitted_by_title,
        submitted_by_email: user.email,
        submitted_at: new Date().toISOString(),
        source: payload.source || 'state_reportable_form',
      },
    });

    // 2) Generate + store a PDF copy as a retained Document (best-effort).
    let pdfUrl = null;
    let documentId = null;
    try {
      const pdfBytes = renderReportPdf(reportText);
      const safeType = String(payload.event_type || 'event').replace(/[^a-z0-9]+/gi, '_').slice(0, 60);
      const fileName = `State_Reportable_${safeType}_${payload.event_date || ''}.pdf`;
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const file = new File([blob], fileName, { type: 'application/pdf' });
      const uploadResult = await base44.asServiceRole.integrations.Core.UploadFile({ file });
      pdfUrl = uploadResult.file_url;

      const document = await base44.asServiceRole.entities.Document.create({
        title: `State Reportable Event – ${payload.event_type}`,
        description: `State-reportable incident report for ${payload.patient_name || payload.patient_id}`,
        file_url: pdfUrl,
        file_name: fileName,
        file_type: 'application/pdf',
        category: 'state_reportable_incident',
        patient_id: payload.patient_id,
        tags: ['state_reportable', 'incident'],
        document_date: payload.event_date,
        uploaded_by: user.email,
        is_sensitive: true,
      });
      documentId = document.id;
    } catch (pdfErr) {
      debugLog('State-reportable PDF/Document step failed:', pdfErr?.message);
    }

    // 3) Notify every admin: in-app notification + immediate email (server-side,
    //    so it does not depend on the submitter's browser staying open).
    const admins = await base44.asServiceRole.entities.User.filter({ role: 'admin' });
    const adminList = Array.isArray(admins) ? admins : [];

    let notifiedCount = 0;
    const recipients = [];
    const failures = [];

    if (adminList.length > 0) {
      await Promise.all(
        adminList.map((admin) =>
          base44.asServiceRole.entities.Notification.create({
            user_email: admin.email,
            title: `⚠️ State Reportable Event – ${payload.event_type}`,
            message: `${user.full_name || user.email} submitted a state reportable event for ${payload.patient_name || 'a patient'} on ${payload.event_date}. Immediate follow-up required.`,
            type: 'critical_alert',
            priority: 'critical',
            is_read: false,
            action_url: '/IncidentReportingModule',
            action_label: 'Review incident',
            metadata: {
              incident_id: incident.id,
              patient_id: payload.patient_id,
              state_reportable: true,
              document_url: pdfUrl,
            },
          })
            .then(() => { notifiedCount += 1; })
            .catch((e) => debugLog('Admin notification failed:', e?.message))
        )
      );

      const subject = `[URGENT] State Reportable Event – ${payload.event_type} – ${payload.patient_name || payload.patient_id}`;
      const body = `${reportText}

${pdfUrl
        ? `A PDF copy of this report has been retained and is available here:\n${pdfUrl}`
        : 'A PDF copy could not be generated automatically; the full report text is above.'}

Please review and follow up in the Incident Reporting module.`;

      await Promise.all(
        adminList.map((admin) =>
          base44.asServiceRole.integrations.Core.SendEmail({
            to: admin.email,
            subject,
            body,
            from_name: 'PENNSync Compliance',
          })
            .then(() => { recipients.push(admin.email); })
            .catch((e) => {
              failures.push({ email: admin.email, error: e?.message });
              debugLog('Admin email failed:', e?.message);
            })
        )
      );
    }

    // 4) Record the alert audit + PDF link on the retained incident.
    try {
      await base44.asServiceRole.entities.Incident.update(incident.id, {
        ...(pdfUrl ? { state_reportable_pdf_url: pdfUrl } : {}),
        ...(recipients.length > 0
          ? { state_reportable_alert_sent_at: new Date().toISOString() }
          : {}),
        details: {
          ...(incident.details || {}),
          document_id: documentId,
          admin_alert: {
            email_sent_at: recipients.length > 0 ? new Date().toISOString() : null,
            recipients,
            failures,
            notified_count: notifiedCount,
          },
        },
      });
    } catch (auditErr) {
      debugLog('Incident audit update failed:', auditErr?.message);
    }

    return Response.json({
      success: true,
      incident_id: incident.id,
      document_url: pdfUrl,
      admin_count: adminList.length,
      admins_notified: notifiedCount,
      emails_sent: recipients.length,
      email_failures: failures.length,
    });
  } catch (error) {
    console.error('submitStateReportableIncident failed:', error?.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});