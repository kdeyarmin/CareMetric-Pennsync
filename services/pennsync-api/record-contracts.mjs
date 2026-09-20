// The service's path to a reviewed per-capability contract.
//
// Separate from `records.mjs` on purpose, because the two are different kinds
// of thing and keeping one allowlist for both would blur exactly the line D16
// drew. `records.mjs` reaches the generic family: five operations over the 31
// entities whose schemas cleared D2's ceiling. A contract is the opposite — one
// endpoint, one reviewed authorization, and a capability the generic family is
// specifically not allowed to serve. `listPolicyLibrary` returns `doc_url`, a
// locator into our own storage, which is why `PolicyLibrary` is kept out of the
// family in the first place.
//
// Everything else is the same discipline as `records.mjs` and
// `integrations.mjs`: the bearer stays in this closure, the RPC name is fixed
// per capability and chosen by nothing a caller sends, and the store's words do
// not come back.
//
// The contract itself decides who may see what. This module carries no
// authorization logic at all, and that is deliberate: a copy here would be a
// second answer to keep in agreement with the database's.
import { ID, MAX_UPSTREAM_BYTES, fail, isObject, readJson } from './contracts.mjs';
import { validAuthorityKey, validAuthorityTarget } from './authority.mjs';

/**
 * One entry per ported capability. `params` is the exact argument set the
 * capability accepts — anything else is refused rather than dropped — and
 * `body` maps it to the contract's parameters, which are never caller-chosen.
 */
export const RECORD_CONTRACTS = Object.freeze({
  listPolicyLibrary: Object.freeze({
    rpc: 'pennsync_contract_policy_library_list',
    params: Object.freeze(['mode']),
    // The original defaults an ABSENT mode to 'active' and refuses an explicit
    // null, so `undefined` is the only thing that defaults here either.
    body: (agencyId, args) => ({ p_agency: agencyId, p_mode: args.mode === undefined ? 'active' : args.mode }),
    codes: Object.freeze([
      'PENNSYNC_CONTRACT_MODE_INVALID',
      'PENNSYNC_CONTRACT_AGENCY_NOT_HELD',
      'PENNSYNC_CONTRACT_FORBIDDEN',
    ]),
  }),
  // D23's roster. Not a ported Base44 name: the original read the `User`
  // entity directly from each of 35 capabilities, and what replaces that is
  // one reviewed contract rather than 35 copies of a query. It is an endpoint
  // in its own right — a staff directory is something a caller asks for — and
  // the thing those 35 handlers will call while serving.
  listAgencyRoster: Object.freeze({
    rpc: 'pennsync_contract_roster_list',
    params: Object.freeze(['limit', 'after']),
    body: (agencyId, args) => ({
      p_agency: agencyId,
      p_limit: args.limit === undefined ? null : args.limit,
      p_after: args.after === undefined ? null : args.after,
    }),
    codes: Object.freeze([
      'PENNSYNC_ROSTER_AGENCY_NOT_HELD',
      'PENNSYNC_ROSTER_CURSOR_INVALID',
      'PENNSYNC_ROSTER_CURSOR_UNKNOWN',
    ]),
  }),
  getAgencyRosterMember: Object.freeze({
    rpc: 'pennsync_contract_roster_get',
    params: Object.freeze(['user_id']),
    body: (agencyId, args) => ({ p_agency: agencyId, p_user_id: args.user_id ?? null }),
    nullable: true,
    codes: Object.freeze([
      'PENNSYNC_ROSTER_AGENCY_NOT_HELD',
      'PENNSYNC_ROSTER_SUBJECT_INVALID',
    ]),
  }),
});
export const CONTRACT_NAMES = Object.freeze(Object.keys(RECORD_CONTRACTS));

/**
 * Every refusal any contract may raise. Declared per contract above and
 * unioned here, rather than kept as one flat list that every contract is
 * checked against.
 *
 * The difference matters in one direction only, and it is the direction that
 * misleads: a flat list lets a contract relay a code the contract it called
 * cannot raise. That is a branch nothing can take, and it reads like a
 * guarantee somebody wrote. With two contracts it was invisible; with three it
 * would have been `listPolicyLibrary` claiming it could answer
 * `PENNSYNC_ROSTER_CURSOR_UNKNOWN`.
 */
export const CONTRACT_CODES = Object.freeze([...new Set(
  Object.values(RECORD_CONTRACTS).flatMap(entry => entry.codes))].sort());
const REQUEST_TIMEOUT_MS = 15000;

/**
 * A contract capability bound to one caller, one agency and one request.
 *
 * `req` is read for its Authorization header and nothing else, and never
 * escapes this closure.
 */
export function contractCapability({ config, req, agencyId }, fetcher = fetch) {
  const bearer = req?.headers?.get('authorization') || '';
  return async function contract(name, args = {}) {
    const entry = Object.hasOwn(RECORD_CONTRACTS, name) ? RECORD_CONTRACTS[name] : null;
    if (!entry) fail(409, 'CONTRACT_UNKNOWN');
    if (!isObject(args)) fail(400, 'CONTRACT_ARGUMENTS_REQUIRED');
    if (Object.keys(args).some(key => !entry.params.includes(key))) fail(400, 'CONTRACT_ARGUMENTS_INVALID');
    if (!validAuthorityTarget(config.authorityUrl) || !validAuthorityKey(config.authorityKey)) {
      fail(503, 'AUTHORITY_NOT_CONFIGURED');
    }
    if (typeof agencyId !== 'string' || !ID.test(agencyId)) fail(400, 'AGENCY_REQUIRED');
    if (!/^Bearer\s+\S+$/i.test(bearer)) fail(401, 'AUTHENTICATION_REQUIRED');

    // Built before the try, so a refused argument is not reported as the store
    // being unreachable — the defect `records.mjs` had until its tests found it.
    const body = JSON.stringify(entry.body(agencyId, args));

    let response;
    try {
      response = await fetcher(`${config.authorityUrl}/rest/v1/rpc/${entry.rpc}`, {
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
    if ([401, 403].includes(response.status)) {
      // A contract's own refusal arrives as a database error rather than an
      // HTTP status, so 401/403 here is the gateway rejecting the token.
      const declared = await declaredRefusal(response, entry.codes);
      if (declared) fail(409, declared);
      fail(response.status, 'AUTHENTICATION_REJECTED');
    }
    let answer;
    try { answer = await readJson(response, MAX_UPSTREAM_BYTES); } catch { fail(503, 'RECORD_STORE_UNREADABLE'); }
    if (!response.ok || response.redirected) {
      const declared = isObject(answer) && entry.codes.includes(answer.message) ? answer.message : null;
      fail(declared ? 409 : 503, declared ?? 'CONTRACT_REFUSED');
    }
    // An absent roster member is `null`, which is an answer rather than an
    // outage: it is how "not there" and "not a colleague of yours" are made
    // indistinguishable, so a caller cannot learn that an id belongs to
    // somebody in an agency they cannot see.
    if (answer === null && entry.nullable) return null;
    if (!isObject(answer)) fail(503, 'RECORD_STORE_UNREADABLE');
    return answer;
  };

  async function declaredRefusal(response, codes) {
    let body;
    try { body = await readJson(response, MAX_UPSTREAM_BYTES); } catch { return null; }
    return isObject(body) && codes.includes(body.message) ? body.message : null;
  }
}
