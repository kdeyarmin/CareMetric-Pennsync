import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


/**
 * saveVisitPointConfig — admin upsert of the facility's per-visit-type point
 * values (SOC, ROC, Recert, Routine, Discharge). Home-health nurses enter visit
 * counts by type on their timesheet; the server multiplies those by these values
 * to compute total points. One active config row per agency (or one global row
 * for platform admins without an agency).
 *
 * Admin-only. Point VALUES are units of work (not dollars or wage rates) — this
 * system holds no pay rates.
 */

const POINT_FIELDS = ['soc_points', 'roc_points', 'recert_points', 'routine_points', 'discharge_points'];

function toNonNegativeNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : Math.round(n * 100) / 100;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    // Admin = role 'admin' or an admin account_type (agency/super), matching the
    // app's role model (src/lib/roles.js) and other backend admin gates.
    const isAdmin = user.role === 'admin' || user.account_type === 'super_admin' || user.account_type === 'agency_admin';
    if (!isAdmin) {
      return Response.json({ error: 'Only administrators can set visit point values.' }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) || {};

    // Guard against empty payloads: an accidental invocation with no body
    // would overwrite the facility's point config with all zeros.
    if (Object.keys(body).length === 0) {
      return Response.json({ error: 'Request body is required' }, { status: 400 });
    }

    const agencyName = String(user.agency_name || '').trim();
    const isAgencyScoped = user.account_type !== 'super_admin'
      && agencyName
      && (user.account_type === 'agency_admin' || user.role === 'admin');
    // Only agency_admin accounts require agency_name. Bare role:admin with no
    // agency is platform-wide and may manage the unscoped legacy config row.
    if (user.account_type === 'agency_admin' && !agencyName) {
      return Response.json({ error: 'Forbidden: agency_name is required' }, { status: 403 });
    }

    const fields = {
      active: true,
      notes: String(body.notes || '').slice(0, 1000),
      ...(agencyName ? { agency_name: agencyName } : {}),
    };
    for (const f of POINT_FIELDS) fields[f] = toNonNegativeNumber(body[f]);

    // Prefer the caller's agency row; never overwrite another tenant's newest row.
    let existing = [];
    if (agencyName) {
      existing = await base44.asServiceRole.entities.VisitPointConfig
        .filter({ agency_name: agencyName }, '-updated_date', 50).catch(() => []);
    }
    if (!existing?.length && !isAgencyScoped) {
      // Only touch a legacy unscoped row when it is unambiguously the only
      // candidate — never clobber another tenant's newest row.
      const newest = await base44.asServiceRole.entities.VisitPointConfig
        .list('-updated_date', 50).catch(() => []);
      const legacy = (newest || []).filter((r) => !String(r?.agency_name || '').trim());
      // Adopt a single UNSCOPED legacy row only. The removed `length <= 1` arm
      // also adopted a lone TENANT-scoped row, so a platform admin (no agency)
      // saving config silently overwrote that agency's point math. Fall through
      // to create a new unscoped row instead, matching saveFollowUpRuleConfig /
      // savePDGMRateConfig.
      if (legacy.length === 1) existing = legacy;
      else existing = [];
    }
    const target = (existing || []).find((c) => c && c.active !== false) || (existing || [])[0];

    let saved;
    if (target) {
      saved = await base44.asServiceRole.entities.VisitPointConfig.update(target.id, fields);
    } else {
      saved = await base44.asServiceRole.entities.VisitPointConfig.create(fields);
    }

    return Response.json({ success: true, config: saved });
  } catch (error) {
    console.error('saveVisitPointConfig failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
