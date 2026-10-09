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
  // 007's provider credential. TWO versions deliberately: the history is
  // append-only, so a restore that brought back only the active row would
  // satisfy a one-row fixture and lose exactly what the table exists to keep.
  // The sealed values are synthetic markers, not real ciphertext -- what is
  // under test is that the bytes come back identical, not that they decrypt.
  const credentials = [];
  for (const n of [1, 2]) {
    const version = await server(db, () => call(db, 'credential_put', [request(n + 50), APP, 'telnyx',
      `Synthetic sealed credential marker ${n}`, `000${n}`, null, `profile-${n}`, null, `faxconn-${n}`,
      `operator-${n}@synthetic.test`]));
    credentials.push({ version: Number(version), sealed: `Synthetic sealed credential marker ${n}` });
  }
  assert.deepEqual(credentials.map(entry => entry.version), [1, 2]);
  return { subject, otherSubject, hash, files, jobs, credentials };
}

export async function proveRuntime(db, fixture) {
  const { subject, otherSubject, hash, files, jobs, credentials } = fixture;
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
  // 007's credential, whose whole point is the history and the one-way
  // retirement. Every probe here either reads or is rolled back, because the
  // caller fingerprints the database again after this function returns.
  const active = await server(db, () => call(db, 'credential_active', [APP, 'telnyx']));
  assert.equal(active.api_key_sealed, credentials.at(-1).sealed);
  assert.equal(Number(active.version), credentials.at(-1).version);
  const status = await server(db, () => call(db, 'credential_status', [APP, 'telnyx']));
  assert.equal(status.api_key_sealed, undefined);
  assert.deepEqual({ ...status, recorded_at: typeof status.recorded_at },
    { provider: 'telnyx', version: 2, api_key_last_four: '0002', public_key_configured: false,
      messaging_profile_configured: true, voice_connection_configured: false, fax_connection_configured: true,
      updated_by: 'operator-2@synthetic.test', recorded_at: 'string' });
  // The retired version is still here, with its own sealed bytes: the restore
  // brought back the history and not just the row the getter returns.
  const history = (await db.query(`select version,is_active,api_key_sealed,deactivated_at is not null as retired
    from public.cm_integration_credential where app_id=$1 and provider='telnyx' order by version`, [APP])).rows;
  assert.deepEqual(history.map(row => [Number(row.version), row.is_active, row.api_key_sealed, row.retired]),
    credentials.map((entry, index) => [entry.version, index === credentials.length - 1, entry.sealed, index !== credentials.length - 1]));
  // The catalog objects came back too, which a data-only comparison cannot see:
  // a restored table with no trigger and no partial index accepts both of these.
  await db.query('begin');
  try {
    await assert.rejects(() => db.query("update public.cm_integration_credential set api_key_sealed='Synthetic swap' where is_active"),
      error => error.message === 'Credential rotation records a new version');
  } finally { await db.query('rollback'); }
  await db.query('begin');
  try {
    await assert.rejects(() => db.query(`insert into public.cm_integration_credential
      (id,app_id,provider,version,api_key_sealed,api_key_last_four,updated_by)
      values($1,$2,'telnyx',99,'Synthetic second active','9999','operator-3@synthetic.test')`, [request(59), APP]),
    error => error.code === '23505');
  } finally { await db.query('rollback'); }
  for (const role of ['anon', 'authenticated']) {
    for (const rpcName of ['credential_active', 'credential_status']) {
      await db.query('begin');
      try {
        await db.query(`set local role ${role}`);
        await assert.rejects(() => call(db, rpcName, [APP, 'telnyx']), error => error.code === '42501');
      } finally { await db.query('rollback'); }
    }
  }
  for (const role of ['anon', 'authenticated']) {
    for (const table of ['cm_integration_jobs', 'cm_integration_files', 'cm_integration_daily_budget', 'cm_integration_credential']) {
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
    restrictive_storage_policy_preserved: true,
    provider_credential_versions_preserved: credentials.length,
    provider_credential_append_only_preserved: true, provider_credential_single_active_preserved: true };
}
