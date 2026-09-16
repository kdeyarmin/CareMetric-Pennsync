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


Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await withTrustedClaims(base44, await base44.auth.me());
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await req.json();

    if (!payload.patient_id || !payload.incident_type || !payload.incident_date || !payload.report) {
      return Response.json({ error: 'Missing required incident fields' }, { status: 400 });
    }

    // Authorize: service-role Incident.create bypasses RLS, so a crafted
    // patient_id would otherwise attribute a safety event (+ admin alerts with
    // patient name) to an arbitrary chart. Mirror extractClinicalEvents /
    // startMaskedCall — assigned nurse, creator, or admin only.
    const [incidentPatient] = await base44.asServiceRole.entities.Patient
      .filter({ id: payload.patient_id }, '', 1).catch(() => []);
    if (!incidentPatient) {
      return Response.json({ error: 'Patient not found' }, { status: 404 });
    }
    const isSuperAdmin = user.account_type === 'super_admin';
    const isAgencyScopedAdmin =
      user.account_type === 'agency_admin'
      || (user.role === 'admin' && !!user.agency_name && !isSuperAdmin);
    const isPlatformAdmin = isSuperAdmin || (user.role === 'admin' && !user.agency_name);
    const isAssigned = Array.isArray(incidentPatient.assigned_nurses)
      && incidentPatient.assigned_nurses.includes(user.email);
    if (!isPlatformAdmin && !isAgencyScopedAdmin && incidentPatient.created_by !== user.email && !isAssigned) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (isAgencyScopedAdmin) {
      if (!user.agency_name) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
      const agencyUsers = await base44.asServiceRole.entities.User
        .list('-created_date', 5000).catch(() => []);
      const agencyEmails = new Set(
        (agencyUsers || [])
          .filter((u) => u.agency_name === user.agency_name && u.email)
          .map((u) => u.email),
      );
      const inAgency = (incidentPatient.created_by && agencyEmails.has(incidentPatient.created_by))
        || (Array.isArray(incidentPatient.assigned_nurses)
          && incidentPatient.assigned_nurses.some((e) => agencyEmails.has(e)));
      if (!inAgency) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    // Service role: Incident write RLS is service-role-only so the CAP
    // lifecycle cannot be bypassed by a direct client write (see
    // functions/updateIncident). created_by must therefore be stamped here --
    // the platform would otherwise attribute it to the service identity, and
    // read RLS keys off created_by to show reporters their own incidents.
    // The offline drain dedupes retries by filtering Incident on
    // client_request_id, so the key has to survive into the stored row. Drop it
    // and an interrupted drain (server committed, queue removal failed) creates
    // a second copy of the same safety event on the next pass.
    const clientRequestId = payload.client_request_id;
    if (clientRequestId) {
      const existing = await base44.asServiceRole.entities.Incident.filter(
        { client_request_id: clientRequestId },
        undefined,
        1,
      ).catch(() => []);
      if (existing?.[0]) {
        return Response.json({ success: true, incident: existing[0], deduplicated: true });
      }
    }

    const incident = await base44.asServiceRole.entities.Incident.create({
      created_by: user.email,
      ...(clientRequestId ? { client_request_id: clientRequestId } : {}),
      patient_id: payload.patient_id,
      patient_name: payload.patient_name,
      incident_type: payload.incident_type,
      incident_name: payload.incident_name,
      incident_date: payload.incident_date,
      incident_time: payload.incident_time,
      severity: payload.severity || 'medium',
      details: payload.details || {},
      report: payload.report,
      photo_urls: payload.photo_urls || [],
      physician_notified: !!payload.physician_notified,
      // Honour what the reporter actually checked. Deriving this from
      // immediate_alert meant the stored compliance flag contradicted the form:
      // "Office notified" ticked on a medium incident saved false, and an
      // unticked high-severity report saved true. Severity is still the fallback
      // for older callers that do not send the field.
      office_notified: typeof payload.office_notified === 'boolean'
        ? payload.office_notified
        : !!payload.immediate_alert,
      alert_triggered: !!payload.immediate_alert,
      status: 'reported',
    });

    if (payload.immediate_alert) {
      // Query admins directly rather than filtering the 200 newest users — in an
      // agency with >200 users the early-created admins (typically owners) were
      // silently dropped and never alerted. Mirrors submitStateReportableIncident.
      // Same admin-tier predicate as isAdminLike — role==='admin' alone missed
    // agency_admin/super_admin accounts, notifying nobody at some agencies.
    const allUsers = await base44.asServiceRole.entities.User.list('-created_date', 5000);
    // Scope recipients to the reporter's agency (plus platform super_admins).
    // Unscoped fan-out leaked patient name/id to every tenant's agency_admins.
    let users = (Array.isArray(allUsers) ? allUsers : []).filter((u) =>
      u && (u.role === 'admin' || u.role === 'agency_admin' ||
        u.account_type === 'agency_admin' || u.account_type === 'super_admin'));
    if (user.agency_name) {
      users = users.filter((u) =>
        u.account_type === 'super_admin' || u.agency_name === user.agency_name);
    } else {
      users = users.filter((u) => u.account_type === 'super_admin');
    }
      // Notify every admin-tier recipient — an extra role==='admin' re-filter
      // here re-dropped the account_type-based admins the list above includes.
      if (users.length > 0) {
        // allSettled, not all: the incident row is ALREADY committed at this
        // point, so one un-creatable Notification (e.g. a bad admin email) used
        // to reject the whole batch, escape to the outer catch and return 500 —
        // telling the nurse their urgent safety report had failed when it had
        // not, and skipping every remaining admin. Same per-notification fault
        // isolation sendRenewalReminders uses.
        const notifyResults = await Promise.allSettled(
          users.map((adminUser) =>
            base44.asServiceRole.entities.Notification.create({
              user_email: adminUser.email,
              title: `Urgent incident: ${payload.incident_name || payload.incident_type}`,
              message: `${user.full_name || user.email} submitted a ${payload.severity || 'medium'} severity incident for ${payload.patient_name || 'a patient'}.`,
              type: payload.severity === 'high' ? 'critical_alert' : 'patient_alert',
              priority: payload.severity === 'high' ? 'critical' : 'high',
              action_url: '/Incidents',
              action_label: 'Review incident',
              metadata: {
                incident_id: incident.id,
                patient_id: payload.patient_id,
                patient_name: payload.patient_name,
                reported_by: user.email,
              },
            })
          )
        );
        const failedNotifications = notifyResults.filter((r) => r.status === 'rejected').length;
        if (failedNotifications > 0) {
          console.error(
            `submitIncidentReport: ${failedNotifications}/${notifyResults.length} admin notifications failed to create`,
          );
        }
      }
    }

    return Response.json({ success: true, incident });
  } catch (error) {
    console.error('submitIncidentReport failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});