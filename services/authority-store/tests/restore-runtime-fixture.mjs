import assert from 'node:assert/strict';
import { APP, request, digest } from './restore-rehearsal.mjs';

async function call(db, name, args) {
  return (await db.query(`select public.cm_integration_${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) result`, args)).rows[0].result;
}
async function server(db, run) {
  await db.query('begin');
  try {
    await db.query('set local role service_role'); const value = await run();
    await db.query('commit'); return value;
  } catch (error) { await db.query('rollback'); throw error; }
}
export async function seedRuntime(db) {
  const subject = digest('Synthetic local subject A'), otherSubject = digest('Synthetic local subject B');
  const hash = digest('Synthetic runtime request'), files = [];
  for (const n of [1, 2, 3]) {
    const id = request(n + 30), owner = n === 3 ? otherSubject : subject;
    const objectPath = `${APP}/${owner}/${id}`, bytes = Buffer.from(`Synthetic metadata fixture ${n}\n`);
    await server(db, () => call(db, 'file_record', [id, APP, owner, objectPath, 'text/plain', bytes.length, digest(bytes)]));
    await db.query('insert into storage.objects(bucket_id,name) values($1,$2)', ['pennsync-external-integrations', objectPath]);
    const record = await server(db, () => call(db, 'file_get', [id, APP, owner]));
    files.push({ id, owner, record });
  }
  const jobs = [];
  for (const [n, state] of [[1, 'completed'], [2, 'uncertain'], [3, 'failed'], [4, 'completed']]) {
    const id = `synthetic-restore-${n}`, claim = request(n + 40);
    const created = await server(db, () => call(db, 'reserve', [APP, subject, 'UploadPrivateFile', id, hash, claim, 100]));
    assert.equal(created.outcome, 'owned');
    assert.equal(await server(db, () => call(db, 'finish', [created.id, claim, state, state === 'completed' ? 'Synthetic opaque result marker' : null])), true);
    if (state === 'failed') await db.query('update public.cm_integration_jobs set attempt_count=3 where id=$1', [created.id]);
    if (n === 4) await db.query("update public.cm_integration_jobs set result_expires_at=now()-interval '1 hour' where id=$1", [created.id]);
    jobs.push({ id: created.id, request: id, outcome: n === 4 ? 'uncertain' : state });
  }
  await db.query("create table public.restore_unrelated_fixture(id integer primary key,note text not null); insert into public.restore_unrelated_fixture values(1,'Synthetic unrelated data retained')");
  return { subject, otherSubject, hash, files, jobs };
}

export async function proveRuntime(db, fixture) {
  const { subject, otherSubject, hash, files, jobs } = fixture;
  for (const file of files) {
    const restored = await server(db, () => call(db, 'file_get', [file.id, APP, file.owner]));
    assert.equal(digest(JSON.stringify(restored)), digest(JSON.stringify(file.record)));
    assert.equal(await server(db, () => call(db, 'file_get', [file.id, APP, file.owner === subject ? otherSubject : subject])), null);
    assert.equal(await server(db, () => call(db, 'file_get', [file.id, 'foreign-app', file.owner])), null);
    await assert.rejects(() => server(db, () => call(db, 'file_record', [file.id, APP, file.owner, file.record.object_path,
      file.record.content_type, file.record.size_bytes, file.record.sha256])), error => error.code === '23505');
  }
  for (const job of jobs) {
    const result = await server(db, () => call(db, 'reserve', [APP, subject, 'UploadPrivateFile', job.request, hash, request(70), 100]));
    assert.equal(result.id, job.id); assert.equal(result.outcome, job.outcome);
    if (job.outcome === 'completed') assert.equal(result.result, 'Synthetic opaque result marker');
    else assert.ok(result.result == null);
    assert.equal(await server(db, () => call(db, 'finish', [job.id, request(71), 'completed', 'Synthetic stale claim'])), false);
  }
  const conflict = await server(db, () => call(db, 'reserve', [APP, subject, 'UploadPrivateFile', jobs[0].request, digest('Synthetic different request'), request(72), 100]));
  assert.equal(conflict.outcome, 'conflict');
  const quota = await server(db, () => call(db, 'reserve', [APP, subject, 'UploadPrivateFile', 'new-quota-blocked', hash, request(73), 4]));
  assert.equal(quota.outcome, 'quota');
  for (const role of ['anon', 'authenticated']) {
    for (const table of ['cm_integration_jobs', 'cm_integration_files', 'cm_integration_daily_budget']) {
      await db.query('begin');
      try {
        await db.query(`set local role ${role}`);
        await assert.rejects(() => db.query(`select * from public.${table}`), error => error.code === '42501');
      } finally { await db.query('rollback'); }
    }
    await db.query('begin');
    try {
      await db.query(`set local role ${role}`);
      assert.equal((await db.query("select * from storage.objects where bucket_id='pennsync-external-integrations'")).rowCount, 0);
      await assert.rejects(() => call(db, 'file_get', [files[0].id, APP, subject]), error => error.code === '42501');
    } finally { await db.query('rollback'); }
  }
  return { runtime_job_outcomes_preserved: jobs.length, private_file_metadata_preserved: files.length,
    file_owner_and_app_denials: true, file_metadata_duplicates_denied: true,
    runtime_claim_payload_quota_preserved: true, browser_runtime_table_and_rpc_denials: true,
    restrictive_storage_policy_preserved: true };
}
