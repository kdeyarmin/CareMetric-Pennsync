import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DECLARED_WAVES, LADDER_CONTRACT, LadderError, checkLadder, closureOf, dollarQuotedBody,
  functionBodies, handlerReach, importedNames, integrationDependents, integrationReach,
  probeDeployment, readinessOf, releaseDelta, releaseLadder, reportDelta,
} from './tools-pennsync-release-ladder.mjs';
import { loadConfig, publicReadiness } from './services/pennsync-api/runtime.mjs';
import { ledgerVersion } from './tools-pennsync-migrate.mjs';

/**
 * The release ladder, held to the two things it claims: that a handler's
 * contract reach is readable from source, and that a wave's prerequisites are
 * everything its contracts actually need present.
 *
 * Both earlier drafts of the write classifier were wrong in OPPOSITE
 * directions, and each is pinned below by the real shape that broke it: a
 * missed write (`update "pennsync_records"."patient_alert"` behind a `\b`) and
 * an invented one (a migration's own backfill, inherited by every read
 * function above it). The second is the dangerous one, because a name-shape
 * check can catch a missed write and cannot catch an imagined one.
 */
const REPOSITORY = resolve(fileURLToPath(new URL('.', import.meta.url)));

test('the committed tree builds a ladder every handler is placed in', () => {
  const ladder = checkLadder(REPOSITORY);
  assert.equal(ladder.contract, LADDER_CONTRACT);
  assert.deepEqual(ladder.unresolved, []);
  const placed = ladder.waves.flatMap(wave => wave.handlers);
  assert.equal(placed.length, ladder.handlers, 'every handler is in exactly one wave');
  assert.equal(new Set(placed).size, placed.length, 'and in only one');
  assert.ok(ladder.handlers >= 75, `expected the ported registry, got ${ladder.handlers}`);
});

test('the declared waves come first and in the order the plan states', () => {
  const ladder = checkLadder(REPOSITORY);
  assert.deepEqual(ladder.waves.slice(0, 3).map(wave => wave.name),
    DECLARED_WAVES.map(wave => wave.name));
  assert.deepEqual(ladder.waves.map(wave => wave.declared),
    [true, true, true, false, false, false]);
});

test('the first wave writes nothing and the ones after it do', () => {
  const [read, write, visit] = checkLadder(REPOSITORY).waves;
  assert.equal(read.writes, false, 'the patient read pair writes nothing');
  assert.equal(write.writes, true);
  assert.equal(visit.writes, true);
});

test('a wave carries the migrations its contracts need, not just the one they live in', () => {
  const ladder = checkLadder(REPOSITORY);
  const write = ladder.waves.find(wave => wave.name === 'patient-write');
  // The chart claim is D28's bridge and its own migration. Release the create
  // without it and the service reports ready while every create fails in the
  // store, which is the whole reason this tool reports a closure.
  assert.ok(write.migrations.includes('20260920110000_claim_new_chart.sql'),
    `expected the chart claim among ${write.migrations.join(', ')}`);
  assert.ok(write.migrations.includes('20260920120000_contract_patient_create.sql'));
});

test('the handlers that reach the paused integration runtime are the last wave', () => {
  const ladder = checkLadder(REPOSITORY);
  const last = ladder.waves.at(-1);
  assert.equal(last.name, 'integration');
  assert.equal(last.needsIntegration, true);
  // Nothing before it depends on the runtime, which is what makes the earlier
  // waves releasable while that service stays paused.
  for (const wave of ladder.waves.slice(0, -1)) assert.equal(wave.needsIntegration, false, wave.name);
});

test('the emitted release value is cumulative, so a wave never revokes an earlier one', () => {
  const ladder = releaseLadder(REPOSITORY);
  const first = ladder.waves[0].functions.split(',');
  const second = ladder.waves[1].functions.split(',');
  assert.deepEqual(first, ['listAuthorizedPatients', 'getAuthorizedPatient']);
  assert.deepEqual(second, ['createAuthorizedPatient', 'updateAuthorizedPatient']);
  // `functions` is per wave; the command line concatenates the waves up to the
  // one asked for, which is what an operator sets.
  assert.equal(new Set([...first, ...second]).size, 4);
});

test('a function body is taken between its dollar quotes, not up to the next definition', () => {
  // The exact shape that broke the second draft: a read function, then a
  // statement of the migration's own, then the next definition.
  const sql = [
    'create function "pennsync_records".reader(p text) returns jsonb',
    "  language sql security definer set search_path = '' as $c$",
    '  select to_jsonb(p)',
    '$c$;',
    'insert into "pennsync_records"."backfill" ("id") values (1);',
    'create function "pennsync_records".other() returns void language sql as $x$ select 1 $x$;',
  ].join('\n');
  const body = dollarQuotedBody(sql, 0, 'pennsync_records.reader', 'fixture.sql');
  assert.match(body, /select to_jsonb/);
  assert.doesNotMatch(body, /insert into/, 'the migration own backfill is not part of the function');
});

test('an undelimited body is refused rather than read as empty', () => {
  let failure = null;
  try { dollarQuotedBody('create function x.y() returns void;', 0, 'x.y', 'f.sql'); }
  catch (error) { failure = error; }
  assert.ok(failure instanceof LadderError, `expected a refusal, got ${failure}`);
  assert.equal(failure.code, 'LADDER_FUNCTION_BODY_UNDELIMITED');
});

test('an update whose target is a quoted qualified name counts as a write', () => {
  // The first draft anchored this with a trailing `\b` and never matched,
  // because `_` continues the word. It reported `contract_alert_update`, whose
  // body is four update statements, as read-only.
  const bodies = new Map([['pennsync_records.writer', {
    file: 'w.sql', directory: 'services/authority-store/supabase/record-migrations',
    body: 'update "pennsync_records"."patient_alert" a set "status" = \'x\'',
  }]]);
  assert.equal(closureOf(bodies, 'pennsync_records.writer', 'c').mutates, true);
});

test('a set-returning write helper called in a from clause is still a call', () => {
  // `select * into v_row from pennsync_private.transition_membership(...)` is
  // how both of the store write helpers are reached. A draft that decided
  // call-or-relation by POSITION dropped it and called the contract read-only.
  const directory = 'services/authority-store/supabase/record-migrations';
  const bodies = new Map([
    ['pennsync_records.contract_x', { file: 'c.sql', directory,
      body: 'select * into v_row from pennsync_private.transition_membership(p_agency)' }],
    ['pennsync_private.transition_membership', { file: 'h.sql', directory,
      body: 'update "pennsync_private"."membership" set "status" = p_status' }],
  ]);
  const closure = closureOf(bodies, 'pennsync_records.contract_x', 'x');
  assert.equal(closure.mutates, true);
  assert.deepEqual([...new Set(closure.files)].sort(), ['c.sql', 'h.sql']);
});

test('a table name followed by a column list is not a call', () => {
  const directory = 'services/authority-store/supabase/record-migrations';
  const bodies = new Map([['pennsync_records.contract_x', { file: 'c.sql', directory,
    body: 'insert into pennsync_private.chart_assignment ("id") values (p_id)' }]]);
  // It writes, and the relation it writes to is not looked up as a function.
  assert.equal(closureOf(bodies, 'pennsync_records.contract_x', 'x').mutates, true);
});

test('a call into a function the migrations do not define is refused', () => {
  const directory = 'services/authority-store/supabase/record-migrations';
  const bodies = new Map([['pennsync_records.contract_x', { file: 'c.sql', directory,
    body: 'select pennsync_records.helper_that_moved(p_agency)' }]]);
  let failure = null;
  try { closureOf(bodies, 'pennsync_records.contract_x', 'x'); } catch (error) { failure = error; }
  assert.ok(failure instanceof LadderError, `expected a refusal, got ${failure}`);
  assert.equal(failure.code, 'LADDER_CALL_GRAPH_INCOMPLETE');
  assert.equal(failure.detail.missing, 'pennsync_records.helper_that_moved');
});

test('only the record migrations are reported as prerequisites', () => {
  const bodies = new Map([
    ['pennsync_records.contract_x', {
      file: 'c.sql', directory: 'services/authority-store/supabase/record-migrations',
      body: 'select pennsync_private.deployment_app_id()' }],
    ['pennsync_private.deployment_app_id', {
      file: 'pin.sql', directory: 'services/authority-store/supabase/migrations',
      body: 'select current_setting(\'x\')' }],
  ]);
  const closure = closureOf(bodies, 'pennsync_records.contract_x', 'x');
  assert.deepEqual(closure.files, ['c.sql'], 'the authority pin applies before the record store');
});

test('an import alias resolves to the module it came from', () => {
  const map = importedNames([
    "import { a, b as c } from './one.mjs';",
    "import {\n  d,\n} from './two.mjs';",
    "import external from 'node:fs';",
  ].join('\n'));
  assert.equal(map.get('a'), 'one.mjs');
  assert.equal(map.get('c'), 'one.mjs');
  assert.equal(map.get('d'), 'two.mjs');
  assert.equal(map.has('external'), false);
});

test('a handler reaching its contract through its own module is attributed to it', () => {
  const reach = handlerReach(REPOSITORY);
  // `syncCMSRegulations` keeps its body in `cms-regulations.mjs`, and is the
  // reason `record-contracts.test.mjs` scans every module. That test proves
  // the UNION of reached contracts and cannot say which handler reached what.
  assert.equal(reach.get('syncCMSRegulations').resolution, 'module');
  assert.deepEqual(reach.get('syncCMSRegulations').contracts, ['syncCMSRegulations']);
  // And one that reaches two contracts inline, because it is one capability
  // with two modes over two different queries.
  assert.equal(reach.get('listAuthorizedPatients').resolution, 'inline');
  assert.deepEqual(reach.get('listAuthorizedPatients').contracts,
    ['listAuthorizedPatientsBatch', 'listAuthorizedPatientsPage']);
});

/** A tree the ladder accepts, so a test can break one thing about it. */
function intactTree(t) {
  const root = mkdtempSync(join(tmpdir(), 'release-ladder-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const api = join(root, 'services/pennsync-api');
  const records = join(root, 'services/authority-store/supabase/record-migrations');
  mkdirSync(api, { recursive: true });
  mkdirSync(records, { recursive: true });
  mkdirSync(join(root, 'services/authority-store/supabase/migrations'), { recursive: true });
  writeFileSync(join(root, 'services/authority-store/supabase/migrations/0001_base.sql'), '-- nothing\n');
  return { root, api, records };
}

/** A contract entry, its public wrapper and the inner function it selects. */
const contractSql = (name, body) => [
  `create function "pennsync_records".${name}(p_agency text) returns jsonb`,
  `  language sql security definer set search_path = '' as $c$ ${body} $c$;`,
  `create function "public"."pennsync_contract_${name}"(p_agency text) returns jsonb`,
  `  language sql security invoker set search_path = '' as $w$`,
  `  select "pennsync_records".${name}(p_agency) $w$;`,
].join('\n');

/** The eight handlers the declared waves name, plus whatever a test adds. */
function fixture({ api, records }, { extraHandler = '', readBody = 'select 1', contracts = '' } = {}) {
  const declared = DECLARED_WAVES.flatMap(wave => wave.handlers);
  writeFileSync(join(records, '0100_contracts.sql'), [
    contractSql('contract_read', readBody),
    contractSql('contract_write', 'insert into "pennsync_records"."thing" ("id") values (1); select 1'),
  ].join('\n\n'));
  writeFileSync(join(api, 'record-contracts.mjs'), [
    'export const RECORD_CONTRACTS = Object.freeze({',
    "  readIt: Object.freeze({ rpc: 'pennsync_contract_contract_read' }),",
    "  writeIt: Object.freeze({ rpc: 'pennsync_contract_contract_write' }),",
    contracts,
    '});',
  ].join('\n'));
  writeFileSync(join(api, 'handlers.mjs'), [
    'export const HANDLERS = Object.freeze({',
    ...declared.map(name => [
      `  ${name}: Object.freeze({`,
      `    handle({ contract }) { return contract('${name.startsWith('list') || name.startsWith('get') ? 'readIt' : 'writeIt'}', {}); },`,
      '  }),',
    ].join('\n')),
    extraHandler,
    '});',
    'export const HANDLER_NAMES = Object.freeze(Object.keys(HANDLERS));',
  ].join('\n'));
}

test('the fixture the other refusals are measured against passes', (t) => {
  const tree = intactTree(t);
  fixture(tree);
  const ladder = checkLadder(tree.root);
  assert.equal(ladder.handlers, 8);
  assert.equal(ladder.waves[0].writes, false);
  assert.equal(ladder.waves[1].writes, true);
});

test('a declared read wave that has gained a write is refused', (t) => {
  const tree = intactTree(t);
  // The read contract now writes, which is what would happen if a projection
  // helper started appending to the trail.
  fixture(tree, { readBody: 'insert into "pennsync_records"."trail" ("id") values (1); select 1' });
  let failure = null;
  try { checkLadder(tree.root); } catch (error) { failure = error; }
  assert.ok(failure instanceof LadderError, `expected a refusal, got ${failure}`);
  assert.equal(failure.code, 'LADDER_DECLARED_WRITE_IN_READ_WAVE');
  assert.equal(failure.detail.wave, 'patient-read');
});

test('a declared name that is no longer a handler is refused', (t) => {
  const tree = intactTree(t);
  fixture(tree);
  // Drop one of the declared names, as a rename would.
  const path = join(tree.api, 'handlers.mjs');
  const source = readFileSync(path, 'utf8').replace(/ {2}getAuthorizedPatient: Object\.freeze\(\{[\s\S]*?\n {2}\}\),\n/, '');
  writeFileSync(path, source);
  let failure = null;
  try { checkLadder(tree.root); } catch (error) { failure = error; }
  assert.ok(failure instanceof LadderError, `expected a refusal, got ${failure}`);
  assert.equal(failure.code, 'LADDER_DECLARED_NOT_A_HANDLER');
  assert.equal(failure.detail.handler, 'getAuthorizedPatient');
});

test('a contract whose RPC no migration defines is refused', (t) => {
  const tree = intactTree(t);
  fixture(tree, { contracts: "  ghostIt: Object.freeze({ rpc: 'pennsync_contract_contract_gone' })," });
  let failure = null;
  try { checkLadder(tree.root); } catch (error) { failure = error; }
  assert.ok(failure instanceof LadderError, `expected a refusal, got ${failure}`);
  assert.equal(failure.code, 'LADDER_CONTRACT_RPC_UNDEFINED');
  assert.equal(failure.detail.rpc, 'pennsync_contract_contract_gone');
});

test('a handler reaching a contract by a computed name leaves the reach unresolved', (t) => {
  const tree = intactTree(t);
  fixture(tree, {
    extraHandler: [
      '  pickOne: Object.freeze({',
      '    handle({ params, contract }) { return contract(params.which, {}); },',
      '  }),',
    ].join('\n'),
  });
  let failure = null;
  try { checkLadder(tree.root); } catch (error) { failure = error; }
  assert.ok(failure instanceof LadderError, `expected a refusal, got ${failure}`);
  assert.equal(failure.code, 'LADDER_REACH_UNRESOLVED');
  assert.deepEqual(failure.detail.handlers, ['pickOne']);
  // The census still reports it rather than throwing, so the name is readable.
  assert.equal(releaseLadder(tree.root).unresolved[0], 'pickOne');
});

/**
 * The registry's `needsIntegration` flag against what the tree can reach.
 *
 * `account-email.mjs` writes this hazard down in its own header: while its
 * send stays paused those two capabilities reach no runtime and belong in the
 * read-only wave, and the release that deletes their two `fail` lines has to
 * move the flag in the same change or the ladder hands an operator two
 * outbound senders inside the wave whose promise is that nothing in it sends.
 * A header is not a check, which is D78's lesson about a rule written down and
 * then broken twice.
 */
test("the registry's integration flag and the tree's reach name the same handlers", () => {
  // Set equality rather than a count, because the interesting failure is one
  // name moving in one direction and a count can be right while that happens.
  assert.deepEqual([...integrationReach(REPOSITORY)].sort(),
    [...integrationDependents(REPOSITORY)].sort());
});

test('the two paused email capabilities are honestly read-only today', () => {
  // Not an aspiration: they destructure no `integration`, so they cannot call
  // the runtime, and the assertion above is what will make a release say so.
  const reach = integrationReach(REPOSITORY);
  const wave = checkLadder(REPOSITORY).waves.find(entry => entry.name === 'read-only');
  for (const name of ['sendAccountReadyEmail', 'sendWelcomeEmail']) {
    assert.equal(reach.has(name), false, name);
    assert.ok(wave.handlers.includes(name), `${name} is in the read-only wave`);
  }
});

test('a handler that gains the runtime without the flag is refused', (t) => {
  // The wave-4 hazard itself: the release deletes the pause and takes
  // `integration`, and nobody touches the registry.
  const tree = intactTree(t);
  fixture(tree, {
    extraHandler: [
      '  sendIt: Object.freeze({',
      "    handle({ params, integration, contract }) {",
      "      integration('SendEmail', params); return contract('readIt', {});",
      '    },',
      '  }),',
    ].join('\n'),
  });
  let failure = null;
  try { checkLadder(tree.root); } catch (error) { failure = error; }
  assert.ok(failure instanceof LadderError, `expected a refusal, got ${failure}`);
  assert.equal(failure.code, 'LADDER_INTEGRATION_FLAG_DISAGREES');
  assert.deepEqual(failure.detail.reach_without_flag, ['sendIt']);
  assert.deepEqual(failure.detail.flagged_without_reach, []);
});

test('a handler flagged for a runtime it cannot reach is refused too', (t) => {
  // The other direction, and a different mistake: it holds a name out of an
  // earlier wave for a dependency it does not have, and a wave nobody can
  // release is how a ladder stops being used.
  const tree = intactTree(t);
  fixture(tree, {
    extraHandler: [
      '  readIt: Object.freeze({',
      '    needsIntegration: true,',
      "    handle({ contract }) { return contract('readIt', {}); },",
      '  }),',
    ].join('\n'),
  });
  let failure = null;
  try { checkLadder(tree.root); } catch (error) { failure = error; }
  assert.ok(failure instanceof LadderError, `expected a refusal, got ${failure}`);
  assert.equal(failure.code, 'LADDER_INTEGRATION_FLAG_DISAGREES');
  assert.deepEqual(failure.detail.flagged_without_reach, ['readIt']);
});

test('a handle that takes its dependencies some other way is refused, not read as empty', (t) => {
  // Fails CLOSED, the rule `handlerReach` follows for a computed contract
  // name. Every `handle` destructures today; a `handle(deps)` reading
  // `deps.integration` is a shape this cannot answer about, and the silent
  // answer is the dangerous one.
  const tree = intactTree(t);
  fixture(tree, {
    extraHandler: [
      '  opaque: Object.freeze({',
      "    handle(deps) { return deps.contract('readIt', {}); },",
      '  }),',
    ].join('\n'),
  });
  let failure = null;
  try { checkLadder(tree.root); } catch (error) { failure = error; }
  assert.ok(failure instanceof LadderError, `expected a refusal, got ${failure}`);
  assert.equal(failure.code, 'LADDER_HANDLER_DEPENDENCIES_UNREADABLE');
  assert.equal(failure.detail.handler, 'opaque');
});

test('a service module reaching the runtime URL itself is refused', (t) => {
  // The derivation above is sufficient only because nothing but the capability
  // and the config loader names the runtime's address. Four handlers
  // destructure `config`, which carries it, so this is the bypass to close.
  const tree = intactTree(t);
  fixture(tree);
  writeFileSync(join(tree.api, 'shortcut.mjs'),
    'export const target = config => `${config.integrationsUrl}/integrations/v1`;\n');
  let failure = null;
  try { checkLadder(tree.root); } catch (error) { failure = error; }
  assert.ok(failure instanceof LadderError, `expected a refusal, got ${failure}`);
  assert.equal(failure.code, 'LADDER_INTEGRATION_RUNTIME_REACHED_DIRECTLY');
  assert.equal(failure.detail.file, 'shortcut.mjs');
});

test('the same function defined twice in the record migrations is refused', (t) => {
  const tree = intactTree(t);
  fixture(tree);
  writeFileSync(join(tree.records, '0200_again.sql'), contractSql('contract_read', 'select 2'));
  let failure = null;
  try { functionBodies(tree.root); } catch (error) { failure = error; }
  assert.ok(failure instanceof LadderError, `expected a refusal, got ${failure}`);
  assert.equal(failure.code, 'LADDER_FUNCTION_DEFINED_TWICE');
  assert.deepEqual(failure.detail.files, ['0100_contracts.sql', '0200_again.sql']);
});

test('a D88 catch-up repeating a definition verbatim is not a second definition', (t) => {
  // The shape a forward migration has: `create or replace`, byte for byte what
  // the migration it carries already says. Nothing is ambiguous — both are the
  // same definition — and the ladder has to keep reading the tree, because a
  // regenerated record store ships one of these every time it changes.
  const tree = intactTree(t);
  fixture(tree);
  const again = contractSql('contract_read', 'select 1')
    .replaceAll('create function', 'create or replace function');
  writeFileSync(join(tree.records, '0200_catchup.sql'), again);
  const bodies = functionBodies(tree.root);
  // The FIRST file keeps the key: a catch-up repeats a definition, it does not
  // become the place the definition lives, and the wave is derived from that.
  assert.equal(bodies.get('pennsync_records.contract_read').file, '0100_contracts.sql');
  assert.doesNotThrow(() => checkLadder(tree.root));
});

test('an or-replace whose body differs is still refused, which is the real ambiguity', (t) => {
  // The case the exemption must not swallow. Two definitions that disagree
  // make "which one is this contract" a guess in exactly the way the original
  // refusal exists to prevent — and `or replace` is what makes it apply
  // silently rather than failing on the target.
  const tree = intactTree(t);
  fixture(tree);
  const drifted = contractSql('contract_read', 'select 2')
    .replaceAll('create function', 'create or replace function');
  writeFileSync(join(tree.records, '0200_catchup.sql'), drifted);
  let failure = null;
  try { functionBodies(tree.root); } catch (error) { failure = error; }
  assert.ok(failure instanceof LadderError, `expected a refusal, got ${failure}`);
  assert.equal(failure.code, 'LADDER_FUNCTION_DEFINED_TWICE');
  assert.deepEqual(failure.detail.files, ['0100_contracts.sql', '0200_catchup.sql']);
});

test('a handler reaching a contract the registry does not carry is refused', (t) => {
  const tree = intactTree(t);
  fixture(tree, {
    extraHandler: [
      '  callsNothing: Object.freeze({',
      "    handle({ contract }) { return contract('retiredContract', {}); },",
      '  }),',
    ].join('\n'),
  });
  let failure = null;
  try { checkLadder(tree.root); } catch (error) { failure = error; }
  assert.ok(failure instanceof LadderError, `expected a refusal, got ${failure}`);
  assert.equal(failure.code, 'LADDER_CONTRACT_UNKNOWN');
  assert.deepEqual(failure.detail.contracts, ['retiredContract']);
});

/**
 * The deployment half. What the running service answers is not invented here:
 * `publicReadiness` is the thing that writes `/readyz`, so the payload these
 * measure is built by it, and a field renamed there fails these rather than
 * being quietly read as absent.
 */
const readinessFor = env => publicReadiness(loadConfig(env));
const RELEASED_ENV = Object.freeze({
  PENNSYNC_API_RELEASE: 'enabled-v1',
  PENNSYNC_API_APP_ID: '6a9881683dc68a0bd54f1ef7',
  PENNSYNC_API_AUTHORITY_URL: 'https://xxtyweswohkvgkprimwa.supabase.co',
  PENNSYNC_API_AUTHORITY_PUBLISHABLE_KEY: 'sb_publishable_synthetic-acceptance-key',
});

test('the service readiness payload is the shape the probe reads', () => {
  const readiness = readinessFor({});
  const parsed = readinessOf(readiness, 'unit');
  assert.equal(parsed.released, false);
  assert.deepEqual(parsed.operations, []);
  assert.ok(parsed.implemented.length > 0);
  // The binding, which is what a release throws on before it serves anything.
  assert.equal(parsed.appStated, false);
  assert.equal(parsed.appId, '694ec16e72e01b60d22f7cbf');
});

test('a payload the probe cannot read is refused rather than read as complete', () => {
  for (const payload of [
    null,
    {},
    { ...readinessFor({}), implemented: undefined },
    { ...readinessFor({}), implemented: [1, 2] },
    { ...readinessFor({}), released: 'false' },
    { ...readinessFor({}), revision: null },
  ]) {
    let failure = null;
    try { readinessOf(payload, 'unit'); } catch (error) { failure = error; }
    assert.ok(failure instanceof LadderError, `expected a refusal for ${JSON.stringify(payload)?.slice(0, 40)}`);
    assert.equal(failure.code, 'LADDER_DEPLOYMENT_UNREADABLE');
  }
});

test('an app binding a revision does not report is unreported, not cleared', () => {
  const { appId: _id, appStated: _stated, ...older } = readinessFor(RELEASED_ENV);
  const parsed = readinessOf(older, 'unit');
  assert.equal(parsed.appStated, null);
  assert.equal(parsed.appId, null);
  const wave = { needsIntegration: false };
  // Null is not false: an older revision is not accused of defaulting.
  assert.deepEqual(releaseDelta([], parsed, wave).blockers, []);
  assert.deepEqual(releaseDelta([], readinessOf(readinessFor({}), 'unit'), wave).blockers,
    ['INCOMPLETE_AUTHORITY_CONFIGURATION', 'IMPLICIT_APP_BINDING']);
});

test('a name the deployment does not implement is the refusal, not a note', () => {
  const readiness = readinessOf(readinessFor(RELEASED_ENV), 'unit');
  const real = readiness.implemented[0];
  const delta = releaseDelta([real, 'aHandlerThisRevisionNeverHad'], readiness, { needsIntegration: false });
  assert.deepEqual(delta.missing, ['aHandlerThisRevisionNeverHad']);
  const lines = [];
  assert.equal(reportDelta([real, 'aHandlerThisRevisionNeverHad'], readiness, { needsIntegration: false }, line => lines.push(line)), 1);
  assert.ok(lines.some(line => line.includes('INVALID_FUNCTION_RELEASE')), lines.join('\n'));
});

test('a value behind the deployment is refused for what it would revoke', () => {
  const served = readinessOf(readinessFor({
    ...RELEASED_ENV, PENNSYNC_API_FUNCTIONS: 'listAuthorizedPatients,getAuthorizedPatient',
  }), 'unit');
  assert.deepEqual(served.operations, ['listAuthorizedPatients', 'getAuthorizedPatient']);
  const delta = releaseDelta(['listAuthorizedPatients'], served, { needsIntegration: false });
  assert.deepEqual(delta.revokes, ['getAuthorizedPatient']);
  assert.deepEqual(delta.missing, []);
  const lines = [];
  assert.equal(reportDelta(['listAuthorizedPatients'], served, { needsIntegration: false }, line => lines.push(line)), 1);
  assert.ok(lines.some(line => line.includes('stop serving getAuthorizedPatient')), lines.join('\n'));
});

test('a wave needing the paused runtime is blocked where it is not configured', () => {
  const readiness = readinessOf(readinessFor(RELEASED_ENV), 'unit');
  assert.equal(readiness.integrationsConfigured, false);
  assert.deepEqual(releaseDelta([], readiness, { needsIntegration: true }).blockers, ['INTEGRATIONS_NOT_CONFIGURED']);
  assert.deepEqual(releaseDelta([], readiness, { needsIntegration: false }).blockers, []);
});

test('the probe accepts the 503 a paused service answers with', async () => {
  const payload = readinessFor({});
  const asked = [];
  const fetchImpl = async (url) => {
    asked.push(url);
    return { status: 503, json: async () => payload };
  };
  const readiness = await probeDeployment('https://api.example.test', fetchImpl);
  assert.deepEqual(asked, ['https://api.example.test/readyz']);
  assert.equal(readiness.released, false);
});

test('the probe refuses a target that is not an https origin', async () => {
  for (const target of [
    'http://api.example.test',
    'https://api.example.test/api',
    'https://api.example.test/?x=1',
    'not a url',
  ]) {
    let failure = null;
    try { await probeDeployment(target, async () => assert.fail('must not fetch')); }
    catch (error) { failure = error; }
    assert.ok(failure instanceof LadderError, `expected a refusal for ${target}`);
    assert.equal(failure.code, 'LADDER_DEPLOYMENT_TARGET_INVALID');
  }
});

test('an unreachable or unexpected answer is refused, never assumed', async () => {
  const cases = [
    [async () => { throw new Error('ECONNREFUSED'); }, 'LADDER_DEPLOYMENT_UNREACHABLE'],
    [async () => ({ status: 500, json: async () => ({}) }), 'LADDER_DEPLOYMENT_UNREACHABLE'],
    [async () => ({ status: 200, json: async () => { throw new Error('not json'); } }), 'LADDER_DEPLOYMENT_UNREADABLE'],
  ];
  for (const [fetchImpl, code] of cases) {
    let failure = null;
    try { await probeDeployment('https://api.example.test', fetchImpl); } catch (error) { failure = error; }
    assert.ok(failure instanceof LadderError, `expected ${code}`);
    assert.equal(failure.code, code);
  }
});

test('a prerequisite is printed in the form the ledger actually holds', () => {
  // The ledger's `version` is the file's whole stem, so the file name alone is
  // a string that matches nothing in `supabase_migrations.schema_migrations` —
  // which is where an operator checks whether a prerequisite has been applied.
  // Imported from the migrate tool rather than reproduced here, so the two
  // cannot drift apart.
  const ladder = checkLadder(REPOSITORY);
  const migrations = [...new Set(ladder.waves.flatMap(wave => wave.migrations))];
  assert.ok(migrations.length > 0);
  for (const migration of migrations) {
    assert.match(migration, /^\d+_[a-z0-9_]+\.sql$/);
    assert.equal(ledgerVersion(migration), migration.replace(/\.sql$/, ''));
  }
});

test('the go-live plan carries the wave table the ladder measures', () => {
  // Stage D of `docs/RAILWAY_GO_LIVE_PLAN_2026-09-21.md` restates the six
  // waves with a handler and a migration count each, and it is the page an
  // operator reads before pasting a `PENNSYNC_API_FUNCTIONS` value. Nothing
  // compared the two, and every port since #245 lands in a DERIVED wave while
  // the three declared ones hold — so the table drifts on its own. On
  // 2026-09-23 it read `read-only 21/16`, `mutating 30/28`, `integration
  // 16/13` against a measured 23/16, 32/30 and 17/14.
  //
  // The rows are matched by NAME rather than by position, because a table
  // whose rows were reordered would otherwise pass while saying something
  // else, and every declared wave must appear so a wave added to the tool
  // cannot be silently absent from the page.
  const page = readFileSync(resolve(REPOSITORY, 'docs/RAILWAY_GO_LIVE_PLAN_2026-09-21.md'), 'utf8');
  const ladder = checkLadder(REPOSITORY);
  for (const wave of ladder.waves) {
    const row = new RegExp(
      `\\|\\s*\`${wave.name}\`\\s*\\((?:declared|derived)\\)\\s*\\|\\s*(\\d+)\\s*\\|\\s*(\\d+)\\s*\\|`,
    ).exec(page);
    assert.ok(row, `the plan's stage D has no row for the \`${wave.name}\` wave`);
    assert.equal(Number(row[1]), wave.handlers.length,
      `the plan says the \`${wave.name}\` wave holds ${row[1]} handlers; it holds ${wave.handlers.length}`);
    assert.equal(Number(row[2]), wave.migrations.length,
      `the plan says the \`${wave.name}\` wave needs ${row[2]} migrations; it needs ${wave.migrations.length}`);
  }
});
