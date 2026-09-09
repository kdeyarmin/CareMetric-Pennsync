import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';

const APP_ID = '694ec16e72e01b60d22f7cbf';
const TARGETS = [
  {
    id: '6aa11ee84bff16a85fb9a703',
    membership_key: '6aa11eae0e1453e1047cf691:694ec16f72e01b60d22f7cc0',
    user_id: '694ec16f72e01b60d22f7cc0',
    agency_id: '6aa11eae0e1453e1047cf691',
  },
  {
    id: '6aa11f0ac9826ad877e60a02',
    membership_key: '__cleanup_probe_never_authority__',
    user_id: '__invalid__',
    agency_id: '__invalid__',
  },
];

const noStore = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { ...noStore, Allow: 'POST' } });
  }
  if (req.headers.get('Base44-App-Id') !== APP_ID) {
    return Response.json({ error: 'Not found' }, { status: 404, headers: noStore });
  }
  const base44 = createClientFromRequest(req);
  const entity = base44.asServiceRole.entities.AgencyMembership;
  let removed = 0;
  for (const expected of TARGETS) {
    const rows = await entity.filter({ id: expected.id }, undefined, 2);
    if (!Array.isArray(rows) || rows.length > 1) {
      return Response.json({ error: 'Cleanup precondition failed' }, { status: 409, headers: noStore });
    }
    if (rows.length === 0) continue;
    const row = rows[0];
    if (
      row.id !== expected.id
      || row.membership_key !== expected.membership_key
      || row.user_id !== expected.user_id
      || row.agency_id !== expected.agency_id
    ) {
      return Response.json({ error: 'Cleanup precondition failed' }, { status: 409, headers: noStore });
    }
    await entity.delete(expected.id);
    const after = await entity.filter({ id: expected.id }, undefined, 2);
    if (!Array.isArray(after) || after.length !== 0) {
      return Response.json({ error: 'Cleanup verification failed' }, { status: 500, headers: noStore });
    }
    removed += 1;
  }
  return Response.json({ success: true, removed, scope: 'bootstrap_artifacts_only' }, { headers: noStore });
});
