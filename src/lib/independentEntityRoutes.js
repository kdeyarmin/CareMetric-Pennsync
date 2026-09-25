/**
 * Which frontend entity calls a ported handler actually SERVES.
 *
 * Stage J's unit of work is not "repoint a call site". `pennsync-api` has no
 * generic entity route by design, so an entity method reaches the owned store
 * only if some named handler answers that exact call. This
 * module is where that mapping is DECLARED, one entity operation at a time,
 * and `check:entity-routes` re-checks every declaration against the shipped
 * handler registry rather than trusting it.
 *
 * Three rules make it a seam rather than a shim, and each of them exists
 * because the obvious version of this file is wrong in a way nothing would
 * report.
 *
 * **A route that cannot honour the call's own arguments REFUSES.** The
 * tempting shape is to map `Patient.filter(query)` onto a handler that takes
 * no filter and return its rows. That silently answers "the patients matching
 * this" with "the patients", which is a disclosure bug wearing a passing test.
 * So an argument this file cannot express raises
 * `STAGING_ENTITY_ARGUMENTS_UNSUPPORTED` — a different code from "no route
 * exists", because a screen's author needs to tell "not built yet" from "your
 * query cannot be served".
 *
 * **A route declares the PROJECTION it delivers.** The authorized reads are
 * purpose-scoped (D64): `getAuthorizedPatient` under `display` returns the
 * fields that purpose discloses and not the row. A screen reading a field
 * outside the purpose gets `undefined` rather than an error, which is the
 * "a handler that touches an entity is not one that serves a call site"
 * failure from the other side. `projection` names the purpose so adopting a
 * route is a checkable act, and the per-call-site work in Stage J is to check
 * each screen against it.
 *
 * **A route is a claim about a call site that exists.** `check:entity-routes`
 * fails if a declaration names an entity operation the frontend never
 * performs, so a stale route cannot sit here reading as coverage.
 *
 * Deterministic, offline, and no authorization of its own: every route goes
 * through the adapter's `portedCall`, so the tenant fence, the session lease
 * and the service's own contract are unchanged by anything here.
 */

/** Raised when a route exists but the call's arguments are outside it. */
export const ARGUMENTS_UNSUPPORTED = 'STAGING_ENTITY_ARGUMENTS_UNSUPPORTED';

const unsupported = (detail) => {
  const error = new Error(ARGUMENTS_UNSUPPORTED);
  error.code = ARGUMENTS_UNSUPPORTED;
  error.status = 400;
  error.detail = detail;
  throw error;
};

/**
 * A sort argument the roster page can honour.
 *
 * The roster is ordered by email with the user id as the tiebreaker, and the
 * contract takes no other order. Base44's `list` takes a sort string, so the
 * only honourable answers are "no order asked for" and "ascending email".
 * `-created_date`, which several call sites pass, is a real order this cannot
 * produce, and answering it with email order would silently reorder a screen.
 */
const EMAIL_ASCENDING_SORTS = Object.freeze(['', 'email', '+email']);

function pageSize(limit, ceiling) {
  if (limit === undefined || limit === null) return undefined;
  if (!Number.isSafeInteger(limit) || limit < 1) unsupported('limit');
  // The contract clamps silently. Refusing here instead keeps a screen that
  // asked for more rows than the roster will ever return from quietly
  // rendering a short list as the whole agency.
  if (limit > ceiling) unsupported('limit_above_ceiling');
  return limit;
}

function emailAscending(sort) {
  if (sort === undefined || sort === null) return;
  if (typeof sort !== 'string' || !EMAIL_ASCENDING_SORTS.includes(sort)) unsupported('sort');
}

/** The roster contract's own ceiling (`least(greatest(limit, 1), 500)`). */
export const ROSTER_MAXIMUM = 500;

/**
 * The declared routes.
 *
 * `request` builds the handler’s input from the entity call’s own arguments —
 * and refuses rather than dropping one. `response` takes the handler’s answer
 * apart into the shape the entity method’s callers already expect: an ARRAY
 * for `list`, the ROW for `get`.
 */
export const ENTITY_ROUTES = Object.freeze({
  /**
   * The staff directory: 36 of the frontend’s call sites, the largest single
   * group that can land, and the one D23 built `listAgencyRoster` for.
   *
   * `projection` is doing real work here. The roster answers from the
   * AUTHORITY store for identity and tenancy and from the carried row only for
   * what only it knows, so it supplies `id`, `email`, `agency_id`,
   * `agency_name`, `tenant_role`, `is_active`, a DERIVED `is_manager` and
   * `is_approved`, the staff and duty fields, and — for an `agency_admin` or
   * `manager` only — `phone`, `credentials`, `license_number`,
   * `manager_email`, `profile_completeness_score` and
   * `ai_content_agreement_accepted`, null rather than absent for everybody
   * else.
   *
   * It supplies NO `role` and no `account_type`, because those are the
   * self-editable labels D23 forbids authorizing on. A screen reading either
   * to decide what to show gets `undefined` here, and its answer is the tenant
   * context rather than a wider projection — which is the per-screen work
   * Stage J is made of, and the reason this route is a seam rather than a
   * drop-in.
   */
  'User.list': Object.freeze({
    function: 'listAgencyRoster',
    projection: 'roster',
    reason: 'D23 replaced 35 copies of a User read with this one reviewed roster contract.',
    request: (sort, limit) => {
      emailAscending(sort);
      const size = pageSize(limit, ROSTER_MAXIMUM);
      return size === undefined ? {} : { limit: size };
    },
    response: (result) => result.entries,
  }),
});

export const ROUTED_OPERATIONS = Object.freeze(Object.keys(ENTITY_ROUTES).sort());

/** The route for one entity operation, or null when none is declared. */
export function routeFor(entity, operation) {
  const key = `${entity}.${operation}`;
  return Object.hasOwn(ENTITY_ROUTES, key) ? ENTITY_ROUTES[key] : null;
}
