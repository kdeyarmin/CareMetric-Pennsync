import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { jsPDF } from 'npm:jspdf@2.5.2';

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

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


// <<<BEGIN SHARED HELPER: brandedEmail — generated, edit base44/_shared/backendHelpers.mjs>>>
const BRAND_EMAIL = {
  navy: '#213a76', navyDeep: '#1c2f5e', gold: '#c7901f',
  ink: '#111a2b', slate: '#334155', muted: '#5b6a7f', line: '#e4e9f1',
  wash: '#eef3fc', panel: '#f5f8fd',
  logo: 'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/68ee80d98929370f9e8f2932/02eed9872_pennsynclogoupdated.png',
};
// Callout tones. 'info' is on-brand navy; success/warn/urgent reuse the manual
// theme's green/amber/red and are used ONLY for genuine status (never decoration).
const EMAIL_TONES = {
  info:    { bg: '#eef3fc', border: '#88a5e0', text: '#213a76' },
  success: { bg: '#effdf4', border: '#86efac', text: '#15803d' },
  warn:    { bg: '#fff8ec', border: '#fcd68a', text: '#b45309' },
  urgent:  { bg: '#fef2f2', border: '#fca5a5', text: '#b91c1c' },
};
function escapeEmailHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
// Allow only absolute http(s)/mailto links in email buttons, then HTML-escape the
// whole attribute value. Rejects dangerous/unusable schemes (javascript:, data:,
// protocol-relative //host, app-relative paths that don't resolve in an inbox) so
// a user-controlled URL can never inject a scheme or break out of the attribute.
// Returns '' for a rejected URL, and the caller then renders no button.
function safeEmailHref(raw) {
  const url = String(raw ?? '').trim();
  const lower = url.toLowerCase();
  const ok = lower.startsWith('https://') || lower.startsWith('http://') || lower.startsWith('mailto:');
  return ok ? escapeEmailHtml(url) : '';
}
function emailParagraph(text) {
  return `<p style="margin:0 0 14px;font-size:15px;line-height:1.62;color:${BRAND_EMAIL.slate};">${escapeEmailHtml(text)}</p>`;
}
function renderEmailSection(section) {
  const s = section || {};
  const parts = [];
  if (s.heading) {
    parts.push(`<h2 style="margin:20px 0 8px;font-size:16px;font-weight:800;color:${BRAND_EMAIL.ink};">${escapeEmailHtml(s.heading)}</h2>`);
  }
  for (const p of (Array.isArray(s.paragraphs) ? s.paragraphs : [])) parts.push(emailParagraph(p));
  if (s.pre) {
    parts.push(`<pre style="margin:4px 0 16px;padding:14px 16px;background:${BRAND_EMAIL.panel};border:1px solid ${BRAND_EMAIL.line};border-radius:10px;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:12.5px;line-height:1.5;color:${BRAND_EMAIL.ink};white-space:pre-wrap;word-break:break-word;">${escapeEmailHtml(s.pre)}</pre>`);
  }
  if (Array.isArray(s.rows) && s.rows.length) {
    const rows = s.rows.map((r) =>
      `<tr><td style="padding:5px 0;font-size:13.5px;color:${BRAND_EMAIL.muted};vertical-align:top;white-space:nowrap;">${escapeEmailHtml(r[0])}</td>` +
      `<td style="padding:5px 0 5px 16px;font-size:14px;color:${BRAND_EMAIL.ink};font-weight:600;vertical-align:top;">${escapeEmailHtml(r[1])}</td></tr>`
    ).join('');
    parts.push(`<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:4px 0 16px;background:${BRAND_EMAIL.panel};border:1px solid ${BRAND_EMAIL.line};border-radius:10px;"><tr><td style="padding:8px 16px;"><table role="presentation" cellpadding="0" cellspacing="0" width="100%">${rows}</table></td></tr></table>`);
  }
  if (Array.isArray(s.bullets) && s.bullets.length) {
    const items = s.bullets.map((b) =>
      `<li style="margin:0 0 7px;font-size:14.5px;line-height:1.55;color:${BRAND_EMAIL.slate};">${escapeEmailHtml(b)}</li>`
    ).join('');
    parts.push(`<ul style="margin:0 0 16px;padding-left:20px;">${items}</ul>`);
  }
  if (s.callout && s.callout.text) {
    const t = EMAIL_TONES[s.callout.tone] || EMAIL_TONES.info;
    parts.push(`<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:4px 0 16px;"><tr><td style="padding:13px 16px;background:${t.bg};border-left:4px solid ${t.border};border-radius:8px;font-size:14px;line-height:1.55;color:${t.text};font-weight:600;">${escapeEmailHtml(s.callout.text)}</td></tr></table>`);
  }
  if (s.button && s.button.href) {
    const href = safeEmailHref(s.button.href);
    if (href) {
      parts.push(`<div style="margin:6px 0 18px;"><a href="${href}" target="_blank" rel="noopener" style="display:inline-block;padding:13px 26px;border-radius:8px;background:${BRAND_EMAIL.navy};color:#ffffff;font-weight:700;font-size:15px;line-height:1;text-decoration:none;">${escapeEmailHtml(s.button.label || 'Open PennSync')}</a></div>`);
    }
  }
  if (s.note) {
    parts.push(`<p style="margin:0 0 14px;font-size:12.5px;line-height:1.55;color:${BRAND_EMAIL.muted};">${escapeEmailHtml(s.note)}</p>`);
  }
  return parts.join('');
}
/**
 * Build a branded PennSync email. Returns an HTML string for SendEmail's body.
 * opts: { preheader, eyebrow, tone('brand'|'urgent'), title, intro(string|string[]),
 *         sections[{ heading, paragraphs[], pre, rows[[k,v]], bullets[], callout{text,tone},
 *         button{href,label}, note }], signoffName, footerNote }
 */
function renderBrandedEmail(opts) {
  const o = opts || {};
  const rule = o.tone === 'urgent' ? '#dc2626' : BRAND_EMAIL.gold;
  const intro = Array.isArray(o.intro) ? o.intro : (o.intro ? [o.intro] : []);
  const sections = Array.isArray(o.sections) ? o.sections : [];
  const signoff = o.signoffName === null ? '' : (o.signoffName || 'The PennSync by CareMetric Team');
  const preheader = o.preheader ? escapeEmailHtml(o.preheader) : '';
  const eyebrow = o.eyebrow
    ? `<p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:${BRAND_EMAIL.gold};">${escapeEmailHtml(o.eyebrow)}</p>`
    : '';
  const introHtml = intro.map(emailParagraph).join('');
  const sectionsHtml = sections.map(renderEmailSection).join('');
  const signoffHtml = signoff
    ? `<p style="margin:22px 0 2px;font-size:15px;line-height:1.6;color:${BRAND_EMAIL.slate};">Warm regards,<br /><strong style="color:${BRAND_EMAIL.navy};">${escapeEmailHtml(signoff)}</strong></p>`
    : '';
  const footerNote = o.footerNote
    ? `<p style="margin:0 0 8px;font-size:11.5px;line-height:1.5;color:${BRAND_EMAIL.muted};">${escapeEmailHtml(o.footerNote)}</p>`
    : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><meta name="color-scheme" content="light only" /><title>${escapeEmailHtml(o.title || 'PennSync by CareMetric')}</title></head>
<body style="margin:0;padding:0;background:${BRAND_EMAIL.wash};">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;color:${BRAND_EMAIL.wash};">${preheader}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND_EMAIL.wash};"><tr><td align="center" style="padding:28px 14px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border:1px solid ${BRAND_EMAIL.line};border-radius:16px;overflow:hidden;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <tr><td style="background:linear-gradient(180deg,#25407e 0%,${BRAND_EMAIL.navyDeep} 100%);padding:28px 28px 24px;text-align:center;">
    <img src="${BRAND_EMAIL.logo}" width="54" height="54" alt="PennSync" style="display:inline-block;width:54px;height:54px;border-radius:13px;border:0;" />
    <div style="margin-top:11px;font-size:23px;font-weight:800;letter-spacing:-.3px;color:#ffffff;">Penn<span style="color:${BRAND_EMAIL.gold};">Sync</span></div>
    <div style="margin-top:4px;font-size:10.5px;font-weight:600;letter-spacing:4px;text-transform:uppercase;color:#b6c9ee;">by CareMetric</div>
    <div style="width:58px;height:4px;border-radius:3px;background:${rule};margin:14px auto 0;"></div>
  </td></tr>
  <tr><td style="padding:30px 32px 6px;">
    ${eyebrow}<h1 style="margin:0;font-size:22px;font-weight:800;color:${BRAND_EMAIL.navy};">${escapeEmailHtml(o.title || '')}</h1>
  </td></tr>
  <tr><td style="padding:14px 32px 4px;">${introHtml}${sectionsHtml}${signoffHtml}</td></tr>
  <tr><td style="padding:24px 32px 30px;text-align:center;">
    <div style="height:1px;background:${BRAND_EMAIL.line};margin-bottom:16px;"></div>
    <div style="font-size:13px;font-weight:800;color:${BRAND_EMAIL.navy};">Penn<span style="color:${BRAND_EMAIL.gold};">Sync</span> <span style="font-weight:600;color:${BRAND_EMAIL.muted};">by CareMetric</span></div>
    ${footerNote}<p style="margin:8px 0 0;font-size:11.5px;line-height:1.5;color:${BRAND_EMAIL.muted};">This is an automated message from PennSync by CareMetric — please do not reply to this email.</p>
  </td></tr>
</table></td></tr></table>
</body></html>`;
}
// <<<END SHARED HELPER: brandedEmail>>>

// Operational debug logs are compiled out in production (the FUNCTIONS_DEBUG
// secret was retired). console.error/warn remain ungated for visibility.
// PA state event code -> Incident.incident_type (aggregation category).
// Only map PA event codes with an unambiguous incident_type. IE = hospital
// transfer, HC = medication-error death (verified against EventReport's list).
// Everything else (incl. code 18 "Other") stays 'other' — guessing a 'fall'
// for it contaminated fall analytics.
const STATE_EVENT_TO_INCIDENT_TYPE = {
  IE: 'hospitalized',
  HC: 'medication_error',
};

const debugLog = (..._args) => {};

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
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const callerEmail = normalizeProtectedEmail(user.email);
    if (!callerEmail) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const payload = await req.json();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return Response.json({ error: 'Invalid request body' }, { status: 400 });
    }

    if (
      !payload.patient_id ||
      !payload.event_type ||
      !payload.event_date ||
      !(payload.factual_description || payload.report_text)
    ) {
      return Response.json({ error: 'Missing required state-reportable event fields' }, { status: 400 });
    }
    if (
      typeof payload.patient_id !== 'string'
      || !payload.patient_id.trim()
      || payload.patient_id.trim().length > 200
    ) {
      return Response.json({ error: 'Invalid patient_id' }, { status: 400 });
    }
    if (
      payload.event_type_id != null
      && payload.event_type_id !== ''
      && (
        typeof payload.event_type_id !== 'string'
        || !payload.event_type_id.trim()
        || payload.event_type_id.trim().length > 100
      )
    ) {
      return Response.json({ error: 'Invalid event_type_id' }, { status: 400 });
    }
    const scopedPatientId = payload.patient_id.trim();

    // Service-role writes bypass RLS, so prove access to the exact requested
    // Patient before building/uploading a file or creating/emailing anything.
    // account_type and agency fields are self-mutable User data and must never
    // grant cross-chart access.
    const patientRows = await base44.asServiceRole.entities.Patient
      .filter({ id: scopedPatientId }, '', 1).catch(() => []);
    const incidentPatient = (Array.isArray(patientRows) ? patientRows : [])
      .find((patient) => typeof patient?.id === 'string'
        && patient.id.trim() === scopedPatientId);
    if (!incidentPatient) {
      return Response.json({ error: 'Patient not found' }, { status: 404 });
    }
    const isOwner = normalizeProtectedEmail(incidentPatient.created_by) === callerEmail;
    const isAssigned = Array.isArray(incidentPatient.assigned_nurses)
      && incidentPatient.assigned_nurses.some(
        (email) => normalizeProtectedEmail(email) === callerEmail,
      );
    if (!isOwner && !isAssigned && !isProtectedSuperAdmin(user)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const patientName = [incidentPatient.first_name, incidentPatient.last_name]
      .filter((part) => typeof part === 'string' && part.trim())
      .map((part) => part.trim())
      .join(' ')
      || (typeof incidentPatient.full_name === 'string' && incidentPatient.full_name.trim())
      || scopedPatientId;
    const reportText = payload.report_text || buildReportText({
      ...payload,
      patient_id: scopedPatientId,
      patient_name: patientName,
    });

    // 1) Persist the incident FIRST so the record is retained even if a later
    //    step (PDF, email) fails. If this throws, the outer catch returns 500
    //    and the nurse can retry.
    // Service role + explicit created_by: Incident writes are service-role-only
    // (see functions/updateIncident), and read RLS keys off created_by, so the
    // reporter must still be recorded as the author.
    const incident = await base44.asServiceRole.entities.Incident.create({
      created_by: callerEmail,
      patient_id: scopedPatientId,
      patient_name: patientName,
      // Map the state event code onto a real incident_type so these — the most
      // severe events — appear in falls/hospitalization/med-error aggregates
      // instead of vanishing into 'other'.
      incident_type: STATE_EVENT_TO_INCIDENT_TYPE[String(payload.event_type_id || '').toUpperCase()] || 'other',
      incident_name: `State Reportable: ${payload.event_type}`,
      incident_date: payload.event_date,
      incident_time: payload.event_time || '',
      severity: 'high',
      report: reportText,
      // Evidence photos were silently dropped from the most serious incident
      // class — the non-state path persists them, this one must too.
      photo_urls: Array.isArray(payload.photo_urls) ? payload.photo_urls : [],
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
        submitted_by_email: callerEmail,
        submitted_at: new Date().toISOString(),
        source: payload.source || 'state_reportable_form',
      },
    });
    const incidentId = typeof incident?.id === 'string' && incident.id.trim().length <= 200
      ? incident.id.trim()
      : '';
    if (!incidentId) {
      throw new Error('Incident create returned an invalid identifier');
    }

    // 2) Generate + privately retain a PDF through the binding-aware broker
    // (best-effort). No storage URI or short-lived signed URL is copied into
    // Incident, Notification, email, or the response.
    let documentId = null;
    try {
      const pdfBytes = renderReportPdf(reportText);
      const safeType = String(payload.event_type || 'event').replace(/[^a-z0-9]+/gi, '_').slice(0, 60);
      const fileName = `State_Reportable_${safeType}_${payload.event_date || ''}.pdf`;
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const file = new File([blob], fileName, { type: 'application/pdf' });
      const retained = await base44.functions.invoke('createAuthorizedDocument', {
        file,
        agency_id: incidentPatient.agency_id,
        patient_id: scopedPatientId,
        purpose: 'patient_document',
        client_request_id: incidentId,
      });
      const retainedResult = retained?.data ?? retained;
      const retainedId = retainedResult?.document?.id;
      documentId = typeof retainedId === 'string' && retainedId.trim().length <= 200
        ? retainedId.trim()
        : null;
      if (!documentId || retainedResult?.success !== true) {
        throw new Error('Authorized Document retention returned an invalid result');
      }
    } catch {
      // Static only: provider messages can contain filenames, identifiers, and
      // storage details.
      console.warn('State-reportable private Document retention failed');
    }

    // 3) Notify directly related protected admins plus the configured platform
    // owner. The broad User read is only a lookup optimization; every returned
    // row is re-filtered against the exact patient's stored owner/assignment
    // relationship. Self-asserted account/agency fields cannot join this fan-out.
    const allUsers = await base44.asServiceRole.entities.User.list('-created_date', 5000);
    const directlyRelatedEmails = new Set([
      normalizeProtectedEmail(incidentPatient.created_by),
      ...(Array.isArray(incidentPatient.assigned_nurses)
        ? incidentPatient.assigned_nurses.map(normalizeProtectedEmail)
        : []),
    ].filter(Boolean));
    const adminsByEmail = new Map();
    for (const candidate of (Array.isArray(allUsers) ? allUsers : [])) {
      const candidateEmail = normalizeProtectedEmail(candidate?.email);
      if (!candidateEmail || adminsByEmail.has(candidateEmail)) continue;
      const isDirectProtectedAdmin = candidate?.role === 'admin'
        && directlyRelatedEmails.has(candidateEmail);
      if (!isDirectProtectedAdmin && !isProtectedSuperAdmin(candidate)) continue;
      adminsByEmail.set(candidateEmail, { ...candidate, email: candidateEmail });
    }
    const adminList = [...adminsByEmail.values()];

    let notifiedCount = 0;
    const recipients = [];
    const failures = [];

    if (adminList.length > 0) {
      await Promise.all(
        adminList.map((admin) =>
          base44.asServiceRole.entities.Notification.create({
            user_email: admin.email,
            title: `⚠️ State Reportable Event – ${payload.event_type}`,
            message: `${user.full_name || callerEmail} submitted a state reportable event for ${patientName} on ${payload.event_date}. Immediate follow-up required.`,
            type: 'critical_alert',
            priority: 'critical',
            is_read: false,
            action_url: '/IncidentReportingModule',
            action_label: 'Review incident',
            metadata: {
              incident_id: incidentId,
              patient_id: scopedPatientId,
              state_reportable: true,
              document_id: documentId,
            },
          })
            .then(() => { notifiedCount += 1; })
            .catch((e) => debugLog('Admin notification failed:', e?.message))
        )
      );

      const subject = `Urgent: state reportable event – ${payload.event_type} – ${patientName}`;
      const body = renderBrandedEmail({
        preheader: `A state reportable event was submitted for ${patientName} and requires immediate follow-up.`,
        eyebrow: 'State reportable event',
        tone: 'urgent',
        title: `State reportable event — ${payload.event_type}`,
        intro: `A state reportable event has been submitted for ${patientName} and requires immediate follow-up.`,
        sections: [
          { pre: reportText },
          ...(documentId
            ? [{ note: 'A private PDF copy was retained in PennSync and requires current document authorization.' }]
            : [{ note: 'A PDF copy could not be retained automatically; the full report text is above.' }]),
          { note: 'Please review and follow up in the Incident Reporting module.' },
        ],
      });

      await Promise.all(
        adminList.map((admin) =>
          base44.asServiceRole.integrations.Core.SendEmail({
            to: admin.email,
            subject,
            body,
            from_name: 'PennSync by CareMetric',
          })
            .then(() => { recipients.push(admin.email); })
            .catch((e) => {
              failures.push({ email: admin.email, error: e?.message });
              debugLog('Admin email failed:', e?.message);
            })
        )
      );
    }

    // 4) Record the alert audit and opaque Document id on the retained incident.
    try {
      await base44.asServiceRole.entities.Incident.update(incidentId, {
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
      incident_id: incidentId,
      document_url: null,
      pdf_retained: !!documentId,
      admin_count: adminList.length,
      admins_notified: notifiedCount,
      emails_sent: recipients.length,
      email_failures: failures.length,
    });
  } catch (error) {
    console.error('submitStateReportableIncident failed:', error?.message);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
