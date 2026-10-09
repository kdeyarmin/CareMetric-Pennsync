const normalizeEmail = value => String(value || '').trim().toLowerCase();
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 200 && value.trim() === value && !value.startsWith('$');
const email = value => typeof value === 'string' && value.length <= 320 && value.includes('@') && !/\s/.test(value) && value === normalizeEmail(value);
const instant = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
const reason = value => typeof value === 'string' && value.length > 0 && value.length <= 500 && value.trim() === value;
const roles = new Set(['agency_admin', 'manager', 'clinician', 'office_staff', 'social_worker', 'spiritual_care']);

function canonicalMembership(row, user) {
  return row && id(row.id) && id(row.agency_id) && row.user_id === user.id
    && row.membership_key === row.agency_id + ':' + user.id
    && email(row.user_email_normalized) && row.user_email_normalized === normalizeEmail(user.email)
    && roles.has(row.tenant_role) && ['pending', 'active', 'suspended', 'revoked'].includes(row.status)
    && Number.isSafeInteger(row.version) && row.version >= 1
    && (row.invitation_id == null || id(row.invitation_id))
    && id(row.created_by_user_id) && id(row.last_transition_by_user_id)
    && email(row.last_transition_by_email_normalized) && instant(row.last_transition_at)
    && reason(row.last_transition_reason)
    && (row.activated_at == null || instant(row.activated_at))
    && (!['active', 'suspended'].includes(row.status) || instant(row.activated_at))
    && (row.status !== 'pending' || row.activated_at == null)
    && (row.status === 'revoked'
      ? instant(row.revoked_at) && reason(row.revocation_reason)
      : row.revoked_at == null && row.revocation_reason == null);
}

async function membershipsFor(entities, user) {
  if (!id(user?.id) || !email(normalizeEmail(user?.email))) return null;
  const rows = await entities.AgencyMembership.filter({ user_id: user.id }, undefined, 101);
  if (!Array.isArray(rows) || rows.length > 100 || rows.some(row => !canonicalMembership(row, user))) return null;
  for (const field of ['id', 'membership_key', 'agency_id']) {
    if (new Set(rows.map(row => row[field])).size !== rows.length) return null;
  }
  return rows;
}

// Only authenticated callers pass a server-computed platformOwner flag here.
// Profile account_type and agency_name never grant access.
export async function canManageUserInAgency(base44, caller, target, { platformOwner = false, requireActiveTarget = false } = {}) {
  if (caller?.role !== 'admin' || caller.is_active === false || caller.disabled === true || caller.is_service === true || !target?.id) return false;
  if (platformOwner === true) return true;
  try {
    const entities = base44.asServiceRole.entities;
    const [callerRows, targetRows] = await Promise.all([
      membershipsFor(entities, caller), membershipsFor(entities, target),
    ]);
    if (!callerRows || !targetRows) return false;
    const active = callerRows.filter(row => row.status === 'active');
    // Existing admin actions carry no tenant selector: ambiguity fails closed.
    if (active.length !== 1 || !['agency_admin', 'manager'].includes(active[0].tenant_role)) return false;
    const agencyId = active[0].agency_id;
    const targetMembership = targetRows.find(row => row.agency_id === agencyId);
    if (!targetMembership || !((requireActiveTarget ? ['active'] : ['pending', 'active', 'suspended']).includes(targetMembership.status))) return false;
    const agencies = await entities.Agency.filter({ id: agencyId }, undefined, 2);
    return Array.isArray(agencies) && agencies.length === 1 && agencies[0].id === agencyId
      && ['active', 'trial'].includes(agencies[0].status);
  } catch {
    return false;
  }
}