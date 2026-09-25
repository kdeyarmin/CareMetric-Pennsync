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
 * **A route may re-order or narrow only a COMPLETE set.** The broker family
 * pages by id and offers no order and no predicate, while the screens over it
 * ask for `-created_date`, `-severity` and `{is_active: true}`. Sorting the
 * page the family returned would answer "the newest ten" with "ten of them,
 * newest first", which reads correct on every screen and is wrong whenever
 * there are more rows than the page. So a route that re-orders asks for ONE
 * ROW MORE than the caller wanted and serves the answer only when fewer came
 * back, which proves the page is the whole set; otherwise it raises
 * `STAGING_ENTITY_PAGE_INCOMPLETE`. Sorting a page is a lie; sorting a
 * complete set is arithmetic.
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

/**
 * The caller's row bound, checked for shape and nothing else.
 *
 * It deliberately does NOT refuse a limit above the contract's ceiling any
 * more. What made that refusal look right was the real risk behind it — a
 * screen rendering a truncated list as the whole agency — and the complete-set
 * proof answers that risk directly, where the ceiling only approximated it.
 */
function pageSize(limit) {
  if (limit === undefined || limit === null) return undefined;
  if (!Number.isSafeInteger(limit) || limit < 1) unsupported('limit');
  return limit;
}

function emailAscending(sort) {
  if (sort === undefined || sort === null) return;
  if (typeof sort !== 'string' || !EMAIL_ASCENDING_SORTS.includes(sort)) unsupported('sort');
}

/**
 * Raised when a re-ordered or narrowed route could not prove it held every
 * row. Distinct from `ARGUMENTS_UNSUPPORTED`: the query IS expressible, the
 * answer just is not trustworthy at this size.
 */
export const PAGE_INCOMPLETE = 'STAGING_ENTITY_PAGE_INCOMPLETE';

const incomplete = (entity) => {
  const error = new Error(PAGE_INCOMPLETE);
  error.code = PAGE_INCOMPLETE;
  error.status = 409;
  error.detail = entity;
  throw error;
};

/** The broker family's own page ceiling (`least(greatest(limit, 1), 5000)`). */
export const BROKER_MAXIMUM = 5000;

/**
 * One row more than the caller asked for, capped at what the contract will
 * return. `answer.length < probe` is then exactly "there are no more rows",
 * for both cases: a caller under the ceiling learns it from the extra row that
 * did not arrive, and a caller at or above it learns it from a short page.
 *
 * This is also why a limit ABOVE a contract's ceiling is not a refusal. It
 * reads like one — the screen asked for 5,000 rows and the contract will
 * return 500 — but a screen passing `ALL_ROWS` is naming a bound it does not
 * expect to reach, and a short answer proves it did not. Refusing it outright
 * was the first version of this file and it turned every roster call site into
 * a refusal.
 */
const probeFor = (limit, maximum) => Math.min(limit + 1, maximum);

/**
 * Base44 compares the raw column, so this does too: strings lexicographically
 * and numbers numerically, with a null or a missing value last in both
 * directions, because a row with no value has no place in an order.
 *
 * One consequence is worth knowing rather than silently improving. `severity`
 * is the text enum `critical|high|medium|low`, so `-severity` descending is
 * `medium, low, high, critical` — not most-severe-first, which is plainly what
 * the screen means. That is what the product does today, and a port is not the
 * place to change it; it is recorded here and in the route's own note.
 */
function ordered(rows, field, descending) {
  const rank = (row) => {
    const value = row?.[field];
    return value === undefined || value === null ? null : value;
  };
  return [...rows].sort((left, right) => {
    const a = rank(left);
    const b = rank(right);
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    if (a === b) return 0;
    return (a < b ? -1 : 1) * (descending ? -1 : 1);
  });
}

/**
 * The sort argument taken apart, against the fields this route can order by.
 *
 * A field outside the list refuses rather than being ignored: the whole point
 * of the rule above is that an order a screen asked for and did not get is
 * invisible on the screen.
 */
function sortKey(sort, sortable) {
  if (sort === undefined || sort === null || sort === '') return null;
  if (typeof sort !== 'string') unsupported('sort');
  const descending = sort.startsWith('-');
  const field = sort.replace(/^[-+]/, '');
  if (!sortable.includes(field)) unsupported('sort');
  return { field, descending };
}

/**
 * Base44's filter object, as far as these call sites use it: a field equals a
 * scalar, or a field is one of a list. Anything else refuses — an operator
 * this cannot express would otherwise widen the result set silently, which is
 * the disclosure shape the first rule exists for.
 */
function predicate(query, filterable) {
  if (query === undefined || query === null) return () => true;
  if (typeof query !== 'object' || Array.isArray(query)) unsupported('filter');
  const tests = [];
  for (const [field, condition] of Object.entries(query)) {
    if (!filterable.includes(field)) unsupported('filter_field');
    if (condition !== null && typeof condition === 'object') {
      const keys = Object.keys(condition);
      if (keys.length !== 1 || keys[0] !== '$in' || !Array.isArray(condition.$in)) unsupported('filter_operator');
      const allowed = condition.$in;
      tests.push(row => allowed.includes(row?.[field]));
      continue;
    }
    tests.push(row => row?.[field] === condition);
  }
  return row => tests.every(test => test(row));
}

/**
 * A read served by the broker family: the rows for one entity, then the order
 * and the predicate applied here, over a set this proved complete.
 *
 * `filtered` says whether the entity method takes a query as its first
 * argument, which is the only difference between `list` and `filter`.
 */
function brokeredRead({ entity, sortable, filterable = [], filtered }) {
  return {
    function: 'listBrokeredRecords',
    projection: 'broker_family_row',
    request: (...args) => {
      const [query, sort, limit] = filtered ? args : [undefined, args[0], args[1]];
      // Parsed for its refusals here, so a query this cannot express never
      // reaches the service at all.
      predicate(query, filterable);
      sortKey(sort, sortable);
      // Without a limit there is no size to prove the page complete against,
      // and the family's own default of 50 is not what a screen asking for
      // everything meant.
      if (limit === undefined || limit === null) unsupported('limit_required');
      return { entity, limit: probeFor(pageSize(limit), BROKER_MAXIMUM) };
    },
    response: (rows, ...args) => {
      const [query, sort, limit] = filtered ? args : [undefined, args[0], args[1]];
      if (!Array.isArray(rows)) unsupported('answer');
      if (rows.length >= probeFor(limit, BROKER_MAXIMUM)) incomplete(entity);
      const key = sortKey(sort, sortable);
      const kept = rows.filter(predicate(query, filterable));
      return (key ? ordered(kept, key.field, key.descending) : kept).slice(0, limit);
    },
  };
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
   * It also supplies no `created_date` and no `full_name` — the carried `user`
   * table has no name column at all (D69) — which is why 31 of the 36 call
   * sites here still refuse: they ask the staff list to sort by a field the
   * store does not hold. Those are per-screen work, not a route this file can
   * write, and the gate now counts them as unserved rather than adopted.
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
      const size = pageSize(limit);
      return size === undefined ? {} : { limit: probeFor(size, ROSTER_MAXIMUM) };
    },
    response: (result, sort, limit) => {
      const entries = result.entries;
      if (!Array.isArray(entries)) unsupported('answer');
      if (limit === undefined || limit === null) return entries;
      // The same proof the brokered reads use. Five call sites ask for
      // `ALL_ROWS` and no order, which is "everybody" rather than a page, and
      // they are served exactly when the answer shows there is no more.
      if (entries.length >= probeFor(limit, ROSTER_MAXIMUM)) incomplete('User');
      return entries.slice(0, limit);
    },
  }),

  /**
   * The broker family's three entities, wired to the seven call sites that
   * read them. These need no migration and no new contract: D16's ceiling
   * already admitted them, `20260919180000_record_brokers.sql` already serves
   * them read-only, and the store already has it applied — what was missing
   * was any handler at all, so nothing in the browser could reach the family.
   *
   * Every one of the seven asks for an order the family does not have, and
   * three of them for a predicate, so all seven are served under the
   * complete-set rule above.
   */
  'Announcement.list': Object.freeze({
    ...brokeredRead({ entity: 'Announcement', sortable: ['created_date', 'updated_date', 'priority'], filtered: false }),
    reason: 'The admin manager reads every announcement; the family serves the rows and this supplies the order.',
  }),
  'Announcement.filter': Object.freeze({
    ...brokeredRead({
      entity: 'Announcement',
      sortable: ['created_date', 'updated_date', 'priority'],
      filterable: ['is_active', 'type'],
      filtered: true,
    }),
    reason: 'The dashboard widget reads active announcements only, which the family has no predicate for.',
  }),
  /**
   * `-severity` is a text enum, so descending is `medium, low, high,
   * critical` rather than most-severe-first. That is what the product does
   * today and this reproduces it; changing it is a product decision, and one
   * worth taking, but not inside a port.
   */
  'FacilityDocumentationRule.list': Object.freeze({
    ...brokeredRead({
      entity: 'FacilityDocumentationRule',
      sortable: ['severity', 'created_date', 'updated_date'],
      filtered: false,
    }),
    reason: 'Three screens read the facility rules the same way: every rule, ordered by severity.',
  }),
  'RegulatoryUpdate.filter': Object.freeze({
    ...brokeredRead({
      entity: 'RegulatoryUpdate',
      sortable: ['created_date', 'updated_date', 'effective_date'],
      filterable: ['status', 'category', 'impact_level', 'source'],
      filtered: true,
    }),
    reason: 'The monitor reads every update and the nurse alert reads the approved and implemented ones.',
  }),
});

export const ROUTED_OPERATIONS = Object.freeze(Object.keys(ENTITY_ROUTES).sort());

/** The route for one entity operation, or null when none is declared. */
export function routeFor(entity, operation) {
  const key = `${entity}.${operation}`;
  return Object.hasOwn(ENTITY_ROUTES, key) ? ENTITY_ROUTES[key] : null;
}
