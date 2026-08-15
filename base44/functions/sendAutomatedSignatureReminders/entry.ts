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

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Scheduled reminder task. Allow the platform's no-identity scheduler path
    // (per docs/SECURITY-RLS-CHECKLIST.md §4) but reject any authenticated
    // non-admin. The prior `!user` gate 403'd the scheduler, so the "automated"
    // reminders only ran when an admin triggered them manually.
    const user = await base44.auth.me().catch(() => null);
    const authError = getSchedulerAuthError(req, user);
    if (authError) return authError;
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    console.log('Starting automated signature reminders...');
    const runId = crypto.randomUUID();

    // Get all pending signatures, OLDEST first with an explicit cap. Without a
    // sort/limit the SDK returns only its default first page, so in an agency with
    // more pending signatures than that page every run reprocesses the same page
    // and the rest never get reminded. Sort ASCENDING on created_date so the
    // oldest/most-overdue are within the cap, matching the sibling reminder crons
    // (sendRenewalReminders / sendCredentialRenewalReminders).
    const pendingSignatures = await base44.asServiceRole.entities.DocumentSignature.filter({
      status: 'pending'
    }, 'created_date', 5000);

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

        // Claim before send; re-read to confirm ownership (overlapping crons).
        const claimToken = runId;
        try {
          await base44.asServiceRole.entities.DocumentSignature.update(sig.id, {
            reminder_claimed_by: claimToken,
            reminder_claimed_at: new Date().toISOString(),
          });
        } catch {
          continue;
        }
        const claimCheck = await base44.asServiceRole.entities.DocumentSignature
          .filter({ id: sig.id }, '-created_date', 1).catch(() => []);
        if (!claimCheck[0] || claimCheck[0].reminder_claimed_by !== claimToken) {
          continue;
        }

        // Skip signatures with no patient_id: an empty id can be dropped from the
        // filter object, which would then match ALL patients and email an
        // arbitrary patients[0] a reminder every run (scheduleSignatureReminders
        // guards this the same way).
        if (!sig.patient_id) {
          continue;
        }
        // Get patient details
        const patients = await base44.asServiceRole.entities.Patient.filter({ id: sig.patient_id }, undefined, 5000);
        const patient = patients[0];

        if (!patient || !patient.email) {
          console.log('Skipping signature: patient email not found');
          continue;
        }

        // Send reminder
        const documentName = sig.document_name || sig.document_title || sig.document_type || 'Document';
        const dueDate = sig.due_date || sig.expires_at;
        const dueText = dueDate
          ? `This document is due by ${new Date(dueDate).toLocaleDateString()}.`
          : '';

        const isOverdue = isPastDueDate(dueDate);

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

        // Stamp after successful send. Do NOT swallow failures — a silent miss
        // lets the next run re-email within the same window.
        await base44.asServiceRole.entities.DocumentSignature.update(sig.id, {
          last_reminder_sent_at: new Date().toISOString()
        });

        remindersSent++;
        results.push({
          signature_id: sig.id,
          patient_email: patient.email,
          status: 'sent'
        });

        console.log('Signature reminder sent');

      } catch (error) {
        errors++;
        results.push({
          signature_id: sig.id,
          status: 'error',
          error: error.message
        });
        console.error('Error sending signature reminder:', error?.message || error);
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

// Date-only due values compare on the local calendar — UTC midnight parsing
// flagged signatures overdue the evening before the due day.
function isPastDueDate(dueDate, now = new Date()) {
  if (!dueDate) return false;
  const raw = String(dueDate).trim();
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(raw)) {
    const [y, m, d] = raw.split('-').map(Number);
    const due = new Date(y, m - 1, d);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return due < today;
  }
  const due = new Date(dueDate);
  return !Number.isNaN(due.getTime()) && due < now;
}

function hoursUntilDueDate(dueDate, now = new Date()) {
  if (!dueDate) return null;
  const raw = String(dueDate).trim();
  let deadline;
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(raw)) {
    const [y, m, d] = raw.split('-').map(Number);
    // End of local due day — "due within 24h" for a date-only field means the
    // due calendar day is today (or already past, handled by isPastDueDate).
    deadline = new Date(y, m - 1, d, 23, 59, 59, 999);
  } else {
    deadline = new Date(dueDate);
  }
  if (Number.isNaN(deadline.getTime())) return null;
  return (deadline - now) / (1000 * 60 * 60);
}

// Helper function to determine if reminder should be sent
function shouldSendReminderLogic(signature) {
  const now = new Date();
  const createdDate = new Date(signature.created_date);
  const daysOld = (now - createdDate) / (1000 * 60 * 60 * 24);

  // Send reminder if:
  // 1. Document is overdue
  const dueDate = signature.due_date || signature.expires_at;

  if (isPastDueDate(dueDate, now)) {
    return true;
  }

  // 2. Document is 3+ days old with no due date
  if (!dueDate && daysOld >= 3) {
    return true;
  }

  // 3. Document due within 24 hours
  if (dueDate) {
    const hoursUntilDue = hoursUntilDueDate(dueDate, now);
    if (hoursUntilDue != null && hoursUntilDue <= 24 && hoursUntilDue > 0) {
      return true;
    }
  }

  return false;
}