import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

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
    const base44 = createClientFromRequest(req);
    const user = await withTrustedClaims(base44, await base44.auth.me());

    // Platform facility admins (role:admin) and agency/super admins.
    const isAdminLike = !!user && (
      user.role === 'admin'
      || user.account_type === 'agency_admin'
      || user.account_type === 'super_admin'
    );
    if (!isAdminLike) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    {
      const _agencyAdminGate = agencyAdminMissingAgencyResponse(user);
      if (_agencyAdminGate) return _agencyAdminGate;
    }
    // Agency admins are scoped to their OWN agency (mirrors
    // getTeamTrainingReadiness / distributePolicyAcknowledgment): resolve the set
    // of emails in the caller's agency and drop any row whose employee is outside
    // it. Without this an agency_admin could pass another agency's
    // employeeId/courseId/planId and export that tenant's certificates, scores and
    // completion records. super_admin is not scoped.
    // Fail closed when agency_admin lacks agency_name — otherwise agencyEmails
    // stays null and inAgency() admits every tenant's rows.
    let agencyEmails = null;
    if (user.account_type !== 'super_admin' && user.agency_name && (user.account_type === 'agency_admin' || user.role === 'admin')) {
      if (!user.agency_name) {
        return Response.json({ error: 'Forbidden: agency membership required' }, { status: 403 });
      }
      const agencyUsers = await base44.asServiceRole.entities.User.list('-created_date', 5000);
      agencyEmails = new Set(
        agencyUsers.filter((u) => u.agency_name === user.agency_name).map((u) => u.email)
      );
    }
    const inAgency = (email) => agencyEmails === null || agencyEmails.has(email);

    const {
      reportType,
      businessLine,
      dateStart,
      dateEnd,
      employeeId,
      courseId,
      planId,
      status
    } = await req.json();

    let data = [];
    let headers = [];

    // Guard date cells: a null/invalid date would otherwise render "Invalid Date"
    // (or 1970), and date subtraction would yield NaN.
    const fmtDate = (d) => {
      if (!d) return 'N/A';
      const t = new Date(d);
      return Number.isNaN(t.getTime()) ? 'N/A' : t.toLocaleDateString();
    };
    const daysBetween = (a, b) => {
      const x = new Date(a), y = new Date(b);
      return (Number.isNaN(x.getTime()) || Number.isNaN(y.getTime()))
        ? 'N/A'
        : Math.ceil((x - y) / (1000 * 60 * 60 * 24));
    };

    if (reportType === 'transcript') {
      // Employee transcript CSV
      // Explicit high limits throughout this function: an unlimited filter()
      // returns only the server's default page (~50 rows), so every CSV below
      // silently stopped at 50 records. These exports are the agency's training
      // compliance evidence — a short file reads as "this is everything".
      const certificates = (await base44.asServiceRole.entities.TrainingCertificate.filter(
        { user_id: employeeId, revoked: false },
        '-issued_at',
        5000
      )).filter(cert => inAgency(cert.user_id));

      headers = ['Completion Date', 'Course', 'Score', 'Pass', 'Certificate ID'];
      data = certificates.map(cert => ({
        'Completion Date': fmtDate(cert.issued_at),
        'Course': cert.course_title || 'Unknown',
        'Score': cert.score ? `${cert.score}%` : 'N/A',
        'Pass': cert.score && cert.score >= 80 ? 'Yes' : 'No',
        'Certificate ID': cert.certificate_id || 'N/A'
      }));
    } else if (reportType === 'roster') {
      // Course roster CSV
      const query = { course_id: courseId };
      if (businessLine && businessLine !== 'all') {
        // TrainingAssignment's business-line field is `assigned_to_business_line`
        // (there is no `business_line` field); filtering the wrong field silently
        // returned wrong rows. Matches getTeamTrainingReadiness.
        query.assigned_to_business_line = businessLine;
      }

      const assignments = (await base44.asServiceRole.entities.TrainingAssignment.filter(query, '-created_date', 5000))
        .filter(a => inAgency(a.assigned_to_user_id));

      headers = ['Employee', 'Assigned Date', 'Due Date', 'Status', 'Completion Date', 'Score', 'Attempts'];
      data = assignments.map(a => ({
        'Employee': a.assigned_to_user_id || 'N/A',
        'Assigned Date': fmtDate(a.created_date),
        'Due Date': a.due_date || 'N/A',
        'Status': a.status || 'pending',
        'Completion Date': a.completion_date ? new Date(a.completion_date).toLocaleDateString() : 'Not Completed',
        'Score': a.score || 'N/A',
        'Attempts': a.attempt_count || '0'
      }));
    } else if (reportType === 'plan-compliance') {
      // Learning plan compliance CSV
      const enrollments = (await base44.asServiceRole.entities.PlanEnrollment.filter(
        { plan_id: planId },
        '-enrolled_at',
        5000
      )).filter(e => inAgency(e.user_id));

      headers = ['Employee', 'Enrollment Date', 'Status', 'Progress %', 'Completed / Total'];
      data = enrollments.map(e => ({
        'Employee': e.user_name || 'Unknown',
        'Enrollment Date': fmtDate(e.enrolled_at),
        'Status': e.status || 'active',
        'Progress %': Math.round(e.progress_percentage || 0),
        'Completed / Total': `${e.courses_completed || 0} / ${e.courses_total || 0}`
      }));
    } else if (reportType === 'overdue') {
      // Overdue assignments CSV
      const query = { status: 'overdue' };
      if (businessLine && businessLine !== 'all') {
        // See roster branch: TrainingAssignment uses `assigned_to_business_line`.
        query.assigned_to_business_line = businessLine;
      }

      const overdue = (await base44.asServiceRole.entities.TrainingAssignment.filter(query, '-due_date', 5000))
        .filter(a => inAgency(a.assigned_to_user_id));

      headers = ['Employee', 'Course', 'Due Date', 'Days Overdue'];
      data = overdue.map(a => ({
        'Employee': a.assigned_to_user_id || 'N/A',
        'Course': a.course_title || 'Unknown',
        'Due Date': a.due_date || 'N/A',
        'Days Overdue': daysBetween(new Date(), a.due_date)
      }));
    } else if (reportType === 'expiring') {
      // Certificate expiration CSV
      const query = {
        revoked: false,
        expiration_date: { $ne: null }
      };
      if (businessLine && businessLine !== 'all') {
        query.business_line = businessLine;
      }

      const expiring = (await base44.asServiceRole.entities.TrainingCertificate.filter(query, 'expiration_date', 5000))
        .filter(c => inAgency(c.user_id));

      headers = ['Employee', 'Course', 'Issued Date', 'Expiration Date', 'Days Until Expiry'];
      data = expiring.map(c => {
        const daysUntilExpiry = daysBetween(c.expiration_date, new Date());
        return {
          'Employee': c.user_name || 'Unknown',
          'Course': c.course_title || 'Unknown',
          'Issued Date': fmtDate(c.issued_at),
          'Expiration Date': fmtDate(c.expiration_date),
          'Days Until Expiry': daysUntilExpiry
        };
      });
    }

    // Convert to CSV
    const csvContent = [
      headers.join(','),
      ...data.map(row => headers.map(h => {
        // Only blank null/undefined — `|| ''` wrongly blanked legitimate 0s
        // (Days Until Expiry / Days Overdue / Progress % for a cert due today).
        const raw = row[h];
        const val = raw === undefined || raw === null ? '' : raw;
        let cell = String(val);
        // CSV formula-injection guard: a cell starting with =, +, -, @ or a
        // leading tab/CR is executed as a formula by Excel/Sheets even inside
        // quotes. Prefix a single quote so an AI-generated course title like
        // "=cmd|..." renders as text. Only text cells — numbers stay numeric so
        // a negative count (e.g. Days Until Expiry) isn't turned into a string.
        if (typeof raw !== 'number' && /^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
        const escaped = cell.replace(/"/g, '""');
        return `"${escaped}"`;
      }).join(','))
    ].join('\n');

    return new Response(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="report_${reportType}_${new Date().getTime()}.csv"`
      }
    });

  } catch (error) {
    console.error('CSV export failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});