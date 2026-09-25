#!/usr/bin/env node
/**
 * What a per-name release of the ported business API actually depends on.
 *
 * `docs/RAILWAY_GO_LIVE_PLAN_2026-09-21.md` (stage D) ends on one bullet:
 * "release per function, behind the existing per-name gate: the patient read
 * pair, then the create, then the visit family, then the rest by blast
 * radius". Releasing is an operator action — `PENNSYNC_API_FUNCTIONS` is a
 * comma-separated list and `PENNSYNC_API_RELEASE=enabled-v1` opens it — and
 * `loadConfig` already refuses a name that is not in the registry, a
 * duplicate, a release with no authority and a release with no stated app.
 *
 * What it cannot refuse is a name whose CONTRACT is not in the target store.
 * A released handler reaches a reviewed per-capability contract by a fixed RPC
 * name, and that RPC is created by exactly one record migration. Release a
 * name whose migration a deployment has not applied and every startup check
 * passes, `/readyz` reports ready, and each call fails in the store — the same
 * silent shape as a stated-but-wrong `PENNSYNC_API_APP_ID`, which the plan
 * singles out for exactly this reason.
 *
 * So this derives, per handler name: the contracts it reaches, the migrations
 * that define them, whether any of them WRITES, and whether the handler needs
 * the integration runtime. From that it builds
 * the ladder and emits each wave's `PENNSYNC_API_FUNCTIONS` value, so the
 * operator copies a value the repository has checked rather than typing one.
 *
 * The first three waves are DECLARED, because the plan's order is a judgement
 * about blast radius and the plan is where such a judgement belongs. Each is
 * then re-checked against the tree, the way `DECLARED_UNIQUE` is in
 * `tools-entity-schema-plan.mjs`: a declared name that is not a handler, or
 * that is declared twice, or a mutating handler declared into a read wave,
 * fails the run. "The rest by blast radius" is DERIVED rather than typed —
 * read-only first, then mutating, then the ones that need that runtime.
 *
 * What it does NOT do is state the runtime's condition from a constant. It was
 * "deployed and paused" here in four places until 2026-09-25, when the service
 * was released and began serving both AI operations and every one of them went
 * silently false — a literal that reads like a measurement, which is the defect
 * this repository keeps finding. A wave now says what it REQUIRES, and
 * `--integration-deployment <https://host>` measures whether that holds.
 *
 * Whether a handler needs the runtime is the REGISTRY's answer, because
 * `/readyz` is decided from the same flag — but it is crossed against what the
 * tree can reach (D92), both directions, so a released send cannot sit in a
 * wave that does not require the runtime to be configured.
 *
 * This authorizes nothing and releases nothing. It reads committed source.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// The ledger's own identity for a migration, imported rather than reproduced:
// an operator checking a prerequisite queries `supabase_migrations.schema_migrations`,
// whose `version` is the file's whole STEM, so printing the file name alone
// gives them a string that matches nothing there.
import { ledgerVersion } from './tools-pennsync-migrate.mjs';

export const LADDER_CONTRACT = 'cm.pennsync.release-ladder.v1';

const SERVICE = 'services/pennsync-api';
const MIGRATIONS = 'services/authority-store/supabase/record-migrations';
/**
 * The authority store's own migrations, which apply BEFORE the record ones and
 * define the `pennsync_private` helpers a contract's call graph reaches. Read
 * for the graph only: a contract is never attributed to a file here.
 */
const AUTHORITY_MIGRATIONS = 'services/authority-store/supabase/migrations';

/**
 * The plan's own order, as far as it names names. Each wave is re-checked
 * against the tree below; nothing here is trusted for being written down.
 */
export const DECLARED_WAVES = Object.freeze([
  Object.freeze({
    name: 'patient-read',
    reason: 'the plan\'s "patient read pair": the narrowest useful surface, and no write.',
    readOnly: true,
    handlers: Object.freeze(['listAuthorizedPatients', 'getAuthorizedPatient']),
  }),
  Object.freeze({
    name: 'patient-write',
    reason: 'the plan\'s "then the create". Update rides with it: both are the chart root.',
    readOnly: false,
    handlers: Object.freeze(['createAuthorizedPatient', 'updateAuthorizedPatient']),
  }),
  Object.freeze({
    name: 'visit',
    reason: 'the plan\'s "then the visit family", read and write together as one family.',
    readOnly: false,
    handlers: Object.freeze([
      'listAuthorizedVisits', 'getAuthorizedVisit',
      'createAuthorizedVisit', 'updateAuthorizedVisit',
    ]),
  }),
]);

const INTEGRATIONS_MODULE = 'integrations.mjs';

/**
 * What an integration wave requires that runtime to be SERVING, read out of the
 * business API's own allowlist rather than typed here — the same reason the
 * wave's membership is derived from the registry instead of listed.
 *
 * `BROKERED_OPERATIONS` is D56's ratchet and is the UNCONDITIONAL set.
 * `DELIVERY_OPERATIONS` is deliberately not included: mail has a switch of its
 * own (`PENNSYNC_API_DELIVERY`), so requiring it would make every integration
 * release wait on a decision about something else, and the two held send names
 * are out of every value anyway.
 *
 * Refuses rather than defaulting to an empty set, because an empty requirement
 * makes `integrationRuntimeHolds` vacuously true — a gate that reports a wave
 * safe against a runtime it did not actually ask about.
 */
export function brokeredOperationsRequired(root) {
  const file = `${SERVICE}/${INTEGRATIONS_MODULE}`;
  const source = read(resolve(root, SERVICE, INTEGRATIONS_MODULE))
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const found = /export const BROKERED_OPERATIONS\s*=\s*Object\.freeze\(\[([^\]]*)\]\)/.exec(source);
  if (!found) refuse('LADDER_BROKERED_OPERATIONS_UNREADABLE', { file });
  const names = [...found[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map(match => match[1] ?? match[2]);
  if (!names.length) refuse('LADDER_BROKERED_OPERATIONS_EMPTY', { file });
  return Object.freeze(names);
}

/** The derived tail of the ladder, in the order "by blast radius" resolves to. */
export const DERIVED_WAVES = Object.freeze([
  Object.freeze({ name: 'read-only', reason: 'reaches no contract that writes, and no separate runtime.' }),
  Object.freeze({ name: 'mutating', reason: 'writes through a contract. No dependency beyond the store.' }),
  Object.freeze({ name: 'integration', reason: 'reaches the integration runtime, which must therefore be'
    + ' released and serving the brokered operations.' }),
]);

/**
 * Names the OWNER has withheld from every release, whatever wave the
 * derivation puts them in.
 *
 * This is NOT a readiness question and is deliberately not expressed through
 * `needsIntegration`. The hold is ORTHOGONAL to the derivation: wherever the
 * tree puts these two, `releasable` strips them, and every wave reports what
 * it withheld. What holds them back is a decision about who may be sent mail,
 * which no property of the tree can answer.
 *
 * This paragraph used to say they were "refusal-only today — they touch no
 * store and reach no runtime — so the derivation is right to put them in the
 * read-only wave". #269 gave both `needsIntegration: true` and they have been
 * in the INTEGRATION wave since, so the note describing the hold had gone
 * false about the thing it was describing. It now names no wave, because a
 * comment that names one goes stale the next time the derivation moves.
 *
 * It exists because the exclusion used to live nowhere the tool could see. The
 * read-only wave was released on 2026-09-25 as this tool's output with these
 * two struck out by hand, and re-running `--wave read-only` would have emitted
 * them again. A rule kept in a document is not a check; a value an operator
 * pastes has to come out of the emitter already correct.
 *
 * Releasing one means deleting its entry here, with the owner's word, in the
 * same change as the code that makes the send real.
 */
export const OWNER_HELD = Object.freeze({
  sendAccountReadyEmail: 'Outbound mail to real people is the owner\'s decision (D56):'
    + ' releasing it hands invitee names to an outside provider.',
  sendWelcomeEmail: 'The same decision, and the sharper half of it: this message\'s body'
    + ' carries a working temporary password.',
});

/** The held names, sorted, for reporting. */
export const heldNames = Object.freeze(Object.keys(OWNER_HELD).sort());

/**
 * Every emitted value passes through this. Applied per wave AND to the
 * cumulative list, because a held name reaching an operator by either path is
 * the same mistake.
 */
export const releasable = names => names.filter(name => !Object.hasOwn(OWNER_HELD, name));

/**
 * Held names found in emitted values, by wave. Split out from `checkLadder` so
 * it can be driven with a wave the emitter would never build: the guard exists
 * for a SECOND emitter added later that forgets `releasable`, and a guard that
 * cannot be made to fire has not been shown to work.
 */
export const heldLeaks = waves => waves
  .map(entry => ({
    wave: entry.name,
    handlers: String(entry.adds).split(',').filter(name => Object.hasOwn(OWNER_HELD, name)),
  }))
  .filter(entry => entry.handlers.length);

export class LadderError extends Error {
  constructor(code, detail) { super(code); this.code = code; this.detail = detail; }
}
const refuse = (code, detail) => { throw new LadderError(code, detail); };

/**
 * A contract body that writes.
 *
 * Deliberately not anchored with a trailing `\b`: the first draft matched
 * `update\s+"?pennsync\b`, and the store's own DML reads
 * `update "pennsync_records"."patient_alert"`, where `_` continues the word
 * and the boundary never matches. It reported `contract_alert_update` — a
 * function whose whole body is four `update` statements — as read-only, which
 * would have put a write into the read wave. `mutationClassifierHolds` below
 * is the check that keeps that from going quiet again.
 */
const DML = /\b(?:insert\s+into|update\s+(?:only\s+)?"?pennsync|delete\s+from)/i;
/**
 * A call into another function of this store. A contract reaches a write
 * through one of these as often as it writes itself — D37's audit append and
 * D48's notification mint are both facilities, `contract_credential_*_sweep`'s
 * whole body is one `select credential_sweep(...)`, and both `*_transition`
 * contracts delegate to a `pennsync_private` helper. So the write is resolved
 * TRANSITIVELY over the call graph rather than against a list of facility
 * names, which would have gone stale the first time a sixth one was added.
 */
const CALL = /"?\b(pennsync_records|pennsync_private)\b"?\s*\.\s*"?([a-z0-9_]+)"?\s*\(/gi;

/** Where a qualified name is a relation rather than a function. */
const TABLE_POSITION = /\b(?:insert\s+into|into|from|join|update(?:\s+only)?|table|truncate)\s+"?$/i;

/**
 * Verbs whose contract MUST write, so a classifier that stops working says so
 * rather than reporting a ladder built on it.
 *
 * `review` is deliberately NOT here. `contract_clinical_event_review` reads
 * and writes nothing — D64's pair "only READ, and says so" — so a verb list
 * that demanded a write from it would refuse a correct tree. A verb belongs
 * here only when the capability's whole point is the write.
 */
const MUTATING_VERBS = Object.freeze([
  'accept', 'acknowledge', 'add', 'append', 'archive', 'create', 'import', 'mark_all',
  'record', 'save', 'submit', 'sweep', 'transition', 'update', 'used',
]);

const read = path => readFileSync(path, 'utf8');
const serviceFiles = root => readdirSync(resolve(root, SERVICE))
  .filter(name => name.endsWith('.mjs') && !name.endsWith('.test.mjs')).sort();

/**
 * Every `create function` in the record migrations, with the body that follows
 * it, keyed by schema and name. The body runs to the next `create function` in
 * the file, which is what separates one definition from the next here: every
 * migration in this directory defines its functions one after another, and the
 * grants between them carry no DML.
 *
 * One re-declaration is legitimate and is admitted by NAME of its shape rather
 * than by an exception list: a D88 catch-up carries an object from a
 * regenerated migration to a store that already applied it, so it says
 * `create or replace` and its body is byte-identical to the one it repeats.
 * Nothing is a guess there — both definitions are the same definition — and
 * the migration that DEFINES the contract is still the first. Anything else is
 * refused as before, including an `or replace` whose body differs, which is
 * the case that would really make "which one is this" unanswerable.
 */
export function functionBodies(root) {
  const pattern = /create\s+(or\s+replace\s+)?function\s+(?:"?([a-z_]+)"?\s*\.\s*)?"?([A-Za-z0-9_]+)"?\s*\(/gi;
  const bodies = new Map();
  // Authority first, because that is the order they apply in, and because a
  // helper there is legitimately redefined by a later migration — the store
  // evolves, so the LAST definition is the one a contract calls.
  for (const directory of [AUTHORITY_MIGRATIONS, MIGRATIONS]) {
    const path = resolve(root, directory);
    for (const file of readdirSync(path).filter(name => name.endsWith('.sql')).sort()) {
      const sql = read(resolve(path, file));
      for (const match of sql.matchAll(pattern)) {
        const replaces = Boolean(match[1]);
        const key = `${(match[2] ?? '').toLowerCase()}.${match[3]}`;
        const body = dollarQuotedBody(sql, match.index, key, file);
        // Within the record migrations a name defined twice would make "the
        // migration that defines this contract" a guess, so it is refused
        // rather than last-one-wins. That invariant is this directory's alone.
        const seen = directory === MIGRATIONS && bodies.get(key)?.directory === MIGRATIONS
          ? bodies.get(key) : null;
        if (seen && !(replaces && seen.body === body)) {
          refuse('LADDER_FUNCTION_DEFINED_TWICE', { key, files: [seen.file, file] });
        }
        // The first file keeps the key: a catch-up repeats a definition, it
        // does not become the place the definition lives.
        if (!seen) bodies.set(key, { file, body, directory });
      }
    }
  }
  return bodies;
}

/**
 * One function's body, taken between its dollar-quote delimiters.
 *
 * The first draft sliced from one `create function` to the next instead, which
 * reads like the same thing and is not: everything between two definitions
 * comes with it — the grants, and any standalone statement the migration runs.
 * `20260920050000_patient_purpose_policy.sql` ends its projection helpers with
 * a backfill, so the patient READ contracts inherited an `insert into` none of
 * them contains and the declared read wave was refused for carrying a write.
 * Both mistakes pointed the same way, which is why the classifier check exists
 * — but a false WRITE is the one a name-shape check cannot catch, so the body
 * is now bounded by what actually delimits it.
 */
export function dollarQuotedBody(sql, from, key, file) {
  const opening = /\bas\s+(\$[A-Za-z_]*\$)/g;
  opening.lastIndex = from;
  const found = opening.exec(sql);
  // No body at all means the scan has misread the file rather than found a
  // function that does nothing, so it claims nothing.
  if (!found) refuse('LADDER_FUNCTION_BODY_UNDELIMITED', { key, file });
  const start = found.index + found[0].length;
  const end = sql.indexOf(found[1], start);
  if (end < 0) refuse('LADDER_FUNCTION_BODY_UNTERMINATED', { key, file, tag: found[1] });
  return sql.slice(start, end);
}

/**
 * What one function reaches: whether it writes, and which record migrations
 * its call closure lives in.
 *
 * The closure rather than the definition, because a release prerequisite is
 * everything the contract needs present. `contract_patient_create` claims the
 * new chart through `pennsync_private.claim_new_chart`, which is its own
 * migration — release the contract without it and every create fails in the
 * store while the service reports ready.
 *
 * Fails CLOSED: a call into `pennsync_records` or `pennsync_private` that the
 * migrations do not define means the graph cannot be walked to the end, and an
 * unwalkable graph is refused rather than answered "no write found".
 */
export function closureOf(bodies, key, contract, seen = new Set()) {
  if (seen.has(key)) return { mutates: false, files: [] };
  seen.add(key);
  const entry = bodies.get(key);
  if (!entry) refuse('LADDER_CALL_GRAPH_INCOMPLETE', { contract, missing: key });
  // Only the record migrations are reported as prerequisites. The authority
  // ones are read for the graph but apply before the record store exists at
  // all, so naming them would be noise rather than a thing to check.
  const files = entry.directory === MIGRATIONS ? [entry.file] : [];
  let mutates = DML.test(entry.body);
  // A qualified name followed by `(` is a call — unless the `(` is a column
  // list and the name is a TABLE: `insert into pennsync_private.chart_assignment (`
  // reads exactly like one. What settles it is whether the migrations define a
  // FUNCTION by that name, not where the name sits — the first draft used the
  // position, and dropped `select * into v_row from
  // pennsync_private.transition_membership(...)`, a set-returning function
  // called in a `from` clause, which is how the store's two write helpers are
  // reached. Position is consulted only for a name the migrations do not
  // define at all, so a genuinely unknown FUNCTION still fails closed.
  const calls = [];
  for (const match of entry.body.matchAll(CALL)) {
    const called = `${match[1].toLowerCase()}.${match[2]}`;
    // A recursive call is already handled by `seen`; a self-reference is not a
    // dependency on anything new.
    if (called === key) continue;
    if (bodies.has(called)) { calls.push(called); continue; }
    if (TABLE_POSITION.test(entry.body.slice(0, match.index))) continue;
    refuse('LADDER_CALL_GRAPH_INCOMPLETE', { contract, missing: called });
  }
  for (const called of calls) {
    const reached = closureOf(bodies, called, contract, seen);
    mutates = mutates || reached.mutates;
    files.push(...reached.files);
  }
  return { mutates, files };
}

/**
 * Each contract's RPC, the migration that defines it, and whether it writes.
 *
 * The RPC an entry names is the PUBLIC wrapper; the work is in the
 * `pennsync_records` function it selects from, so the write is classified from
 * that inner body. A wrapper that reaches no inner function is refused: it
 * would otherwise be classified read-only by having nothing in it.
 */
export function contractOrigins(root) {
  const source = read(resolve(root, SERVICE, 'record-contracts.mjs'));
  const entries = [...source.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*): Object\.freeze\(\{/gm)];
  const bodies = functionBodies(root);
  const origins = new Map();
  entries.forEach((entry, index) => {
    const block = source.slice(entry.index, entries[index + 1]?.index ?? source.length);
    const rpc = /rpc:\s*'([^']+)'/.exec(block)?.[1];
    if (!rpc) return;
    const wrapper = bodies.get(`public.${rpc}`);
    if (!wrapper) refuse('LADDER_CONTRACT_RPC_UNDEFINED', { contract: entry[1], rpc });
    const inner = /"?pennsync_records"?\s*\.\s*([A-Za-z0-9_]+)\s*\(/.exec(wrapper.body)?.[1];
    const target = inner ? bodies.get(`pennsync_records.${inner}`) : null;
    if (!target) refuse('LADDER_CONTRACT_BODY_UNREACHABLE', { contract: entry[1], rpc, inner: inner ?? null });
    const closure = closureOf(bodies, `pennsync_records.${inner}`, entry[1]);
    origins.set(entry[1], Object.freeze({
      contract: entry[1],
      rpc,
      // The wrapper's file, which is where the contract is reviewed, first;
      // then everything its closure needs.
      migrations: Object.freeze([...new Set([wrapper.file, target.file, ...closure.files])].sort()),
      mutates: closure.mutates,
    }));
  });
  if (!origins.size) refuse('LADDER_NO_CONTRACTS', { file: 'record-contracts.mjs' });
  return origins;
}

/**
 * The classifier's own check. A contract whose name carries a writing verb and
 * classifies read-only means the DML match has stopped working, not that the
 * store has a create that creates nothing — so it refuses instead of reporting
 * a ladder built on it. This is the check the `\b` bug would have failed.
 */
export function mutationClassifierHolds(origins) {
  const wrong = [...origins.values()]
    .filter(origin => !origin.mutates
      && MUTATING_VERBS.some(verb => origin.rpc.endsWith(`_${verb}`)))
    .map(origin => `${origin.contract} (${origin.rpc})`);
  if (wrong.length) refuse('LADDER_MUTATION_CLASSIFIER_BROKEN', { read_only_but_named_as_writing: wrong });
  return true;
}

/** `import { a, b as c } from './module.mjs'` → local name to module file. */
export function importedNames(source) {
  const map = new Map();
  for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\/([^']+)'/g)) {
    for (const specifier of match[1].split(',')) {
      const local = specifier.trim().split(/\s+as\s+/).pop()?.trim();
      if (local) map.set(local, match[2]);
    }
  }
  return map;
}

/**
 * Which contracts each handler reaches.
 *
 * Two hops, because a capability whose body lives in its own module reaches
 * its contract from there — the same reason `record-contracts.test.mjs` scans
 * every module rather than `handlers.mjs` alone. That test joins every module
 * together and proves the UNION, which cannot say which handler reached what;
 * this attributes it per name.
 *
 * It fails CLOSED. A `contract(` call whose name is not a literal makes the
 * handler's reach `dynamic`, which claims nothing and is refused by the gate —
 * the rule `entityReach` follows for a computed key and `invokedFunctions` for
 * an unparsed callee.
 */
export function handlerReach(root) {
  const source = read(resolve(root, SERVICE, 'handlers.mjs'));
  const imports = importedNames(source);
  const modules = new Map(serviceFiles(root)
    .map(name => [name, read(resolve(root, SERVICE, name))]));
  const contractsIn = text => [...text.matchAll(/\bcontract\(\s*'([A-Za-z0-9]+)'/g)].map(match => match[1]);
  const dynamicIn = text => /\bcontract\(\s*(?!')/.test(text);

  const start = source.indexOf('export const HANDLERS');
  if (start < 0) refuse('LADDER_HANDLERS_MISSING', { file: 'handlers.mjs' });
  const registry = source.slice(start);
  const entries = [...registry.matchAll(/\n {2}([A-Za-z][A-Za-z0-9]*): Object\.freeze\(\{/g)];
  if (!entries.length) refuse('LADDER_NO_HANDLERS', { file: 'handlers.mjs' });

  const reach = new Map();
  entries.forEach((entry, index) => {
    const block = registry.slice(entry.index, entries[index + 1]?.index ?? registry.length);
    const direct = contractsIn(block);
    let dynamic = dynamicIn(block);
    const delegates = [...new Set([...block.matchAll(/\b([A-Za-z][A-Za-z0-9]*)\s*\(/g)]
      .map(match => match[1]).filter(name => imports.has(name)).map(name => imports.get(name)))];
    const indirect = [];
    for (const file of delegates) {
      const text = modules.get(file);
      // An imported callee whose module is not in the service directory cannot
      // be read, so the reach is unknown rather than empty.
      if (text === undefined) { dynamic = true; continue; }
      indirect.push(...contractsIn(text));
      if (dynamicIn(text)) dynamic = true;
    }
    reach.set(entry[1], Object.freeze({
      handler: entry[1],
      contracts: Object.freeze([...new Set([...direct, ...indirect])].sort()),
      modules: Object.freeze(delegates.sort()),
      resolution: dynamic ? 'dynamic' : direct.length ? 'inline' : indirect.length ? 'module' : 'none',
    }));
  });
  return reach;
}

/** Everything about one handler that decides when it can be released. */
export function releaseFacts(root) {
  const origins = contractOrigins(root);
  mutationClassifierHolds(origins);
  const reach = handlerReach(root);
  const integration = integrationDependents(root);
  integrationFlagHolds(integration, integrationReach(root));
  const facts = [];
  for (const entry of reach.values()) {
    const unknown = entry.contracts.filter(name => !origins.has(name));
    if (unknown.length) refuse('LADDER_CONTRACT_UNKNOWN', { handler: entry.handler, contracts: unknown });
    const reached = entry.contracts.map(name => origins.get(name));
    facts.push(Object.freeze({
      handler: entry.handler,
      resolution: entry.resolution,
      contracts: entry.contracts,
      migrations: Object.freeze([...new Set(reached.flatMap(origin => origin.migrations))].sort()),
      mutates: reached.some(origin => origin.mutates),
      needsIntegration: integration.has(entry.handler),
    }));
  }
  return Object.freeze(facts);
}

/**
 * The handlers the registry marks as reaching the integration runtime, read
 * from the registry's own flag rather than re-derived: `runtime.mjs` decides
 * readiness from `HANDLERS[name].needsIntegration`, so a second answer here
 * could disagree with the thing that actually gates the deployment.
 *
 * That is still the answer the ladder places a handler by. What
 * `integrationReach` adds is not a second answer but a CROSS-CHECK of this
 * one, for the reason `account-email.mjs` writes down in its own header.
 */
export function integrationDependents(root) {
  const source = read(resolve(root, SERVICE, 'handlers.mjs'));
  const start = source.indexOf('export const HANDLERS');
  const registry = source.slice(start < 0 ? 0 : start);
  const entries = [...registry.matchAll(/\n {2}([A-Za-z][A-Za-z0-9]*): Object\.freeze\(\{/g)];
  const names = new Set();
  entries.forEach((entry, index) => {
    const block = registry.slice(entry.index, entries[index + 1]?.index ?? registry.length);
    if (/needsIntegration:\s*true/.test(block)) names.add(entry[1]);
  });
  return names;
}

/**
 * Which handlers can REACH the integration runtime, derived from the tree.
 *
 * `integration` is minted per request in `app.mjs` and handed to `handle` as
 * one property of one object. There is no module-level access to it, and
 * nothing outside `integrations.mjs` and `runtime.mjs` names the runtime's URL
 * at all — both of which this checks below. So a handler that does not
 * destructure `integration` cannot call the runtime, whatever its module
 * imports, and one that does can.
 *
 * This exists because `account-email.mjs` records the hazard in its own header
 * and a header is not a check: while the send stays paused those two
 * capabilities are honestly read-only, and the release that deletes their two
 * `fail` lines has to set `needsIntegration: true` in the same change or the
 * ladder hands an operator two outbound senders inside the wave whose whole
 * promise is that nothing in it writes or sends. D78's lesson, which is the
 * house one: a rule in a document is not a check, and `chart_assignment`'s
 * locking rule was written down and then broken twice.
 *
 * It fails CLOSED on a signature it cannot read, the rule `handlerReach`
 * follows for a computed contract name: a `handle` that takes its dependencies
 * any other way is refused rather than read as reaching nothing, because the
 * silent answer here is the dangerous one.
 */
export function integrationReach(root) {
  const source = read(resolve(root, SERVICE, 'handlers.mjs'));
  const start = source.indexOf('export const HANDLERS');
  if (start < 0) refuse('LADDER_HANDLERS_MISSING', { file: 'handlers.mjs' });
  const registry = source.slice(start);
  const entries = [...registry.matchAll(/\n {2}([A-Za-z][A-Za-z0-9]*): Object\.freeze\(\{/g)];
  if (!entries.length) refuse('LADDER_NO_HANDLERS', { file: 'handlers.mjs' });

  const names = new Set();
  entries.forEach((entry, index) => {
    const block = registry.slice(entry.index, entries[index + 1]?.index ?? registry.length);
    const signature = /\bhandle\s*\(\s*\{([^}]*)\}/s.exec(block);
    if (!signature) {
      refuse('LADDER_HANDLER_DEPENDENCIES_UNREADABLE', {
        handler: entry[1],
        // Every one of them destructures today. A `handle(deps)` reading
        // `deps.integration`, or a rest element, is a shape this cannot answer
        // about, so it is a refusal and not a false negative.
        reason: 'handle does not destructure its dependency object',
      });
    }
    if (/\bintegration\b/.test(signature[1])) names.add(entry[1]);
  });

  // The other way to the runtime would be to fetch it directly out of
  // `config`, which four handlers destructure. Only the capability and the
  // config loader may name it, so the derivation above stays sufficient.
  for (const file of serviceFiles(root)) {
    if (file === 'integrations.mjs' || file === 'runtime.mjs') continue;
    if (/\bintegrationsUrl\b/.test(read(resolve(root, SERVICE, file)))) {
      refuse('LADDER_INTEGRATION_RUNTIME_REACHED_DIRECTLY', { file });
    }
  }
  return names;
}

/**
 * The outbound routes a release gate has to be able to SEE.
 *
 * D92's gate decides from whether a handler destructures `integration`, which
 * is the brokered route through the integration runtime. That is not the only
 * way this service could come to send something to a real person. The
 * invitation capabilities record intent and report `delivery_paused` because
 * D42 found their original send had no successor at all — Base44's own
 * `inviteUser` minted the account AND delivered the link — so the plausible
 * successor is a SUPABASE AUTH call, which never touches `integration` and
 * which D92 therefore cannot see. A handler that gained one could ship under a
 * name already sitting in a live `PENNSYNC_API_FUNCTIONS` value with nothing
 * in the build firing.
 *
 * So this is the same check over the other route: the five Auth calls that
 * cause Supabase to send mail to an address. It is a RATCHET over the whole
 * service rather than an attribution to one handler, because unlike
 * `integration` an Auth client is not handed to `handle` — it could be reached
 * through any module at any depth, and a scan that tried to attribute it would
 * fail open on the import chain it did not follow. Conservative on purpose:
 * the cost of a false positive is one line in `AUTH_SEND_DECLARED`, and the
 * cost of a false negative is an unannounced email to a real person.
 */
export const AUTH_SEND_CALLS = Object.freeze([
  'inviteUserByEmail',      // invitation
  'generateLink',           // any link Supabase mails, invite or recovery
  'signInWithOtp',          // magic link
  'resetPasswordForEmail',  // password reset
  'signUp',                 // sign-up confirmation
]);

/**
 * Files permitted to carry one of those calls, each with a reason.
 *
 * EMPTY today, and that is the measurement rather than a placeholder: nothing
 * in the service or the authority client reaches Supabase Auth to send. When
 * invitation delivery is built, its file goes here in the same change, which
 * is what makes the addition visible in a diff instead of silent.
 */
export const AUTH_SEND_DECLARED = Object.freeze({});

/**
 * Which service files reach an Auth send call, derived from the tree.
 *
 * Comments are stripped FIRST, which is D73's lesson: a scan that reads a file
 * for a name has to say whether it means absent from the CODE or absent from
 * the page, and two scans there failed on a header that named what it removed.
 * `account-email.mjs` is exactly that shape — its every `SendEmail` is prose —
 * so a scan that counted comments would report a sender that does not exist.
 * The call must also be CALLED: a bare mention is not a send.
 */
export function authSendReach(root) {
  const found = new Map();
  for (const file of serviceFiles(root)) {
    const text = read(resolve(root, SERVICE, file))
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const hits = AUTH_SEND_CALLS.filter(call => new RegExp(`\\b${call}\\s*\\(`).test(text));
    if (hits.length) found.set(file, hits);
  }
  return found;
}

/**
 * Both directions, for `integrationFlagHolds`' reasons. A file that reaches an
 * Auth send without a declaration is the dangerous one. A declaration without
 * the reach is the stale-hold shape D47 keeps finding: it outlives its reason
 * where nothing can notice, so it is refused too.
 */
export function authSendHolds(reached, declared = AUTH_SEND_DECLARED) {
  const undeclared = [...reached.keys()].filter(file => !Object.hasOwn(declared, file)).sort();
  const staleDeclaration = Object.keys(declared).filter(file => !reached.has(file)).sort();
  if (undeclared.length || staleDeclaration.length) {
    refuse('LADDER_AUTH_SEND_UNDECLARED', {
      undeclared: undeclared.map(file => ({ file, calls: reached.get(file) })),
      declared_without_reach: staleDeclaration,
    });
  }
}

/**
 * The registry's flag and the tree's reach must name the same handlers.
 *
 * Both directions are refused and they are different mistakes. A handler that
 * can call the runtime while the registry says it cannot is placed in a wave
 * that does not require the runtime to be configured, which is the wave-4
 * hazard above. A handler flagged without the reach is the opposite and still
 * wrong: it holds a name out of an earlier wave for a dependency it does not
 * have, and a wave nobody can release is how a ladder stops being used.
 */
export function integrationFlagHolds(flagged, reached) {
  const flaggedWithoutReach = [...flagged].filter(name => !reached.has(name)).sort();
  const reachWithoutFlag = [...reached].filter(name => !flagged.has(name)).sort();
  if (flaggedWithoutReach.length || reachWithoutFlag.length) {
    refuse('LADDER_INTEGRATION_FLAG_DISAGREES', {
      flagged_without_reach: flaggedWithoutReach,
      reach_without_flag: reachWithoutFlag,
    });
  }
}

/** The ladder: the declared waves re-checked, then the rest by blast radius. */
export function releaseLadder(root) {
  const facts = releaseFacts(root);
  const byName = new Map(facts.map(fact => [fact.handler, fact]));
  const placed = new Map();
  const waves = [];

  for (const declared of DECLARED_WAVES) {
    for (const handler of declared.handlers) {
      if (!byName.has(handler)) refuse('LADDER_DECLARED_NOT_A_HANDLER', { wave: declared.name, handler });
      if (placed.has(handler)) {
        refuse('LADDER_DECLARED_TWICE', { handler, waves: [placed.get(handler), declared.name] });
      }
      const fact = byName.get(handler);
      // A declared wave cannot quietly carry something the derivation would
      // have put later: a write in a read wave, or a name that needs the
      // paused runtime.
      if (declared.readOnly && fact.mutates) {
        refuse('LADDER_DECLARED_WRITE_IN_READ_WAVE', { wave: declared.name, handler, contracts: fact.contracts });
      }
      if (fact.needsIntegration) {
        refuse('LADDER_DECLARED_NEEDS_PAUSED_RUNTIME', { wave: declared.name, handler });
      }
      placed.set(handler, declared.name);
    }
    waves.push(wave(declared, declared.handlers.map(handler => byName.get(handler))));
  }

  const rest = facts.filter(fact => !placed.has(fact.handler));
  const buckets = {
    'read-only': rest.filter(fact => !fact.mutates && !fact.needsIntegration),
    mutating: rest.filter(fact => fact.mutates && !fact.needsIntegration),
    integration: rest.filter(fact => fact.needsIntegration),
  };
  for (const derived of DERIVED_WAVES) {
    const members = buckets[derived.name].slice()
      .sort((left, right) => left.handler.localeCompare(right.handler));
    for (const fact of members) placed.set(fact.handler, derived.name);
    waves.push(wave(derived, members));
  }

  const unplaced = facts.filter(fact => !placed.has(fact.handler)).map(fact => fact.handler);
  if (unplaced.length) refuse('LADDER_HANDLER_UNPLACED', { handlers: unplaced });
  return Object.freeze({
    contract: LADDER_CONTRACT,
    handlers: facts.length,
    contracts_reached: new Set(facts.flatMap(fact => fact.contracts)).size,
    unresolved: Object.freeze(facts.filter(fact => fact.resolution === 'dynamic').map(fact => fact.handler)),
    waves: Object.freeze(waves),
  });
}

function wave(declaration, members) {
  const names = members.map(fact => fact.handler);
  return Object.freeze({
    name: declaration.name,
    reason: declaration.reason,
    declared: Object.hasOwn(declaration, 'handlers'),
    // The wave's true membership, held names included: this says where the
    // derivation puts each handler, which stays true while a hold is on.
    handlers: Object.freeze(names),
    // What the derivation placed here and `OWNER_HELD` keeps out of the value.
    // Reported rather than silently dropped, so a shorter value than the
    // membership is explained where it is read.
    withheld: Object.freeze(names.filter(name => Object.hasOwn(OWNER_HELD, name))),
    // THIS WAVE'S OWN NAMES, and deliberately NOT called `functions` any more.
    //
    // It was, and its comment said "what an operator sets", which was false and
    // pointing the wrong way: the CLI's `--wave` prints the CUMULATIVE value
    // while this field is one wave's slice, and consecutive waves share not one
    // name. Composing a release from this field would have set 32 names and
    // silently REVOKED the 29 already serving, patients and visits included.
    // Two representations of one answer with the reader steered to the wrong
    // one — this repository's house defect, in the tool everybody reads.
    //
    // The value an operator sets comes from `cumulativeValue`, which is what
    // the CLI prints. A test asserts no wave carries a `functions` key, so the
    // trap cannot come back under its old name.
    adds: releasable(names).join(','),
    writes: members.some(fact => fact.mutates),
    needsIntegration: members.some(fact => fact.needsIntegration),
    // Every migration this wave's contracts live in. The target deployment has
    // to have applied all of them, cumulatively with the waves before it.
    migrations: Object.freeze([...new Set(members.flatMap(fact => fact.migrations))].sort()),
  });
}

/**
 * The gate. Two invariants, neither with a baseline: every handler's contract
 * reach is readable from source, and the declared waves agree with what the
 * tree says about the handlers they name.
 */
export function checkLadder(root) {
  const ladder = releaseLadder(root);
  if (ladder.unresolved.length) refuse('LADDER_REACH_UNRESOLVED', { handlers: ladder.unresolved });
  // A hold over a name the registry no longer has protects nothing while
  // reading as protection, so it is checked — but NOT here. `checkLadder` runs
  // over any tree, and a synthetic fixture legitimately has neither name; a
  // refusal here would fire on every fixture and say nothing about the real
  // registry. The staleness check belongs where the real tree is known, and
  // lives in this tool's test file against `HANDLER_NAMES` itself.
  //
  // The invariant that makes this a gate rather than a convention: whatever
  // builds a value, no emitted value carries a held name. A second emitter
  // added later that forgot `releasable` fails here instead of shipping.
  const leaks = heldLeaks(ladder.waves);
  if (leaks.length) refuse('LADDER_HELD_IN_EMITTED_VALUE', { leaks });
  // The other outbound route. D92's gate reads `integration` and cannot see a
  // Supabase Auth send, so a handler gaining one could ship under a name that
  // is already in a live value. Checked over the whole service for the reason
  // `authSendReach` gives: an Auth client is not handed to `handle`.
  authSendHolds(authSendReach(root));
  return ladder;
}

/**
 * What an operator pastes for a wave: every name up to and including it, less
 * the ones `OWNER_HELD` withholds.
 *
 * Exported and separate from `main` so the CUMULATIVE path is testable. The
 * per-wave `functions` field and this are two emitters over the same rule, and
 * the one that matters more is this one — `mutating` is pasted as read-only's
 * names plus its own, so a hold applied only to a wave's own slice would leak
 * the moment the operator moved to the next wave. A first version left this
 * inline in `main`, where deleting the withholding failed no test.
 */
export function cumulativeValue(ladder, wave) {
  const through = ladder.waves.slice(0, ladder.waves.indexOf(wave) + 1);
  return Object.freeze({
    names: Object.freeze(releasable(through.flatMap(entry => entry.handlers))),
    withheld: Object.freeze(through.flatMap(entry => entry.withheld)),
    migrations: Object.freeze([...new Set(through.flatMap(entry => entry.migrations))].sort()),
  });
}

/**
 * The other half of the same gap, from the other side. The startup gate cannot
 * see the STORE, which is what the migrations above are for; the repository
 * cannot see the DEPLOYMENT. A wave's value is derived from committed source,
 * and the running service answers from the revision it was built at — so a
 * wave naming a handler that revision does not implement is
 * `INVALID_FUNCTION_RELEASE` at startup (`services/pennsync-api/runtime.mjs`),
 * which is a crash loop rather than a refusal an operator can read.
 *
 * `/readyz` states both halves: `implemented` is that revision's registry and
 * `operations` is what is released on it right now. So the comparison is
 * arithmetic over a payload, and it is kept separate from fetching one so it
 * can be tested without a network.
 */
export function readinessOf(payload, source) {
  const strings = value => Array.isArray(value) && value.every(entry => typeof entry === 'string');
  // Fail CLOSED on a payload this does not recognise. Treating an unreadable
  // answer as "nothing missing" is the one outcome worse than not asking: it
  // reports a wave safe against a deployment nobody measured.
  if (!payload || typeof payload !== 'object'
    || !strings(payload.implemented) || !strings(payload.operations)
    || typeof payload.released !== 'boolean'
    || typeof payload.authorityConfigured !== 'boolean'
    || typeof payload.integrationsConfigured !== 'boolean'
    || typeof payload.revision !== 'string') {
    refuse('LADDER_DEPLOYMENT_UNREADABLE', { source, keys: payload && typeof payload === 'object' ? Object.keys(payload) : null });
  }
  // `appId`/`appStated` are read as OPTIONAL, and that is deliberate rather
  // than lax: they were added to readiness after the running deployment was
  // built, so demanding them would refuse exactly the revision this check
  // exists to measure. Absent means unreported, never "fine" — the caller is
  // told which, and a stated `false` is a blocker.
  const appStated = typeof payload.appStated === 'boolean' ? payload.appStated : null;
  return Object.freeze({
    revision: payload.revision,
    implemented: Object.freeze([...payload.implemented]),
    operations: Object.freeze([...payload.operations]),
    released: payload.released,
    authorityConfigured: payload.authorityConfigured,
    integrationsConfigured: payload.integrationsConfigured,
    appId: typeof payload.appId === 'string' ? payload.appId : null,
    appStated,
  });
}

/**
 * What setting this wave's value on that deployment would do. `missing` is the
 * crash; `revokes` is the quieter one — the waves are cumulative, so a value
 * that omits a name the service is serving today takes that capability away,
 * and an operator pasting wave 2 over a deployment already at wave 4 would do
 * it without being told.
 */
export function releaseDelta(names, readiness, wave) {
  const implemented = new Set(readiness.implemented);
  const asked = new Set(names);
  const blockers = [];
  // Both of these are startup throws in `loadConfig`/readiness, not per-call
  // failures, so they belong in front of the operator rather than in a log.
  if (!readiness.authorityConfigured) blockers.push('INCOMPLETE_AUTHORITY_CONFIGURATION');
  if (wave.needsIntegration && !readiness.integrationsConfigured) blockers.push('INTEGRATIONS_NOT_CONFIGURED');
  // Only a REPORTED default is a blocker. A revision that does not report the
  // binding at all cannot be cleared here and says so instead.
  if (readiness.appStated === false) blockers.push('IMPLICIT_APP_BINDING');
  return Object.freeze({
    revision: readiness.revision,
    released: readiness.released,
    missing: Object.freeze(names.filter(name => !implemented.has(name))),
    revokes: Object.freeze(readiness.operations.filter(name => !asked.has(name))),
    adds: Object.freeze(names.filter(name => !readiness.operations.includes(name))),
    blockers: Object.freeze(blockers),
  });
}

/**
 * Read-only HTTP against a stated target, and https only: this prints a value
 * an operator will paste into a release, so the answer it is derived from does
 * not come over a channel anybody can rewrite. `/readyz` answers 503 while the
 * gate is shut, which is the NORMAL state of a paused deployment and not an
 * error — a first draft that accepted 200 alone refused every service this is
 * for.
 */
async function fetchReadyz(target, fetchImpl) {
  let base;
  try { base = new URL(target); } catch { base = null; }
  // A path is refused rather than normalised away: `new URL('/readyz', base)`
  // discards it, so a target of `https://host/api` would be probed at
  // `https://host/readyz` and the answer attributed to the wrong service.
  if (!base || base.protocol !== 'https:' || base.pathname !== '/' || base.search || base.hash) {
    refuse('LADDER_DEPLOYMENT_TARGET_INVALID', { target });
  }
  const url = new URL('/readyz', base).toString();
  let response;
  try {
    response = await fetchImpl(url, { method: 'GET', headers: { accept: 'application/json' } });
  } catch (failure) {
    refuse('LADDER_DEPLOYMENT_UNREACHABLE', { url, reason: failure?.message ?? 'fetch failed' });
  }
  // A 503 body is read, not discarded: a paused or unready service answers 503
  // and its body is exactly what the caller needs.
  if (response.status !== 200 && response.status !== 503) {
    refuse('LADDER_DEPLOYMENT_UNREACHABLE', { url, status: response.status });
  }
  let payload;
  try { payload = await response.json(); } catch { refuse('LADDER_DEPLOYMENT_UNREADABLE', { source: url, keys: null }); }
  return { payload, url };
}

export async function probeDeployment(target, fetchImpl = fetch) {
  const { payload, url } = await fetchReadyz(target, fetchImpl);
  return readinessOf(payload, url);
}

/**
 * The integration runtime's readiness, which is a DIFFERENT contract from the
 * business API's. It publishes no `implemented`, no `authorityConfigured` and
 * no `integrationsConfigured`, so `readinessOf` refuses its body outright —
 * and that is the right outcome rather than something to relax: reading one
 * service's answer under the other's contract is how a reading gets attributed
 * to the wrong service. Fails CLOSED on anything it does not recognise.
 */
export function runtimeReadinessOf(payload, source) {
  const strings = value => Array.isArray(value) && value.every(entry => typeof entry === 'string');
  const keys = payload && typeof payload === 'object' ? Object.keys(payload) : null;
  // The business API's body satisfies `operations`, `released`, `ready` and
  // `revision` too, so a first draft of this accepted it and reported 61
  // handler names as "the runtime is serving" — the wrong service's answer
  // under this label, which is the defect the comment above claims to avoid,
  // in the check written to avoid it. Found by pointing the flag at the other
  // host rather than by reading. So the runtime is identified POSITIVELY by
  // fields only `publicReadiness` emits, and the other service's marker is
  // refused BY NAME with a code that says which host was probed.
  if (keys && Object.prototype.hasOwnProperty.call(payload, 'implemented')) {
    refuse('LADDER_RUNTIME_IS_THE_BUSINESS_API', { source });
  }
  if (!payload || typeof payload !== 'object'
    || !strings(payload.operations)
    || !strings(payload.browserOperations)
    || !strings(payload.missingProviders)
    || typeof payload.configured !== 'boolean'
    || typeof payload.released !== 'boolean'
    || typeof payload.ready !== 'boolean'
    || typeof payload.revision !== 'string') {
    refuse('LADDER_RUNTIME_UNREADABLE', { source, keys });
  }
  // The app binding is OPTIONAL here and READ rather than required. That
  // service began publishing `appId`/`appStated` after this reader was
  // written, and a merge does not deploy it, so a body without the pair is a
  // current deployment rather than a malformed one. What is refused is a pair
  // that is HALF published or the wrong type: a field this tool prints as a
  // reading has to mean what it says, and `undefined` rendered beside a real
  // id is the shape of a measurement with nothing behind it.
  const hasApp = Object.prototype.hasOwnProperty.call(payload, 'appId');
  const hasStated = Object.prototype.hasOwnProperty.call(payload, 'appStated');
  if (hasApp !== hasStated
    || (hasApp && typeof payload.appId !== 'string')
    || (hasStated && typeof payload.appStated !== 'boolean')) {
    refuse('LADDER_RUNTIME_APP_BINDING_UNREADABLE', { source, keys });
  }
  return Object.freeze({
    revision: payload.revision,
    operations: Object.freeze([...payload.operations]),
    missingProviders: Object.freeze([...payload.missingProviders]),
    configured: payload.configured,
    released: payload.released,
    ready: payload.ready,
    appId: hasApp ? payload.appId : null,
    appStated: hasApp ? payload.appStated : null,
  });
}

export async function probeIntegrationRuntime(target, fetchImpl = fetch) {
  const { payload, url } = await fetchReadyz(target, fetchImpl);
  return runtimeReadinessOf(payload, url);
}

/**
 * The app binding as one line, or the plain statement that this build does not
 * publish one.
 *
 * Its own function so that BOTH branches are proved by running them. The live
 * service publishes no binding yet, so the populated branch cannot be driven
 * end to end here — and a test that scans this file for the template literal
 * proves the text exists, not that it renders. That is the distinction this
 * repository keeps paying for.
 */
export function appBindingLine(runtime) {
  if (runtime.appId === null) {
    return '# this build publishes no app binding, so it predates the build that'
      + ' does: which app it keys into the store cannot be read from here.';
  }
  return `# app binding ${runtime.appId}, stated by the operator ${runtime.appStated}`;
}

/**
 * Why an integration wave does not hold against that runtime, as a list of
 * reasons — empty means it holds. `ready` is asked as well as `released`
 * because the runtime's own readiness additionally wants a non-empty
 * operations list, so a release flag alone leaves it released and serving
 * nothing, which from outside looks like a broken deployment.
 */
export function integrationRuntimeHolds(required, runtime) {
  const problems = [];
  if (!runtime.configured) problems.push('it is not configured');
  if (!runtime.released) problems.push('it is not released');
  const missing = required.filter(operation => !runtime.operations.includes(operation));
  if (missing.length) problems.push(`it is not serving ${missing.join(', ')}`);
  // Named separately from `ready`, which is the AND of all of these: a bare
  // "not ready" sends an operator looking at the release flag when the real
  // answer is an empty provider key. `missingProviders` answers only for the
  // operations IN that service's list, so it is reported for the ones this
  // wave requires and nothing is inferred about any other.
  const unserviceable = required.filter(operation => runtime.missingProviders.includes(operation));
  if (unserviceable.length) problems.push(`its provider config is incomplete for ${unserviceable.join(', ')}`);
  if (!runtime.ready && !problems.length) problems.push('it reports not ready for a reason this check does not name');
  return Object.freeze(problems);
}

/**
 * The `--deployment` half of `--wave`. Kept out of `main` so the reporting is
 * one function over a readiness payload, and so the gate never reaches the
 * network: `--summary` reads committed source and nothing else.
 */
export function reportDelta(names, readiness, wave, write) {
  const delta = releaseDelta(names, readiness, wave);
  write(`# deployment revision ${delta.revision}`
    + `, release ${delta.released ? 'open' : 'paused'}`
    + `, serving ${readiness.operations.length} of ${readiness.implemented.length} implemented`);
  write(`# app binding: ${readiness.appStated === null
    ? 'not reported by this revision, so it cannot be checked here'
    : `${readiness.appId ?? 'unknown'} (${readiness.appStated ? 'stated' : 'DEFAULTED'})`}`);
  if (delta.missing.length) {
    write(`# REFUSED: this revision does not implement ${delta.missing.join(', ')}.`);
    write('# Setting the value above would be INVALID_FUNCTION_RELEASE at startup,'
      + ' which is a crash loop, not a refusal. Redeploy the service first.');
  }
  if (delta.revokes.length) {
    write(`# REFUSED: this would stop serving ${delta.revokes.join(', ')},`
      + ' which the deployment is serving now. The waves are cumulative;'
      + ' this value is behind the deployment.');
  }
  // The repository's half of the hold is the value it emits; this is the other
  // half, and the only place the two can be compared. A held name serving on
  // the deployment got there by a value this tool did not produce.
  const serving = readiness.operations.filter(name => Object.hasOwn(OWNER_HELD, name));
  if (serving.length) {
    // Say what was OBSERVED and not what it implies about a person. A first
    // version read "Someone set a hand-edited value", which is one cause of
    // this and not the only one: widening the hold list AFTER a release puts
    // a deployment in exactly this state with nobody having edited anything.
    // Naming the wrong cause sends a reader to look for an incident that did
    // not happen, so the two cases are both stated and neither is asserted.
    write(`# WITHHELD NAME IS LIVE: this deployment is serving ${serving.join(', ')},`
      + ' which no value from this tool contains. Either the value was edited by'
      + ' hand, or the hold was added after the release. Check which before acting.');
  }
  for (const blocker of delta.blockers) write(`# REFUSED: ${blocker} — a release would throw this at startup.`);
  if (!delta.missing.length && !delta.revokes.length && !delta.blockers.length) {
    write(`# this revision implements every name above; the release adds ${delta.adds.length}.`);
  }
  return delta.missing.length || delta.revokes.length || delta.blockers.length || serving.length ? 1 : 0;
}

async function main(argv, root, write) {
  const waveFlag = argv.indexOf('--wave');
  if (waveFlag >= 0) {
    const asked = argv[waveFlag + 1];
    const ladder = checkLadder(root);
    const found = ladder.waves.find(entry => entry.name === asked);
    if (!found) {
      write(`unknown wave: ${asked}. one of: ${ladder.waves.map(entry => entry.name).join(', ')}`);
      return 1;
    }
    const { names, withheld } = cumulativeValue(ladder, found);
    write(`# wave ${found.name}: ${found.reason}`);
    write(`PENNSYNC_API_FUNCTIONS=${names.join(',')}`);
    // Said out loud where the value is read. A value shorter than the wave's
    // membership with no explanation invites somebody to "fix" it back.
    for (const name of withheld) write(`# WITHHELD ${name}: ${OWNER_HELD[name]}`);
    write('# migrations this deployment must have applied'
      + ' (the ledger version is what `supabase_migrations.schema_migrations` holds):');
    for (const migration of cumulativeValue(ladder, found).migrations) {
      write(`#   ${migration}  ->  version '${ledgerVersion(migration)}'`);
    }
    const required = brokeredOperationsRequired(root);
    if (found.needsIntegration) {
      write(`# needs the integration runtime, serving ${required.join(' and ')}`
        + ` (read from ${SERVICE}/${INTEGRATIONS_MODULE}).`);
    }
    const runtimeFlag = argv.indexOf('--integration-deployment');
    if (runtimeFlag >= 0) {
      // Refused rather than ignored on a wave that needs nothing from it: a
      // check that cannot apply must not print as though it passed.
      if (!found.needsIntegration) {
        write(`# --integration-deployment does not apply to wave ${found.name}: it needs no runtime.`);
        return 1;
      }
      const runtime = await probeIntegrationRuntime(argv[runtimeFlag + 1]);
      const problems = integrationRuntimeHolds(required, runtime);
      write(`# integration runtime revision ${runtime.revision},`
        + ` configured ${runtime.configured}, release ${runtime.released ? 'open' : 'paused'},`
        + ` ready ${runtime.ready},`
        + ` serving ${runtime.operations.length ? runtime.operations.join(', ') : 'nothing'}`);
      // Printed with its reach said out loud, because an empty answer over an
      // empty list means nothing and the same field over a populated one means
      // the provider config is present for those operations.
      write(`# missingProviders ${runtime.missingProviders.length ? runtime.missingProviders.join(', ') : '[]'}`
        + `, which answers only for the ${runtime.operations.length} operation(s) it serves`);
      if (problems.length) {
        write(`# DO NOT SET THIS VALUE YET: ${problems.join(', and ')}.`);
        write('# releasing these names would advertise capability that service cannot answer.');
        return 1;
      }
      // What this gate proves is bounded, and the bound is now MEASURED rather
      // than enumerated. The first version listed the two states that read
      // ready and refuse every call — an explicitly production
      // `INTEGRATIONS_APP_ID` and a shape-valid but revoked authority key —
      // and said that service publishes no app id, so neither could be read
      // from here. Both halves of that moved within a day: the runtime now
      // refuses a mismatched binding at startup, its preflight reads the body
      // that tells a revoked key from a live one, and its readiness publishes
      // the binding. A tool that lists another component's defects dates
      // itself exactly as "deployed and paused" did, and re-listing them from
      // here would be that literal a third time. So report the binding when it
      // is published, say plainly when it is not, and name the preflight as
      // the thing that measures reachability without claiming what it covers.
      write(appBindingLine(runtime));
      write('# the runtime is released and serving what this wave needs.'
        + ' That is NOT proof it can answer: its readiness asks the SHAPE of its'
        + ' configuration, so nothing here measures whether its provider keys, its'
        + ' bucket or its authority key actually work.');
      write('# to close that, read its boot log with INTEGRATIONS_PREFLIGHT=read-only,'
        + ' which probes what this cannot.');
    }
    const target = argv[argv.indexOf('--deployment') + 1];
    if (argv.includes('--deployment')) {
      return reportDelta(names, await probeDeployment(target), found, write);
    }
    return 0;
  }
  if (argv.includes('--summary')) {
    const ladder = checkLadder(root);
    write(`release ladder: handlers=${ladder.handlers} contracts=${ladder.contracts_reached}`
      + ` waves=${ladder.waves.length} unresolved=${ladder.unresolved.length}`
      + ` withheld=${heldNames.length}`);
    for (const entry of ladder.waves) {
      write(`  ${entry.name.padEnd(13)} ${String(entry.handlers.length).padStart(2)} handlers`
        + ` ${String(entry.migrations.length).padStart(2)} migrations`
        + `${entry.writes ? ' writes' : ''}${entry.needsIntegration ? ' integration' : ''}`
        + `${entry.withheld.length ? ` -${entry.withheld.length} withheld` : ''}`
        + `${entry.declared ? ' (declared)' : ''}`);
    }
    return 0;
  }
  write(JSON.stringify(releaseLadder(root), null, 2));
  return 0;
}

// Direct-invocation check through pathToFileURL: a hand-built `file://`
// string never matches a Windows backslash path or a percent-encoded one,
// and the CLI then exits 0 having silently done nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)));
  try {
    process.exitCode = await main(process.argv.slice(2), root, message => console.log(message));
  } catch (failure) {
    console.error(JSON.stringify({
      error: failure?.code ?? 'LADDER_FAILED', detail: failure?.detail ?? null,
    }, null, 2));
    process.exitCode = 1;
  }
}
