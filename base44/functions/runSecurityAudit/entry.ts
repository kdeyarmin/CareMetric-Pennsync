import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

// <<<BEGIN SHARED HELPER: isAdminLike — generated, edit base44/_shared/backendHelpers.mjs>>>
const isAdminLike = (u) => !!u && (
  u.role === 'admin' || u.account_type === 'agency_admin' ||
  u.account_type === 'super_admin'
);
// <<<END SHARED HELPER: isAdminLike>>>

// <<<BEGIN SHARED HELPER: requireAgencyAdminAgency — generated, edit base44/_shared/backendHelpers.mjs>>>
function agencyAdminMissingAgencyResponse(user) {
  if (user && user.account_type === 'agency_admin' && !String(user.agency_name || '').trim()) {
    return Response.json({ error: 'Forbidden: agency_name is required.' }, { status: 403 });
  }
  return null;
}
// <<<END SHARED HELPER: requireAgencyAdminAgency>>>

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
 * runSecurityAudit — admin-only PHI-aware security audit.
 * Previously ran asServiceRole from the browser (impossible without a service
 * token and a cross-tenant PHI leak if it worked). Agency-scoped admins only
 * audit their own staff / charts / activity.
 *
 * Body: { secure_context?: boolean }
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    {
      const gate = agencyAdminMissingAgencyResponse(user);
      if (gate) return gate;
    }
    if (!isAdminLike(user)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const secureContext = body?.secure_context !== false;

    const agency = String(user.agency_name || '').trim();
    const isAgencyScoped =
      user.account_type !== 'super_admin' && !!agency
      && (user.account_type === 'agency_admin' || user.role === 'admin');

    let users;
    let patients;
    let activities;
    try {
      if (isAgencyScoped) {
        // Agency cohort FIRST — never sample a global newest-N window and then
        // filter (an older/smaller agency can vanish from the sample and look
        // like a perfect score).
        users = await base44.asServiceRole.entities.User
          .filter({ agency_name: agency }, '-created_date', 2000);
        if (!Array.isArray(users)) throw new Error('User cohort read failed');
        const staffEmails = [...new Set((users || []).map((u) => u?.email).filter(Boolean))];
        const patientById = new Map();
        const activityById = new Map();
        for (const email of staffEmails) {
          const owned = await base44.asServiceRole.entities.Patient
            .filter({ created_by: email }, '-created_date', 500);
          if (!Array.isArray(owned)) throw new Error('Patient cohort read failed');
          for (const p of owned) {
            if (p?.id) patientById.set(p.id, p);
          }
          const acts = await base44.asServiceRole.entities.UserActivity
            .filter({ user_email: email }, '-created_date', 500);
          if (!Array.isArray(acts)) throw new Error('Activity cohort read failed');
          for (const a of acts) {
            if (a?.id) activityById.set(a.id, a);
            else activityById.set(`${a?.user_email}:${a?.created_date}:${a?.action}`, a);
          }
        }
        patients = [...patientById.values()];
        activities = [...activityById.values()];
      } else {
        users = await base44.asServiceRole.entities.User.list('-created_date', 2000);
        patients = await base44.asServiceRole.entities.Patient.list('-created_date', 2000);
        activities = await base44.asServiceRole.entities.UserActivity.list('-created_date', 2000);
        if (!Array.isArray(users) || !Array.isArray(patients) || !Array.isArray(activities)) {
          throw new Error('Required audit cohort read failed');
        }
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
    await base44.asServiceRole.entities.SecurityLog.create({
      timestamp: new Date().toISOString(),
      user_email: user.email,
      user_role: user.role || user.account_type || 'admin',
      action: 'security_audit',
      details: {
        audit_type: 'comprehensive',
        security_score: securityScore,
        findings_count: findings.length,
        findings,
        checked_users: (users || []).length,
        checked_patients: (patients || []).length,
        checked_activities: (activities || []).length,
        agency_scoped: isAgencyScoped,
        agency_name: agency || null,
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
