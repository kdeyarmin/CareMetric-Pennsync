import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { jsPDF } from 'npm:jspdf@4.0.0';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

// <<<BEGIN SHARED HELPER: requireAgencyAdminAgency — generated, edit base44/_shared/backendHelpers.mjs>>>
function agencyAdminMissingAgencyResponse(user) {
  if (user && user.account_type === 'agency_admin' && !String(user.agency_name || '').trim()) {
    return Response.json({ error: 'Forbidden: agency_name is required.' }, { status: 403 });
  }
  return null;
}
// <<<END SHARED HELPER: requireAgencyAdminAgency>>>



// creditYear / round1 / dedupeCreditRecords are inline copies of the
// unit-tested source in src/components/learning/ceTranscript.js. The printed
// transcript must credit exactly what the in-app transcript credits — a PDF
// whose CE total disagrees with the screen is a compliance problem, not a
// cosmetic one. base44/functions/ceTranscriptInlineParity.test.js guards
// against drift.

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

// One credit-earning record per assignment (or per course within a credit year
// for older rows without an assignment id), so a retake isn't printed as two
// separate credits while a genuine renewal in a later year still counts.
function dedupeCreditRecords(certificates = []) {
  const seen = new Set();
  const kept = [];
  for (const certificate of certificates) {
    if (!certificate || certificate.revoked === true) continue;
    const year = creditYear(certificate);
    if (year === null) continue;
    const key = certificate.assignment_id
      ? `assignment:${certificate.assignment_id}`
      : `course:${certificate.course_id || certificate.course_title || certificate.id}:${year}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push({ certificate, year });
  }
  return kept;
}

/** Credit-year blocks (newest first) plus the grand CE total for the header. */
function groupByCreditYear(certificates = []) {
  const byYear = new Map();
  for (const { certificate, year } of dedupeCreditRecords(certificates)) {
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push(certificate);
  }
  const yearGroups = [...byYear.entries()].sort((a, b) => b[0] - a[0]);
  return {
    yearGroups,
    yearTotals: yearGroups.map(([year, rows]) => ({
      year,
      hours: round1(rows.reduce((sum, cert) => sum + (Number(cert.hours) || 0), 0)),
      courseCount: rows.length,
    })),
    grandTotalHours: round1(
      yearGroups.reduce(
        (sum, [, rows]) => sum + rows.reduce((rowSum, cert) => rowSum + (Number(cert.hours) || 0), 0),
        0,
      ),
    ),
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    
    {
      const _agencyAdminGate = agencyAdminMissingAgencyResponse(user);
      if (_agencyAdminGate) return _agencyAdminGate;
    }
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { employeeId, businessLine, dateStart, dateEnd } = await req.json();

    // Require the id up front: an undefined employeeId is dropped by the SDK's
    // JSON.stringify of the filter, so the User and certificate queries below
    // would run unscoped (arbitrary employee, every clinician's certificates).
    if (!employeeId || typeof employeeId !== 'string') {
      return Response.json({ error: 'employeeId is required' }, { status: 400 });
    }

    // Only admins can generate transcripts for others (role:admin or admin account types).
    const isAdminLike = user.role === 'admin'
      || user.account_type === 'agency_admin'
      || user.account_type === 'super_admin';
    if (employeeId !== user.email && !isAdminLike) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get employee
    const employees = await base44.asServiceRole.entities.User.filter({ email: employeeId }, undefined, 5000);
    if (!employees || employees.length === 0) {
      return Response.json({ error: 'Employee not found' }, { status: 404 });
    }
    const employee = employees[0];

    if (user.account_type !== 'super_admin' && user.agency_name && (user.account_type === 'agency_admin' || user.role === 'admin')) {
      if (!user.agency_name || employee.agency_name !== user.agency_name) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
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

    // Yearly blocks, newest first, each carrying an hours subtotal — the shape a
    // CE transcript is expected to have.
    const { yearGroups, yearTotals, grandTotalHours } = groupByCreditYear(certificates);

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

    yearGroups.forEach(([year, rows], groupIndex) => {
      const { hours: yearHours, courseCount } = yearTotals[groupIndex];

      ensureSpace(34);
      doc.setFontSize(11);
      doc.setTextColor(11, 64, 127);
      doc.text(`${year}`, 20, yPosition);
      doc.setFontSize(9);
      doc.setTextColor(80, 80, 80);
      doc.text(
        `${courseCount} course${courseCount === 1 ? '' : 's'} - ${yearHours} CE hour${yearHours === 1 ? '' : 's'}`,
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
        const hours = Number(cert.hours) > 0 ? String(round1(Number(cert.hours))) : '-';

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