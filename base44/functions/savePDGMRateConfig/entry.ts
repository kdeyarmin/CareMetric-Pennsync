import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * savePDGMRateConfig — the ONLY write path for the admin-editable PDGM rate set.
 *
 * The PDGMRateConfig entity is service-role-write only (see its RLS), so it can't
 * be written directly from the browser. This function is the gated server-side
 * writer, mirroring how saveTelnyxSecret guards the IntegrationSecret entity.
 *
 * Authorization mirrors src/lib/superAdmin.js `isAdminLike` (role admin OR an
 * agency_admin / super_admin account_type OR the designated owner email). A plain
 * `role === 'admin'` RLS rule would lock out the platform owner, whose `role` is
 * promoted only best-effort by ensureSuperAdmin (account_type is the reliable
 * signal). The backend runs as a standalone Deno module and can't import the
 * frontend helper, so the predicate + owner email are mirrored here — keep them in
 * sync with superAdmin.js when changing the owner.
 */

// <<<BEGIN SHARED HELPER: isAdminLike — generated, edit base44/_shared/backendHelpers.mjs>>>
const isAdminLike = (u) => !!u && (
  u.role === 'admin' || u.account_type === 'agency_admin' ||
  u.account_type === 'super_admin'
);
// <<<END SHARED HELPER: isAdminLike>>>

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


const isPlainObject = (v) =>
  !!v && typeof v === 'object' && !Array.isArray(v);

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const user = await base44.auth.me().catch(() => null);
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!isAdminLike(user)) {
      return Response.json({ error: 'Forbidden: admin access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const { label, effective_year, is_official, notes, rates, icd10_clinical_groups, case_mix_weight_table, wage_index_table } = body || {};

    // Guard against empty payloads: an accidental invocation with no body
    // would overwrite the agency's existing rate config with empty defaults.
    if (!body || Object.keys(body).length === 0) {
      return Response.json({ error: 'Request body is required' }, { status: 400 });
    }

    const agencyName = String(user.agency_name || '').trim();
    const isAgencyScoped = user.account_type !== 'super_admin'
      && agencyName
      && (user.account_type === 'agency_admin' || user.role === 'admin');
    // Only agency_admin accounts require agency_name. Bare role:admin with no
    // agency is platform-wide and may manage the unscoped legacy rate row.
    if (user.account_type === 'agency_admin' && !agencyName) {
      return Response.json({ error: 'Forbidden: agency_name is required' }, { status: 403 });
    }

    // Prefer the caller's agency row; never overwrite another tenant's newest row.
    let existing = [];
    if (agencyName) {
      existing = await base44.asServiceRole.entities.PDGMRateConfig
        .filter({ agency_name: agencyName }, '-created_date', 1).catch(() => []);
    }
    if (!existing?.length && !isAgencyScoped) {
      // Only touch a legacy unscoped row when it is unambiguously the only
      // candidate — never clobber another tenant's newest row.
      const newest = await base44.asServiceRole.entities.PDGMRateConfig
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

    // Persist only the known fields. The editor identity is taken from the
    // authenticated caller — never a posted `updated_by_email`. `rates` /
    // `icd10_clinical_groups` are stored as-is (the handler's mergePdgmRates /
    // effectiveIcdGroups overlay them on the built-in defaults at calc time, so a
    // partial or empty object is safe); reject non-objects so a malformed payload
    // can't poison the merge.
    const payload = {
      label: typeof label === 'string' ? label : '',
      effective_year: typeof effective_year === 'string' ? effective_year : '',
      is_official: is_official === true,
      notes: typeof notes === 'string' ? notes : '',
      rates: isPlainObject(rates) ? rates : {},
      icd10_clinical_groups: isPlainObject(icd10_clinical_groups) ? icd10_clinical_groups : {},
      // REFERENCE-ONLY uploaded CMS case-mix weight table (see the entity schema):
      // feeds the admin HIPPS reconciliation preview only — never a second payment
      // figure. Preserve-unless-sent: a caller that omits the field keeps the
      // stored table (so a rates-only save can't silently wipe it); an explicit
      // null (or any non-object) clears it; an object replaces it.
      case_mix_weight_table: case_mix_weight_table === undefined
        ? (isPlainObject(current?.case_mix_weight_table) ? current.case_mix_weight_table : null)
        : (isPlainObject(case_mix_weight_table) ? case_mix_weight_table : null),
      // Agency-imported CBSA wage-index table (see the entity schema): matched
      // by the referral brief and passed explicitly to calculatePDGM. Same
      // preserve-unless-sent semantics as case_mix_weight_table, so a
      // rates-only save can't silently wipe it and an explicit null clears it.
      wage_index_table: wage_index_table === undefined
        ? (isPlainObject(current?.wage_index_table) ? current.wage_index_table : null)
        : (isPlainObject(wage_index_table) ? wage_index_table : null),
      updated_by_email: user.email || null,
      ...(agencyName ? { agency_name: agencyName } : {}),
    };
    const saved = current?.id
      ? await base44.asServiceRole.entities.PDGMRateConfig.update(current.id, payload)
      : await base44.asServiceRole.entities.PDGMRateConfig.create(payload);

    return Response.json({ success: true, id: saved?.id || current?.id || null });
  } catch (error) {
    console.error('Error saving PDGM rate config:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});