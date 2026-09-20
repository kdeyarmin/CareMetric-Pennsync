// The ported service's path to a record.
//
// Sixty-two of the functions still to port read or write entity rows. What
// blocked them was never transport — it was that the record store grants no
// caller role a table, a helper, or even USAGE on its schema, deliberately,
// because an RLS policy is evaluated with the privileges of the role running
// the query: a caller holding the table would also need the helpers that decide
// who it is. The bridge is a SECURITY DEFINER broker owned by a role row level
// security still binds, and this module is how a handler reaches it.
//
// It is shaped exactly like `integrations.mjs`, for the same three reasons:
//
// 1. **A handler never receives a credential.** `app.mjs` builds a capability
//    bound to the caller's own request; the bearer stays in this closure. A
//    handler calls `records(operation, entity, args)` and cannot read, log or
//    forward the token that authorizes it.
//
// 2. **The call carries the caller's authority, not the service's.** The
//    bearer replayed here is the caller's Supabase Auth token, and the
//    publishable key identifies the project rather than anyone. So the
//    database decides what this call may touch by asking its own membership
//    roster — not by trusting anything this service said.
//
// 3. **The store's words do not come back.** A refusal maps to one of the
//    broker family's own declared codes or to a single fixed code, and nothing
//    else crosses. PostgREST's error body carries a database message, a hint
//    and the detail the broker attached; forwarding it wholesale would put
//    internal text in a caller's hands.
//
// There is no new credential and no new origin: the record store lives in the
// same database as the authority store — its migration refuses to apply
// without it — so this reuses the authority target and key that `authority.mjs`
// already validates against a fixed pair.
import { BROKERED_ENTITIES, BROKER_CODES, BROKER_REFUSALS, READ_ONLY_MODES } from './brokered-entities.mjs';
import { ID, MAX_UPSTREAM_BYTES, fail, isObject, readJson } from './contracts.mjs';
import { validAuthorityKey, validAuthorityTarget } from './authority.mjs';

export { BROKERED_ENTITIES, BROKER_CODES, BROKER_REFUSALS, READ_ONLY_MODES };

/** Fixed RPC names. No caller, handler, request or environment value selects one. */
export const RECORD_RPC = Object.freeze({
  list: 'pennsync_records_list',
  get: 'pennsync_records_get',
  insert: 'pennsync_records_insert',
  update: 'pennsync_records_update',
  delete: 'pennsync_records_delete',
});
export const RECORD_OPERATIONS = Object.freeze(Object.keys(RECORD_RPC));
/** Mirrors the family's own ceiling, so an over-large page is refused here too. */
export const MAX_PAGE = 5000;
export const DEFAULT_PAGE = 50;
const REQUEST_TIMEOUT_MS = 15000;

/**
 * What each operation may be given. Unknown keys are refused rather than
 * ignored, exactly as `exactObject` refuses them at the HTTP edge: a handler
 * that believes it passed a filter it did not is the same defect one layer in.
 */
const ARGUMENTS = Object.freeze({
  list: ['limit', 'after'],
  get: ['id'],
  insert: ['record'],
  update: ['id', 'patch'],
  delete: ['id'],
});

const refusal = value => (BROKER_REFUSALS.includes(value) ? value : null);

/** The RPC body for one operation, with nothing in it the caller chose but its own data. */
function requestBody(operation, entity, agencyId, args) {
  const body = { p_agency: agencyId, p_entity: entity };
  if (operation === 'list') {
    const limit = args.limit ?? DEFAULT_PAGE;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE) fail(400, 'RECORD_LIMIT_INVALID');
    if (args.after !== undefined && args.after !== null
      && (typeof args.after !== 'string' || !ID.test(args.after))) fail(400, 'RECORD_CURSOR_INVALID');
    return { ...body, p_limit: limit, p_after: args.after ?? null };
  }
  if (operation === 'insert') {
    if (!isObject(args.record)) fail(400, 'RECORD_REQUIRED');
    return { ...body, p_record: args.record };
  }
  if (typeof args.id !== 'string' || !ID.test(args.id)) fail(400, 'RECORD_ID_REQUIRED');
  if (operation === 'update') {
    if (!isObject(args.patch)) fail(400, 'RECORD_PATCH_REQUIRED');
    return { ...body, p_id: args.id, p_patch: args.patch };
  }
  return { ...body, p_id: args.id };
}

/**
 * A record capability bound to one caller, one agency and one request.
 *
 * `req` is read for its Authorization header and nothing else, and never
 * escapes this closure. The returned function is what a handler sees.
 */
export function recordCapability({ config, req, agencyId }, fetcher = fetch) {
  const bearer = req?.headers?.get('authorization') || '';
  return async function records(operation, entity, args = {}) {
    if (!Object.hasOwn(RECORD_RPC, operation)) fail(409, 'RECORD_OPERATION_UNKNOWN');
    // Refused here as well as in the database. The database's answer is the one
    // that matters; this one keeps a handler's mistake from being a request.
    if (!Object.hasOwn(BROKERED_ENTITIES, entity)) fail(409, BROKER_CODES.entityNotBrokered);
    // Read from the generated modes rather than naming one: an entity is
    // read-only when it is reference data OR when its own schema conditions who
    // may write it, and a rule spelled `=== 'global'` here missed the second.
    if (READ_ONLY_MODES.includes(BROKERED_ENTITIES[entity]) && operation !== 'list' && operation !== 'get') {
      fail(409, BROKER_CODES.entityReadOnly);
    }
    if (!isObject(args)) fail(400, 'RECORD_ARGUMENTS_REQUIRED');
    if (Object.keys(args).some(key => !ARGUMENTS[operation].includes(key))) fail(400, 'RECORD_ARGUMENTS_INVALID');
    if (!validAuthorityTarget(config.authorityUrl) || !validAuthorityKey(config.authorityKey)) {
      fail(503, 'AUTHORITY_NOT_CONFIGURED');
    }
    if (typeof agencyId !== 'string' || !ID.test(agencyId)) fail(400, 'AGENCY_REQUIRED');
    // Authority was resolved from this same header before any handler ran, so
    // its absence here means the request shape changed, not that a caller is
    // anonymous. Fail rather than call the store unauthenticated.
    if (!/^Bearer\s+\S+$/i.test(bearer)) fail(401, 'AUTHENTICATION_REQUIRED');

    // Built BEFORE the try, because it validates: inside it, a refused limit or
    // a malformed id would be caught by the network handler below and reported
    // as the store being unreachable. The caller would then see a 503 for its
    // own bad argument, and a retry would never fix it.
    const body = JSON.stringify(requestBody(operation, entity, agencyId, args));

    let response;
    try {
      response = await fetcher(`${config.authorityUrl}/rest/v1/rpc/${RECORD_RPC[operation]}`, {
        method: 'POST',
        headers: {
          apikey: config.authorityKey,
          Authorization: bearer,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch { fail(503, 'RECORD_STORE_UNREACHABLE'); }
    if ([401, 403].includes(response.status)) fail(response.status, 'AUTHENTICATION_REJECTED');

    let answer;
    // Bounded, not `response.json()`: a `list` may carry 5,000 rows and the
    // shape checks below run only after the whole body has been read.
    try { answer = await readJson(response, MAX_UPSTREAM_BYTES); } catch { fail(503, 'RECORD_STORE_UNREADABLE'); }
    if (!response.ok || response.redirected) {
      // The store's vocabulary, only where it is one of the family's own
      // declared codes. Anything else — a PostgREST message, a constraint name,
      // a hint — is a single code, because it would otherwise cross a trust
      // boundary on its way to a caller.
      const declared = isObject(answer) ? refusal(answer.message) : null;
      fail(declared ? 409 : 503, declared ?? 'RECORD_REFUSED');
    }
    // Shapes are fixed by the wrappers: an array for `list`, a row or null for
    // `get`/`insert`/`update`, a boolean for `delete`. Checked rather than
    // trusted, so a store that answered something else is an outage here rather
    // than a surprise inside a handler.
    if (operation === 'list') {
      if (!Array.isArray(answer) || answer.some(row => !isObject(row))) fail(503, 'RECORD_STORE_UNREADABLE');
      return answer;
    }
    if (operation === 'delete') {
      if (typeof answer !== 'boolean') fail(503, 'RECORD_STORE_UNREADABLE');
      return answer;
    }
    if (answer !== null && !isObject(answer)) fail(503, 'RECORD_STORE_UNREADABLE');
    return answer;
  };
}
