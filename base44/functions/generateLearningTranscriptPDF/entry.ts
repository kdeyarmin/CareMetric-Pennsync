import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { jsPDF } from 'npm:jspdf@4.0.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { employeeId, businessLine, dateStart, dateEnd } = await req.json();

    // Only admins can generate transcripts for others
    if (employeeId !== user.email && user.account_type !== 'agency_admin' && user.account_type !== 'super_admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get employee
    const employees = await base44.asServiceRole.entities.User.filter({ email: employeeId });
    if (!employees || employees.length === 0) {
      return Response.json({ error: 'Employee not found' }, { status: 404 });
    }
    const employee = employees[0];

    // Get certificates for this employee
    let query = { user_id: employeeId, revoked: false };
    if (dateStart || dateEnd) {
      query.issued_at = {};
      if (dateStart) query.issued_at.$gte = `${dateStart}T00:00:00Z`;
      if (dateEnd) query.issued_at.$lte = `${dateEnd}T23:59:59Z`;
    }

    const certificates = await base44.asServiceRole.entities.TrainingCertificate.filter(
      query,
      '-issued_at'
    );

    // Create PDF
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    let yPosition = 20;

    // Header
    doc.setFontSize(16);
    doc.setTextColor(11, 64, 127); // Dark blue
    doc.text('Employee Training Transcript', pageWidth / 2, yPosition, { align: 'center' });
    yPosition += 10;

    doc.setFontSize(10);
    doc.setTextColor(80, 80, 80);
    doc.text(`Business Line: ${businessLine || 'All'}`, 20, yPosition);
    yPosition += 5;
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, 20, yPosition);
    yPosition += 8;

    // Employee info
    doc.setFontSize(11);
    doc.setTextColor(20, 20, 20);
    doc.text(`Employee: ${employee.full_name}`, 20, yPosition);
    yPosition += 5;
    doc.text(`Email: ${employee.email}`, 20, yPosition);
    yPosition += 8;

    // Table header
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    doc.setFillColor(11, 64, 127);
    
    const columns = [
      { label: 'Completion Date', width: 25 },
      { label: 'Course', width: 70 },
      { label: 'Score', width: 18 },
      { label: 'Certificate', width: 32 }
    ];

    let xPos = 20;
    columns.forEach(col => {
      doc.rect(xPos, yPosition - 4, col.width, 6, 'F');
      doc.text(col.label, xPos + 2, yPosition, { maxWidth: col.width - 4, fontSize: 9 });
      xPos += col.width;
    });
    yPosition += 8;

    // Table rows
    doc.setFontSize(8);
    doc.setTextColor(40, 40, 40);

    certificates.forEach((cert, idx) => {
      if (yPosition > pageHeight - 20) {
        doc.addPage();
        yPosition = 20;
      }

      const issuedDate = new Date(cert.issued_at).toLocaleDateString();
      const score = cert.score ? `${cert.score}%` : 'N/A';

      let cellX = 20;
      doc.text(issuedDate, cellX, yPosition, { maxWidth: 23 });
      cellX += 25;

      doc.text(cert.course_title || 'Unknown Course', cellX, yPosition, { maxWidth: 68 });
      cellX += 70;

      doc.text(score, cellX, yPosition, { maxWidth: 16 });
      cellX += 18;

      doc.text(cert.certificate_id || 'N/A', cellX, yPosition, { maxWidth: 30, fontSize: 7 });

      yPosition += 6;
    });

    // Footer on every page with real page numbers (the transcript paginates; the
    // footer was previously stamped once as a hardcoded "Page 1 of 1").
    const totalPages = doc.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(120, 120, 120);
      doc.text('Internal Use Only', pageWidth / 2, pageHeight - 10, { align: 'center' });
      doc.text(`Page ${i} of ${totalPages}`, pageWidth - 20, pageHeight - 10, { align: 'right' });
    }

    const pdfBytes = doc.output('arraybuffer');

    return new Response(pdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="transcript_${employeeId}_${new Date().getTime()}.pdf"`
      }
    });

  } catch (error) {
    console.error('PDF generation failed:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});