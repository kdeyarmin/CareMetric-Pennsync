import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { jsPDF } from 'npm:jspdf@4.0.0';

// <<<BEGIN SHARED HELPER: trustedCallerClaims — generated, edit base44/_shared/backendHelpers.mjs>>>
const PRIVILEGED_PROFILE_ACCOUNT_TYPES = new Set(['super_admin', 'agency_admin']);
const TRUSTED_CLAIM_AGENCY_STATUSES = new Set(['active', 'trial']);
const normalizeClaimEmail = (value) => String(value || '').trim().toLowerCase();
async function loadTrustedTenantClaim(base44, profileId, email) {
  if (!profileId || !email) return null;
  let membership = null;
  try {
    const rows = await base44.asServiceRole.entities.AgencyMembership.filter(
      { user_id: profileId, status: 'active' },
      undefined,
      2,
    );
    const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
    if (row
      && String(row.user_id || '').trim() === profileId
      && String(row.status || '') === 'active'
      && normalizeClaimEmail(row.user_email_normalized) === email
      && typeof row.agency_id === 'string'
      && row.agency_id.trim()) {
      membership = row;
    }
  } catch {
    membership = null;
  }
  if (!membership) return null;
  try {
    const agencyId = membership.agency_id.trim();
    const rows = await base44.asServiceRole.entities.Agency.filter({ id: agencyId }, undefined, 2);
    const agency = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
    const agencyName = String(agency?.agency_name || '').trim();
    if (!agency || agency.id !== agencyId || !TRUSTED_CLAIM_AGENCY_STATUSES.has(String(agency.status || ''))
      || !agencyName) {
      return null;
    }
    return { tenantRole: String(membership.tenant_role || ''), agencyId, agencyName };
  } catch {
    return null;
  }
}
async function withTrustedClaims(base44, profile) {
  if (!profile || typeof profile !== 'object') return profile;
  // Protected built-in admins (the platform owner included) already hold
  // platform-level RLS authority, so their legacy self-scoping claims cannot
  // widen access; leave them exactly as the handler saw them before.
  if (profile.role === 'admin') return profile;
  const email = normalizeClaimEmail(profile.email);
  const profileId = typeof profile.id === 'string' ? profile.id.trim() : '';
  const tenant = await loadTrustedTenantClaim(base44, profileId, email);
  const claimedType = String(profile.account_type || '');
  const baseType = PRIVILEGED_PROFILE_ACCOUNT_TYPES.has(claimedType) ? 'user' : claimedType;
  if (tenant) {
    return {
      ...profile,
      account_type: tenant.tenantRole === 'agency_admin' ? 'agency_admin' : baseType,
      agency_name: tenant.agencyName,
      agency_id: tenant.agencyId,
      is_approved: true,
    };
  }
  return { ...profile, account_type: baseType, agency_name: '', agency_id: '', is_approved: false };
}
// <<<END SHARED HELPER: trustedCallerClaims>>>

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



Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await withTrustedClaims(base44, await base44.auth.me());
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    
    {
      const _agencyAdminGate = agencyAdminMissingAgencyResponse(user);
      if (_agencyAdminGate) return _agencyAdminGate;
    }
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { employeeId, certificateIds } = await req.json();

    // Require the id up front: an undefined employeeId is dropped by the SDK's
    // filter, so the User/certificate queries below would run unscoped.
    if (!employeeId || typeof employeeId !== 'string') {
      return Response.json({ error: 'employeeId is required' }, { status: 400 });
    }

    // Only admins can generate packets for others (role:admin or admin account types).
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

    // Agency admins are scoped to their OWN agency (mirrors generateAndCacheCertificatePacket):
    // without this an agency_admin could pass another agency's employeeId and pull
    // that tenant's certificate packet. Fail closed when caller lacks agency_name.
    if (user.account_type !== 'super_admin' && user.agency_name && (user.account_type === 'agency_admin' || user.role === 'admin')) {
      if (!user.agency_name || employee.agency_name !== user.agency_name) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    // Get certificates
    let query = { user_id: employeeId, revoked: false };
    if (certificateIds && certificateIds.length > 0) {
      query.id = { $in: certificateIds };
    }

    const certificates = await base44.asServiceRole.entities.TrainingCertificate.filter(
      query,
      '-issued_at',
      5000,
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
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});