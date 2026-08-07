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

    // Cron-invoked reminder sweep. Admins may run it interactively, and unattended scheduler runs must send `x-internal-secret`.
    const user = await base44.auth.me().catch(() => null);
    const authError = getSchedulerAuthError(req, user);
    if (authError) return authError;
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // Per-run claim token so overlapping cron invocations do not double-email
    // the same signer (mirrors dispatchScheduledSignatureReminders).
    const runId = crypto.randomUUID();

    // Fetch all pending document packages. Use asServiceRole (the cron path has
    // no user context) and an explicit sort/limit — an unbounded filter returns
    // only the SDK's default first page, so later packages never got reminders.
    // Mirrors sendAutomatedSignatureReminders.
    const pendingPackages = await base44.asServiceRole.entities.DocumentPackage.filter({
      status: 'pending',
      auto_reminder_enabled: true,
    }, 'due_date', 5000);

    let sentCount = 0;
    let failureCount = 0;
    const results = [];

    for (const pkg of pendingPackages) {
      try {
        // Skip if no due date
        if (!pkg.due_date) continue;

        // Date-only due dates must use local calendar components — UTC midnight
        // parsing shifts the day west of UTC and mis-classifies due_today/overdue.
        const dueRaw = String(pkg.due_date).trim();
        let dueDate;
        if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(dueRaw)) {
          const [y, m, d] = dueRaw.split('-').map(Number);
          dueDate = new Date(y, m - 1, d);
        } else {
          dueDate = new Date(pkg.due_date);
          dueDate.setHours(0, 0, 0, 0);
        }
        if (Number.isNaN(dueDate.getTime())) continue;

        // Calculate days until due
        const daysUntilDue = Math.floor(
          (dueDate - today) / (1000 * 60 * 60 * 24)
        );

        // Audience-specific cadence only — never fall back to last_reminder_sent_at
        // (that stamp is shared and would suppress the other audience's reminders).
        const lastSignerAt = pkg.last_signer_reminder_sent_at;
        if (lastSignerAt) {
          const lastSent = new Date(lastSignerAt);
          // `today` is midnight-normalized, so comparing it against the raw
          // timestamp made a reminder sent any time yesterday floor to 0 days and
          // suppress today's — halving the cadence and skipping due_today entirely.
          // Normalize both sides so "< 1 day" means literally "already sent today".
          lastSent.setHours(0, 0, 0, 0);
          const daysSinceReminder = Math.floor(
            (today - lastSent) / (1000 * 60 * 60 * 24)
          );
          if (daysSinceReminder < 1) {
            continue; // Already sent today
          }
        }

        // Determine reminder type based on days remaining
        const reminderDaysBuffer = pkg.reminder_days_before || 3;
        let reminderType = null;

        if (daysUntilDue === 0) {
          reminderType = 'due_today';
        } else if (daysUntilDue < 0) {
          reminderType = 'overdue';
        } else if (daysUntilDue <= reminderDaysBuffer) {
          reminderType = 'pre_due';
        }

        // Skip if not in reminder window
        if (!reminderType) continue;

        // Skip if no signer email
        if (!pkg.signer_email) continue;

        // Claim before send; re-read to confirm we still own the row so two
        // overlapping runs cannot both email the same signer.
        const claimToken = `signer:${runId}`;
        try {
          await base44.asServiceRole.entities.DocumentPackage.update(pkg.id, {
            reminder_claimed_by: claimToken,
            reminder_claimed_at: new Date().toISOString(),
          });
        } catch {
          continue;
        }
        const claimCheck = await base44.asServiceRole.entities.DocumentPackage
          .filter({ id: pkg.id }, '-created_date', 1).catch(() => []);
        if (!claimCheck[0] || claimCheck[0].reminder_claimed_by !== claimToken) {
          continue;
        }

        // Get signature details (guard against a package with no
        // document_signatures array so a single bad row doesn't 500 the reminder)
        const signatureIds = Array.isArray(pkg.document_signatures)
          ? pkg.document_signatures
          : [];
        const signatures = await Promise.all(
          signatureIds.map((id) =>
            base44.asServiceRole.entities.DocumentSignature.get(id).catch(() => null)
          )
        );

        const validSignatures = signatures.filter((s) => s !== null);
        const signedCount = validSignatures.filter(
          (s) => s.status === 'completed'
        ).length;
        const pendingCount = validSignatures.length - signedCount;

        // Build personalized email
        const reminderSubject = getReminderSubject(reminderType, pkg.package_name);
        const reminderBody = getReminderBody(
          pkg.signer_name || 'Signer',
          pkg.package_name,
          daysUntilDue,
          reminderType,
          signedCount,
          validSignatures.length
        );

        // Send email (service role: the cron path has no user context)
        await base44.asServiceRole.integrations.Core.SendEmail({
          to: pkg.signer_email,
          from_name: 'PennSync by CareMetric',
          subject: reminderSubject,
          body: reminderBody,
        });

        // Log the reminder
        await base44.asServiceRole.entities.ReminderLog.create({
          package_id: pkg.id,
          package_name: pkg.package_name,
          signer_email: pkg.signer_email,
          signer_name: pkg.signer_name,
          reminder_type: reminderType,
          days_until_due: daysUntilDue,
          sent_at: new Date().toISOString(),
          status: 'sent',
          document_count: validSignatures.length,
          documents_signed: signedCount,
          documents_pending: pendingCount,
        });

        // Stamp audience-specific + legacy fields. Do NOT swallow failures after
        // a successful send — a silent stamp miss lets the next run re-email.
        const sentAt = new Date().toISOString();
        await base44.asServiceRole.entities.DocumentPackage.update(pkg.id, {
          last_signer_reminder_sent_at: sentAt,
          last_reminder_sent_at: sentAt,
        });

        sentCount++;
        results.push({
          packageId: pkg.id,
          status: 'success',
          reminderType,
          email: pkg.signer_email,
        });
      } catch (error) {
        failureCount++;
        results.push({
          packageId: pkg.id,
          status: 'failed',
          error: error.message,
        });
      }
    }

    return Response.json({
      success: true,
      summary: {
        total_packages_checked: pendingPackages.length,
        reminders_sent: sentCount,
        failures: failureCount,
        results,
      },
    });
  } catch (error) {
    console.error('sendDocumentReminderEmails failed:', error);
    return Response.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});

function getReminderSubject(reminderType, packageName) {
  switch (reminderType) {
    case 'due_today':
      return `Due today: signatures needed for ${packageName}`;
    case 'overdue':
      return `Overdue: signatures needed for ${packageName}`;
    case 'pre_due':
      return `Reminder: signatures needed for ${packageName}`;
    default:
      return `Signature reminder: ${packageName}`;
  }
}

function getReminderBody(
  signerName,
  packageName,
  daysUntilDue,
  reminderType,
  signedCount,
  totalCount
) {
  let urgency = '';
  let timeframe = '';
  let calloutTone = 'info';

  if (reminderType === 'due_today') {
    urgency = 'Your document signatures are due today.';
    timeframe = 'Please complete them today to avoid delays.';
    calloutTone = 'warn';
  } else if (reminderType === 'overdue') {
    urgency = 'Your document signatures are overdue.';
    timeframe = `They were due ${Math.abs(daysUntilDue)} days ago. Please complete them as soon as possible.`;
    calloutTone = 'urgent';
  } else {
    urgency = `Your document signatures are due in ${daysUntilDue} day(s).`;
    timeframe = 'Please review and sign the documents at your earliest convenience to ensure timely completion.';
  }

  const progressLine = signedCount > 0
    ? `${signedCount} of ${totalCount} document(s) signed`
    : `All ${totalCount} document(s) are awaiting your signature`;

  return renderBrandedEmail({
    preheader: `${urgency} ${timeframe}`,
    eyebrow: reminderType === 'overdue' ? 'Action required' : (reminderType === 'due_today' ? 'Due today' : 'Signature reminder'),
    tone: reminderType === 'overdue' ? 'urgent' : 'brand',
    title: `Hello ${signerName},`,
    intro: `This is a reminder regarding the "${packageName}" document package.`,
    sections: [
      { callout: { tone: calloutTone, text: `${urgency} ${timeframe}` } },
      { rows: [['Package', packageName], ['Progress', progressLine]] },
      { note: 'If you have any questions or need assistance, please contact your care team.' },
    ],
  });
}