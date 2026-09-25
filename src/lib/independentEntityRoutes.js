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

/** Every contract in `20260920570000_contract_clinical_library.sql` clamps here. */
export const LIBRARY_MAXIMUM = 1000;

/**
 * A read served by a named contract that answers `{ entries, complete }`.
 *
 * `request` is the per-route part — which of the contract's own arguments the
 * call site's query means — and it runs AFTER the query and sort have been
 * parsed for their refusals, so a predicate this file cannot express never
 * reaches the service. The predicate is then applied here as well, because a
 * contract's own filter is coarser than Base44's: `EducationMaterial.filter`
 * asks for published materials and the contract's `published_only` answers
 * that, but a screen asking for `is_published: false` would be answered by
 * neither and has to refuse.
 *
 * The limit is passed through rather than probed. `complete` comes from the
 * contract, so there is nothing to infer from the page's length, and a limit
 * above the ceiling is not a refusal for the reason `probeFor` gives above.
 */
function libraryRead({ capability, sortable, filterable = [], filtered = false, request }) {
  const argumentsOf = (args) => (filtered ? args : [undefined, ...args]);
  return {
    function: capability,
    projection: 'library_row',
    request: (...args) => {
      const [query, sort, limit] = argumentsOf(args);
      predicate(query, filterable);
      sortKey(sort, sortable);
      const size = limit === undefined || limit === null
        ? LIBRARY_MAXIMUM : Math.min(pageSize(limit), LIBRARY_MAXIMUM);
      return { ...(request ? request(query) : {}), limit: size };
    },
    response: (answer, ...args) => {
      const [query, sort, limit] = argumentsOf(args);
      if (!answer || !Array.isArray(answer.entries)) unsupported('answer');
      // The contract measured this, so a page that is not the whole set is a
      // real refusal rather than a guess from its length.
      if (answer.complete !== true) incomplete(capability);
      const key = sortKey(sort, sortable);
      const kept = answer.entries.filter(predicate(query, filterable));
      const rows = key ? ordered(kept, key.field, key.descending) : kept;
      return limit === undefined || limit === null ? rows : rows.slice(0, limit);
    },
  };
}

/** The roster contract's own ceiling (`least(greatest(limit, 1), 500)`). */
export const ROSTER_MAXIMUM = 500;

/**
 * The reference reads' ceilings, as each contract clamps them.
 *
 * Unlike the broker family's, these differ per capability, and unlike the
 * roster's they sit BELOW what several call sites ask for — `ALL_ROWS` is 5,000
 * and the Medicare rule read stops at 2,000. That gap is the reason
 * `servedPage` exists rather than a reason to widen a contract.
 */
export const REFERENCE_MAXIMUM = Object.freeze({
  MedicareComplianceRule: 2000,
  MedicareGuideline: 2000,
  Physician: 2000,
  DocumentTemplate: 500,
  LibraryDocument: 500,
  OnCallShift: 2000,
  VisitPointConfig: 100,
});

/**
 * The exact sort strings a contract implements, and nothing adjacent.
 *
 * `sortKey` above is right for the broker family, where this file does the
 * ordering and either direction is arithmetic it can perform. These contracts
 * order in SQL, so the direction is fixed too: a screen asking `created_date`
 * ascending of a contract that returns newest-first must refuse, not receive
 * the reverse of what it asked for. An absent order is spelled `''`, and a
 * contract that chose its own order (the Medicare rules, read by reference)
 * accepts only that.
 */
function exactSort(sort, allowed) {
  const asked = sort === undefined || sort === null ? '' : sort;
  if (typeof asked !== 'string' || !allowed.includes(asked)) unsupported('sort');
  return asked;
}

/**
 * A page from a contract that ordered it in SQL, proved complete where it has
 * to be.
 *
 * The broker family's rule is that a page cannot be re-ordered. This is the
 * other half of the same argument: a page a contract ordered IS a true top-N,
 * so trimming it to the caller's own smaller bound loses nothing and needs no
 * proof. What does need proof is a caller whose bound is ABOVE the contract's
 * ceiling, because there "everything" and "the first 2,000 of it" are different
 * answers and the screen cannot tell them apart. So the proof is required in
 * exactly that case and skipped in the other, rather than applied everywhere
 * and turning every `ALL_ROWS` call site into a refusal.
 */
function servedPage(entries, limit, maximum, entity) {
  if (!Array.isArray(entries)) unsupported('answer');
  const probe = probeFor(limit, maximum);
  if (probe <= limit && entries.length >= probe) incomplete(entity);
  return entries.slice(0, limit);
}

/** A caller's row bound, required: a page has no completeness without one. */
function boundedSize(limit) {
  const size = pageSize(limit);
  if (size === undefined) unsupported('limit_required');
  return size;
}

/** The three orders `contract_physician_list` implements, by the sort that means each. */
const PHYSICIAN_ORDERS = Object.freeze({
  '-created_date': 'recent',
  'full_name': 'name',
  '-referral_count': 'referrals',
});

/**
 * A filter object holding exactly one equality, on the one field the contract
 * takes a parameter for. Anything else refuses: a second key would be a
 * narrowing this cannot pass on, and a key the contract does not model would be
 * one it silently ignored.
 */
function onlyKey(query, field, entity) {
  if (query === undefined || query === null) return null;
  if (typeof query !== 'object' || Array.isArray(query)) unsupported('filter');
  const keys = Object.keys(query);
  if (keys.length !== 1 || keys[0] !== field) unsupported('filter_field');
  const value = query[field];
  if (typeof value !== 'boolean') unsupported(`filter_${entity}`);
  return value;
}

/**
 * The rota's window, taken apart into the contract's two text dates.
 *
 * Only `$gte` and `$lte` on `shift_date`, both or neither: a half-open window
 * is expressible and the call site never asks for one, and admitting a shape no
 * screen uses would be a route claiming more than it was checked against.
 */
function shiftWindow(query) {
  if (query === undefined || query === null) return { from: null, to: null };
  if (typeof query !== 'object' || Array.isArray(query)) unsupported('filter');
  const keys = Object.keys(query);
  if (keys.length !== 1 || keys[0] !== 'shift_date') unsupported('filter_field');
  const condition = query.shift_date;
  if (condition === null || typeof condition !== 'object' || Array.isArray(condition)) unsupported('filter_operator');
  const bounds = Object.keys(condition).sort();
  if (bounds.length !== 2 || bounds[0] !== '$gte' || bounds[1] !== '$lte') unsupported('filter_operator');
  return { from: condition.$gte, to: condition.$lte };
}

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

  /**
   * The seven reference and configuration reads (D101), across nine routes and
   * seventeen call sites.
   *
   * These differ from every route above in where the work happens. The broker
   * family offers no order and no predicate, so this file supplies both over a
   * set it proved complete. Each of these has a contract that orders and filters
   * IN SQL — which is why the on-call rota's date WINDOW is servable at all, and
   * why a screen asking for a month of shifts gets the month rather than a page
   * of it. What this file does here is translate: an entity call's sort string
   * into the word the contract takes, its filter object into the contract's own
   * parameters, and its row bound into a page it will either prove or refuse.
   *
   * Two things are deliberately NOT translated. A sort the contract does not
   * implement refuses instead of being approximated — including the same field
   * in the other direction, which `exactSort` is for — and a filter key outside
   * the contract's parameters refuses instead of being dropped, because a
   * narrowing a screen asked for and did not get is invisible on the screen.
   */
  'MedicareComplianceRule.list': Object.freeze({
    function: 'listMedicareComplianceRules',
    projection: 'medicare_compliance_rule_row',
    // The largest single group in this batch, and the plainest: all seven ask
    // for everything in no particular order, which the contract answers by
    // Conditions-of-Participation reference — the order a reader looks a rule
    // up in, and a total one, so the page is stable.
    reason: 'Seven screens read the published Medicare rules the same way: every rule, no order asked.',
    request: (sort, limit) => {
      exactSort(sort, ['']);
      return { limit: probeFor(boundedSize(limit), REFERENCE_MAXIMUM.MedicareComplianceRule) };
    },
    response: (result, sort, limit) =>
      servedPage(result.entries, limit, REFERENCE_MAXIMUM.MedicareComplianceRule, 'MedicareComplianceRule'),
  }),
  'MedicareGuideline.filter': Object.freeze({
    function: 'listMedicareGuidelines',
    projection: 'medicare_guideline_row',
    reason: 'The guidelines library reads the active CMS guidance, most recently fetched first.',
    request: (query, sort, limit) => {
      exactSort(sort, ['-last_fetched_date']);
      const active = onlyKey(query, 'is_active', 'MedicareGuideline');
      return {
        limit: probeFor(boundedSize(limit), REFERENCE_MAXIMUM.MedicareGuideline),
        active,
      };
    },
    response: (result, query, sort, limit) =>
      servedPage(result.entries, limit, REFERENCE_MAXIMUM.MedicareGuideline, 'MedicareGuideline'),
  }),
  /**
   * The physician directory, whose three call sites want three different
   * orders — newest, by name, and by referral count. The contract takes the
   * order as a WORD from a fixed set rather than a column, so this is where the
   * three sort strings become those three words, and a fourth refuses.
   */
  'Physician.list': Object.freeze({
    function: 'listPhysicians',
    projection: 'physician_row',
    reason: 'The fax recipient picker and the follow-up queue both read the referral-source directory.',
    request: (sort, limit) => ({
      limit: probeFor(boundedSize(limit), REFERENCE_MAXIMUM.Physician),
      order: PHYSICIAN_ORDERS[exactSort(sort, Object.keys(PHYSICIAN_ORDERS))],
      active: null,
    }),
    response: (result, sort, limit) =>
      servedPage(result.entries, limit, REFERENCE_MAXIMUM.Physician, 'Physician'),
  }),
  'Physician.filter': Object.freeze({
    function: 'listPhysicians',
    projection: 'physician_row',
    reason: 'The directory screen reads the active physicians, busiest referrers first.',
    request: (query, sort, limit) => ({
      limit: probeFor(boundedSize(limit), REFERENCE_MAXIMUM.Physician),
      order: PHYSICIAN_ORDERS[exactSort(sort, Object.keys(PHYSICIAN_ORDERS))],
      active: onlyKey(query, 'is_active', 'Physician'),
    }),
    response: (result, query, sort, limit) =>
      servedPage(result.entries, limit, REFERENCE_MAXIMUM.Physician, 'Physician'),
  }),
  'DocumentTemplate.list': Object.freeze({
    function: 'listDocumentTemplates',
    projection: 'document_template_row',
    // The contract deliberately does not restate the tenant predicate: the
    // policy admits an agency's own templates OR any row flagged
    // `is_system_template`, whoever owns it, and those are most of what these
    // screens show.
    reason: 'Template management and the onboarding strip both read the newest templates first.',
    request: (sort, limit) => {
      exactSort(sort, ['-created_date']);
      return { limit: probeFor(boundedSize(limit), REFERENCE_MAXIMUM.DocumentTemplate) };
    },
    response: (result, sort, limit) =>
      servedPage(result.entries, limit, REFERENCE_MAXIMUM.DocumentTemplate, 'DocumentTemplate'),
  }),
  /**
   * The clinical library. `file_url` comes back through D77's locator map, so
   * until the file copy has run it is null rather than the Base44 URL it holds
   * today — the screen shows a document it cannot open yet instead of one that
   * quietly still comes from the platform we are leaving.
   */
  'LibraryDocument.list': Object.freeze({
    function: 'listLibraryDocuments',
    projection: 'library_document_row',
    reason: 'The template library reads the agency\'s own library documents, newest first.',
    request: (sort, limit) => {
      exactSort(sort, ['-created_date']);
      return { limit: probeFor(boundedSize(limit), REFERENCE_MAXIMUM.LibraryDocument) };
    },
    response: (result, sort, limit) =>
      servedPage(result.entries, limit, REFERENCE_MAXIMUM.LibraryDocument, 'LibraryDocument'),
  }),
  /**
   * The on-call rota, and the one call in this batch whose predicate is not an
   * equality: a month is `{shift_date: {$gte, $lte}}`. The contract takes the
   * window as two text dates and refuses an impossible day itself, which is why
   * this passes the strings through rather than parsing them here — a browser
   * that parsed them would be deciding what the store then has to agree with.
   */
  'OnCallShift.filter': Object.freeze({
    function: 'listOnCallShifts',
    projection: 'on_call_shift_row',
    reason: 'The schedule screen reads one month of shifts, which needs a range the family has not got.',
    request: (query, sort, limit) => {
      exactSort(sort, ['']);
      const window = shiftWindow(query);
      return { limit: probeFor(boundedSize(limit), REFERENCE_MAXIMUM.OnCallShift), ...window };
    },
    response: (result, query, sort, limit) =>
      servedPage(result.entries, limit, REFERENCE_MAXIMUM.OnCallShift, 'OnCallShift'),
  }),
  /**
   * The visit point schedule. Both call sites live in one `queryFn`, and the
   * filtered one is D43's derived scope in miniature: it asks for the rows whose
   * `agency_name` string matches the caller's own profile field. The contract
   * scopes by the envelope's `agency_id` instead, so that filter is already
   * satisfied before it is applied — and it is still applied here, over a set
   * this proved complete, because a route that dropped a narrowing the screen
   * asked for would be answering a different question.
   */
  'VisitPointConfig.list': Object.freeze({
    function: 'listVisitPointConfigs',
    projection: 'visit_point_config_row',
    reason: 'The timesheet form reads the agency point schedule, most recently updated first.',
    request: (sort, limit) => {
      exactSort(sort, ['-updated_date']);
      return { limit: probeFor(boundedSize(limit), REFERENCE_MAXIMUM.VisitPointConfig) };
    },
    response: (result, sort, limit) =>
      servedPage(result.entries, limit, REFERENCE_MAXIMUM.VisitPointConfig, 'VisitPointConfig'),
  }),
  'VisitPointConfig.filter': Object.freeze({
    function: 'listVisitPointConfigs',
    projection: 'visit_point_config_row',
    reason: 'The same read, narrowed by the agency name the screen already holds on the profile.',
    request: (query, sort, limit) => {
      exactSort(sort, ['-updated_date']);
      predicate(query, ['agency_name']);
      return { limit: probeFor(boundedSize(limit), REFERENCE_MAXIMUM.VisitPointConfig) };
    },
    response: (result, query, sort, limit) => {
      const page = servedPage(result.entries, limit, REFERENCE_MAXIMUM.VisitPointConfig, 'VisitPointConfig');
      return page.filter(predicate(query, ['agency_name']));
    },
  }),

  /**
   * The clinical library, patient education and per-agency configuration:
   * seven entities served by named contracts rather than by the generic
   * family, so each route names its own capability.
   *
   * These differ from the brokered reads above in one way that matters. A
   * broker returns rows and this file supplies the order and the predicate,
   * which is why `probeFor` has to infer completeness from a short page. These
   * contracts do the ordering and the filtering in SQL and ANSWER
   * `{ entries, complete }`, so completeness is measured by the thing that
   * holds the rows rather than reconstructed here. `complete` is what lets a
   * screen passing `ALL_ROWS` be served: it is naming a bound it does not
   * expect to reach, and the contract saying it did not reach it is proof.
   *
   * Only the operations whose call sites pass arguments this file can READ are
   * declared. `ClinicalLibraryTemplate.list`'s pager passes a computed skip and
   * `PatientEducationAssignment.filter` passes `patient?.id`, so neither can be
   * proved here and neither is claimed — the contract and handler exist either
   * way, which is the half that has to be built whatever the browser seam
   * turns out to be.
   */
  'ClinicalPathway.list': Object.freeze({
    ...libraryRead({ capability: 'listClinicalPathways', sortable: ['created_date'] }),
    reason: 'The pathway manager reads every pathway, newest first.',
  }),
  'ClinicalPathway.filter': Object.freeze({
    ...libraryRead({
      capability: 'listClinicalPathways',
      sortable: ['created_date'],
      filterable: ['is_active'],
      filtered: true,
      request: (query) => ({ active_only: query?.is_active === true }),
    }),
    reason: 'The OASIS recommender and the trigger both read the active pathways.',
  }),
  'ClinicalLibraryFolder.list': Object.freeze({
    ...libraryRead({ capability: 'listClinicalLibraryFolders', sortable: ['order'] }),
    reason: 'The library manager reads the agency-wide folders and the caller\'s own, in display order.',
  }),
  'EducationMaterial.filter': Object.freeze({
    ...libraryRead({
      capability: 'listEducationMaterials',
      sortable: ['last_used_date'],
      filterable: ['is_published'],
      filtered: true,
      request: (query) => ({ published_only: query?.is_published === true }),
    }),
    reason: 'The education library and the care-plan engine both read the published materials.',
  }),
  'CustomValidationRule.list': Object.freeze({
    ...libraryRead({ capability: 'listCustomValidationRules', sortable: ['created_date'] }),
    reason: 'The validation rule manager is the only screen, and only an agency_admin reaches it.',
  }),
  'AIConfiguration.list': Object.freeze({
    ...libraryRead({
      capability: 'readAiConfiguration',
      sortable: [],
      request: () => ({ scope: 'agency' }),
    }),
    reason: 'The admin manager reads the agency settings, which are the rows with no user_email.',
  }),
  'AIConfiguration.filter': Object.freeze({
    ...libraryRead({
      capability: 'readAiConfiguration',
      sortable: [],
      filtered: true,
      request: () => ({ scope: 'mine' }),
    }),
    reason: 'User settings reads the caller\'s own preferences, which the empty filter meant all along.',
  }),
});

export const ROUTED_OPERATIONS = Object.freeze(Object.keys(ENTITY_ROUTES).sort());

/** The route for one entity operation, or null when none is declared. */
export function routeFor(entity, operation) {
  const key = `${entity}.${operation}`;
  return Object.hasOwn(ENTITY_ROUTES, key) ? ENTITY_ROUTES[key] : null;
}
