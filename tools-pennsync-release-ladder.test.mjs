import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DECLARED_WAVES, LADDER_CONTRACT, LadderError, checkLadder, closureOf, dollarQuotedBody,
  functionBodies, handlerReach, importedNames, releaseLadder,
} from './tools-pennsync-release-ladder.mjs';

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
