import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { jsPDF } from 'npm:jspdf@2.5.2';

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

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await withTrustedClaims(base44, await base44.auth.me().catch(() => null));
        const body = await req.json();
        const expectedSecret = String(Deno.env.get('INTERNAL_FN_SECRET') || '').trim();
        const providedSecret = String(body?.internal_secret || '').trim();
        let internalOk = false;
        if (expectedSecret && providedSecret.length === expectedSecret.length) {
          let mismatch = 0;
          for (let i = 0; i < expectedSecret.length; i++) {
            mismatch |= expectedSecret.charCodeAt(i) ^ providedSecret.charCodeAt(i);
          }
          internalOk = mismatch === 0;
        }
        if (!user && !internalOk) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }
        if (user && isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

        const { certificate_id } = body;

        if (!certificate_id) {
            return Response.json({ error: 'certificate_id is required' }, { status: 400 });
        }

        // Fetch certificate record (service-role for nested issueCertificate path)
        const certificates = await base44.asServiceRole.entities.TrainingCertificate.filter({ certificate_id }, undefined, 5000);
        
        if (!certificates || certificates.length === 0) {
            return Response.json({ error: 'Certificate not found' }, { status: 404 });
        }

        const certificate = certificates[0];

        // Verify user owns this certificate or is admin (skip when trusted internal invoke)
        if (!internalOk) {
            const isSuperAdmin = user.account_type === 'super_admin';
            const isAgencyScopedAdmin =
              user.account_type === 'agency_admin'
              || (user.role === 'admin' && !!user.agency_name && !isSuperAdmin);
            const isPlatformAdmin = isSuperAdmin || (user.role === 'admin' && !user.agency_name);
            const ownsCert = certificate.user_id === user.email;
            if (!ownsCert && !isPlatformAdmin && !isAgencyScopedAdmin) {
                return Response.json({ error: 'Forbidden' }, { status: 403 });
            }
            // Agency-scoped admins may only generate PDFs for certificates of
            // staff in their own agency (TrainingCertificate has no agency_name).
            if (!ownsCert && isAgencyScopedAdmin) {
                if (!user.agency_name) {
                    return Response.json({ error: 'Forbidden' }, { status: 403 });
                }
                const owners = await base44.asServiceRole.entities.User
                    .filter({ email: certificate.user_id }, undefined, 1)
                    .catch(() => []);
                if (!owners?.[0] || owners[0].agency_name !== user.agency_name) {
                    return Response.json({ error: 'Forbidden: certificate owner is outside your agency' }, { status: 403 });
                }
            }
        }

        // Generate PDF
        const doc = new jsPDF({
            orientation: 'landscape',
            unit: 'mm',
            format: 'letter'
        });

        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();

        // Background gradient effect (using rectangles)
        doc.setFillColor(240, 248, 255);
        doc.rect(0, 0, pageWidth, pageHeight, 'F');
        
        // Border
        doc.setLineWidth(2);
        doc.setDrawColor(59, 130, 246);
        doc.rect(10, 10, pageWidth - 20, pageHeight - 20);
        
        doc.setLineWidth(0.5);
        doc.setDrawColor(147, 197, 253);
        doc.rect(12, 12, pageWidth - 24, pageHeight - 24);

        // Header - Certificate of Completion
        doc.setFontSize(36);
        doc.setTextColor(30, 64, 175);
        doc.setFont('helvetica', 'bold');
        doc.text('Certificate of Completion', pageWidth / 2, 40, { align: 'center' });

        // Subheading
        doc.setFontSize(14);
        doc.setTextColor(71, 85, 105);
        doc.setFont('helvetica', 'normal');
        doc.text('This certifies that', pageWidth / 2, 55, { align: 'center' });

        // Employee Name
        doc.setFontSize(28);
        doc.setTextColor(15, 23, 42);
        doc.setFont('helvetica', 'bold');
        doc.text(certificate.user_name || certificate.user_id, pageWidth / 2, 70, { align: 'center' });

        // Has successfully completed
        doc.setFontSize(14);
        doc.setTextColor(71, 85, 105);
        doc.setFont('helvetica', 'normal');
        doc.text('has successfully completed', pageWidth / 2, 82, { align: 'center' });

        // Course Title
        doc.setFontSize(20);
        doc.setTextColor(30, 64, 175);
        doc.setFont('helvetica', 'bold');
        const courseTitle = certificate.course_title || 'Training Course';
        const titleLines = doc.splitTextToSize(courseTitle, pageWidth - 60);
        doc.text(titleLines, pageWidth / 2, 95, { align: 'center' });

        // Course details
        const detailsY = 95 + (titleLines.length * 7) + 10;
        doc.setFontSize(11);
        doc.setTextColor(71, 85, 105);
        doc.setFont('helvetica', 'normal');

        let currentY = detailsY;

        if (certificate.training_category) {
            doc.text(`Category: ${certificate.training_category}`, pageWidth / 2, currentY, { align: 'center' });
            currentY += 6;
        }

        if (certificate.business_line && certificate.business_line !== 'all') {
            doc.text(`Business Line: ${certificate.business_line}`, pageWidth / 2, currentY, { align: 'center' });
            currentY += 6;
        }

        if (certificate.annual_cycle_year) {
            doc.text(`Annual Education Cycle: ${certificate.annual_cycle_year}`, pageWidth / 2, currentY, { align: 'center' });
            currentY += 6;
        }

        if (certificate.score !== null && certificate.score !== undefined) {
            doc.text(`Score: ${certificate.score}%`, pageWidth / 2, currentY, { align: 'center' });
            currentY += 6;
        }

        if (certificate.hours) {
            doc.text(`CEU Hours: ${certificate.hours}`, pageWidth / 2, currentY, { align: 'center' });
            currentY += 6;
        }

        // Completion Date
        currentY += 5;
        doc.setFontSize(12);
        doc.setTextColor(15, 23, 42);
        const completionDate = new Date(certificate.completion_date).toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        });
        doc.text(`Date of Completion: ${completionDate}`, pageWidth / 2, currentY, { align: 'center' });

        // Expiration (if applicable)
        if (certificate.expiration_date) {
            currentY += 6;
            const expirationDate = new Date(certificate.expiration_date).toLocaleDateString('en-US', { 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
            });
            doc.text(`Valid Until: ${expirationDate}`, pageWidth / 2, currentY, { align: 'center' });
        }

        // Certificate ID
        currentY += 12;
        doc.setFontSize(9);
        doc.setTextColor(100, 116, 139);
        doc.text(`Certificate ID: ${certificate.certificate_id}`, pageWidth / 2, currentY, { align: 'center' });

        // Verification hash
        if (certificate.verification_hash) {
            currentY += 4;
            doc.text(`Verification Code: ${certificate.verification_hash.substring(0, 16).toUpperCase()}`, pageWidth / 2, currentY, { align: 'center' });
        }

        // Footer note
        doc.setFontSize(8);
        doc.setTextColor(148, 163, 184);
        doc.text('This certificate verifies successful completion of required training.', pageWidth / 2, pageHeight - 15, { align: 'center' });

        // Seal/Badge (decorative circle)
        const sealX = 30;
        const sealY = pageHeight - 35;
        doc.setDrawColor(59, 130, 246);
        doc.setFillColor(219, 234, 254);
        doc.circle(sealX, sealY, 12, 'FD');
        doc.setFontSize(8);
        doc.setTextColor(30, 64, 175);
        doc.setFont('helvetica', 'bold');
        doc.text('CERTIFIED', sealX, sealY - 2, { align: 'center' });
        doc.setFontSize(6);
        doc.text(new Date(certificate.issued_at).getFullYear().toString(), sealX, sealY + 3, { align: 'center' });

        // Convert to ArrayBuffer
        const pdfBytes = doc.output('arraybuffer');

        // Upload to storage
        const fileName = `certificate_${certificate.certificate_id}.pdf`;
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const file = new File([blob], fileName, { type: 'application/pdf' });

        // Service-role upload, like the other 10 PDF generators. issueCertificate
        // invokes this on the internal path where auth.me() is null, so the plain
        // RLS client had no identity to upload as and the eager PDF generation at
        // issuance failed silently (certificate_pdf_url stayed unset until a user
        // later clicked download).
        const uploadResult = await base44.asServiceRole.integrations.Core.UploadFile({ file });

        // Update certificate with PDF URL
        await base44.asServiceRole.entities.TrainingCertificate.update(certificate.id, {
            certificate_pdf_url: uploadResult.file_url
        });

        return Response.json({
            success: true,
            pdf_url: uploadResult.file_url,
            certificate_id: certificate.certificate_id
        });

    } catch (error) {
        console.error('Certificate generation error:', error);
        return Response.json({ 
            error: 'Failed to generate certificate',
            details: 'Internal server error' 
        }, { status: 500 });
    }
});