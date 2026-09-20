// The service's path to the general activity trail (D25).
//
// Separate from `record-contracts.mjs` even though both reach a contract,
// because the two are used differently and conflating them would blur that. A
// record contract IS a capability — one ported endpoint, one handler, one
// allowlist entry. Auditing is something a capability DOES while serving, so it
// is a facility handlers reach for rather than an endpoint anyone calls.
// Keeping them apart also keeps `record-contracts.mjs`'s invariant honest: every
// contract it declares has a handler, which an audit append never will.
//
// Same discipline as its neighbours: the bearer stays in this closure, the RPC
// name is fixed, and the store's words do not come back.
//
// One property is worth stating because it is the reason the trail is worth
// keeping: a handler cannot say who did something. The actor is stamped in SQL
// from the caller helpers, so nothing this module sends can attribute an action
// to another person.
import { ID, MAX_UPSTREAM_BYTES, fail, isObject, readJson } from './contracts.mjs';
import { validAuthorityKey, validAuthorityTarget } from './authority.mjs';

export const AUDIT_RPC = 'pennsync_contract_activity_append';
/** Mirrors the table's own check constraint, so a bad kind is refused here too. */
export const SUBJECT_KINDS = Object.freeze([
  'patient', 'visit', 'document', 'referral', 'user', 'agency', 'membership', 'other',
]);
export const MAX_ACTION = 120;
/** The contract refuses a larger detail rather than truncating it. */
export const MAX_DETAIL_BYTES = 8192;
/**
 * What `contract_activity_append` raises — not what the trail's SQL raises.
 *
 * The two are worth keeping apart. A code the contract raises that this module
 * does not know reaches a handler as a generic outage; a code this module
 * expects that the contract it calls cannot raise is a branch nothing can take,
 * and it reads like a guarantee that was never written. `PENNSYNC_AUDIT_
 * FORBIDDEN` was in this list and is one of those: reading the trail requires
 * an administrator, appending to it does not, and an append is all this module
 * does.
 */
export const AUDIT_CODES = Object.freeze([
  'PENNSYNC_AUDIT_AGENCY_NOT_HELD',
  'PENNSYNC_AUDIT_ACTION_INVALID',
  'PENNSYNC_AUDIT_SUBJECT_INVALID',
  'PENNSYNC_AUDIT_DETAIL_INVALID',
  'PENNSYNC_AUDIT_DETAIL_TOO_LARGE',
]);
/**
 * What `contract_activity_list` raises. Declared here so the pair is checked
 * against the migration as a whole — a code neither list knows would otherwise
 * be invisible — and unused until an administrative capability reads the trail.
 */
export const AUDIT_LIST_CODES = Object.freeze([
  'PENNSYNC_AUDIT_AGENCY_NOT_HELD',
  'PENNSYNC_AUDIT_FORBIDDEN',
  'PENNSYNC_AUDIT_CURSOR_INVALID',
]);
const REQUEST_TIMEOUT_MS = 15000;

/**
 * An audit capability bound to one caller, one agency and one request.
 *
 * `req` is read for its Authorization header and nothing else, and never
 * escapes this closure.
 */
export function auditCapability({ config, req, agencyId }, fetcher = fetch) {
  const bearer = req?.headers?.get('authorization') || '';
  return async function audit(action, { subject = null, detail = null } = {}) {
    if (typeof action !== 'string' || action.length < 1 || action.length > MAX_ACTION) {
      fail(400, 'AUDIT_ACTION_INVALID');
    }
    // A subject is a pair or it is nothing. Half of one names something nobody
    // can look up, which the table refuses too.
    if (subject !== null) {
      if (!isObject(subject) || !SUBJECT_KINDS.includes(subject.kind)
        || typeof subject.id !== 'string' || !ID.test(subject.id)) {
        fail(400, 'AUDIT_SUBJECT_INVALID');
      }
    }
    if (detail !== null && !isObject(detail)) fail(400, 'AUDIT_DETAIL_INVALID');
    const encoded = detail === null ? null : JSON.stringify(detail);
    if (encoded !== null && Buffer.byteLength(encoded, 'utf8') > MAX_DETAIL_BYTES) {
      // Refused here as well as in SQL, so a handler learns before the round
      // trip that what it wanted to record will not fit.
      fail(400, 'AUDIT_DETAIL_TOO_LARGE');
    }
    if (!validAuthorityTarget(config.authorityUrl) || !validAuthorityKey(config.authorityKey)) {
      fail(503, 'AUTHORITY_NOT_CONFIGURED');
    }
    if (typeof agencyId !== 'string' || !ID.test(agencyId)) fail(400, 'AGENCY_REQUIRED');
    if (!/^Bearer\s+\S+$/i.test(bearer)) fail(401, 'AUTHENTICATION_REQUIRED');

    const body = JSON.stringify({
      p_agency: agencyId,
      p_action: action,
      p_subject_kind: subject?.kind ?? null,
      p_subject_id: subject?.id ?? null,
      p_detail: detail,
    });

    let response;
    try {
      response = await fetcher(`${config.authorityUrl}/rest/v1/rpc/${AUDIT_RPC}`, {
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
    } catch { fail(503, 'AUDIT_UNREACHABLE'); }

    let answer;
    try { answer = await readJson(response, MAX_UPSTREAM_BYTES); } catch { fail(503, 'AUDIT_UNREADABLE'); }
    if (!response.ok || response.redirected) {
      const declared = isObject(answer) && AUDIT_CODES.includes(answer.message) ? answer.message : null;
      fail(declared ? 409 : 503, declared ?? 'AUDIT_REFUSED');
    }
    // The contract answers the row's id. A handler that gets anything else did
    // not audit, and must not be told that it did.
    if (typeof answer !== 'string' || !ID.test(answer)) fail(503, 'AUDIT_UNREADABLE');
    return answer;
  };
}
