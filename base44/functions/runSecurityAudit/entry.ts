import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

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

/** Parse YYYY-MM-DD (or datetime) as local calendar day start. */
function startOfLocalDay(value) {
  if (!value) return null;
  const s = String(value);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    d.setHours(0, 0, 0, 0);
    return d;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * runSecurityAudit — protected-platform-owner PHI-aware security audit.
 * Previously ran asServiceRole from the browser (impossible without a service
 * token and a cross-tenant PHI leak if it worked). Tenant-admin audit access
 * remains unavailable until the cohort is derived from immutable membership
 * and tenant provenance. Mutable User account_type/agency_name fields are not
 * authority.
 *
 * Body: { secure_context?: boolean }
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (user.disabled === true || user.is_service === true || user.is_verified === false
      || !isProtectedSuperAdmin(user)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const secureContext = body?.secure_context !== false;

    let users;
    let patients;
    let activities;
    try {
      users = await base44.asServiceRole.entities.User.list('-created_date', 2000);
      patients = await base44.asServiceRole.entities.Patient.list('-created_date', 2000);
      activities = await base44.asServiceRole.entities.UserActivity.list('-created_date', 2000);
      if (!Array.isArray(users) || !Array.isArray(patients) || !Array.isArray(activities)) {
        throw new Error('Required audit cohort read failed');
      }
    } catch (readErr) {
      console.error('runSecurityAudit cohort read failed:', readErr?.message || readErr);
      return Response.json({
        error: 'Security audit could not load the inspected cohort. Retry later.',
      }, { status: 503 });
    }

    if ((users || []).length === 0 && (patients || []).length === 0) {
      return Response.json({
        error: 'Security audit found an empty cohort — refusing to record a misleading score.',
      }, { status: 422 });
    }

    const findings = [];
    let score = 100;

    const inactiveUsers = (users || []).filter((u) => {
      const lastActivity = (activities || []).find((a) => a.user_email === u.email);
      if (!lastActivity) return true;
      const daysSinceActivity =
        (Date.now() - new Date(lastActivity.created_date).getTime()) / (1000 * 60 * 60 * 24);
      return daysSinceActivity > 90;
    });
    if (inactiveUsers.length > 0) {
      findings.push({
        severity: 'medium',
        category: 'Access Control',
        issue: `${inactiveUsers.length} inactive user(s) detected (no activity in 90+ days)`,
        recommendation: 'Review and disable accounts that are no longer active',
        affected_count: inactiveUsers.length,
      });
      score -= 5;
    }

    const failedLogins = (activities || []).filter((a) =>
      a.action?.includes('login_failed') || a.action?.includes('access_denied'),
    );
    if (failedLogins.length > 10) {
      findings.push({
        severity: 'high',
        category: 'Authentication',
        issue: `${failedLogins.length} failed authentication attempts detected`,
        recommendation: 'Monitor for potential brute force attacks. Consider implementing rate limiting.',
        affected_count: failedLogins.length,
      });
      score -= 10;
    }

    const phiAccess = (activities || []).filter((a) =>
      a.entity_type === 'Patient' || a.entity_type === 'Visit',
    );
    const suspiciousAccess = phiAccess.filter((access) => {
      const userAccess = phiAccess.filter((a) => a.user_email === access.user_email);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayAccess = userAccess.filter((a) => new Date(a.created_date) >= today);
      return todayAccess.length > 50;
    });
    if (suspiciousAccess.length > 0) {
      findings.push({
        severity: 'critical',
        category: 'Data Access',
        issue: 'Unusual PHI access patterns detected',
        recommendation: 'Review access patterns for potential data breach or misuse',
        affected_count: new Set(suspiciousAccess.map((s) => s.user_email)).size,
      });
      score -= 15;
    }

    if (!secureContext) {
      findings.push({
        severity: 'critical',
        category: 'Encryption',
        issue: 'Application not running in secure context (HTTPS)',
        recommendation: 'Ensure all access is through HTTPS with valid SSL certificate',
        affected_count: 1,
      });
      score -= 20;
    }

    const usersWithoutStrongAuth = (users || []).filter((u) => !u.mfa_enabled);
    if (usersWithoutStrongAuth.length > 0) {
      findings.push({
        severity: 'medium',
        category: 'Authentication',
        issue: `${usersWithoutStrongAuth.length} user(s) without multi-factor authentication`,
        recommendation: 'Encourage or require MFA for all users, especially admins',
        affected_count: usersWithoutStrongAuth.length,
      });
      score -= 5;
    }

    const oldPatients = (patients || []).filter((p) => {
      const discharged = startOfLocalDay(p.discharge_date);
      if (!discharged) return false;
      const daysSinceDischarge = (Date.now() - discharged.getTime()) / (1000 * 60 * 60 * 24);
      return daysSinceDischarge > 2555;
    });
    if (oldPatients.length > 0) {
      findings.push({
        severity: 'low',
        category: 'Data Retention',
        issue: `${oldPatients.length} patient record(s) older than 7 years`,
        recommendation: 'Review data retention policy and archive/purge old records',
        affected_count: oldPatients.length,
      });
      score -= 2;
    }

    const securityScore = Math.max(0, score);
    const freshUser = await base44.auth.me().catch(() => null);
    if (!freshUser || isDeactivatedUser(freshUser) || freshUser.disabled === true
      || freshUser.is_service === true || freshUser.is_verified === false
      || !isProtectedSuperAdmin(freshUser)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    await base44.asServiceRole.entities.SecurityLog.create({
      timestamp: new Date().toISOString(),
      user_email: freshUser.email,
      user_role: freshUser.role || 'admin',
      action: 'security_audit',
      details: {
        audit_type: 'comprehensive',
        security_score: securityScore,
        findings_count: findings.length,
        findings,
        checked_users: (users || []).length,
        checked_patients: (patients || []).length,
        checked_activities: (activities || []).length,
        agency_scoped: false,
      },
    });

    return Response.json({
      success: true,
      security_score: securityScore,
      findings_count: findings.length,
      findings,
    });
  } catch (error) {
    console.error('runSecurityAudit failed:', error?.message || error);
    return Response.json({ error: error?.message || 'Audit failed' }, { status: 500 });
  }
});
