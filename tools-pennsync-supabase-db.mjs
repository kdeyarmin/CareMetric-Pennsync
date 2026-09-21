#!/usr/bin/env node
/**
 * Speak the migrate tool's `db` interface over Supabase's management API.
 *
 * `tools-pennsync-migrate.mjs` takes anything with `query` and `session`, so
 * the transport was never part of its design. This is the second transport,
 * and it exists because the first one is not always reachable: Supabase's
 * direct database host is IPv6-only, the poolers want TCP 5432/6543, and a
 * runner that is allowed outbound HTTPS and nothing else — CI here, and this
 * container — can open neither. `POST /v1/projects/{ref}/database/query` runs
 * as `postgres` over ordinary HTTPS and is reachable from all of them.
 *
 * It carries statements. It decides nothing: which migrations are pending, in
 * what order, and whether the deployment pin moved are all still read out of
 * the ledger by the tool that owns those questions.
 *
 * THREE PROPERTIES ARE LOAD-BEARING, and each is a refusal rather than a
 * convention, because this endpoint is not a connection and quietly behaves
 * like one right up until it matters.
 *
 * 1. NO PARAMETERS. The endpoint takes a SQL string and nothing else. A shim
 *    that accepted `params` and dropped them would turn a placeholder into a
 *    literal `$1` — so a non-empty `params` is refused. Nothing in the migrate
 *    tool passes any; this keeps it that way.
 *
 * 2. ONE TRANSACTION PER CALL. Every POST is its own connection, so two calls
 *    are two transactions with no relationship. `applyMigrations` depends on
 *    the opposite for the one thing it cannot get wrong: `migrationWithLedgerRow`
 *    puts the ledger row inside the migration's own `begin`/`commit` so that a
 *    crash cannot leave a migration applied and unrecorded. That holds here
 *    only because the whole body travels in ONE request. A body that would end
 *    with a transaction still open is refused instead of being sent and
 *    silently abandoned when the connection closes.
 *
 * 3. A WRITE IS NEVER RETRIED. A request that times out after the server has
 *    already committed is indistinguishable from one that never arrived, and
 *    re-sending it would apply a migration twice. So a failure here is final,
 *    and recovery is to run the tool again — which is safe precisely because
 *    of property 2: the ledger row committed with the migration, so the next
 *    run sees the truth and plans from it. Reads are retried, since re-reading
 *    is free and the CDN flakiness that cost this repository a CI run is real.
 *
 * The token is read from the environment and never appears in a URL, a log
 * line or a refusal's detail. Neither does the SQL: a body here can be half a
 * megabyte, and a diagnostic that quotes it is not a diagnostic.
 */
import { codeLines } from './tools-pennsync-migrate-shape.mjs';

export const SUPABASE_DB_CONTRACT = 'cm.pennsync.supabase-db.v1';
export const MANAGEMENT_ENDPOINT = 'https://api.supabase.com';

/** Reads are retried; writes are not. See property 3. */
export const READ_ATTEMPTS = 4;

export class SupabaseDbError extends Error {
  constructor(code, detail = null) {
    super(code);
    this.name = 'SupabaseDbError';
    this.code = code;
    this.detail = detail;
  }
}

const refuse = (code, detail = null) => { throw new SupabaseDbError(code, detail); };

/** `supabase://<project-ref>` — the token is NOT in the URL, deliberately. */
export function isManagementUrl(url) {
  return typeof url === 'string' && url.startsWith('supabase://');
}

export function parseManagementUrl(url) {
  if (!isManagementUrl(url)) refuse('SUPABASE_DB_URL_NOT_MANAGEMENT');
  const ref = url.slice('supabase://'.length).replace(/\/+$/, '');
  // A project ref is twenty lowercase letters. Checked because it is
  // interpolated into the request path.
  if (!/^[a-z]{20}$/.test(ref)) refuse('SUPABASE_DB_REF_UNUSABLE', { ref });
  return Object.freeze({ ref });
}

/**
 * Refuse a body that would leave a transaction open when the connection goes.
 *
 * Read as STATEMENTS through the same helper `migrationWithLedgerRow` uses, so
 * there is one reading of "what is the first line of this file" rather than
 * two that can drift — every migration opens with a `--` header, and a check
 * anchored at the first character refused all sixty-nine of them once already.
 */
export function assertSingleTransaction(sql) {
  const code = codeLines(sql);
  const first = code.at(0)?.line ?? '';
  const last = code.at(-1)?.line ?? '';
  const opens = /^\s*begin\s*;/i.test(first);
  const closes = /(commit|rollback)\s*;\s*$/i.test(last);
  // Either a self-contained transaction, or a body with no transaction control
  // at all (one implicit statement, which the endpoint wraps itself).
  if (opens && closes) return;
  if (!opens && !closes) return;
  refuse('SUPABASE_DB_TRANSACTION_SPLIT', { opens, closes });
}

const sleep = ms => new Promise(done => setTimeout(done, ms));

/**
 * A minimal `pg`-shaped client: `query(sql, params)` returning `{ rows }`, and
 * `end()`. That is the whole surface `tools-pennsync-migrate.mjs` opens a
 * connection for, which is why it can be handed this instead.
 */
export function openManagementClient({
  url,
  token = process.env.SUPABASE_ACCESS_TOKEN,
  fetchImpl = globalThis.fetch,
  endpoint = MANAGEMENT_ENDPOINT,
  retryDelay = sleep,
} = {}) {
  const { ref } = parseManagementUrl(url);
  if (typeof token !== 'string' || !token) refuse('SUPABASE_DB_TOKEN_REQUIRED');
  if (typeof fetchImpl !== 'function') refuse('SUPABASE_DB_FETCH_REQUIRED');
  const target = `${endpoint}/v1/projects/${ref}/database/query`;

  const send = async sql => {
    const response = await fetchImpl(target, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query: sql }),
    });
    const text = await response.text();
    if (!response.ok) {
      let message = text.slice(0, 400);
      try { message = JSON.parse(text)?.error?.message ?? message; } catch { /* keep the text */ }
      // Status and the server's own words. Never the token, never the SQL.
      refuse('SUPABASE_DB_QUERY_FAILED', { status: response.status, message });
    }
    let rows;
    try { rows = JSON.parse(text); } catch { refuse('SUPABASE_DB_RESPONSE_UNREADABLE', { status: response.status }); }
    // A 2xx that is not a row array is not a result set, and treating it as an
    // empty one would read as "no rows" to every caller above.
    if (!Array.isArray(rows)) refuse('SUPABASE_DB_RESPONSE_NOT_ROWS');
    return { rows, rowCount: rows.length };
  };

  return {
    contract: SUPABASE_DB_CONTRACT,
    async query(sql, params = []) {
      if (typeof sql !== 'string' || !sql.trim()) refuse('SUPABASE_DB_QUERY_EMPTY');
      // Property 1. Dropping these would send a literal `$1`.
      if (Array.isArray(params) ? params.length : params != null) {
        refuse('SUPABASE_DB_PARAMS_UNSUPPORTED', { count: params?.length ?? null });
      }
      assertSingleTransaction(sql);                                   // property 2

      // Property 3: a body that can change the database gets exactly one
      // attempt. `codeLines` already told us whether it opens a transaction;
      // anything that does is a migration, and a migration is never re-sent.
      const writes = /^\s*begin\s*;/i.test(codeLines(sql).at(0)?.line ?? '');
      if (writes) return send(sql);

      let failure = null;
      for (let attempt = 1; attempt <= READ_ATTEMPTS; attempt += 1) {
        try { return await send(sql); } catch (error) {
          failure = error;
          // A refusal this module raised is a fact about the request and will
          // not read differently next time; only transport trouble retries.
          const transport = !(error instanceof SupabaseDbError)
            || (error.code === 'SUPABASE_DB_QUERY_FAILED' && error.detail?.status >= 500);
          if (!transport || attempt === READ_ATTEMPTS) throw error;
          await retryDelay(2 ** attempt * 250);
        }
      }
      throw failure;
    },
    async end() { /* Nothing is held open: every call is its own connection. */ },
  };
}
