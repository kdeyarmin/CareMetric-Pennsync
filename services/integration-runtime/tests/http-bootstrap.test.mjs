// Actual disposable Supabase catalogs/gateway. No platform doubles are loaded.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { localStatus, API } from '../../authority-store/tests/http-local-stack.mjs';

test('recovered runtime migrations bootstrap actual isolated Supabase catalogs and RPCs', { timeout: 60000 }, async () => {
  const status = await localStatus(); // Requires pinned local daemon and this harness's ownership marker.
  const db = new pg.Client({ connectionString: status.DB_URL, statement_timeout: 10000, connectionTimeoutMillis: 10000 });
  let phase = 'connect';
  let retentionWasAbsent = false;
  const requireTrue = (value, code) => { if (!value) throw new Error(code); };
  const pauseOwnedRetention = async () => {
    if (!retentionWasAbsent) return;
    try {
      await db.query('rollback');
      const jobs = (await db.query("select jobid,command from cron.job where jobname='pennsync-integration-result-retention'")).rows;
      if (!jobs.length) return;
      requireTrue(jobs.length === 1 && jobs[0].command === 'select public.cm_integration_expire_results();', 'LOCAL_CRON_OWNERSHIP_MISMATCH');
      await db.query('select cron.alter_job($1,active:=false)', [jobs[0].jobid]);
    } catch { throw new Error('LOCAL_OWNED_CRON_CLEANUP_FAILED'); }
  };
  try {
    await db.connect();
    phase = 'real platform and empty integration namespace preconditions';
    const state = (await db.query(`select
      to_regclass('storage.buckets') is not null as buckets,
      to_regclass('storage.objects') is not null as objects,
      to_regprocedure('auth.uid()') is not null as native_auth,
      to_regprocedure('public.pennsync_integration_local_test_double()') is null as not_double,
      not exists(select 1 from pg_roles where rolname in ('anon','authenticated') and (rolsuper or rolbypassrls)) as safe_browser_roles,
      not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('cm_integration_jobs','cm_integration_files','cm_integration_daily_budget')) as no_tables,
      not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'cm_integration_%') as no_functions`)).rows[0];
    requireTrue(Object.values(state).every(value => value === true), 'LOCAL_REAL_PLATFORM_OR_EMPTY_NAMESPACE_REQUIRED');
    requireTrue((await db.query("select count(*)::integer as count from storage.buckets where id='pennsync-external-integrations'")).rows[0].count === 0, 'LOCAL_BUCKET_ALREADY_EXISTS');
    requireTrue((await db.query("select count(*)::integer as count from pg_policies where schemaname='storage' and tablename='objects' and policyname='pennsync external files require server authorization'")).rows[0].count === 0, 'LOCAL_BUCKET_POLICY_ALREADY_EXISTS');
    // Install the actual bundled pg_cron extension only in this owned disposable
    // database, and only when the server already preloads the real worker library.
    if (!(await db.query("select exists(select 1 from pg_extension where extname='pg_cron') as installed")).rows[0].installed) {
      const available = (await db.query("select exists(select 1 from pg_available_extensions where name='pg_cron') as available,current_setting('shared_preload_libraries') as preload")).rows[0];
      requireTrue(available.available && available.preload.split(',').some(name => name.trim() === 'pg_cron'), 'LOCAL_REAL_PG_CRON_REQUIRED');
      await db.query('create extension pg_cron with schema pg_catalog');
    }
    requireTrue((await db.query("select count(*)::integer as count from cron.job where jobname='pennsync-integration-result-retention'")).rows[0].count === 0, 'LOCAL_RETENTION_JOB_ALREADY_EXISTS');
    retentionWasAbsent = true;
    phase = 'apply recovered migrations to actual platform';
    const directory = new URL('../migrations/', import.meta.url);
    const files = (await readdir(directory)).filter(file => /^00[1-5]_.+\.sql$/.test(file)).sort();
    assert.equal(files.length, 5);
    for (const file of files) {
      await db.query(await readFile(new URL(file, directory), 'utf8'));
      if (file.startsWith('003_')) {
        const jobs = (await db.query("select jobid,schedule,command,active from cron.job where jobname='pennsync-integration-result-retention'")).rows;
        assert.equal(jobs.length, 1); assert.equal(jobs[0].schedule, '17 * * * *');
        assert.equal(jobs[0].command, 'select public.cm_integration_expire_results();'); assert.equal(jobs[0].active, true);
        await pauseOwnedRetention();
      }
    }
    const bucket = (await db.query("select public,file_size_limit::integer as max_bytes,allowed_mime_types from storage.buckets where id='pennsync-external-integrations'")).rows[0];
    assert.equal(bucket.public, false); assert.equal(bucket.max_bytes, 8388608); assert.equal(bucket.allowed_mime_types.length, 6);
    for (const table of ['cm_integration_jobs', 'cm_integration_files', 'cm_integration_daily_budget']) {
      const permissions = (await db.query(`select has_table_privilege('anon',$1,'SELECT,INSERT,UPDATE,DELETE') as anon,
        has_table_privilege('authenticated',$1,'SELECT,INSERT,UPDATE,DELETE') as authenticated,
        has_table_privilege('service_role',$1,'SELECT') and has_table_privilege('service_role',$1,'INSERT')
        and has_table_privilege('service_role',$1,'UPDATE') and has_table_privilege('service_role',$1,'DELETE') as server`, [`public.${table}`])).rows[0];
      assert.deepEqual(permissions, { anon: false, authenticated: false, server: true });
    }
    await db.query("notify pgrst, 'reload schema'");
    phase = 'real service and anonymous gateway RPC proof';
    const app = '6a9881683dc68a0bd54f1ef7'; const subject = 'a'.repeat(64); const claim = randomUUID();
    const rpc = async (name, body, privileged = true) => {
      const key = privileged ? status.SECRET_KEY : status.PUBLISHABLE_KEY;
      const response = await fetch(`${API}/rest/v1/rpc/cm_integration_${name}`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { apikey: key, ...(privileged ? { Authorization: `Bearer ${key}` } : {}), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    };
    const request = { p_app_id: app, p_subject: subject, p_operation: 'InvokeLLM', p_request_id: 'synthetic-bootstrap-http', p_payload_hash: 'b'.repeat(64), p_claim: claim, p_daily_limit: 10 };
    // Cache reload is asynchronous. Poll only the unauthenticated denial; never
    // retry a mutation whose outcome could be uncertain.
    let anonymous;
    for (let attempt = 0; attempt < 30; attempt++) {
      anonymous = await rpc('reserve', request, false);
      if (anonymous.status !== 404 || anonymous.body.code !== 'PGRST202') break;
      await delay(100);
    }
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.body.code, '42501');
    const owned = await rpc('reserve', request); assert.equal(owned.status, 200); assert.equal(owned.body.outcome, 'owned');
    const completed = await rpc('finish', { p_id: owned.body.id, p_claim: claim, p_state: 'completed', p_result: 'Synthetic ciphertext' });
    assert.equal(completed.status, 200); assert.equal(completed.body, true);
    const replay = await rpc('reserve', request); assert.equal(replay.status, 200); assert.equal(replay.body.outcome, 'completed');
    const id = randomUUID(); const path = `${app}/${subject}/${id}`;
    assert.equal((await rpc('file_record', { p_id: id, p_app_id: app, p_subject: subject, p_object_path: path, p_content_type: 'text/plain', p_size: 12, p_sha256: 'c'.repeat(64) })).body, true);
    assert.equal((await rpc('file_get', { p_id: id, p_app_id: app, p_subject: 'd'.repeat(64) })).body, null);
    assert.equal((await rpc('file_get', { p_id: id, p_app_id: app, p_subject: subject })).body.object_path, path);
    assert.equal((await rpc('expire_results', {})).body, 0);
    // SQL catalog proof only for storage: no object byte upload or customer read.
    const policies = (await db.query("select permissive,roles,cmd,qual,with_check from pg_policies where schemaname='storage' and tablename='objects' and policyname='pennsync external files require server authorization'")).rows;
    assert.equal(policies.length, 1); assert.equal(policies[0].permissive, 'RESTRICTIVE');
    assert.deepEqual(policies[0].roles, ['anon', 'authenticated']); assert.equal(policies[0].cmd, 'ALL');
    assert.equal(policies[0].qual, "(bucket_id <> 'pennsync-external-integrations'::text)"); assert.equal(policies[0].with_check, policies[0].qual);
    assert.equal((await db.query("select active from cron.job where jobname='pennsync-integration-result-retention'")).rows[0].active, false);
  } catch (error) {
    if (error?.code === 'ERR_ASSERTION') throw error;
    const code = /^LOCAL_[A-Z_]+$/.test(error.message) ? error.message : /^[0-9A-Z]{5}$/.test(error.code || '') ? `SQLSTATE_${error.code}` : 'DETAILS_SUPPRESSED';
    throw new Error(`LOCAL_RUNTIME_BOOTSTRAP_FAILED at ${phase}: ${code}`);
  } finally {
    // Handles a failure after 003 committed but before its pause was observed.
    // Only the exact job proven absent before this owned local test is eligible.
    try { await pauseOwnedRetention(); } finally { await db.end().catch(() => {}); }
  }
});
