// Explicit fictional context and committed disclosures only. No source/customer
// reads, inferred chart fields, provider sessions or hosted write are involved.
import assert from 'node:assert/strict';
import { patientContexts, seedPatientContexts } from './patient-context-fixture.mjs';
import { APP, uid, sid, actor, rpc, digest } from './restore-rehearsal.mjs';

const purposes = ['display', 'smart_note_context'];
const count = async db => (await db.query('select count(*)::integer as n from pennsync_private.patient_disclosure_audit')).rows[0].n;
const contexts = async db => (await db.query(`select to_jsonb(c) as record,c.data::text as canonical
  from pennsync_private.patient_context c order by patient_id collate "C"`)).rows;
const audits = async db => (await db.query('select to_jsonb(a) as record from pennsync_private.patient_disclosure_audit a order by id')).rows.map(row => row.record);
const exact = (actual, expected, label) => assert.equal(digest(JSON.stringify(actual)), digest(JSON.stringify(expected)), label);
const scopeKeys = ['agency_id', 'membership_id', 'membership_version', 'tenant_role'];
async function claims(db, n) {
  await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid(n), session_id: sid(n),
    role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })]);
  await db.query('set local role authenticated');
}
async function rollback(db, run) {
  await db.query('begin');
  try { return await run(); } finally { await db.query('rollback'); }
}

export async function seedPatientDisclosures(db) {
  const explicit = patientContexts.filter(record => record.patientId !== 'patient-a2')
    .map(record => ({ ...record, version: record.patientId === 'patient-a1' ? 3 : 2 }));
  assert.deepEqual(explicit.map(record => record.patientId), ['patient-a1', 'patient-b1']);
  await seedPatientContexts(db, explicit);
  const stored = await contexts(db);
  for (const { record, canonical } of stored) {
    const fixture = explicit.find(value => value.patientId === record.patient_id);
    assert.deepEqual(record.data, fixture.data);
    assert.equal(Number(record.version), fixture.version, 'Non-default context revisions are retained');
    assert.equal(record.provenance_kind, 'synthetic_fixture');
    assert.equal(record.provenance_sha256, digest(`LOCAL_SYNTHETIC_PATIENT_CONTEXT:${fixture.patientId}:${JSON.stringify(fixture.data)}`));
    assert.equal(record.data_sha256, digest(canonical), 'Digest binds actual stored JSONB bytes, not raw source JSON');
  }
  const reads = [];
  for (const [reader, agency, patient] of [[1, 'agency-a', 'patient-a1'], [2, 'agency-a', 'patient-a1'], [4, 'agency-b', 'patient-b1']]) {
    const data = explicit.find(value => value.patientId === patient).data;
    for (const purpose of purposes) {
      const args = [APP, agency, patient, purpose];
      const result = await actor(db, reader, () => rpc(db, 'patient_context', args));
      assert.deepEqual(result.patient, purpose === 'display'
        ? Object.fromEntries(Object.entries(data).filter(([key]) => ['id', 'first_name', 'middle_name', 'last_name'].includes(key))) : data);
      assert.deepEqual(result.scope, Object.fromEntries(scopeKeys.map(key => [key, result.context[key]])));
      assert.equal(result.auth_user_id, uid(reader)); assert.equal(result.purpose, purpose);
      reads.push({ reader, args, result });
    }
  }
  assert.equal(await count(db), 6);
  return { stored, reads, audits: await audits(db) };
}

export async function provePatientDisclosures(db, fixture) {
  exact(await contexts(db), fixture.stored, 'Context values, canonical bytes, versions, provenance and creation time restored exactly');
  exact(await audits(db), fixture.audits, 'All committed patient disclosure identities and fields restored exactly');
  for (const { record, canonical } of await contexts(db)) assert.equal(record.data_sha256, digest(canonical));
  const before = await count(db); assert.equal(before, 6);
  for (const { reader, args, result } of fixture.reads) {
    await actor(db, reader, async () => {
      const restored = await rpc(db, 'patient_context', args);
      exact(restored, result, 'Restored purpose projection retains absent fields, Unicode and explicit false/zero values');
      await db.query('reset role');
      assert.equal(await count(db), before + 1, 'Current authorized read appends audit before returning');
      const inserted = (await db.query(`select * from pennsync_private.patient_disclosure_audit
        where id<>all($1::uuid[])`, [fixture.audits.map(row => row.id)])).rows;
      assert.equal(inserted.length, 1);
      const stored = fixture.stored.find(value => value.record.patient_id === args[2]).record;
      const audit = inserted[0];
      assert.equal(audit.actor_id, uid(reader)); assert.equal(audit.patient_id, args[2]); assert.equal(audit.purpose, args[3]);
      assert.equal(Number(audit.context_version), Number(stored.version)); assert.equal(audit.context_sha256, stored.data_sha256);
      for (const key of scopeKeys) assert.equal(String(audit[key]), String(result.scope[key]));
      const sourceAudit = fixture.audits.find(row => row.actor_id === uid(reader) && row.purpose === args[3]);
      assert.equal(audit.assignment_id, sourceAudit.assignment_id);
      assert.equal(String(audit.assignment_version), String(sourceAudit.assignment_version));
      assert.equal(audit.access_basis, sourceAudit.access_basis);
    }, { rollback: true });
  }
  const denials = [[3, 'agency-a', 'patient-a1'], [2, 'agency-a', 'patient-a2'], [1, 'agency-a', 'patient-a2'],
    [1, 'agency-a', 'patient-b1'], [4, 'agency-b', 'patient-a1'], [1, 'agency-b', 'patient-b1']];
  for (const [reader, agency, patient] of denials) for (const purpose of purposes) {
    await assert.rejects(() => actor(db, reader, () => rpc(db, 'patient_context', [APP, agency, patient, purpose])),
      error => error.code === '42501' && (reader !== 1 || patient !== 'patient-a2' || error.message === 'PENNSYNC_PATIENT_CONTEXT_UNAVAILABLE'));
  }
  assert.equal(await count(db), before, 'Denied or missing-context reads do not append disclosures');
  for (const role of ['anon', 'service_role']) {
    for (const table of ['patient_context', 'patient_disclosure_audit']) await rollback(db, async () => {
      await db.query(`set local role ${role}`);
      await assert.rejects(() => db.query(`select * from pennsync_private.${table}`), error => error.code === '42501');
    });
    await rollback(db, async () => {
      await db.query(`set local role ${role}`);
      await assert.rejects(() => rpc(db, 'patient_context', [APP, 'agency-a', 'patient-a1', 'display']), error => error.code === '42501');
    });
  }
  for (const table of ['patient_context', 'patient_disclosure_audit']) for (const statement of [
    `update pennsync_private.${table} set patient_id=patient_id`, `delete from pennsync_private.${table}`,
  ]) await rollback(db, async () => {
    await assert.rejects(() => db.query(statement), error => error.code === '23514' && error.message === 'PENNSYNC_PATIENT_CONTEXT_IMMUTABLE');
  });
  for (const [statement, code] of [
    [`delete from auth.sessions where id='${sid(2)}'`, '28000'],
    ["update pennsync_private.assignment set status='revoked',version=version+1 where membership_id='membership-2' and patient_id='patient-a1'", '42501'],
  ]) for (const purpose of purposes) await rollback(db, async () => {
    await db.query('select pg_advisory_xact_lock(168344,20260918)'); await db.query(statement); await claims(db, 2);
    await assert.rejects(() => rpc(db, 'patient_context', [APP, 'agency-a', 'patient-a1', purpose]), error => error.code === code);
  });
  await rollback(db, async () => {
    await db.query(`create function pennsync_private.local_restore_patient_audit_failure() returns trigger
      language plpgsql set search_path='' as $$ begin raise exception 'LOCAL_SYNTHETIC_RESTORE_AUDIT_FAILURE'; end $$;
      create trigger local_restore_failure before insert on pennsync_private.patient_disclosure_audit
      for each row execute function pennsync_private.local_restore_patient_audit_failure()`);
    await claims(db, 1);
    await assert.rejects(() => rpc(db, 'patient_context', [APP, 'agency-a', 'patient-a1', 'smart_note_context']),
      error => error.code === 'PT503' && error.message === 'PENNSYNC_PATIENT_AUDIT_UNAVAILABLE' && error.detail === undefined);
  });
  exact(await contexts(db), fixture.stored, 'All context probes preserve original values and provenance');
  exact(await audits(db), fixture.audits, 'All patient disclosure probes roll back their temporary writes');
  return { restored_explicit_patient_contexts: 2, patient_context_data_and_provenance_preserved: true,
    restored_patient_disclosure_audits: 6, restored_current_authority_patient_reads: fixture.reads.length,
    patient_disclosure_append_before_return: true, restored_patient_context_denials: denials.length * purposes.length,
    patient_context_missing_fields_not_inferred: true, patient_context_immutable_guards_preserved: true,
    patient_context_anon_service_denials: true, patient_context_revocation_denials: 4,
    patient_context_audit_failure_withheld: true };
}
