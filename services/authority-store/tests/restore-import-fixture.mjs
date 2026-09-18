// Representative synthetic import provenance only. This fixture does not run
// the archive importer or broaden its separate owned-target boundary.
import assert from 'node:assert/strict';
import { patientProjectionSha256 } from '../../../tools-pennsync-archive-import.mjs';
import { APP, actor, rpc, digest } from './restore-rehearsal.mjs';

export const importPatients = Object.freeze([
  Object.freeze({ id: 'f100000000000000000000001', agency_id: 'agency-a', display_name: 'Synthetic Archive Patient A', synthetic: true, version: 1, status: 'active' }),
  Object.freeze({ id: 'f200000000000000000000002', agency_id: 'agency-b', display_name: 'Synthetic Archive Patient B', synthetic: true, version: 1, status: 'active' }),
]);
const readReceipt = async (db, planHash) => (await db.query(
  'select to_jsonb(r) as receipt from pennsync_private.archive_patient_import_receipt r where app_id=$1 and plan_sha256=$2',
  [APP, planHash])).rows[0]?.receipt;

export async function seedImportReceipt(db) {
  const planHash = digest('Synthetic restore fixture plan; no supplied archive verified');
  const ownerHash = digest('Synthetic restore fixture owner; no importer ownership token');
  const projectionHash = patientProjectionSha256(importPatients);
  assert.equal(projectionHash, digest(JSON.stringify(importPatients)), 'Known ordered projection has the documented digest');
  await db.query('begin');
  try {
    await db.query('select pg_advisory_xact_lock(168344,20260918)');
    for (const patient of importPatients) await db.query(
      'insert into pennsync_private.patient(app_id,id,agency_id,display_name,synthetic,version,status) values($1,$2,$3,$4,$5,$6,$7)',
      [APP, patient.id, patient.agency_id, patient.display_name, patient.synthetic, patient.version, patient.status]);
    await db.query(`insert into pennsync_private.archive_patient_import_receipt
      (app_id,plan_sha256,owner_sha256,projection_sha256,patient_count,state) values($1,$2,$3,$4,$5,'applied')`,
    [APP, planHash, ownerHash, projectionHash, importPatients.length]);
    await db.query('commit');
  } catch (error) { await db.query('rollback'); throw error; }
  return { planHash, receipt: await readReceipt(db, planHash) };
}

export async function proveImportReceipt(db, { planHash, receipt }) {
  const restored = await readReceipt(db, planHash);
  assert.equal(digest(JSON.stringify(restored)), digest(JSON.stringify(receipt)), 'Every import provenance field is preserved');
  const patients = (await db.query(`select id,agency_id,display_name,synthetic,version::integer,status
    from pennsync_private.patient where app_id=$1 and id=any($2::text[]) order by id collate "C"`,
  [APP, importPatients.map(patient => patient.id)])).rows;
  assert.deepEqual(patients, importPatients);
  assert.equal(restored.projection_sha256, digest(JSON.stringify(patients)), 'Restored patient rows match receipt projection hash');
  assert.equal(restored.patient_count, patients.length);
  assert.equal(restored.state, 'applied');
  assert.equal(restored.rolled_back_at, null);
  const database = (await db.query('select current_database() as name')).rows[0].name;
  assert.notEqual(restored.database_name, database, 'Restoration retains source binding, never silently rebinds importer ownership');
  for (const [index, n] of [[0, 1], [1, 4]]) {
    const patient = importPatients[index];
    const result = await actor(db, n, () => rpc(db, 'patient', [APP, patient.agency_id, patient.id]));
    assert.deepEqual(result.patient, { id: patient.id, agency_id: patient.agency_id,
      display_name: patient.display_name, version: 1, synthetic: true });
  }
  for (const [n, agency, patient] of [[2, 'agency-a', importPatients[0]], [3, 'agency-a', importPatients[0]],
    [1, 'agency-a', importPatients[1]], [4, 'agency-b', importPatients[0]]]) {
    await assert.rejects(() => actor(db, n, () => rpc(db, 'patient', [APP, agency, patient.id])), error => error.code === '42501');
  }
  for (const role of ['anon', 'service_role']) {
    await db.query('begin');
    try {
      await db.query(`set local role ${role}`);
      await assert.rejects(() => db.query('select * from pennsync_private.archive_patient_import_receipt'), error => error.code === '42501');
    } finally { await db.query('rollback'); }
  }
  return { import_receipt_fields_preserved: true, import_patient_projection_hash: true,
    import_receipt_source_database_binding_retained: true, import_patient_admin_reads: 2,
    import_patient_scope_denials: 4, import_receipt_anon_service_denials: true };
}
