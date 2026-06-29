import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { jsPDF } from 'npm:jspdf@4.0.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { employeeId, certificateIds } = await req.json();

    // Only admins can generate packets for others
    if (employeeId !== user.email && user.account_type !== 'agency_admin' && user.account_type !== 'super_admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get employee
    const employees = await base44.asServiceRole.entities.User.filter({ email: employeeId });
    if (!employees || employees.length === 0) {
      return Response.json({ error: 'Employee not found' }, { status: 404 });
    }
    const employee = employees[0];

    // Get certificates
    let query = { user_id: employeeId, revoked: false };
    if (certificateIds && certificateIds.length > 0) {
      query.id = { $in: certificateIds };
    }

    const certificates = await base44.asServiceRole.entities.TrainingCertificate.filter(
      query,
      '-issued_at'
    );

    // Create main PDF with cover sheet
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    // Cover page
    doc.setFontSize(24);
    doc.setTextColor(11, 64, 127);
    doc.text('Certificate Packet', pageWidth / 2, 40, { align: 'center' });

    doc.setFontSize(14);
    doc.setTextColor(80, 80, 80);
    doc.text(employee.full_name || employeeId, pageWidth / 2, 60, { align: 'center' });

    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text(`Business Line: ${employee.business_line || 'N/A'}`, pageWidth / 2, 75, { align: 'center' });
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, pageWidth / 2, 85, { align: 'center' });

    // Certificate list
    doc.setFontSize(11);
    doc.setTextColor(20, 20, 20);
    doc.text('Included Certificates:', 20, 105);

    let listY = 115;
    certificates.forEach((cert, idx) => {
      const issuedDate = new Date(cert.issued_at).toLocaleDateString();
      doc.setFontSize(10);
      doc.text(`${idx + 1}. ${cert.course_title}`, 25, listY);
      doc.setFontSize(8);
      doc.setTextColor(120, 120, 120);
      doc.text(`Issued: ${issuedDate}`, 30, listY + 5);
      doc.setTextColor(20, 20, 20);
      listY += 12;

      // Page-break when the cover-page list runs long (mirrors
      // generateAndCacheCertificatePacket); ~13+ certs otherwise draw off-page.
      if (listY > pageHeight - 30) {
        doc.addPage();
        listY = 20;
      }
    });

    // Add individual certificate pages (or placeholders)
    for (const cert of certificates) {
      doc.addPage();
      
      if (cert.certificate_pdf_url) {
        // In production, would embed the actual certificate PDF
        doc.setFontSize(12);
        doc.setTextColor(11, 64, 127);
        doc.text(cert.course_title, pageWidth / 2, 50, { align: 'center' });
        
        doc.setFontSize(10);
        doc.setTextColor(80, 80, 80);
        doc.text(`Certificate of Completion`, pageWidth / 2, 70, { align: 'center' });
        doc.text(`Presented to: ${employee.full_name || employeeId}`, pageWidth / 2, 100, { align: 'center' });
        doc.text(`Date Earned: ${new Date(cert.issued_at).toLocaleDateString()}`, pageWidth / 2, 120, { align: 'center' });
        doc.text(`Certificate ID: ${cert.certificate_id}`, pageWidth / 2, 140, { align: 'center' });
      } else {
        // Placeholder for missing certificate
        doc.setFontSize(11);
        doc.setTextColor(192, 0, 0);
        doc.text('Certificate PDF Not Available', pageWidth / 2, 50, { align: 'center' });
        doc.setFontSize(10);
        doc.setTextColor(100, 100, 100);
        doc.text(`Course: ${cert.course_title}`, pageWidth / 2, 70, { align: 'center' });
        doc.text(`Please contact administrator to retrieve certificate.`, pageWidth / 2, 90, { align: 'center' });
      }
    }

    const pdfBytes = doc.output('arraybuffer');

    return new Response(pdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="certificates_${employeeId}_${new Date().getTime()}.pdf"`
      }
    });

  } catch (error) {
    console.error('Certificate packet generation failed:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});