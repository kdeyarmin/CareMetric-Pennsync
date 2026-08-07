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

function getAppBaseUrl() {
  const fromEnv = String(Deno.env.get('APP_PUBLIC_URL') || Deno.env.get('APP_URL') || '').trim().replace(/\/+$/, '');
  if (fromEnv) {
    try { return new URL(fromEnv).origin; } catch { /* fall through */ }
  }
  return 'https://caremetricai.base44.app';
}

// Agency-scoped admin-tier recipients (isAdminLike). Unscoped User.filter({role:'admin'})
// emailed patient/document PHI to every tenant's admins — derive agency from the
// patient's care team and only notify that agency (plus platform super_admins).
async function adminsForPatientAgency(svc, patient) {
  // Let User.list failures throw so callers can release idempotency claims and
  // retry; seed User.filter lookups below are best-effort (.catch → []).
  const allUsers = await svc.User.list('-created_date', 5000);
  let admins = (Array.isArray(allUsers) ? allUsers : []).filter((u) =>
    u && u.email && (
      u.role === 'admin' ||
      u.account_type === 'agency_admin' ||
      u.account_type === 'super_admin'
    )
  );
  const seedEmails = [
    patient?.created_by,
    ...(Array.isArray(patient?.assigned_nurses) ? patient.assigned_nurses : []),
  ].filter(Boolean);
  const agencyNames = new Set();
  for (const email of seedEmails) {
    const [u] = await svc.User.filter({ email }, '-created_date', 1).catch(() => []);
    if (u?.agency_name) agencyNames.add(u.agency_name);
  }
  if (agencyNames.size > 0) {
    admins = admins.filter((u) =>
      u.account_type === 'super_admin' || agencyNames.has(u.agency_name)
    );
  } else {
    // Unknown agency — do not fan out PHI to every tenant's admins
    admins = admins.filter((u) => u.account_type === 'super_admin');
  }
  return admins;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { data } = await req.json();

    // Entity-trigger (fires on DocumentSignature update): invoked by the platform
    // with no identity / no custom header, so it can't be gated on auth. The
    // defense for a trigger is to re-fetch the canonical record and act only on
    // its real state, never the posted body — so a forged id/status can't probe
    // patients or spam admins.
    if (!data || !data.id) {
      return Response.json({ error: 'No signature data provided' }, { status: 400 });
    }

    const signature = await base44.asServiceRole.entities.DocumentSignature.get(data.id).catch(() => null);
    if (!signature) {
      return Response.json({ success: true, skipped: 'signature not found' });
    }

    // Only notify once the row is fully 'completed'
    if (signature.status !== 'completed') {
      return Response.json({ success: true, skipped: 'Not a completed status' });
    }

    // Shared idempotency with onDocumentSigned: both functions may be wired to
    // the same DocumentSignature-update trigger, and the trigger re-fires on
    // every later update. Claim with a unique token + re-read so concurrent
    // fires don't both email every admin (boolean alone races).
    if (signature.admin_notified) {
      return Response.json({ success: true, skipped: 'admin already notified' });
    }
    const claimToken = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `admin-notify-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      await base44.asServiceRole.entities.DocumentSignature.update(signature.id, {
        admin_notified: true,
        admin_notify_claimed_by: claimToken,
      });
    } catch {
      return Response.json({ success: true, skipped: 'could not claim admin notify' });
    }
    const claimCheck = await base44.asServiceRole.entities.DocumentSignature
      .filter({ id: signature.id }, '-created_date', 1).catch(() => []);
    if (!claimCheck[0] || claimCheck[0].admin_notify_claimed_by !== claimToken) {
      return Response.json({ success: true, skipped: 'admin notify claimed by concurrent run' });
    }

    // Fetch package info
    let pkg = null;
    try {
      // Find package containing this signature
      const packages = await base44.asServiceRole.entities.DocumentPackage.filter({
        document_signatures: signature.id,
      }, undefined, 5000);
      pkg = packages.length > 0 ? packages[0] : null;
    } catch (e) {
      // Package may not exist yet
      console.log('Could not fetch package');
    }

    // Fetch patient info (tolerate a missing/invalid patient_id rather than
    // 500-ing the whole notification on a bad lookup)
    const patient = await base44.asServiceRole.entities.Patient.get(signature.patient_id).catch(() => null);
    const patientName = patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown Patient';

    // Agency-scoped admin-tier recipients. A transient lookup failure must NOT
    // leave the claim set (that would permanently skip the notice on re-fire) —
    // release and retry.
    let admins;
    try {
      admins = await adminsForPatientAgency(base44.asServiceRole.entities, patient);
    } catch {
      admins = null;
    }

    if (admins === null) {
      await base44.asServiceRole.entities.DocumentSignature.update(signature.id, {
        admin_notified: false,
        admin_notify_claimed_by: '',
      }).catch(() => {});
      return Response.json({ success: false, error: 'Admin lookup failed' }, { status: 500 });
    }
    if (admins.length === 0) {
      // No admins to notify = nothing to send; leave it claimed (a real, stable
      // state, not a transient failure) so we don't churn the update-trigger.
      return Response.json({ success: true, skipped: 'No admins found' });
    }

    // Signer identity lives in the signers[] array; the document name is
    // document_title. There are no flat document_name/signer_* fields.
    const documentTitle = signature.document_title || 'Document';
    const completedSigners = (Array.isArray(signature.signers) ? signature.signers : [])
      .filter((s) => s?.status === 'completed' || s?.signed_date);
    const signedByText = completedSigners.length > 0
      ? completedSigners.map((s) => `${s.name || 'Signer'}${s.email ? ` (${s.email})` : ''}`).join(', ')
      : 'A signer';
    const lastSignedAt = completedSigners
      .map((s) => s.signed_date)
      .filter(Boolean)
      .sort()
      .slice(-1)[0] || signature.completed_date;

    const subject = `Document signed: ${documentTitle}`;
    const appBase = getAppBaseUrl();
    const body = renderBrandedEmail({
      preheader: `${documentTitle} has been signed by ${signedByText}.`,
      eyebrow: 'Document signed',
      title: 'A document has been signed',
      intro: 'A document has been successfully signed. Here are the details for your records.',
      sections: [
        {
          rows: [
            ['Patient', patientName],
            ['Document', documentTitle],
            ['Type', signature.document_type],
            ['Signed by', signedByText],
            ['Signed at', lastSignedAt ? new Date(lastSignedAt).toLocaleString() : new Date().toLocaleString()],
            ...(pkg ? [['Package', pkg.package_name]] : []),
          ],
        },
        {
          button: { href: `${appBase}/DocumentHub`, label: 'View in Document Hub' },
        },
      ],
    });

    // Send email to all admins. allSettled so one bad recipient doesn't reject
    // the batch; if NONE succeed, release the claim so a re-fire retries (admins
    // must not silently lose a completion notice on a transient outage).
    const results = await Promise.allSettled(
      admins.map((admin) =>
        base44.integrations.Core.SendEmail({
          to: admin.email,
          subject,
          body,
          from_name: 'PennSync by CareMetric',
        })
      )
    );
    const sent = results.filter((r) => r.status === 'fulfilled').length;
    if (sent === 0) {
      await base44.asServiceRole.entities.DocumentSignature.update(signature.id, {
        admin_notified: false,
        admin_notify_claimed_by: '',
      }).catch(() => {});
    }

    return Response.json({
      success: true,
      admins_notified: sent,
    });
  } catch (error) {
    console.error('Error sending admin notification:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});