import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

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
    const href = String(s.button.href).replace(/"/g, '&quot;');
    parts.push(`<div style="margin:6px 0 18px;"><a href="${href}" target="_blank" rel="noopener" style="display:inline-block;padding:13px 26px;border-radius:8px;background:${BRAND_EMAIL.navy};color:#ffffff;font-weight:700;font-size:15px;line-height:1;text-decoration:none;">${escapeEmailHtml(s.button.label || 'Open PennSync')}</a></div>`);
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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    // Admin-only function for scheduled task
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    console.log('Starting automated signature reminders...');

    // Get all pending signatures
    const pendingSignatures = await base44.asServiceRole.entities.DocumentSignature.filter({ 
      status: 'pending' 
    });

    console.log(`Found ${pendingSignatures.length} pending signatures`);

    let remindersSent = 0;
    let errors = 0;
    const results = [];

    for (const sig of pendingSignatures) {
      try {
        // Check if reminder is needed
        const shouldSendReminder = shouldSendReminderLogic(sig);
        
        if (!shouldSendReminder) {
          continue;
        }

        // Idempotency: don't re-email the same pending signature on every cron
        // tick. Skip if a reminder already went out in the last ~20h. Without
        // this, an overdue document re-emailed the patient (and re-created a
        // 'critical' notification) on every run until signed.
        const lastSent = sig.last_reminder_sent_at ? new Date(sig.last_reminder_sent_at).getTime() : 0;
        if (lastSent && (Date.now() - lastSent) < 20 * 60 * 60 * 1000) {
          continue;
        }

        // Get patient details
        const patients = await base44.asServiceRole.entities.Patient.filter({ id: sig.patient_id });
        const patient = patients[0];

        if (!patient || !patient.email) {
          console.log(`Skipping signature ${sig.id}: Patient email not found`);
          continue;
        }

        // Send reminder
        const documentName = sig.document_name || sig.document_title || sig.document_type || 'Document';
        const dueDate = sig.due_date || sig.expires_at;
        const dueText = dueDate
          ? `This document is due by ${new Date(dueDate).toLocaleDateString()}.`
          : '';

        const isOverdue = dueDate && new Date(dueDate) < new Date();

        await base44.asServiceRole.integrations.Core.SendEmail({
          to: patient.email,
          from_name: 'PennSync by CareMetric',
          subject: isOverdue
            ? `Overdue: your signature is needed — ${documentName}`
            : `Reminder: your signature is needed — ${documentName}`,
          body: renderBrandedEmail({
            preheader: isOverdue
              ? `A document is overdue for your signature: ${documentName}.`
              : `A document is waiting for your signature: ${documentName}.`,
            eyebrow: isOverdue ? 'Action required' : 'Signature requested',
            tone: isOverdue ? 'urgent' : 'brand',
            title: `Hello ${patient.first_name},`,
            intro: isOverdue
              ? 'This is an urgent reminder that a document is overdue for your signature.'
              : 'This is a reminder that a document is waiting for your signature.',
            sections: [
              ...(isOverdue
                ? [{ callout: { tone: 'urgent', text: 'This document is overdue. Please sign it as soon as possible.' } }]
                : []),
              {
                rows: [
                  ['Document', documentName],
                  ['Status', isOverdue ? 'Overdue' : 'Pending signature'],
                ],
              },
              ...(dueText ? [{ callout: { tone: 'warn', text: dueText } }] : []),
              {
                paragraphs: [`Please sign this document ${isOverdue ? 'as soon as possible' : 'at your earliest convenience'} through your patient portal.`],
              },
              {
                note: 'If you have any questions, please contact your healthcare provider.',
              },
            ],
          }),
        });

        // Create notification
        await base44.asServiceRole.entities.Notification.create({
          user_email: patient.email,
          title: isOverdue ? 'OVERDUE: Document Signature Required' : 'Document Signature Reminder',
          message: `${isOverdue ? 'OVERDUE - ' : ''}Please sign "${documentName}"`,
          type: 'task_due_soon',
          priority: isOverdue ? 'critical' : 'medium',
          metadata: {
            signature_id: sig.id,
            patient_id: patient.id,
            document_name: documentName,
            is_overdue: isOverdue
          }
        });

        // Record that a reminder went out so the next run skips it within the window.
        await base44.asServiceRole.entities.DocumentSignature.update(sig.id, {
          last_reminder_sent_at: new Date().toISOString()
        }).catch(() => {});

        remindersSent++;
        results.push({
          signature_id: sig.id,
          patient_email: patient.email,
          status: 'sent'
        });

        console.log(`Reminder sent for signature ${sig.id} to ${patient.email}`);

      } catch (error) {
        errors++;
        results.push({
          signature_id: sig.id,
          status: 'error',
          error: error.message
        });
        console.error(`Error sending reminder for signature ${sig.id}:`, error);
      }
    }

    return Response.json({ 
      success: true,
      reminders_sent: remindersSent,
      errors: errors,
      total_pending: pendingSignatures.length,
      results: results
    });

  } catch (error) {
    console.error('Error in automated signature reminders:', error);
    return Response.json({
      error: 'Failed to send automated reminders'
    }, { status: 500 });
  }
});

// Helper function to determine if reminder should be sent
function shouldSendReminderLogic(signature) {
  const now = new Date();
  const createdDate = new Date(signature.created_date);
  const daysOld = (now - createdDate) / (1000 * 60 * 60 * 24);

  // Send reminder if:
  // 1. Document is overdue
  const dueDate = signature.due_date || signature.expires_at;

  if (dueDate && new Date(dueDate) < now) {
    return true;
  }

  // 2. Document is 3+ days old with no due date
  if (!dueDate && daysOld >= 3) {
    return true;
  }

  // 3. Document due within 24 hours
  if (dueDate) {
    const deadline = new Date(dueDate);
    const hoursUntilDue = (deadline - now) / (1000 * 60 * 60);
    if (hoursUntilDue <= 24 && hoursUntilDue > 0) {
      return true;
    }
  }

  return false;
}