import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { jsPDF } from 'npm:jspdf@4.0.0';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

// <<<BEGIN SHARED HELPER: protectedUserAuthz — generated, edit base44/_shared/backendHelpers.mjs>>>
const normalizeProtectedEmail = (value) => String(value || '').trim().toLowerCase();
const isProtectedAdmin = (user) => !!user && user.role === 'admin';
function isProtectedSuperAdmin(user) {
  const configuredEmail = normalizeProtectedEmail(Deno.env.get('SUPER_ADMIN_EMAIL'));
  return !!configuredEmail
    && isProtectedAdmin(user)
    && normalizeProtectedEmail(user.email) === configuredEmail;
}
// <<<END SHARED HELPER: protectedUserAuthz>>>


Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { employeeId, certificateIds, dateRangeStart, dateRangeEnd } = await req.json();

    // Require the id up front: an undefined employeeId is dropped by the SDK's
    // filter, so User/certificate queries below would run unscoped.
    if (!employeeId || typeof employeeId !== 'string') {
      return Response.json({ error: 'employeeId is required' }, { status: 400 });
    }
    if (certificateIds !== undefined && (
      !Array.isArray(certificateIds)
      || certificateIds.length > 5000
      || certificateIds.some((id) => typeof id !== 'string' || !id.trim() || id.length > 200)
    )) {
      return Response.json({ error: 'certificateIds must be an array of valid IDs' }, { status: 400 });
    }
    const isIsoDate = (value) => {
      if (value === undefined || value === null || value === '') return true;
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const parsed = new Date(`${value}T00:00:00.000Z`);
      return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
    };
    if (!isIsoDate(dateRangeStart) || !isIsoDate(dateRangeEnd)
        || (dateRangeStart && dateRangeEnd && dateRangeStart > dateRangeEnd)) {
      return Response.json({ error: 'date range must contain valid ordered YYYY-MM-DD dates' }, { status: 400 });
    }

    // Every user may export only their own packet. Cross-user export remains a
    // platform-owner operation until tenant membership is server-owned. Custom
    // account_type / agency fields are self-editable through auth.updateMe and
    // are therefore never authorization inputs here.
    const isSelf = normalizeProtectedEmail(employeeId) === normalizeProtectedEmail(user.email);
    if (!isSelf && !isProtectedSuperAdmin(user)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    const targetEmployeeId = isSelf ? String(user.email) : employeeId.trim();

    // Check for existing valid cache. The cache key only tracks user_id + date
    // range, so a request that pins a specific set of certificateIds must NOT
    // reuse a packet cached for a different selection — skip the cache (and
    // regenerate) whenever explicit certificateIds are supplied.
    const hasExplicitIds = Array.isArray(certificateIds) && certificateIds.length > 0;
    const cacheQuery = {
      user_id: targetEmployeeId,
      date_range_start: dateRangeStart || null,
      date_range_end: dateRangeEnd || null
    };

    const existingCache = hasExplicitIds
      ? []
      : (await base44.asServiceRole.entities.CertificatePacketCache
        .filter(cacheQuery, '-created_date', 5000))
        // Re-check every key in memory. A service-role response must never be
        // trusted merely because its query carried a filter.
        .filter((cache) =>
          normalizeProtectedEmail(cache?.user_id) === normalizeProtectedEmail(targetEmployeeId)
          && (cache?.date_range_start || null) === (dateRangeStart || null)
          && (cache?.date_range_end || null) === (dateRangeEnd || null));
    
    if (existingCache && existingCache.length > 0) {
      const cache = existingCache[0];
      const expiresAt = new Date(cache.expires_at);
      const now = new Date();

      // If cache is still valid, return it
      if (expiresAt > now) {
        // Update download tracking
        await base44.asServiceRole.entities.CertificatePacketCache.update(cache.id, {
          download_count: (cache.download_count || 0) + 1,
          last_downloaded: now.toISOString()
        });

        // Generate signed URL for the cached PDF
        const signedUrl = await base44.integrations.Core.CreateFileSignedUrl({
          file_uri: cache.file_uri,
          expires_in: 3600
        });

        return Response.json({
          success: true,
          cached: true,
          download_url: signedUrl.signed_url,
          generated_at: cache.generated_at,
          expires_at: cache.expires_at
        });
      }
    }

    // Cache miss or expired: generate new packet. When an admin generates for
    // someone else, the packet must carry the TARGET employee's name — not the
    // caller's — so resolve `employee` to the target record rather than reusing
    // the authenticated caller (auth.me()).
    let employee = user;
    if (!isSelf) {
      const employees = await base44.asServiceRole.entities.User.filter({ email: targetEmployeeId }, undefined, 5000);
      employee = (employees || []).find((candidate) =>
        normalizeProtectedEmail(candidate?.email) === normalizeProtectedEmail(targetEmployeeId));
      if (!employee) {
        return Response.json({ error: 'Employee not found' }, { status: 404 });
      }
    }

    // Fetch certificates
    let query = { user_id: targetEmployeeId, revoked: false };
    if (certificateIds && certificateIds.length > 0) {
      query.id = { $in: certificateIds };
    } else if (dateRangeStart || dateRangeEnd) {
      query.issued_at = {};
      if (dateRangeStart) query.issued_at.$gte = `${dateRangeStart}T00:00:00Z`;
      if (dateRangeEnd) query.issued_at.$lte = `${dateRangeEnd}T23:59:59Z`;
    }

    const certificates = (await base44.asServiceRole.entities.TrainingCertificate.filter(
      query,
      '-issued_at',
      5000,
    )).filter((certificate) =>
      normalizeProtectedEmail(certificate?.user_id) === normalizeProtectedEmail(targetEmployeeId));

    if (hasExplicitIds) {
      const requestedIds = new Set(certificateIds.map((id) => String(id || '').trim()).filter(Boolean));
      const returnedIds = new Set(certificates.map((certificate) => String(certificate?.id || '').trim()));
      if (requestedIds.size !== certificateIds.length ||
          [...requestedIds].some((id) => !returnedIds.has(id))) {
        return Response.json({ error: 'One or more certificates were not found for this employee' }, { status: 404 });
      }
    }

    // Generate PDF server-side
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    // Cover page
    doc.setFontSize(24);
    doc.setTextColor(11, 64, 127);
    doc.text('Certificate Packet', pageWidth / 2, 40, { align: 'center' });

    doc.setFontSize(14);
    doc.setTextColor(80, 80, 80);
    doc.text(employee.full_name || targetEmployeeId, pageWidth / 2, 60, { align: 'center' });

    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, pageWidth / 2, 85, { align: 'center' });

    // Certificate list
    doc.setFontSize(11);
    doc.setTextColor(20, 20, 20);
    doc.text('Included Certificates:', 20, 105);

    let listY = 115;
    certificates.forEach((cert, idx) => {
      const issuedDate = new Date(cert.issued_at).toLocaleDateString();
      doc.setFontSize(10);
      doc.text(`${idx + 1}. ${cert.course_title || 'Unknown Course'}`, 25, listY);
      doc.setFontSize(8);
      doc.setTextColor(120, 120, 120);
      doc.text(`Issued: ${issuedDate}`, 30, listY + 5);
      doc.setTextColor(20, 20, 20);
      listY += 12;

      // Add page break if list gets too long
      if (listY > pageHeight - 30) {
        doc.addPage();
        listY = 20;
      }
    });

    // Add individual certificate pages
    certificates.forEach((cert, idx) => {
      doc.addPage();
      
      doc.setFontSize(12);
      doc.setTextColor(11, 64, 127);
      doc.text('Certificate of Completion', pageWidth / 2, 40, { align: 'center' });

      doc.setFontSize(14);
      doc.setTextColor(20, 20, 20);
      doc.text(cert.course_title || 'Unknown Course', pageWidth / 2, 70, { align: 'center' });

      doc.setFontSize(10);
      doc.setTextColor(80, 80, 80);
      doc.text(`Presented to: ${employee.full_name || targetEmployeeId}`, pageWidth / 2, 100, { align: 'center' });
      doc.text(`Date Earned: ${new Date(cert.issued_at).toLocaleDateString()}`, pageWidth / 2, 120, { align: 'center' });
      
      if (cert.expiration_date) {
        doc.text(`Expires: ${new Date(cert.expiration_date).toLocaleDateString()}`, pageWidth / 2, 135, { align: 'center' });
      }

      doc.setFontSize(8);
      doc.setTextColor(120, 120, 120);
      doc.text(`Certificate ID: ${cert.certificate_id || 'N/A'}`, pageWidth / 2, 150, { align: 'center' });
      doc.text(`Score: ${cert.score || 'N/A'}%`, pageWidth / 2, 158, { align: 'center' });

      // Footer
      doc.setFontSize(7);
      doc.setTextColor(150, 150, 150);
      doc.text('Internal Use Only', pageWidth / 2, pageHeight - 10, { align: 'center' });
    });

    const pdfBytes = doc.output('arraybuffer');

    // Upload to private storage
    const packetFile = new File([pdfBytes], 'certificate_packet.pdf', { type: 'application/pdf' });
    const uploadResponse = await base44.integrations.Core.UploadPrivateFile({
      file: packetFile
    });

    // Save cache entry
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours

    // Don't cache explicit-certificateIds packets: the cache READ keys only on
    // user_id + date range (it can't match a specific id set), so persisting a
    // pinned-subset packet here would let a later all-certs / date-range request
    // for the same employee read it back. Generate + return without caching.
    if (!hasExplicitIds) {
      await base44.asServiceRole.entities.CertificatePacketCache.create({
        user_id: targetEmployeeId,
        certificate_ids_json: certificates.map(c => c.id),
        date_range_start: dateRangeStart || null,
        date_range_end: dateRangeEnd || null,
        file_uri: uploadResponse.file_uri,
        generated_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
        download_count: 0
      });
    }

    // Generate signed URL
    const signedUrl = await base44.integrations.Core.CreateFileSignedUrl({
      file_uri: uploadResponse.file_uri,
      expires_in: 3600
    });

    return Response.json({
      success: true,
      cached: false,
      download_url: signedUrl.signed_url,
      generated_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      certificates_count: certificates.length
    });

  } catch (error) {
    console.error('Certificate packet generation failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
