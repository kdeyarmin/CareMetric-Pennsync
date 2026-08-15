import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { jsPDF } from 'npm:jspdf@2.5.2';

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


const sanitizeFileName = (value) => String(value || 'certificate').replace(/[^a-z0-9]+/gi, '_');
const safeText = (value, fallback = '') => value || fallback;

const buildCertificatePdf = async ({ userName, moduleName, completionDate, score, certificateId, agencyName }) => {
  const doc = new jsPDF('landscape');

  doc.setDrawColor(33, 58, 118);
  doc.setLineWidth(2);
  doc.rect(10, 10, 277, 190, 'S');
  doc.setLineWidth(0.5);
  doc.rect(15, 15, 267, 180, 'S');

  doc.setFillColor(33, 58, 118);
  [[10, 10], [287, 10], [10, 200], [287, 200]].forEach(([x, y]) => doc.circle(x, y, 3, 'F'));

  try {
    const logoUrl = 'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/68ee80d98929370f9e8f2932/02eed9872_pennsynclogoupdated.png';
    if (logoUrl) {
      const logoResponse = await fetch(logoUrl);
      const logoBlob = await logoResponse.blob();
      const logoArrayBuffer = await logoBlob.arrayBuffer();
      const logoBase64 = btoa(String.fromCharCode(...new Uint8Array(logoArrayBuffer)));
      doc.addImage(`data:image/png;base64,${logoBase64}`, 'PNG', 128.5, 25, 40, 40);
    }
  } catch (_error) {}

  doc.setFontSize(36);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(33, 58, 118);
  doc.text('Certificate of Completion', 148.5, 80, { align: 'center' });

  doc.setFontSize(14);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(107, 114, 128);
  doc.text('This certifies that', 148.5, 95, { align: 'center' });

  doc.setFontSize(28);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(0, 0, 0);
  doc.text(userName, 148.5, 110, { align: 'center' });

  doc.setDrawColor(33, 58, 118);
  doc.setLineWidth(0.5);
  doc.line(90, 112, 207, 112);

  doc.setFontSize(13);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(55, 65, 81);
  doc.text('has successfully completed the training module', 148.5, 125, { align: 'center' });

  doc.setFontSize(18);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(33, 58, 118);
  const moduleLines = doc.splitTextToSize(moduleName, 200);
  const moduleY = 135 + (moduleLines.length - 1) * 3;
  doc.text(moduleLines, 148.5, 135, { align: 'center' });

  if (score !== undefined && score !== null) {
    doc.setFontSize(12);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(34, 197, 94);
    doc.text(`Score: ${Math.round(score)}%`, 148.5, moduleY + 10, { align: 'center' });
  }

  const formattedDate = new Date(completionDate).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  doc.setFontSize(11);
  doc.setTextColor(107, 114, 128);
  doc.text(`Completion Date: ${formattedDate}`, 148.5, moduleY + 20, { align: 'center' });

  doc.setDrawColor(107, 114, 128);
  doc.setLineWidth(0.3);
  doc.line(50, 175, 120, 175);
  doc.line(177, 175, 247, 175);

  doc.setFontSize(9);
  doc.text(safeText(agencyName, 'PennSync by CareMetric'), 85, 182, { align: 'center' });
  doc.text(`Certificate ID: ${certificateId}`, 212, 182, { align: 'center' });

  doc.setFillColor(33, 58, 118);
  doc.rect(0, 195, 297, 15, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.text('PennSync by CareMetric — Home Health Documentation & Analytics', 148.5, 203, { align: 'center' });

  return doc.output('arraybuffer');
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const payload = await req.json();
    const incoming = payload?.data || payload;
    if (!incoming?.certificate_id) {
      return Response.json({ error: 'certificate_id is required' }, { status: 400 });
    }

    // Load the PERSISTED certificate — never trust the request body for the
    // recipient/content, or anyone could email a forged certificate to any
    // address. Everything downstream uses this DB-sourced record.
    const [certificate] = await base44.asServiceRole.entities.TrainingCertificate
      .filter({ certificate_id: incoming.certificate_id }, '-created_date', 1);
    if (!certificate) {
      return Response.json({ error: 'Certificate not found' }, { status: 404 });
    }
    // Ownership: only the certificate's owner or an admin may (re)send it.
    // Facility admins with an agency are agency-scoped (parity with PDF path).
    const isSuperAdmin = user.account_type === 'super_admin';
    const isAgencyScopedAdmin =
      user.account_type === 'agency_admin'
      || (user.role === 'admin' && !!user.agency_name && !isSuperAdmin);
    const isPlatformAdmin = isSuperAdmin || (user.role === 'admin' && !user.agency_name);
    const ownsCert = certificate.user_id === user.email;
    if (!ownsCert && !isPlatformAdmin && !isAgencyScopedAdmin) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!certificate.user_id || !certificate.course_title || !certificate.issued_at) {
      return Response.json({ error: 'Certificate record is missing required fields' }, { status: 400 });
    }

    const [employee] = await base44.asServiceRole.entities.User.filter({ email: certificate.user_id }, '-created_date', 1);
    if (!ownsCert && isAgencyScopedAdmin) {
      if (!user.agency_name || !employee || employee.agency_name !== user.agency_name) {
        return Response.json({ error: 'Forbidden: certificate owner is outside your agency' }, { status: 403 });
      }
    }
    const allUsers = await base44.asServiceRole.entities.User.list('-created_date', 5000);
    // Only notify admins of the employee's OWN agency. If the employee can't be
    // resolved (deleted/renamed user) we have no agency to scope to, so notify
    // no one rather than broadcasting the certificate (PHI) to every tenant's
    // admins.
    const agencyAdmins = employee?.agency_name
      ? allUsers.filter((candidate) =>
          candidate.account_type === 'agency_admin' &&
          candidate.agency_name === employee.agency_name)
      : [];

    const pdfBytes = await buildCertificatePdf({
      userName: safeText(certificate.user_name, employee?.full_name || certificate.user_id),
      moduleName: certificate.course_title,
      completionDate: certificate.completion_date || certificate.issued_at,
      score: certificate.score,
      certificateId: certificate.certificate_id,
      agencyName: employee?.agency_name || 'PennSync by CareMetric'
    });

    const pdfFile = new File(
      [pdfBytes],
      `${sanitizeFileName(certificate.course_title)}_${sanitizeFileName(certificate.user_name || certificate.user_id)}.pdf`,
      { type: 'application/pdf' }
    );

    const uploadResult = await base44.asServiceRole.integrations.Core.UploadFile({ file: pdfFile });
    const certificateUrl = uploadResult?.file_url;

    if (certificate.id && certificateUrl) {
      await base44.asServiceRole.entities.TrainingCertificate.update(certificate.id, {
        certificate_pdf_url: certificateUrl,
      });
    }

    const scoreText = certificate.score ?? 'N/A';
    const employeeName = safeText(certificate.user_name, employee?.full_name || 'there');
    const employeeBody = renderBrandedEmail({
      preheader: `You passed "${certificate.course_title}" — your certificate is ready.`,
      eyebrow: 'Certificate earned',
      title: `Congratulations, ${employeeName}!`,
      intro: `You’ve successfully passed "${certificate.course_title}". Your certificate of completion is ready to download.`,
      sections: [
        {
          rows: [
            ['Course', certificate.course_title],
            ['Score', `${scoreText}%`],
            ['Certificate ID', certificate.certificate_id],
          ],
        },
        ...(certificateUrl ? [{ button: { href: certificateUrl, label: 'Download your certificate (PDF)' } }] : []),
      ],
    });

    await base44.asServiceRole.integrations.Core.SendEmail({
      to: certificate.user_id,
      from_name: 'PennSync by CareMetric',
      subject: `Your training certificate: ${certificate.course_title}`,
      body: employeeBody,
    });

    const adminTraineeName = safeText(certificate.user_name, employee?.full_name || certificate.user_id);
    await Promise.all(agencyAdmins.map((manager) =>
      base44.asServiceRole.integrations.Core.SendEmail({
        to: manager.email,
        from_name: 'PennSync by CareMetric',
        subject: `Employee passed training: ${certificate.course_title}`,
        body: renderBrandedEmail({
          preheader: `${adminTraineeName} passed "${certificate.course_title}".`,
          eyebrow: 'Training completed',
          title: 'An employee completed training',
          intro: `${adminTraineeName} has successfully passed "${certificate.course_title}".`,
          sections: [
            {
              rows: [
                ['Employee', adminTraineeName],
                ['Course', certificate.course_title],
                ['Score', `${scoreText}%`],
                ['Certificate ID', certificate.certificate_id],
              ],
            },
            ...(certificateUrl ? [{ button: { href: certificateUrl, label: 'Download the certificate (PDF)' } }] : []),
          ],
        }),
      })
    ));

    return Response.json({
      success: true,
      emailed_employee: true,
      emailed_agency_admins: agencyAdmins.length,
      certificate_url: certificateUrl
    });
  } catch (error) {
    console.error('sendTrainingCertificateEmail failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});