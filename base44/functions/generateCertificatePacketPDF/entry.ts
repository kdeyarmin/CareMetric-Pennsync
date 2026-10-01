import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
// <<<BEGIN SHARED HELPER: pennsyncProductionAppId — generated, edit base44/_shared/backendHelpers.mjs>>>
const PENNSYNC_PRODUCTION_APP_ID = '694ec16e72e01b60d22f7cbf';
// <<<END SHARED HELPER: pennsyncProductionAppId>>>
// <<<BEGIN SHARED HELPER: base44ClientRequest — generated, edit base44/_shared/backendHelpers.mjs>>>
function pinnedBase44Request(req, expectedAppId, forwardUserCredential) {
  if (typeof expectedAppId !== 'string' || expectedAppId === '') {
    throw new Error('pinned Base44 request requires an expected Base44-App-Id');
  }
  // Read the inbound headers without ever throwing on the SHAPE of req. A production
  // request is always a real Request with a Headers bag; a bare object with no usable
  // headers (a test fixture, a malformed direct call) carries no inbound header, which
  // is the absent case handled below. Only a PRESENT, different app id throws, and that
  // requires a real header an attacker would have to set — so a real Request always
  // reaches this read and the refusal is never skipped by the tolerance.
  const inbound =
    req && req.headers && typeof req.headers.get === 'function' ? req.headers : null;
  const read = (name) => (inbound ? inbound.get(name) : null);
  const received = read('Base44-App-Id');
  // Refuse only an ACTIVE mismatch: a caller presenting a DIFFERENT app id is the
  // tenant-redirect attack, and that is the case the refusal exists for. An ABSENT
  // header is not a mismatch and selects no other tenant — it only means the request
  // did not arrive through the platform, which always injects this header. We SET the
  // pinned constant below either way, so absent falls back to the correct app exactly
  // as the dropped Base44-Api-Url falls back to the default serverUrl. Throwing on
  // absent would turn every anonymous denial into a 500 instead of a clean 403.
  if (received !== null && received !== expectedAppId) {
    throw new Error(
      'Base44-App-Id mismatch: expected ' + expectedAppId + ', received ' + received
    );
  }
  const headers = new Headers();
  // Load-bearing: SET the constant (never forward the inbound value). The SDK reads
  // appId from this header and throws of its own accord when it is absent, so pinning
  // requires setting it here — dropping the inbound header alone would not suffice.
  headers.set('Base44-App-Id', expectedAppId);
  const serviceAuth = read('Base44-Service-Authorization');
  if (serviceAuth !== null) headers.set('Base44-Service-Authorization', serviceAuth);
  if (forwardUserCredential) {
    const authorization = read('Authorization');
    if (authorization !== null) headers.set('Authorization', authorization);
    const dataEnv = read('X-Data-Env');
    if (dataEnv === 'dev' || dataEnv === 'prod') headers.set('X-Data-Env', dataEnv);
  }
  // Cosmetic URL: serverUrl comes from the dropped Base44-Api-Url, not from here.
  // No method: the SDK request factory reads only headers.get(...), never the
  // method, so the request defaults to GET. An explicit POST would be inert for the
  // SDK and would read as an outbound delivery primitive to the inventory scanner
  // once this block is inlined into the fax status pollers.
  return new Request('https://base44.app', { headers });
}
function userScopedClientRequest(req, expectedAppId) {
  return pinnedBase44Request(req, expectedAppId, true);
}
function serviceRoleClientRequest(req, expectedAppId) {
  return pinnedBase44Request(req, expectedAppId, false);
}
// <<<END SHARED HELPER: base44ClientRequest>>>
import { jsPDF } from 'npm:jspdf@4.0.0';

// <<<BEGIN SHARED HELPER: trustedCallerClaims — generated, edit base44/_shared/backendHelpers.mjs>>>
const PRIVILEGED_PROFILE_ACCOUNT_TYPES = new Set(['super_admin', 'agency_admin']);
const TRUSTED_CLAIM_AGENCY_STATUSES = new Set(['active', 'trial']);
const TRUSTED_CLAIM_TENANT_ROLES = new Set(['agency_admin', 'manager', 'clinician', 'office_staff', 'social_worker', 'spiritual_care']);
const normalizeClaimEmail = (value) => typeof value === 'string' ? value.trim().toLowerCase() : '';
const claimIdentifier = (value) => typeof value === 'string' && value.length > 0
  && value.length <= 200 && value.trim() === value && !value.startsWith('$');
const claimEmail = (value) => typeof value === 'string' && value.length <= 320
  && value.includes('@') && !/\s/.test(value) && value === normalizeClaimEmail(value);
const claimInstant = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value))
  && new Date(Date.parse(value)).toISOString() === value;
const claimReason = (value) => typeof value === 'string' && value.length > 0
  && value.length <= 500 && value.trim() === value;
function canonicalClaimMembership(row, userId, normalizedEmail) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
  const status = row.status;
  return claimIdentifier(row.id) && claimIdentifier(row.agency_id)
    && row.user_id === userId && claimIdentifier(row.membership_key)
    && row.membership_key === row.agency_id + ':' + userId
    && claimEmail(row.user_email_normalized) && row.user_email_normalized === normalizedEmail
    && TRUSTED_CLAIM_TENANT_ROLES.has(row.tenant_role)
    && ['pending', 'active', 'suspended', 'revoked'].includes(status)
    && Number.isSafeInteger(row.version) && row.version >= 1
    && (row.invitation_id == null || claimIdentifier(row.invitation_id))
    && claimIdentifier(row.created_by_user_id) && claimIdentifier(row.last_transition_by_user_id)
    && claimEmail(row.last_transition_by_email_normalized) && claimInstant(row.last_transition_at)
    && claimReason(row.last_transition_reason)
    && (row.activated_at == null || claimInstant(row.activated_at))
    && (!['active', 'suspended'].includes(status) || claimInstant(row.activated_at))
    && (status !== 'pending' || row.activated_at == null)
    && (status === 'revoked'
      ? claimInstant(row.revoked_at) && claimReason(row.revocation_reason)
      : row.revoked_at == null && row.revocation_reason == null);
}
async function loadTrustedTenantClaim(base44, profileId, normalizedEmail) {
  if (!claimIdentifier(profileId) || !claimEmail(normalizedEmail)) return null;
  try {
    // Inspect all lifecycle states before choosing an active membership. An
    // active row plus a revoked/suspended duplicate is never a trusted grant.
    const rows = await base44.asServiceRole.entities.AgencyMembership.filter(
      { user_id: profileId }, undefined, 101,
    );
    if (!Array.isArray(rows) || rows.length > 100
      || rows.some(row => !canonicalClaimMembership(row, profileId, normalizedEmail))) return null;
    for (const key of ['id', 'membership_key', 'agency_id']) {
      if (new Set(rows.map(row => row[key])).size !== rows.length) return null;
    }
    const active = rows.filter(row => row.status === 'active');
    // Legacy callers do not carry an explicit tenant selector. Multiple active
    // memberships cannot safely be resolved by choosing the first result.
    if (active.length !== 1) return null;
    const membership = active[0];
    const agencyId = membership.agency_id;
    const agencies = await base44.asServiceRole.entities.Agency.filter({ id: agencyId }, undefined, 2);
    const agency = Array.isArray(agencies) && agencies.length === 1 ? agencies[0] : null;
    const agencyName = typeof agency?.agency_name === 'string' ? agency.agency_name.trim() : '';
    if (!agency || agency.id !== agencyId || !TRUSTED_CLAIM_AGENCY_STATUSES.has(agency.status)
      || !agencyName || agencyName.length > 200) return null;
    return { tenantRole: membership.tenant_role, agencyId, agencyName };
  } catch {
    // No lookup failure may be interpreted as membership approval.
    return null;
  }
}
async function withTrustedClaims(base44, profile) {
  if (!profile || typeof profile !== 'object') return profile;
  // Preserve the repository's existing protected built-in-admin boundary. This
  // compatibility helper does not grant or change built-in roles.
  if (profile.role === 'admin') return profile;
  const normalizedEmail = normalizeClaimEmail(profile.email);
  const profileId = profile.id;
  const eligible = profile.role === 'user' && profile.is_active !== false
    && profile.disabled !== true && profile.is_service !== true;
  const tenant = eligible ? await loadTrustedTenantClaim(base44, profileId, normalizedEmail) : null;
  const claimedType = String(profile.account_type || '');
  const baseType = PRIVILEGED_PROFILE_ACCOUNT_TYPES.has(claimedType) ? 'user' : claimedType;
  if (tenant) {
    return {
      ...profile,
      account_type: tenant.tenantRole === 'agency_admin' ? 'agency_admin' : baseType,
      agency_name: tenant.agencyName,
      agency_id: tenant.agencyId,
      is_approved: true,
      is_manager: tenant.tenantRole === 'manager' || tenant.tenantRole === 'agency_admin',
    };
  }
  return { ...profile, account_type: baseType, agency_name: '', agency_id: '', is_approved: false, is_manager: false };
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
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
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