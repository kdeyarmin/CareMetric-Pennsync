import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { jsPDF } from 'npm:jspdf@4.0.0';

// creditYear / round1 are inline copies of the unit-tested source in
// src/components/learning/ceTranscript.js so the printed transcript groups
// completions into exactly the same credit years the in-app transcript shows.
// base44/functions/ceTranscriptInlineParity.test.js guards against drift.

// Credit year of a completion, read from the leading YYYY of the ISO date so a
// record always lands in the same year for every reader regardless of timezone.
function creditYear(certificate) {
  const value = certificate?.completion_date || certificate?.issued_at;
  if (!value) return null;
  const iso = /^(\d{4})-\d{2}/.exec(String(value));
  if (iso) return Number(iso[1]);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getFullYear();
}

const round1 = (value) => Math.round(value * 10) / 10;

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
    const employees = await base44.asServiceRole.entities.User.filter({ email: employeeId }, undefined, 5000);
    if (!employees || employees.length === 0) {
      return Response.json({ error: 'Employee not found' }, { status: 404 });
    }
    const employee = employees[0];

    if (user.account_type === 'agency_admin' && employee.agency_name !== user.agency_name) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get certificates for this employee
    let query = { user_id: employeeId, revoked: false };
    if (dateStart || dateEnd) {
      query.issued_at = {};
      if (dateStart) query.issued_at.$gte = `${dateStart}T00:00:00Z`;
      if (dateEnd) query.issued_at.$lte = `${dateEnd}T23:59:59Z`;
    }

    const certificates = await base44.asServiceRole.entities.TrainingCertificate.filter(
      query,
      '-issued_at',
      5000,
    );

    // Group by credit year, newest first, so the transcript reads the way a CE
    // transcript is expected to: yearly blocks each carrying an hours subtotal.
    const byYear = new Map();
    for (const certificate of certificates) {
      const year = creditYear(certificate);
      const key = year === null ? 'Undated' : year;
      if (!byYear.has(key)) byYear.set(key, []);
      byYear.get(key).push(certificate);
    }
    const yearGroups = [...byYear.entries()].sort((a, b) => {
      if (a[0] === 'Undated') return 1;
      if (b[0] === 'Undated') return -1;
      return b[0] - a[0];
    });
    const grandTotalHours = round1(
      certificates.reduce((sum, certificate) => sum + (Number(certificate.hours) || 0), 0),
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
    yPosition += 5;
    doc.text(`Total CE Hours: ${grandTotalHours}`, 20, yPosition);
    yPosition += 8;

    const columns = [
      { label: 'Completion Date', width: 25 },
      { label: 'Course', width: 58 },
      { label: 'Score', width: 15 },
      { label: 'CE Hours', width: 17 },
      { label: 'Certificate', width: 32 },
    ];

    const drawTableHeader = () => {
      doc.setFontSize(9);
      doc.setTextColor(255, 255, 255);
      doc.setFillColor(11, 64, 127);
      let xPos = 20;
      columns.forEach(col => {
        doc.rect(xPos, yPosition - 4, col.width, 6, 'F');
        doc.text(col.label, xPos + 2, yPosition, { maxWidth: col.width - 4 });
        xPos += col.width;
      });
      yPosition += 8;
    };

    // Reserve enough room that a year heading is never orphaned at a page break
    // ahead of its own header row and first entry.
    const ensureSpace = (needed) => {
      if (yPosition <= pageHeight - needed) return false;
      doc.addPage();
      yPosition = 20;
      return true;
    };

    yearGroups.forEach(([year, rows]) => {
      const yearHours = round1(rows.reduce((sum, cert) => sum + (Number(cert.hours) || 0), 0));

      ensureSpace(34);
      doc.setFontSize(11);
      doc.setTextColor(11, 64, 127);
      doc.text(`${year}`, 20, yPosition);
      doc.setFontSize(9);
      doc.setTextColor(80, 80, 80);
      doc.text(
        `${rows.length} course${rows.length === 1 ? '' : 's'} · ${yearHours} CE hour${yearHours === 1 ? '' : 's'}`,
        40,
        yPosition,
      );
      yPosition += 7;
      drawTableHeader();

      doc.setFontSize(8);
      doc.setTextColor(40, 40, 40);
      rows.forEach((cert) => {
        if (ensureSpace(20)) drawTableHeader();
        doc.setFontSize(8);
        doc.setTextColor(40, 40, 40);

        const completedValue = cert.completion_date || cert.issued_at;
        const completedDate = completedValue ? new Date(completedValue).toLocaleDateString() : 'N/A';
        const score = cert.score ? `${cert.score}%` : 'N/A';
        const hours = Number(cert.hours) > 0 ? String(round1(Number(cert.hours))) : '—';

        let cellX = 20;
        doc.text(completedDate, cellX, yPosition, { maxWidth: 23 });
        cellX += 25;
        doc.text(cert.course_title || 'Unknown Course', cellX, yPosition, { maxWidth: 56 });
        cellX += 58;
        doc.text(score, cellX, yPosition, { maxWidth: 13 });
        cellX += 15;
        doc.text(hours, cellX, yPosition, { maxWidth: 15 });
        cellX += 17;
        doc.setFontSize(7);
        doc.text(cert.certificate_id || 'N/A', cellX, yPosition, { maxWidth: 30 });

        yPosition += 6;
      });
      yPosition += 4;
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
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});