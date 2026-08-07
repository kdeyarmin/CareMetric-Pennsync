import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


// Operational debug logs are compiled out in production (the FUNCTIONS_DEBUG
// secret was retired). console.error/warn remain ungated for visibility.
const debugLog = (..._args) => {};

// One-time, idempotent backfill: turn TCPA quiet hours ON for existing agencies
// that never configured it, so the legally-safer default enforces immediately in
// the outbound SMS paths (which gate on `tcpa_quiet_hours_enabled === true`).
// An explicit `false` means an admin deliberately disabled it — respect that.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    
    // Platform-wide TCPA default backfill — only super_admin. Facility admins
    // must not flip every tenant's AgencySettings via service role.
    if (!user || user.account_type !== 'super_admin') {
      return Response.json({ error: 'Super admin access required' }, { status: 403 });
    }

    const settingsList = await base44.asServiceRole.entities.AgencySettings.list('-created_date', 500);
    let updated = 0;

    for (const s of settingsList) {
      // Only backfill records that have NEVER set the flag (undefined/null).
      if (s.tcpa_quiet_hours_enabled === true || s.tcpa_quiet_hours_enabled === false) continue;
      await base44.asServiceRole.entities.AgencySettings.update(s.id, {
        tcpa_quiet_hours_enabled: true,
        tcpa_quiet_start_hour: s.tcpa_quiet_start_hour ?? 8,
        tcpa_quiet_end_hour: s.tcpa_quiet_end_hour ?? 21,
      });
      updated += 1;
    }

    debugLog(`TCPA quiet-hours backfill: ${updated}/${settingsList.length} updated`);
    return Response.json({ success: true, updated_count: updated, total: settingsList.length });
  } catch (error) {
    console.error('backfillTcpaQuietHours failed:', error?.message);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});