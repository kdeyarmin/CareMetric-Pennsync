import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Operational logs are gated behind FUNCTIONS_DEBUG so they don't run in
// production by default. console.error/warn remain ungated for visibility.
const DEBUG = !!Deno.env.get('FUNCTIONS_DEBUG');
const debugLog = (...args) => { if (DEBUG) console.log(...args); };

// One-time, idempotent backfill: turn TCPA quiet hours ON for existing agencies
// that never configured it, so the legally-safer default enforces immediately in
// the outbound SMS paths (which gate on `tcpa_quiet_hours_enabled === true`).
// An explicit `false` means an admin deliberately disabled it — respect that.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
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
    return Response.json({ error: error.message }, { status: 500 });
  }
});