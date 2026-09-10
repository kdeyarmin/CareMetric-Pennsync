import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

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



/**
 * rotateTelehealthJoinToken — mint (or re-mint) the patient's guest join token
 * for a telehealth session, storing only its SHA-256 hash at rest.
 *
 * The raw token is returned once to the authorized STAFF caller (host, listed
 * participant, or admin), who builds the patient invite link client-side. Any
 * previously issued token for the session stops working — rotation is the
 * point: staff re-sending a link get a fresh capability, and a link that
 * leaked earlier dies with the rotation.
 *
 * Guest joins validate against join_token_hash in createTelehealthToken, so
 * the plaintext capability never needs to be persisted anywhere.
 */

function generateToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const user = await withTrustedClaims(base44, await base44.auth.me());
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    {
      const _agencyAdminGate = agencyAdminMissingAgencyResponse(user);
      if (_agencyAdminGate) return _agencyAdminGate;
    }
    const { session_id } = await req.json();
    if (!session_id) return Response.json({ error: 'session_id is required' }, { status: 400 });

    const sessions = await base44.asServiceRole.entities.TelehealthSession.filter({ id: session_id }, undefined, 1);
    const session = sessions[0];
    if (!session) return Response.json({ error: 'Telehealth session not found' }, { status: 404 });

    // Same staff predicate as createTelehealthToken: stable identity only
    // (email/role), never the mutable, non-unique full_name.
    const participants = Array.isArray(session.participant_list) ? session.participant_list : [];
    const isHostOrParticipant = session.host_email === user.email
      || participants.includes(user.email);
    const isAdminLike = user.role === 'admin'
      || user.account_type === 'agency_admin'
      || user.account_type === 'super_admin';
    if (!isHostOrParticipant && !isAdminLike) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    const isAgencyScopedAdmin = !isHostOrParticipant
      && user.account_type !== 'super_admin'
      && user.agency_name
      && (user.account_type === 'agency_admin' || user.role === 'admin');
    if (isAgencyScopedAdmin) {
      const [host] = await base44.asServiceRole.entities.User
        .filter({ email: session.host_email }, '-created_date', 1).catch(() => []);
      if (!host?.agency_name || host.agency_name !== user.agency_name) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    if (session.status !== 'scheduled' && session.status !== 'active') {
      return Response.json({ error: 'This telehealth visit is no longer open' }, { status: 409 });
    }

    const token = generateToken();
    const join_token_hash = await sha256Hex(token);
    // Rotating also retires any legacy plaintext invite_link: once a hash
    // exists, createTelehealthToken ignores invite_link entirely, so clear it
    // rather than leave a stale (now-dead) capability URL at rest.
    await base44.asServiceRole.entities.TelehealthSession.update(session.id, {
      join_token_hash,
      invite_link: null,
    });

    return Response.json({ success: true, token, room_name: session.room_name });
  } catch (error) {
    console.error('rotateTelehealthJoinToken error:', error?.message);
    return Response.json({ error: 'Failed to rotate the join token' }, { status: 500 });
  }
});
