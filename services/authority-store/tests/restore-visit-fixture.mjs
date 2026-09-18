// The fixture preserves real server-generated synthetic assignment identities
// and committed disclosure rows, without claiming customer/provider restoration.
import assert from 'node:assert/strict';
import { APP, actor, rpc, digest } from './restore-rehearsal.mjs';

const count = async db => (await db.query('select count(*)::integer as n from pennsync_private.visit_disclosure_audit')).rows[0].n;
export async function seedVisitDisclosures(db, artifacts) {
  const records = [];
  for (const { n, args, result } of artifacts) {
    // Admin reads a clinician-created Visit, clinician reads an admin-created
    // Visit. Neither supplies the author's request ID or original scope version.
    const reader = n === 1 ? 2 : n === 2 ? 1 : 4;
    const readArgs = [APP, args[1], result.artifacts.visit.id];
    const projection = await actor(db, reader, () => rpc(db, 'visit_documentation', readArgs));
    assert.equal(projection.visit.nurse_notes, result.artifacts.visit.nurse_notes);
    assert.deepEqual(projection.visit.vital_signs, result.artifacts.visit.vital_signs);
    assert.equal(projection.scope.patient_id, result.artifacts.visit.patient_id);
    records.push({ reader, readArgs, projection });
  }
  assert.equal(await count(db), 3);
  return records;
}

export async function proveVisitDisclosures(db, records) {
  const before = await count(db); assert.equal(before, 3);
  for (const { reader, readArgs, projection } of records) {
    // Rollback only this test probe after observing its inserted audit. The
    // three source disclosures were committed and are covered by the dump.
    await actor(db, reader, async () => {
      const result = await rpc(db, 'visit_documentation', readArgs);
      assert.equal(digest(JSON.stringify(result)), digest(JSON.stringify(projection)), 'Restored current-authority Visit projection and stable assignment identity');
      await db.query('reset role');
      assert.equal(await count(db), before + 1, 'Successful read appends its disclosure before returning');
    }, { rollback: true });
  }
  assert.equal(await count(db), before);
  return { restored_current_authority_visit_reads: 3, stable_assignment_identity_preserved: true,
    restored_disclosure_audits: 3, disclosure_append_before_return: true };
}
