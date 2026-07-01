import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * savePDGMRateConfig — the ONLY write path for the admin-editable PDGM rate set.
 *
 * The PDGMRateConfig entity is service-role-write only (see its RLS), so it can't
 * be written directly from the browser. This function is the gated server-side
 * writer, mirroring how saveTwilioSecret guards the IntegrationSecret entity.
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
const SUPER_ADMIN_EMAIL = ((typeof Deno !== 'undefined' && Deno.env.get('SUPER_ADMIN_EMAIL')) || '').trim().toLowerCase();
const sameEmail = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const isAdminLike = (u) => !!u && (
  u.role === 'admin' || u.account_type === 'agency_admin' ||
  u.account_type === 'super_admin' || (SUPER_ADMIN_EMAIL !== '' && sameEmail(u.email, SUPER_ADMIN_EMAIL))
);
// <<<END SHARED HELPER: isAdminLike>>>

const isPlainObject = (v) =>
  !!v && typeof v === 'object' && !Array.isArray(v);

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const user = await base44.auth.me().catch(() => null);
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!isAdminLike(user)) {
      return Response.json({ error: 'Forbidden: admin access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const { label, effective_year, is_official, notes, rates, icd10_clinical_groups } = body || {};

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
      updated_by_email: user.email || null,
    };

    // Single-row config: update the most recent row if one exists, else create.
    // The id is derived server-side (not trusted from the body), matching how the
    // page loads `list('-created_date', 1)`.
    const existing = await base44.asServiceRole.entities.PDGMRateConfig.list('-created_date', 1).catch(() => []);
    const current = existing?.[0];
    const saved = current?.id
      ? await base44.asServiceRole.entities.PDGMRateConfig.update(current.id, payload)
      : await base44.asServiceRole.entities.PDGMRateConfig.create(payload);

    return Response.json({ success: true, id: saved?.id || current?.id || null });
  } catch (error) {
    console.error('Error saving PDGM rate config:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});