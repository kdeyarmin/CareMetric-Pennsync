import test from 'node:test';
import assert from 'node:assert/strict';
import {
  READ_ATTEMPTS, SupabaseDbError, assertSingleTransaction, isManagementUrl,
  openManagementClient, parseManagementUrl,
} from './tools-pennsync-supabase-db.mjs';
import { migrationWithLedgerRow } from './tools-pennsync-migrate.mjs';

/**
 * The transport, tested where it differs from a connection.
 *
 * Every POST is its own connection, which is the one thing about this endpoint
 * that reads like a database right up until a migration is half applied. The
 * tests that matter are the three refusals that make the difference explicit.
 */
const REF = 'xxtyweswohkvgkprimwa';
const URL_OK = `supabase://${REF}`;
const TOKEN = 'sbp_test_token_never_logged';

/** A fetch that records what it was asked and answers from a script. */
function fakeFetch(script) {
  const calls = [];
  const replies = [...script];
  const impl = async (target, init) => {
    calls.push({ target, init, body: JSON.parse(init.body).query });
    const reply = replies.length > 1 ? replies.shift() : replies[0];
    if (reply instanceof Error) throw reply;
    return {
      ok: reply.status < 400,
      status: reply.status,
      text: async () => typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body),
    };
  };
  impl.calls = calls;
  return impl;
}

const ok = rows => ({ status: 201, body: rows });
const open = (fetchImpl, extra = {}) => openManagementClient({
  url: URL_OK, token: TOKEN, fetchImpl, retryDelay: async () => {}, ...extra,
});

const rejectsWith = code => error => {
  assert.ok(error instanceof SupabaseDbError, `expected SupabaseDbError, got ${error}`);
  assert.equal(error.code, code);
  return true;
};

test('a project ref is checked, because it is interpolated into the request path', () => {
  assert.equal(isManagementUrl(URL_OK), true);
  assert.equal(isManagementUrl('postgresql://postgres@host/db'), false);
  assert.deepEqual(parseManagementUrl(URL_OK), { ref: REF });
  for (const bad of ['supabase://', 'supabase://UPPER', 'supabase://short', 'supabase://a/../b']) {
    assert.throws(() => parseManagementUrl(bad), rejectsWith('SUPABASE_DB_REF_UNUSABLE'), bad);
  }
});

test('a token is required and never reaches a refusal or a URL', async () => {
  assert.throws(() => openManagementClient({ url: URL_OK, token: '', fetchImpl: fakeFetch([ok([])]) }),
    rejectsWith('SUPABASE_DB_TOKEN_REQUIRED'));

  const fetchImpl = fakeFetch([{ status: 401, body: { error: { message: 'Unauthorized' } } }]);
  const client = open(fetchImpl);
  let failure = null;
  try { await client.query('select 1'); } catch (error) { failure = error; }
  assert.equal(failure.code, 'SUPABASE_DB_QUERY_FAILED');
  // The whole refusal, serialised the way a CLI would print it.
  assert.ok(!JSON.stringify({ code: failure.code, detail: failure.detail }).includes(TOKEN));
  // And the token IS on the wire, in the header, where it belongs.
  assert.equal(fetchImpl.calls[0].init.headers.authorization, `Bearer ${TOKEN}`);
  assert.ok(!fetchImpl.calls[0].target.includes(TOKEN));
});

test('parameters are refused rather than dropped', async () => {
  const fetchImpl = fakeFetch([ok([])]);
  await assert.rejects(() => open(fetchImpl).query('select $1', ['x']),
    rejectsWith('SUPABASE_DB_PARAMS_UNSUPPORTED'));
  // Nothing was sent: a `$1` reaching the server as a literal is the failure.
  assert.equal(fetchImpl.calls.length, 0);
});

test('a body that would leave a transaction open is refused', () => {
  assertSingleTransaction('begin;\ncreate schema x;\ncommit;');
  assertSingleTransaction('select 1;');
  assertSingleTransaction('-- header\nbegin;\nselect 1;\ncommit;');
  for (const split of ['begin;\ncreate schema x;', 'create schema x;\ncommit;']) {
    assert.throws(() => assertSingleTransaction(split), rejectsWith('SUPABASE_DB_TRANSACTION_SPLIT'), split);
  }
});

test('a write is sent exactly once, however it fails', async () => {
  const fetchImpl = fakeFetch([{ status: 503, body: { error: { message: 'upstream' } } }]);
  await assert.rejects(() => open(fetchImpl).query('begin;\ncreate schema x;\ncommit;'),
    rejectsWith('SUPABASE_DB_QUERY_FAILED'));
  // The property the whole design rests on: a timeout after the server
  // committed is indistinguishable from one that never arrived, so re-sending
  // would apply a migration twice. One attempt, then the operator re-runs and
  // the ledger tells the truth.
  assert.equal(fetchImpl.calls.length, 1);
});

test('a read is retried on a server fault and not on a request fault', async () => {
  const flaky = fakeFetch([{ status: 502, body: 'bad gateway' }]);
  await assert.rejects(() => open(flaky).query('select 1'), rejectsWith('SUPABASE_DB_QUERY_FAILED'));
  assert.equal(flaky.calls.length, READ_ATTEMPTS);

  const refused = fakeFetch([{ status: 403, body: { error: { message: 'forbidden' } } }]);
  await assert.rejects(() => open(refused).query('select 1'), rejectsWith('SUPABASE_DB_QUERY_FAILED'));
  // A 403 says the same thing four times; only a 5xx is worth asking again.
  assert.equal(refused.calls.length, 1);

  const recovers = fakeFetch([{ status: 500, body: 'x' }, ok([{ n: 1 }])]);
  assert.deepEqual((await open(recovers).query('select 1')).rows, [{ n: 1 }]);
  assert.equal(recovers.calls.length, 2);
});

test('a 2xx that is not a row array is not an empty result', async () => {
  await assert.rejects(() => open(fakeFetch([{ status: 200, body: { ok: true } }])).query('select 1'),
    rejectsWith('SUPABASE_DB_RESPONSE_NOT_ROWS'));
  await assert.rejects(() => open(fakeFetch([{ status: 200, body: 'not json' }])).query('select 1'),
    rejectsWith('SUPABASE_DB_RESPONSE_UNREADABLE'));
});

test('rows come back in the shape the migrate tool reads', async () => {
  const client = open(fakeFetch([ok([{ version: '20260918015112_a', name: 'a' }])]));
  const { rows, rowCount } = await client.query('select version, name from supabase_migrations.schema_migrations');
  assert.deepEqual(rows, [{ version: '20260918015112_a', name: 'a' }]);
  assert.equal(rowCount, 1);
  await client.end();
});

test('a real migration body passes the transaction check it will be sent under', () => {
  // The two checks share one reading of the file, so this is the thing that
  // would break if either drifted: `migrationWithLedgerRow` puts the ledger row
  // inside the transaction, and the transport must agree that it closes.
  const wrapped = migrationWithLedgerRow({
    name: '20260919090000_deployment_app_pin.sql',
    sql: '-- header comment\n-- another\nbegin;\ncreate schema s;\ncommit;\n',
  });
  assert.match(wrapped, /insert into supabase_migrations\.schema_migrations/);
  const ledger = wrapped.split('\n').findIndex(line => line.includes('insert into supabase_migrations'));
  const commit = wrapped.split('\n').findIndex(line => /^\s*commit\s*;/.test(line));
  assert.ok(ledger < commit, 'the ledger row must land inside the transaction');
  assertSingleTransaction(wrapped);
});
