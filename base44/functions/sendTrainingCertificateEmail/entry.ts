import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { jsPDF } from 'npm:jspdf@2.5.2';

const sanitizeFileName = (value) => String(value || 'certificate').replace(/[^a-z0-9]+/gi, '_');
const safeText = (value, fallback = '') => value || fallback;

const buildCertificatePdf = async ({ userName, moduleName, completionDate, score, certificateId, agencyName }) => {
  const doc = new jsPDF('landscape');

  doc.setDrawColor(79, 70, 229);
  doc.setLineWidth(2);
  doc.rect(10, 10, 277, 190, 'S');
  doc.setLineWidth(0.5);
  doc.rect(15, 15, 267, 180, 'S');

  doc.setFillColor(79, 70, 229);
  [[10, 10], [287, 10], [10, 200], [287, 200]].forEach(([x, y]) => doc.circle(x, y, 3, 'F'));

  try {
    const logoUrl = 'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/68ee80d98929370f9e8f2932/52cac091f_20170AA9-BB95-4BA4-B4E7-793615312CC4.png';
    const logoResponse = await fetch(logoUrl);
    const logoBlob = await logoResponse.blob();
    const logoArrayBuffer = await logoBlob.arrayBuffer();
    const logoBase64 = btoa(String.fromCharCode(...new Uint8Array(logoArrayBuffer)));
    doc.addImage(`data:image/png;base64,${logoBase64}`, 'PNG', 128.5, 25, 40, 40);
  } catch (_error) {}

  doc.setFontSize(36);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(79, 70, 229);
  doc.text('Certificate of Completion', 148.5, 80, { align: 'center' });

  doc.setFontSize(14);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(107, 114, 128);
  doc.text('This certifies that', 148.5, 95, { align: 'center' });

  doc.setFontSize(28);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(0, 0, 0);
  doc.text(userName, 148.5, 110, { align: 'center' });

  doc.setDrawColor(79, 70, 229);
  doc.setLineWidth(0.5);
  doc.line(90, 112, 207, 112);

  doc.setFontSize(13);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(55, 65, 81);
  doc.text('has successfully completed the training module', 148.5, 125, { align: 'center' });

  doc.setFontSize(18);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(79, 70, 229);
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
  doc.text(safeText(agencyName, 'Penn Sync Training Platform'), 85, 182, { align: 'center' });
  doc.text(`Certificate ID: ${certificateId}`, 212, 182, { align: 'center' });

  doc.setFillColor(79, 70, 229);
  doc.rect(0, 195, 297, 15, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.text('Penn Sync - AI-Powered Healthcare Training & Documentation', 148.5, 203, { align: 'center' });

  return doc.output('arraybuffer');
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
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
    if (certificate.user_id !== user.email && user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!certificate.user_id || !certificate.course_title || !certificate.issued_at) {
      return Response.json({ error: 'Certificate record is missing required fields' }, { status: 400 });
    }

    const [employee] = await base44.asServiceRole.entities.User.filter({ email: certificate.user_id }, '-created_date', 1);
    const allUsers = await base44.asServiceRole.entities.User.list('-created_date', 300);
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
      agencyName: employee?.agency_name || 'Penn Sync Training Platform'
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

    const employeeBody = `Congratulations ${safeText(certificate.user_name, employee?.full_name || 'there')},

You passed "${certificate.course_title}" with a score of ${certificate.score ?? 'N/A'}%.

Your PDF certificate is ready here:
${certificateUrl}

Certificate ID: ${certificate.certificate_id}`;

    await base44.asServiceRole.integrations.Core.SendEmail({
      to: certificate.user_id,
      subject: `Your training certificate: ${certificate.course_title}`,
      body: employeeBody,
      from_name: 'Penn Sync Training'
    });

    await Promise.all(agencyAdmins.map((manager) =>
      base44.asServiceRole.integrations.Core.SendEmail({
        to: manager.email,
        subject: `Employee passed training: ${certificate.course_title}`,
        body: `${safeText(certificate.user_name, employee?.full_name || certificate.user_id)} has passed "${certificate.course_title}" with a score of ${certificate.score ?? 'N/A'}%.

Download the PDF certificate here:
${certificateUrl}

Certificate ID: ${certificate.certificate_id}`,
        from_name: 'Penn Sync Training'
      })
    ));

    return Response.json({
      success: true,
      emailed_employee: true,
      emailed_agency_admins: agencyAdmins.length,
      certificate_url: certificateUrl
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});