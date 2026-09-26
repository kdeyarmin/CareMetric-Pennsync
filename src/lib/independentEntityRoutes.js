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
 * The sort arguments the roster page can honour, and the contract order each
 * one asks for.
 *
 * The roster now serves two orders: email with the user id as the tiebreaker,
 * and `created_date` DESCENDING with nulls last and the same tiebreakers. So
 * `-created_date` — which 25 of the frontend's call sites pass, and which this
 * route used to refuse — maps to `created_desc`.
 *
 * Bare `created_date` is still refused, and deliberately: the contract has one
 * direction, ascending is a different page of people, and answering it with
 * the descending one would silently reorder a screen. That is the same reason
 * every other sort is refused rather than served in the default order.
 */
const ROSTER_SORTS = Object.freeze(Object.assign(Object.create(null), {
  '': undefined, email: undefined, '+email': undefined, '-created_date': 'created_desc',
}));

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

function rosterOrder(sort) {
  if (sort === undefined || sort === null) return undefined;
  // `Object.create(null)` above rather than a plain literal, so a sort string
  // of `constructor` or `toString` is an unknown order rather than a hit on a
  // prototype member — and `hasOwn` rather than a truthiness test, since two of
  // the four accepted sorts map to `undefined` on purpose.
  if (typeof sort !== 'string' || !Object.hasOwn(ROSTER_SORTS, sort)) unsupported('sort');
  return ROSTER_SORTS[sort];
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
    // Declared rather than derived: `request` takes a rest parameter, so its
    // `length` is 0 and says nothing about how many arguments this can express.
    arity: filtered ? 3 : 2,
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
    // Declared for `brokeredRead`'s reason: a rest parameter hides the count.
    arity: filtered ? 3 : 2,
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
      const key = sortKey(sort, sortable);
      const kept = answer.entries.filter(predicate(query, filterable));
      const rows = key ? ordered(kept, key.field, key.descending) : kept;
      // The contract measured completeness, so a short page is a fact rather
      // than a guess from its length — but an incomplete page is only a
      // REFUSAL when the caller asked for the whole set. A screen asking for
      // the newest 50 published materials is asking for a bounded page, and
      // Base44 answered it with 50 of however many exist; refusing that would
      // break the screen the moment an agency had 51.
      //
      // Two conditions make a bounded page the caller's page rather than an
      // arbitrary slice of it. The contract has to have done the ordering,
      // which `sortable` is the list of — a sort it does not implement has
      // already refused above. And nothing may have been dropped here: where
      // the contract's own filter is coarser than the query (`is_published:
      // false` is a question `published_only` cannot ask), the rows removed
      // locally came out of a page that was cut in SQL first, so the answer
      // would be short for a reason the caller cannot see. Either of those
      // and completeness is required again.
      const bounded = Number.isInteger(limit) && limit > 0 && limit < LIBRARY_MAXIMUM;
      if (answer.complete !== true
        && !(bounded && kept.length === answer.entries.length)) incomplete(capability);
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
 * The seven operational tables, and why their routes are thinner than the
 * brokered ones above.
 *
 * `20260920580000_contract_operational_tables.sql` takes the order and the
 * predicate as PARAMETERS and applies both in SQL, so there is nothing for
 * this file to re-order and no complete set to prove. What a route does here
 * is take the entity call's arguments apart and refuse the ones its contract
 * cannot express — a sort field it does not order by, a filter field it has no
 * parameter for, an operator other than equality.
 *
 * The one place a bound still has to be proved is the ceiling. The contracts
 * clamp a page at 5,000 rows, and two screens ask for 10,000, so a full page
 * at the ceiling cannot be told from a truncated one and the route raises
 * `STAGING_ENTITY_PAGE_INCOMPLETE` rather than rendering 5,000 conversions as
 * the agency's whole history. Below the ceiling there is nothing to prove: the
 * store did the ordering, so the newest hundred really are the newest hundred.
 */
export const OPERATIONAL_MAXIMUM = 5000;

/** The order parameter for a sort argument, against what the contract orders by. */
function orderKey(sort, orderable) {
  if (sort === undefined || sort === null || sort === '') return undefined;
  if (typeof sort !== 'string' || !sort.startsWith('-')) unsupported('sort');
  const field = sort.slice(1);
  if (!orderable.includes(field)) unsupported('sort');
  return field;
}

/**
 * A filter object as the NAMED parameters a contract takes, rather than as a
 * predicate applied here.
 *
 * `$ne` is admitted for exactly the fields whose contract has an
 * `exclude_status`-shaped parameter, because `patientHistoryAnalyzer` asks for
 * a patient's tasks that are not completed and a route that dropped the
 * operator would answer with the completed ones included.
 */
function namedFilters(query, filterable, negatable = []) {
  if (query === undefined || query === null) return {};
  if (typeof query !== 'object' || Array.isArray(query)) unsupported('filter');
  const named = {};
  for (const [field, condition] of Object.entries(query)) {
    if (condition !== null && typeof condition === 'object') {
      const keys = Object.keys(condition);
      if (keys.length !== 1 || keys[0] !== '$ne' || !negatable.includes(field)) {
        unsupported('filter_operator');
      }
      named[`exclude_${field}`] = condition.$ne;
      continue;
    }
    if (!filterable.includes(field)) unsupported('filter_field');
    named[field] = condition;
  }
  return named;
}

/** A page the contract's ceiling cannot have truncated invisibly. */
function wholePage(entries, limit, entity) {
  if (!Array.isArray(entries)) unsupported('answer');
  if (limit !== undefined && limit !== null
    && limit > OPERATIONAL_MAXIMUM && entries.length >= OPERATIONAL_MAXIMUM) {
    incomplete(entity);
  }
  return entries;
}

/**
 * A read over one operational table: the filter as named parameters, the sort
 * as the contract's order parameter, the limit passed through.
 */
function operationalRead({ entity, fn, orderable, filterable = [], negatable = [], filtered }) {
  return {
    function: fn,
    projection: 'operational_row',
    // Declared for `brokeredRead`'s reason: a rest parameter's `length` is 0,
    // so nothing can be derived from it and #302's guard throws at load.
    arity: filtered ? 3 : 2,
    request: (...args) => {
      const [query, sort, limit] = filtered ? args : [undefined, args[0], args[1]];
      const order = orderKey(sort, orderable);
      return {
        ...namedFilters(query, filterable, negatable),
        ...(order === undefined ? {} : { order }),
        ...(pageSize(limit) === undefined ? {} : { limit: pageSize(limit) }),
      };
    },
    response: (result, ...args) => {
      const limit = filtered ? args[2] : args[1];
      return wholePage(result?.entries, limit, entity);
    },
  };
}

/** `Entity.create(payload)` onto a contract that takes a field object. */
function operationalCreate({ fn, key, reason }) {
  return Object.freeze({
    function: fn,
    projection: 'operational_row',
    reason,
    request: (fields) => {
      if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) {
        unsupported('fields');
      }
      return { fields };
    },
    response: (result) => result?.[key],
  });
}

/**
 * `Entity.update(id, payload)` onto a contract that takes an id and a field
 * object, and `Entity.create(payload)` onto the same contract with no id.
 *
 * One contract serves both because the screens do: a settings panel and a
 * template builder each call `create` the first time and `update` after, and
 * the contract's id parameter is what tells them apart. An absent id is a
 * create; there is no third case.
 */
function operationalSave({ fn, key, reason, withId }) {
  return Object.freeze({
    function: fn,
    projection: 'operational_row',
    reason,
    // An update takes the row's id and the payload; a create takes the payload
    // alone. Declared because the rest parameter hides both counts.
    arity: withId ? 2 : 1,
    request: (...args) => {
      const [id, fields] = withId ? args : [undefined, args[0]];
      if (withId && (typeof id !== 'string' || id === '')) unsupported('id');
      if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) {
        unsupported('fields');
      }
      return withId ? { id, fields } : { fields };
    },
    response: (result) => result?.[key],
  });
}

/**
 * The declared routes for the seven, kept out of the object literal below so
 * the reason for each stays beside the call sites it serves.
 *
 * EIGHT OF THESE ROUTES ARE DECLARED UNPROVED, and that is the gate's third
 * disposition rather than a gap. `AgencySettings.create` and `.update`,
 * `CarePlan.update`, `FaceToFaceEncounter.create` and `.update`,
 * `NoteConversion.create`, and `PDFTemplate.update` and `.delete` each take a
 * payload the screen builds at run time — `AgencySettings.create(payload)` —
 * so `tools-entity-call-arguments.mjs` reads every one of their call sites as
 * indeterminate and `check:entity-routes` can prove nothing about the route.
 * It reports them rather than refusing them, which means the contract's own
 * refusal suite against the real migration is the whole of what checks these
 * eight. Repo-wide the unreadable writes are 84 of 91, so this disposition is
 * what lets any batch land a write seam at all.
 *
 * TWO ENTITY OPERATIONS OF THESE SEVEN STAY ON BASE44 although their
 * capabilities ship here, and `src/lib/operationalRoutes.test.js` holds each
 * reason as a check that fails when it lapses, rather than as a note here that
 * would not. `Task.create` is provable and was held first by the gate's
 * (file, key) subtraction, which #297 fixed; it is still held because that
 * fix's own regression test PLANTS `Task.create` as its route and asserts the
 * measurement rises, so declaring it here makes the baseline already contain
 * it and the test fails. The hold is now one line in another batch's test
 * file rather than anything about the route. `NoteConversion.filter` waits on
 * its own contract, which takes one of the five predicates its call site
 * narrows on while that caller requires exactly one row; dropping the other
 * four would turn a duplicate check into a read that can return two.
 *
 * Every projection here is `operational_row`, which is the entity's own
 * columns less `source_app_id` and less whatever its contract withholds. Two
 * withhold something a screen may notice, and both are why these entities
 * could not be brokered in the first place. `AgencySettings` returns no
 * credential-digest claim columns, which nothing in `src/` reads. `PDFTemplate`
 * and `DocumentRecord` return `template_file_url` and `file_url` RESOLVED
 * (D77): an owned `cmfile:` handle, or null while the file copy has not run.
 * A screen that renders a download link gets nothing to link to rather than a
 * link into Base44's storage, and that is the per-screen work these two
 * routes hand their adopter.
 *
 * One more thing an adopter should expect. Every projection here carries the
 * row's `id` and its `agency_id`, and every write refuses both by name, so a
 * screen that duplicates a record by spreading the row it just read back into
 * a create gets a `FIELD_RESERVED` refusal rather than a copy. That is the
 * contract saying the tenancy is not the caller's to send; the screen's fix is
 * to name the fields it means to copy.
 */
const operationalRoutes = Object.freeze({
  'AgencySettings.list': Object.freeze({
    ...operationalRead({
      entity: 'AgencySettings', fn: 'getAgencySettings',
      orderable: ['created_date'], filtered: false,
    }),
    reason: 'The settings loader reads the agency configuration newest first.',
  }),
  'AgencySettings.filter': Object.freeze({
    ...operationalRead({
      entity: 'AgencySettings', fn: 'getAgencySettings',
      orderable: ['created_date'], filterable: ['agency_code', 'office_name'],
      filtered: true,
    }),
    // The lookup stays and the tenancy behind it goes: the agency is the
    // envelope's now, so naming another agency's code finds nothing.
    reason: 'agencySettings.js looks its row up by agency code and then by office name.',
  }),

  'Task.filter': Object.freeze({
    ...operationalRead({
      entity: 'Task', fn: 'listAgencyTasks',
      orderable: ['created_date', 'due_date'],
      filterable: ['patient_id', 'related_entity', 'related_entity_id'],
      negatable: ['status'], filtered: true,
    }),
    reason: 'Four screens read an agency task list, three of them for one chart.',
  }),
  'PDFTemplate.list': Object.freeze({
    ...operationalRead({
      entity: 'PDFTemplate', fn: 'listPdfTemplates',
      orderable: ['created_date'], filtered: false,
    }),
    reason: 'The template manager and the library both read every template, newest first.',
  }),
  'PDFTemplate.filter': Object.freeze({
    ...operationalRead({
      entity: 'PDFTemplate', fn: 'listPdfTemplates',
      orderable: ['created_date'], filterable: ['parent_template_id'], filtered: true,
    }),
    reason: 'The version history reads the revisions of one parent template.',
  }),
  'PDFTemplate.create': operationalCreate({
    fn: 'savePdfTemplate', key: 'template',
    reason: 'The builder and the manager both create a template from an uploaded file.',
  }),

  'CarePlan.filter': Object.freeze({
    ...operationalRead({
      entity: 'CarePlan', fn: 'listCarePlans',
      orderable: ['created_date', 'updated_date'],
      filterable: ['id', 'patient_id'], filtered: true,
    }),
    reason: 'The interactive care plan reads one plan by id and a chart’s plans by patient.',
  }),
  'CarePlan.create': Object.freeze({
    function: 'saveCarePlan',
    projection: 'operational_row',
    // `patient_id` is lifted out of the payload because it is the row's whole
    // tenancy — `care_plan` has no `agency_id` — so the contract takes it as a
    // parameter of its own and refuses it as a field.
    reason: 'The analyzer writes the care plan it generated for one chart.',
    request: (fields) => {
      if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) {
        unsupported('fields');
      }
      const { patient_id: patientId, ...rest } = fields;
      if (typeof patientId !== 'string' || patientId === '') unsupported('patient_id');
      return { patient_id: patientId, fields: rest };
    },
    response: (result) => result?.care_plan,
  }),

  'FaceToFaceEncounter.filter': Object.freeze({
    ...operationalRead({
      entity: 'FaceToFaceEncounter', fn: 'listFaceToFaceEncounters',
      orderable: ['created_date'], filterable: ['referral_id'], filtered: true,
    }),
    reason: 'Referral intake reads the encounter already recorded against a referral.',
  }),

  'DocumentRecord.filter': Object.freeze({
    ...operationalRead({
      entity: 'DocumentRecord', fn: 'listPatientDocumentRecords',
      orderable: ['created_date'], filterable: ['patient_id'], filtered: true,
    }),
    // Its contract keeps the original's ownership rule, so this answers with
    // the caller's own uploads for that chart unless they are an agency_admin.
    reason: 'Both fax dialogs read the documents already held for one chart.',
  }),

  'AgencySettings.create': operationalSave({
    fn: 'saveAgencySettings', key: 'settings', withId: false,
    reason: 'Three admin panels write the agency\u2019s settings row the first time there is none.',
  }),
  'AgencySettings.update': operationalSave({
    fn: 'saveAgencySettings', key: 'settings', withId: true,
    reason: 'The same three panels write the agency\u2019s settings row once it exists.',
  }),
  'CarePlan.update': operationalSave({
    fn: 'saveCarePlan', key: 'care_plan', withId: true,
    reason: 'The interactive care plan saves the plan a clinician edited in place.',
  }),
  'FaceToFaceEncounter.create': operationalSave({
    fn: 'saveFaceToFaceEncounter', key: 'encounter', withId: false,
    reason: 'The encounter form records a new face-to-face for a chart.',
  }),
  'FaceToFaceEncounter.update': operationalSave({
    fn: 'saveFaceToFaceEncounter', key: 'encounter', withId: true,
    reason: 'The encounter form amends a face-to-face already recorded.',
  }),
  'NoteConversion.create': operationalCreate({
    fn: 'createNoteConversion', key: 'conversion',
    reason: 'The note converter records each conversion it performed.',
  }),
  'PDFTemplate.update': operationalSave({
    fn: 'savePdfTemplate', key: 'template', withId: true,
    reason: 'The builder and the manager both save an existing template.',
  }),
  'PDFTemplate.delete': Object.freeze({
    function: 'deletePdfTemplate',
    projection: 'operational_row',
    reason: 'The template manager deletes a template the agency no longer issues.',
    request: (id) => {
      if (typeof id !== 'string' || id === '') unsupported('id');
      return { id };
    },
    response: (result) => result?.template,
  }),

  'NoteConversion.list': Object.freeze({
    ...operationalRead({
      entity: 'NoteConversion', fn: 'listNoteConversions',
      orderable: ['created_date'], filtered: false,
    }),
    reason: 'Three reports read the agency’s note conversions newest first.',
  }),
});

/**
 * The declared routes.
 *
 * `request` builds the handler’s input from the entity call’s own arguments —
 * and refuses rather than dropping one. `response` takes the handler’s answer
 * apart into the shape the entity method’s callers already expect: an ARRAY
 * for `list`, the ROW for `get`.
 */
/**
 * Each batch E read contract's own page ceiling, as
 * `20260920580000_contract_screen_records.sql` passes it to `screen_limit`.
 *
 * It is here because the route needs it to know when an answer could be
 * truncated, and it is a SECOND COPY of a number that lives in SQL — which is
 * the shape that drifts where nothing measures it. So
 * `independentEntityRoutes.spec.js` reads the ceilings back out of the
 * migration and fails if any of them disagrees with this table, rather than a
 * comment here claiming they match.
 */
export const SCREEN_CEILINGS = Object.freeze({
  listChartClinicalEvents: 200,
  listChartRecommendations: 200,
  listOcrCorrections: 500,
  listOcrTrainingRuns: 200,
  listSentEducationMaterials: 200,
  lookupComplianceRule: 50,
});


/**
 * Batch E's nine reads, each a named contract that orders and pages IN SQL.
 *
 * So no re-ordering happens here and the complete-set rule has nothing to
 * prove about the order — the contract's `order by` is the screen's own. What
 * it still has to prove is the SIZE: a screen passing `ALL_ROWS` against a
 * contract whose ceiling is 500 would render 500 rows as the whole set, which
 * is the same lie in a different place. So a limit above the ceiling is served
 * only when the answer comes back short of it.
 *
 * `order` is the ONE sort string the contract produces, and anything else
 * refuses. There is no swapping: an order a screen asked for and did not get
 * is invisible on the screen, which is why `sortKey` exists at all.
 *
 * `query` names the filter fields the contract takes as parameters. A field
 * outside it refuses rather than being dropped, and a field inside it is
 * passed to the contract rather than applied here — the contract's predicate
 * runs under the policies, and one applied after the page would narrow a set
 * the store had already decided.
 */
function screenRead({ entity, function: handler, projection, order, ceiling, query = {}, filtered, build }) {
  const read = (args) => {
    const [rawQuery, sort, limit] = filtered ? args : [undefined, args[0], args[1]];
    if (sort !== undefined && sort !== null && sort !== order) unsupported('sort');
    if (rawQuery !== undefined && rawQuery !== null) {
      if (typeof rawQuery !== 'object' || Array.isArray(rawQuery)) unsupported('filter');
      for (const field of Object.keys(rawQuery)) {
        if (!Object.hasOwn(query, field)) unsupported('filter_field');
        if (rawQuery[field] !== null && typeof rawQuery[field] === 'object') unsupported('filter_operator');
      }
    }
    return { query: rawQuery ?? {}, size: pageSize(limit) };
  };
  return {
    function: handler,
    projection,
    // DECLARED, because `request` takes a rest parameter and so reveals a
    // `length` of 0. `read` above destructures `(query, sort, limit)` for a
    // filtered read and `(sort, limit)` for a list, which is the entity
    // method's own signature; a fourth argument is an argument this route has
    // no parameter for, and the guard refuses it rather than discarding it.
    arity: filtered ? 3 : 2,
    request: (...args) => {
      const { query: asked, size } = read(args);
      return build(asked, size === undefined ? undefined : Math.min(size, ceiling));
    },
    response: (result, ...args) => {
      const entries = result?.entries;
      if (!Array.isArray(entries)) unsupported('answer');
      const { size } = read(args);
      // Only a caller who asked for MORE than the contract can give needs the
      // proof; anybody at or under the ceiling got exactly what they asked for.
      if (size !== undefined && size > ceiling && entries.length >= ceiling) incomplete(entity);
      return size === undefined ? entries : entries.slice(0, size);
    },
  };
}

const DECLARED_ROUTES = Object.freeze({
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
   * It supplies `created_date` and can be read in `created_date` DESCENDING
   * order, which is what `-created_date` asks for and what 25 of the call sites
   * here were refused on — 24 of which this releases, the twenty-fifth staying
   * refused because it also passes an offset the route has no parameter for. It still supplies no `full_name` — the carried `user`
   * table has no name column at all (D69) — so a site sorting or labelling on a
   * name is still per-screen work rather than a route this file can write, and
   * the gate counts those as unserved rather than adopted.
   *
   * The two are entangled and the figures should not be read as independent: 16
   * files read `role` or `account_type` and 15 of those also read `full_name`
   * off a roster row, so the name is the binding constraint for almost all of
   * them and this order alone does not release them.
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
      const order = rosterOrder(sort);
      const size = pageSize(limit);
      return {
        ...(size === undefined ? {} : { limit: probeFor(size, ROSTER_MAXIMUM) }),
        ...(order === undefined ? {} : { order }),
      };
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
  /**
   * Batch E: the seven entities whose screens read them RAW, with no Base44
   * function between the browser and the row. Each one's authorization was the
   * entity's own access block, and five of the seven say something the owned
   * store's policies do not — so these routes reach named contracts that carry
   * it, never a generic read.
   *
   * Nine of the twelve batch E call sites are here. The other three are
   * `NotificationPreference.create`/`.update` and `PatientRecommendation.
   * create`, which pass a whole variable as their payload: the route gate
   * proves a declaration by running each call site's real arguments, and it
   * cannot read those, so declaring them would fail the build rather than
   * serve anything. The capabilities exist — `saveMyNotificationPreferences`
   * and `recordChartRecommendation` — and the seam for them is per-screen work
   * once those payloads are named at the call site.
   *
   * `ComplianceRule.create` and `.update` are absent for a different and
   * permanent reason: D83 makes a global reference table migration-written, so
   * there is no writer to route to.
   */
  'ClinicalEvent.filter': Object.freeze({
    ...screenRead({
      entity: 'ClinicalEvent',
      function: 'listChartClinicalEvents',
      projection: 'chart_clinical_event',
      order: '-event_date',
      ceiling: SCREEN_CEILINGS.listChartClinicalEvents,
      query: { patient_id: true },
      filtered: true,
      build: (query, limit) => ({ patient_id: query.patient_id ?? null, ...(limit === undefined ? {} : { limit }) }),
    }),
    reason: 'The chart timeline reads one patient\'s events, which D24 narrows to the caller\'s care team.',
  }),
  'PatientRecommendation.filter': Object.freeze({
    ...screenRead({
      entity: 'PatientRecommendation',
      function: 'listChartRecommendations',
      projection: 'chart_recommendation_status',
      order: '-created_date',
      ceiling: SCREEN_CEILINGS.listChartRecommendations,
      query: { patient_id: true },
      filtered: true,
      build: (query, limit) => ({ patient_id: query.patient_id ?? null, ...(limit === undefined ? {} : { limit }) }),
    }),
    // The projection name is doing work: the analyser counts statuses and the
    // contract returns the id and the status ONLY (D64), so a screen reading
    // a title here gets `undefined` rather than a row that rode into a prompt.
    reason: 'The outcomes analyser counts a chart\'s recommendations by status and reads no other field.',
  }),
  'OCRFeedback.list': Object.freeze({
    ...screenRead({
      entity: 'OCRFeedback',
      function: 'listOcrCorrections',
      projection: 'ocr_correction',
      order: '-created_date',
      ceiling: SCREEN_CEILINGS.listOcrCorrections,
      filtered: false,
      build: (_query, limit) => (limit === undefined ? {} : { limit }),
    }),
    reason: 'The corrections dashboard reads every correction the caller wrote, newest first.',
  }),
  'OCRFeedback.filter': Object.freeze({
    ...screenRead({
      entity: 'OCRFeedback',
      function: 'listOcrCorrections',
      projection: 'ocr_correction',
      order: null,
      ceiling: SCREEN_CEILINGS.listOcrCorrections,
      query: { applied_to_training: true },
      filtered: true,
      build: (query, limit) => ({
        ...(Object.hasOwn(query, 'applied_to_training') ? { applied_to_training: query.applied_to_training } : {}),
        ...(limit === undefined ? {} : { limit }),
      }),
    }),
    // This one asks for `ALL_ROWS` against a 500-row contract, so it is served
    // exactly when the answer comes back short of the ceiling.
    reason: 'The training monitor reads the corrections not yet folded into a session, which is a contract parameter.',
  }),
  'OCRTrainingSession.list': Object.freeze({
    ...screenRead({
      entity: 'OCRTrainingSession',
      function: 'listOcrTrainingRuns',
      projection: 'ocr_training_run',
      order: '-created_date',
      ceiling: SCREEN_CEILINGS.listOcrTrainingRuns,
      filtered: false,
      build: (_query, limit) => (limit === undefined ? {} : { limit }),
    }),
    reason: 'The training monitor reads an agency\'s runs, which the entity gates on the admin tier.',
  }),
  'SentEducationMaterial.list': Object.freeze({
    ...screenRead({
      entity: 'SentEducationMaterial',
      function: 'listSentEducationMaterials',
      projection: 'sent_education_material',
      order: '-sent_date',
      ceiling: SCREEN_CEILINGS.listSentEducationMaterials,
      filtered: false,
      build: (_query, limit) => (limit === undefined ? {} : { limit }),
    }),
    // The panel loses `personalized_content`, which the contract does not
    // project: a row's whole patient-specific body on a list screen.
    reason: 'The education library\'s activity panel reads what the caller has sent, newest first.',
  }),
  'SentEducationMaterial.create': Object.freeze({
    function: 'recordSentEducationMaterial',
    projection: 'sent_education_material_id',
    // `patient_name`, `sent_by` and `sent_date` are DROPPED rather than
    // forwarded, and that is the one place this file does drop an argument. It
    // is deliberate and the contract is why: all three are derived from the
    // chart the contract just authorized and from the caller's own identity,
    // so forwarding the screen's copies would let a second answer disagree
    // with the store's. Everything the caller genuinely owns is forwarded, and
    // a field outside the contract's list is refused there BY NAME (D39).
    reason: 'The material sender records one send against a chart it has already opened.',
    request: (material) => {
      if (material === null || typeof material !== 'object' || Array.isArray(material)) unsupported('payload');
      const { patient_id: patientId, patient_name: _name, sent_by: _sender, sent_date: _sent, ...rest } = material;
      return { patient_id: patientId ?? null, material: rest };
    },
    response: (result) => ({ id: result?.id }),
  }),
  'NotificationPreference.filter': Object.freeze({
    function: 'getMyNotificationPreferences',
    projection: 'own_notification_preference',
    // The screen reads `prefs[0]`, so the answer is an ARRAY of nought or one.
    // The address is forwarded rather than dropped: the contract refuses one
    // that is not the caller's, because answering a question about somebody
    // else with an answer about the caller is right every time and
    // unverifiable.
    reason: 'The settings screen reads the caller\'s own notification preferences by their address.',
    request: (query) => {
      if (query === null || typeof query !== 'object' || Array.isArray(query)) unsupported('filter');
      for (const field of Object.keys(query)) {
        if (field !== 'user_email') unsupported('filter_field');
        if (query[field] !== null && typeof query[field] === 'object') unsupported('filter_operator');
      }
      return Object.hasOwn(query, 'user_email') ? { user_email: query.user_email } : {};
    },
    response: (result) => (result?.found ? [result.preference] : []),
  }),
  'ComplianceRule.filter': Object.freeze({
    ...screenRead({
      entity: 'ComplianceRule',
      function: 'lookupComplianceRule',
      projection: 'compliance_rule',
      order: '-created_date',
      ceiling: SCREEN_CEILINGS.lookupComplianceRule,
      query: { rule_code: true },
      filtered: true,
      build: (query, limit) => ({ rule_code: query.rule_code ?? null, ...(limit === undefined ? {} : { limit }) }),
    }),
    // Its two siblings on the same screen, `create` and `update`, have no
    // route and will not get one: D83 says a global reference table is written
    // by migration and never at runtime.
    reason: 'The regulatory monitor looks a rule up by its auditor-matchable code before offering a change.',
  }),
  /**
   * Batch E's three writes, declared UNPROVED.
   *
   * Every one of their call sites passes a whole variable as its payload, so
   * `check:entity-routes` cannot run the real arguments through `request` and
   * cannot prove the route serves them. Under batch A's third disposition that
   * is a declaration reported as unproved rather than counted as adopted — and
   * the reason it is safe to declare is that "cannot prove this serves" and
   * "does not serve" are different states. What checks these is the contract's
   * own refusal suite against the real migration: an unknown field is
   * `PENNSYNC_SCREEN_FIELD_NOT_WRITABLE`, a chart the caller cannot open is
   * `PENNSYNC_SCREEN_PATIENT_NOT_VISIBLE`, somebody else's row is
   * `PENNSYNC_SCREEN_NOT_YOUR_ROWS`, and each of those is raised in
   * `contract-screen-records.test.mjs` on the side that raises it.
   *
   * What the screens lose is the entity's own answer shape. Base44 returned
   * the created row and these return the id, so a screen reading a field back
   * off the answer gets `undefined` rather than a stale value — the per-screen
   * work Stage J is made of, and the reason `projection` is declared.
   */
  'PatientRecommendation.create': Object.freeze({
    function: 'recordChartRecommendation',
    projection: 'chart_recommendation_id',
    reason: 'The OASIS chart pusher creates one recommendation against a chart the contract authorizes.',
    request: (recommendation) => {
      if (recommendation === null || typeof recommendation !== 'object' || Array.isArray(recommendation)) {
        unsupported('payload');
      }
      const { patient_id: patientId, ...rest } = recommendation;
      return { patient_id: patientId ?? null, recommendation: rest };
    },
    response: (result) => ({ id: result?.id }),
  }),
  'NotificationPreference.create': Object.freeze({
    function: 'saveMyNotificationPreferences',
    projection: 'own_notification_preference_id',
    // `user_email` is dropped because the contract takes it from the caller
    // and refuses a payload naming it; the screen sends its own copy, which is
    // the same address by construction and a second answer if it ever is not.
    reason: 'The settings screen creates the caller\'s preference row when they have never saved one.',
    request: (preference) => {
      if (preference === null || typeof preference !== 'object' || Array.isArray(preference)) {
        unsupported('payload');
      }
      const { user_email: _address, id: _id, ...rest } = preference;
      return { expected_id: null, preference: rest };
    },
    response: (result) => ({ id: result?.id }),
  }),
  'NotificationPreference.update': Object.freeze({
    function: 'saveMyNotificationPreferences',
    projection: 'own_notification_preference_id',
    // The id is FORWARDED, never dropped: the contract checks the row is the
    // caller's and refuses if it is not, which it cannot do without it.
    reason: 'The settings screen saves over the preference row it is already holding the id of.',
    request: (id, preference) => {
      if (typeof id !== 'string' || id === '') unsupported('subject');
      if (preference === null || typeof preference !== 'object' || Array.isArray(preference)) {
        unsupported('payload');
      }
      const { user_email: _address, id: _id, ...rest } = preference;
      return { expected_id: id, preference: rest };
    },
    response: (result) => ({ id: result?.id }),
  }),
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
  ...operationalRoutes,
});

/**
 * Every declared route, with an argument it has no parameter for REFUSED.
 *
 * The adapter calls `route.request(...args)`, and JavaScript discards an
 * argument past the last parameter without a word. So the module's own first
 * rule — a route that cannot honour the call's own arguments refuses — held for
 * every argument a route READ and failed for every argument it did not have a
 * parameter for, which is the same disclosure bug arriving from the direction
 * nothing was watching. `User.list` takes `(sort, limit)`, and
 * `src/lib/agencyRoster.js` pages it with a third argument: a request for the
 * second fifty was answered with the first fifty, and a screen paging a roster
 * would read that as the whole of it. It was refused in practice only because
 * of its sort, which is an accident and not a guard.
 *
 * The count is the route's own `request.length` wherever that is readable, so a
 * route cannot declare an arity that disagrees with its parameters. A route
 * whose `request` takes a rest parameter has a `length` of 0 and must say what
 * it accepts; one that neither declares nor reveals an arity throws HERE, at
 * module load, rather than silently admitting everything — a guard that fails
 * open on the case it cannot read is the house defect.
 */
function guardingArity(routes) {
  return Object.freeze(Object.fromEntries(Object.entries(routes).map(([key, route]) => {
    const arity = route.request.length || route.arity;
    if (!Number.isSafeInteger(arity) || arity < 1) {
      throw new Error(`ENTITY_ROUTE_ARITY_UNDECLARED: ${key}`);
    }
    return [key, Object.freeze({
      ...route,
      arity,
      request: (...args) => {
        if (args.length > arity) unsupported('argument_count');
        return route.request(...args);
      },
    })];
  })));
}

export const ENTITY_ROUTES = guardingArity(DECLARED_ROUTES);

export const ROUTED_OPERATIONS = Object.freeze(Object.keys(ENTITY_ROUTES).sort());

/** The route for one entity operation, or null when none is declared. */
export function routeFor(entity, operation) {
  const key = `${entity}.${operation}`;
  return Object.hasOwn(ENTITY_ROUTES, key) ? ENTITY_ROUTES[key] : null;
}
