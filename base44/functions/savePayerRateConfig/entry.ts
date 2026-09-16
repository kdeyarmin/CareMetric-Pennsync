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

/**
 * savePayerRateConfig — the ONLY write path for the agency's payer reimbursement
 * table (PayerRateConfig).
 *
 * The entity is service-role-write only (see its RLS), mirroring
 * savePDGMRateConfig: payer rates are financial configuration, so writes are
 * gated on isAdminLike server-side rather than trusted to entity RLS (a plain
 * `role === 'admin'` rule would lock out the platform owner, whose role is
 * promoted only best-effort by ensureSuperAdmin). Each payer row is sanitized
 * field-by-field so a malformed import can't persist junk shapes.
 */

// <<<BEGIN SHARED HELPER: isAdminLike — generated, edit base44/_shared/backendHelpers.mjs>>>
const isAdminLike = (u) => !!u && u.role === 'admin';
// <<<END SHARED HELPER: isAdminLike>>>

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

// Financial configuration stays immutable while PDGM/reimbursement features
// are globally paused and tenant ownership is not server-bound.
const PAYER_RATE_CONFIG_ENABLED = false;

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

const PAYER_TYPES = ['medicare_ffs', 'medicare_advantage', 'medicaid', 'commercial', 'other'];
const PAYMENT_MODELS = ['episodic', 'per_visit', 'pdgm'];
const DISCIPLINES = ['SN', 'PT', 'OT', 'ST', 'MSW', 'HHA'];

// Positive finite number or null — payer rates/visit counts are never negative.
function posNum(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// Per-discipline { SN: number, ... } map with only valid non-negative numbers kept.
function disciplineMap(v) {
  if (!isPlainObject(v)) return {};
  const out: Record<string, number> = {};
  for (const d of DISCIPLINES) {
    const n = posNum(v[d]);
    if (n !== null) out[d] = n;
  }
  return out;
}

/** Sanitize one imported payer row onto the schema shape; null when unusable. */
function sanitizePayer(raw) {
  if (!isPlainObject(raw)) return null;
  const name = String(raw.payer_name ?? '').trim();
  if (!name) return null;
  const payerType = PAYER_TYPES.includes(raw.payer_type) ? raw.payer_type : 'other';
  const paymentModel = PAYMENT_MODELS.includes(raw.payment_model) ? raw.payment_model : 'per_visit';
  const episodeRate = posNum(raw.episode_rate);
  const episodeLength = posNum(raw.episode_length_days);
  return {
    payer_name: name.slice(0, 200),
    payer_type: payerType,
    payment_model: paymentModel,
    ...(episodeRate !== null ? { episode_rate: episodeRate } : {}),
    ...(episodeLength !== null ? { episode_length_days: episodeLength } : {}),
    per_visit_rates: disciplineMap(raw.per_visit_rates),
    approved_visits: disciplineMap(raw.approved_visits),
    auth_required: raw.auth_required !== false,
    match_terms: Array.isArray(raw.match_terms)
      ? raw.match_terms.map((t) => String(t ?? '').trim().toLowerCase()).filter(Boolean).slice(0, 20)
      : [],
    notes: typeof raw.notes === 'string' ? raw.notes.slice(0, 2000) : '',
  };
}

Deno.serve(async (req) => {
  if (!PAYER_RATE_CONFIG_ENABLED) {
    return Response.json({
      success: false,
      available: false,
      reason: 'payer_rate_configuration_paused',
      message: 'Payer-rate configuration is unavailable pending tenant-scoped financial authorization.',
      saved_count: 0,
      dropped_count: 0,
    }, { status: 409 });
  }

  try {
    const base44 = createClientFromRequest(req);

    const user = await withTrustedClaims(base44, await base44.auth.me().catch(() => null));
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!isAdminLike(user)) {
      return Response.json({ error: 'Forbidden: admin access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const { label, effective_year, notes, payers, source_file, visit_costs } = body || {};

    // Guard against empty payloads: an accidental invocation with no body
    // would overwrite the agency's existing payer table with an empty one.
    if (!body || Object.keys(body).length === 0) {
      return Response.json({ error: 'Request body is required' }, { status: 400 });
    }
    if (!Array.isArray(payers)) {
      return Response.json({ error: 'payers must be an array' }, { status: 400 });
    }

    const sanitized = payers.map(sanitizePayer).filter(Boolean);
    const dropped = payers.length - sanitized.length;
    if (sanitized.length > 500) {
      return Response.json({ error: 'Too many payer rows (max 500)' }, { status: 400 });
    }

    const agencyName = String(user.agency_name || '').trim();
    const isAgencyScoped = user.account_type !== 'super_admin'
      && agencyName
      && (user.account_type === 'agency_admin' || user.role === 'admin');
    if (user.account_type === 'agency_admin' && !agencyName) {
      return Response.json({ error: 'Forbidden: agency_name is required' }, { status: 403 });
    }

    // Prefer the caller's agency row; never overwrite another tenant's newest row.
    let existing = [];
    if (agencyName) {
      existing = await base44.asServiceRole.entities.PayerRateConfig
        .filter({ agency_name: agencyName }, '-created_date', 1).catch(() => []);
    }
    if (!existing?.length && !isAgencyScoped) {
      // Only touch a legacy unscoped row when it is unambiguously the only
      // candidate — never clobber another tenant's newest row.
      const newest = await base44.asServiceRole.entities.PayerRateConfig
        .list('-created_date', 5).catch(() => []);
      const legacy = (newest || []).filter((r) => !String(r?.agency_name || '').trim());
      if (legacy.length === 1) existing = legacy;
      else if ((newest || []).length === 1 && !String(newest[0]?.agency_name || '').trim()) {
        existing = newest;
      } else {
        existing = [];
      }
    }
    const current = existing?.[0];

    // Persist only the known fields; the editor identity is the authenticated
    // caller, never a posted updated_by_email.
    const payload = {
      label: typeof label === 'string' ? label : '',
      effective_year: typeof effective_year === 'string' ? effective_year : '',
      notes: typeof notes === 'string' ? notes : '',
      payers: sanitized,
      // Agency-wide per-visit costs (see the entity schema): preserve-unless-
      // sent so a payers-only import can't silently wipe entered costs; an
      // explicit null (or non-object) clears them; an object is sanitized to
      // the known disciplines' non-negative numbers.
      visit_costs: visit_costs === undefined
        ? (isPlainObject(current?.visit_costs) ? current.visit_costs : {})
        : disciplineMap(visit_costs),
      source_file: typeof source_file === 'string' ? source_file.slice(0, 300) : '',
      updated_by_email: user.email || null,
      ...(agencyName ? { agency_name: agencyName } : {}),
    };
    const saved = current?.id
      ? await base44.asServiceRole.entities.PayerRateConfig.update(current.id, payload)
      : await base44.asServiceRole.entities.PayerRateConfig.create(payload);

    return Response.json({
      success: true,
      id: saved?.id || current?.id || null,
      saved_count: sanitized.length,
      dropped_count: dropped,
    });
  } catch (error) {
    console.error('Error saving payer rate config:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
