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
    const user = await withTrustedClaims(base44, await base44.auth.me());
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const isAdminLike = user.role === 'admin'
      || user.account_type === 'agency_admin'
      || user.account_type === 'super_admin';
    if (!isAdminLike) {
      return Response.json({ error: 'Forbidden - Admin access required' }, { status: 403 });
    }

    let users = await base44.asServiceRole.entities.User.list('-created_date', 5000);
    if (user.account_type === 'agency_admin' && !user.agency_name) {
      return Response.json({ error: 'Forbidden: agency_name is required.' }, { status: 403 });
    }
    if (user.account_type !== 'super_admin' && user.agency_name) {
      users = (Array.isArray(users) ? users : []).filter((u) =>
        u.account_type === 'super_admin' || u.agency_name === user.agency_name
      );
    }

    const doc = new jsPDF('landscape');
    let y = 20;

    // Fetch and add logo
    try {
      const logoUrl = 'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/68ee80d98929370f9e8f2932/02eed9872_pennsynclogoupdated.png';
      const logoResponse = await fetch(logoUrl);
      const logoBlob = await logoResponse.blob();
      const logoArrayBuffer = await logoBlob.arrayBuffer();
      const logoBase64 = btoa(String.fromCharCode(...new Uint8Array(logoArrayBuffer)));
      const logoDataUrl = `data:image/png;base64,${logoBase64}`;
      
      doc.setFillColor(79, 70, 229);
      doc.rect(0, 0, 297, 35, 'F');
      doc.addImage(logoDataUrl, 'PNG', 15, 8, 20, 20);
      
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(24);
      doc.setFont(undefined, 'bold');
      doc.text('User Roster Report', 148.5, 18, { align: 'center' });
      doc.setFontSize(11);
      doc.setFont(undefined, 'normal');
      doc.text(`Generated: ${new Date().toLocaleDateString()} | Total Users: ${users.length}`, 148.5, 27, { align: 'center' });
    } catch (error) {
      doc.setFillColor(79, 70, 229);
      doc.rect(0, 0, 297, 35, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(24);
      doc.setFont(undefined, 'bold');
      doc.text('User Roster Report', 148.5, 18, { align: 'center' });
    }

    doc.setTextColor(0, 0, 0);
    y = 45;

    // Table Header
    doc.setFillColor(59, 130, 246);
    doc.rect(10, y, 277, 10, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    doc.setFont(undefined, 'bold');
    doc.text('Name', 15, y + 7);
    doc.text('Email', 75, y + 7);
    doc.text('Credential', 135, y + 7);
    doc.text('Role', 170, y + 7);
    doc.text('Care Scope', 200, y + 7);
    doc.text('Status', 250, y + 7);
    doc.setTextColor(0, 0, 0);
    y += 12;

    // Table Rows
    users.forEach((u, idx) => {
      if (y > 185) {
        doc.addPage('landscape');
        y = 20;
        
        // Repeat header on new page
        doc.setFillColor(59, 130, 246);
        doc.rect(10, y, 277, 10, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(10);
        doc.setFont(undefined, 'bold');
        doc.text('Name', 15, y + 7);
        doc.text('Email', 75, y + 7);
        doc.text('Credential', 135, y + 7);
        doc.text('Role', 170, y + 7);
        doc.text('Care Scope', 200, y + 7);
        doc.text('Status', 250, y + 7);
        doc.setTextColor(0, 0, 0);
        y += 12;
      }

      // Alternating row colors
      if (idx % 2 === 0) {
        doc.setFillColor(249, 250, 251);
        doc.rect(10, y - 2, 277, 8, 'F');
      }

      doc.setFontSize(9);
      doc.setFont(undefined, 'normal');
      doc.text(u.full_name || 'N/A', 15, y + 4);
      doc.text(u.email || '', 75, y + 4);
      doc.text(u.credential_type || 'N/A', 135, y + 4);
      doc.text(u.role || 'user', 170, y + 4);
      
      const careScope = u.care_scope === 'home_health' ? 'Home Health' : 
                       u.care_scope === 'hospice' ? 'Hospice' : 
                       u.care_scope === 'both' ? 'Both' : 'Not Set';
      doc.text(careScope, 200, y + 4);
      
      const status = u.is_approved || u.role === 'admin' ? 'Approved' : 'Pending';
      const statusColor = u.is_approved || u.role === 'admin' ? [34, 197, 94] : [234, 179, 8];
      doc.setTextColor(...statusColor);
      doc.text(status, 250, y + 4);
      doc.setTextColor(0, 0, 0);
      
      y += 8;
    });

    // Summary Section
    if (y > 160) {
      doc.addPage('landscape');
      y = 20;
    }
    
    y += 10;
    doc.setFillColor(243, 244, 246);
    doc.rect(10, y, 277, 25, 'F');
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text('Summary', 15, y + 8);
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    
    const approvedCount = users.filter(u => u.is_approved || u.role === 'admin').length;
    const pendingCount = users.filter(u => !u.is_approved && u.role !== 'admin').length;
    const rnCount = users.filter(u => u.credential_type === 'RN').length;
    const lpnCount = users.filter(u => u.credential_type === 'LPN').length;
    
    doc.text(`Total Users: ${users.length}`, 15, y + 15);
    doc.text(`Approved: ${approvedCount}`, 80, y + 15);
    doc.text(`Pending: ${pendingCount}`, 145, y + 15);
    doc.text(`RN: ${rnCount}`, 210, y + 15);
    doc.text(`LPN: ${lpnCount}`, 250, y + 15);

    // Footer
    const pageCount = doc.internal.pages.length - 1;
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFillColor(249, 250, 251);
      doc.rect(0, 200, 297, 10, 'F');
      doc.setTextColor(107, 114, 128);
      doc.setFontSize(8);
      doc.text(`PennSync - User Roster - Page ${i} of ${pageCount}`, 148.5, 205, { align: 'center' });
    }

    const pdfBytes = doc.output('arraybuffer');

    return new Response(pdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename=User_Roster_${new Date().toISOString().split('T')[0]}.pdf`
      }
    });
  } catch (error) {
    console.error('Error generating PDF:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});