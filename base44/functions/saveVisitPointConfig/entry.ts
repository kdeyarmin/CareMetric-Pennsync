import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * saveVisitPointConfig — admin upsert of the facility's per-visit-type point
 * values (SOC, ROC, Recert, Routine, Discharge). Home-health nurses enter visit
 * counts by type on their timesheet; the server multiplies those by these values
 * to compute total points. One active config row per facility.
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
    if (user.role !== 'admin') {
      return Response.json({ error: 'Only administrators can set visit point values.' }, { status: 403 });
    }

    const body = (await req.json()) || {};
    const fields = { active: true, notes: String(body.notes || '').slice(0, 1000) };
    for (const f of POINT_FIELDS) fields[f] = toNonNegativeNumber(body[f]);

    // One config per facility: update the existing (active) row, else create it.
    const existing = await base44.asServiceRole.entities.VisitPointConfig.list('-updated_date', 50).catch(() => []);
    const target = (existing || []).find((c) => c && c.active !== false) || (existing || [])[0];

    let saved;
    if (target) {
      saved = await base44.asServiceRole.entities.VisitPointConfig.update(target.id, fields);
    } else {
      saved = await base44.asServiceRole.entities.VisitPointConfig.create(fields);
    }

    return Response.json({ success: true, config: saved });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
