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
 * the integration runtime (which is deployed and paused). From that it builds
 * the ladder and emits each wave's `PENNSYNC_API_FUNCTIONS` value, so the
 * operator copies a value the repository has checked rather than typing one.
 *
 * The first three waves are DECLARED, because the plan's order is a judgement
 * about blast radius and the plan is where such a judgement belongs. Each is
 * then re-checked against the tree, the way `DECLARED_UNIQUE` is in
 * `tools-entity-schema-plan.mjs`: a declared name that is not a handler, or
 * that is declared twice, or a mutating handler declared into a read wave,
 * fails the run. "The rest by blast radius" is DERIVED rather than typed —
 * read-only first, then mutating, then the ones that need the paused runtime.
 *
 * This authorizes nothing and releases nothing. It reads committed source.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/** The derived tail of the ladder, in the order "by blast radius" resolves to. */
export const DERIVED_WAVES = Object.freeze([
  Object.freeze({ name: 'read-only', reason: 'reaches no contract that writes, and no paused runtime.' }),
  Object.freeze({ name: 'mutating', reason: 'writes through a contract. No dependency beyond the store.' }),
  Object.freeze({ name: 'integration', reason: 'reaches the integration runtime, which is deployed and paused.' }),
]);

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
 */
export function functionBodies(root) {
  const pattern = /create\s+(?:or\s+replace\s+)?function\s+(?:"?([a-z_]+)"?\s*\.\s*)?"?([A-Za-z0-9_]+)"?\s*\(/gi;
  const bodies = new Map();
  // Authority first, because that is the order they apply in, and because a
  // helper there is legitimately redefined by a later migration — the store
  // evolves, so the LAST definition is the one a contract calls.
  for (const directory of [AUTHORITY_MIGRATIONS, MIGRATIONS]) {
    const path = resolve(root, directory);
    for (const file of readdirSync(path).filter(name => name.endsWith('.sql')).sort()) {
      const sql = read(resolve(path, file));
      for (const match of sql.matchAll(pattern)) {
        const key = `${(match[1] ?? '').toLowerCase()}.${match[2]}`;
        // Within the record migrations a name defined twice would make "the
        // migration that defines this contract" a guess, so it is refused
        // rather than last-one-wins. That invariant is this directory's alone.
        if (directory === MIGRATIONS && bodies.get(key)?.directory === MIGRATIONS) {
          refuse('LADDER_FUNCTION_DEFINED_TWICE', { key, files: [bodies.get(key).file, file] });
        }
        bodies.set(key, { file, body: dollarQuotedBody(sql, match.index, key, file), directory });
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
    handlers: Object.freeze(names),
    // What an operator sets. Emitted rather than typed: a name that is not in
    // the registry is `INVALID_FUNCTION_RELEASE` at startup, and a name that
    // is in it but wrong is served.
    functions: names.join(','),
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
  return ladder;
}

function main(argv, root, write) {
  const waveFlag = argv.indexOf('--wave');
  if (waveFlag >= 0) {
    const asked = argv[waveFlag + 1];
    const ladder = checkLadder(root);
    const found = ladder.waves.find(entry => entry.name === asked);
    if (!found) {
      write(`unknown wave: ${asked}. one of: ${ladder.waves.map(entry => entry.name).join(', ')}`);
      return 1;
    }
    const cumulative = ladder.waves.slice(0, ladder.waves.indexOf(found) + 1);
    write(`# wave ${found.name}: ${found.reason}`);
    write(`PENNSYNC_API_FUNCTIONS=${cumulative.flatMap(entry => entry.handlers).join(',')}`);
    write(`# migrations this deployment must have applied:`);
    for (const migration of [...new Set(cumulative.flatMap(entry => entry.migrations))].sort()) {
      write(`#   ${migration}`);
    }
    if (found.needsIntegration) write('# needs the integration runtime, which is deployed and paused.');
    return 0;
  }
  if (argv.includes('--summary')) {
    const ladder = checkLadder(root);
    write(`release ladder: handlers=${ladder.handlers} contracts=${ladder.contracts_reached}`
      + ` waves=${ladder.waves.length} unresolved=${ladder.unresolved.length}`);
    for (const entry of ladder.waves) {
      write(`  ${entry.name.padEnd(13)} ${String(entry.handlers.length).padStart(2)} handlers`
        + ` ${String(entry.migrations.length).padStart(2)} migrations`
        + `${entry.writes ? ' writes' : ''}${entry.needsIntegration ? ' integration' : ''}`
        + `${entry.declared ? ' (declared)' : ''}`);
    }
    return 0;
  }
  write(JSON.stringify(releaseLadder(root), null, 2));
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)));
  try {
    process.exitCode = main(process.argv.slice(2), root, message => console.log(message));
  } catch (failure) {
    console.error(JSON.stringify({
      error: failure?.code ?? 'LADDER_FAILED', detail: failure?.detail ?? null,
    }, null, 2));
    process.exitCode = 1;
  }
}
