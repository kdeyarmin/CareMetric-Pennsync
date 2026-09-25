import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DECLARED_WAVES, LADDER_CONTRACT, LadderError, checkLadder, closureOf, dollarQuotedBody,
  functionBodies, handlerReach, importedNames, integrationDependents, integrationReach,
  OWNER_HELD, cumulativeValue, heldLeaks, heldNames, probeDeployment, readinessOf,
  releasable, releaseDelta, releaseLadder, releaseFacts, reportDelta,
  AUTH_SEND_CALLS, AUTH_SEND_DECLARED, authSendHolds, authSendReach,
  brokeredOperationsRequired, integrationRuntimeHolds, runtimeReadinessOf,
  appBindingLine, deliveryDependents, deliveryOperationsRequired,
  deliveryReleaseSetting, requiredRuntimeOperations,
} from './tools-pennsync-release-ladder.mjs';
import { execFileSync } from 'node:child_process';
import { loadConfig, publicReadiness } from './services/pennsync-api/runtime.mjs';
import {
  BROKERED_OPERATIONS,
} from './services/pennsync-api/integrations.mjs';
import {
  DELIVERY_OPERATIONS, DELIVERY_RELEASE_ENV, DELIVERY_RELEASE_VALUE,
} from './services/pennsync-api/outbound-delivery.mjs';
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

/**
 * A hold the emitter would never build, and the only way the withholding
 * guards can still be shown to work.
 *
 * `OWNER_HELD` was emptied on the owner's word on 2026-09-25, which left six
 * guards that no longer fire from the real list — and a guard that cannot be
 * made to fire has not been shown to work, whatever a green suite says. Every
 * function over the hold therefore takes it as a parameter, and every test
 * below drives one of them from this.
 *
 * The two names are DERIVED from the real ladder rather than typed, for the
 * reason the staleness check exists: a hardcoded pair goes stale on a rename
 * and starts asserting over names no wave has. One comes from a wave near the
 * start and one from the last, so the cumulative path — where a hold applied
 * to a single wave's slice would leak — is really crossed.
 */
function syntheticHold(ladder) {
  const first = ladder.waves.find(wave => wave.handlers.length).handlers[0];
  const last = [...ladder.waves].reverse().find(wave => wave.handlers.length).handlers.at(-1);
  assert.notEqual(first, last, 'the synthetic hold needs two distinct handlers');
  return Object.freeze({
    [first]: 'A synthetic hold standing in for a real one, with a reason long enough to pass.',
    [last]: 'The second, in a later wave, so the cumulative value is exercised and not just a slice.',
  });
}

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
  const first = ladder.waves[0].adds.split(',');
  const second = ladder.waves[1].adds.split(',');
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

/**
 * The broker family is the second way a handler reaches a record, and it is
 * invisible to the contract call graph — `contractOrigins` starts from
 * `record-contracts.mjs` and the family is not in it. Planted here rather than
 * waited for: today every `records(` call in the tree is a `list`, so a
 * classifier that ignored the family entirely would look exactly like this one.
 */
test('a write through the broker family is a write, and a page through it is not', (t) => {
  const tree = intactTree(t);
  fixture(tree, {
    extraHandler: [
      "  pageThem: Object.freeze({",
      "    handle({ params, records }) { return records('list', params.entity, {}); },",
      "  }),",
      "  writeOne: Object.freeze({",
      "    handle({ params, records }) { return records('insert', params.entity, { record: params.record }); },",
      "  }),",
    ].join('\n'),
  });
  const facts = releaseFacts(tree.root);
  const page = facts.find(fact => fact.handler === 'pageThem');
  const write = facts.find(fact => fact.handler === 'writeOne');
  assert.deepEqual(page.records, ['list']);
  assert.equal(page.mutates, false);
  assert.deepEqual(write.records, ['insert']);
  assert.equal(write.mutates, true, 'an insert through the family is a write');
  // Both need the family's own migration, which no contract of theirs names.
  for (const fact of [page, write]) {
    assert.ok(fact.migrations.includes('20260919180000_record_brokers.sql'), fact.handler);
  }
});

test('an operation the family is asked for by variable claims nothing', (t) => {
  const tree = intactTree(t);
  fixture(tree, {
    extraHandler: [
      "  whichever: Object.freeze({",
      "    handle({ params, records }) { return records(params.operation, params.entity, {}); },",
      "  }),",
    ].join('\n'),
  });
  // The gate refuses an unresolved reach outright rather than reporting it, so
  // this is the refusal and not a field on a report somebody has to read.
  let failure = null;
  try { checkLadder(tree.root); } catch (error) { failure = error; }
  assert.ok(failure instanceof LadderError, `expected a refusal, got ${failure}`);
  assert.equal(failure.code, 'LADDER_REACH_UNRESOLVED');
  assert.deepEqual(failure.detail.handlers, ['whichever']);
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

test('the two email capabilities moved to the integration wave when they gained a send', () => {
  // This assertion is the INVERSE of the one it replaces, and the inversion is
  // the point of the cross-check above. While the send was paused both were
  // honestly read-only: they destructured no `integration` and could not call
  // the runtime. D97 serves the send, so both take it and both carry the flag,
  // and the ladder must place them where a sender belongs — otherwise a wave
  // whose whole promise is that nothing in it sends would hand an operator two
  // outbound senders. The pause did not move them; taking the capability did.
  const reach = integrationReach(REPOSITORY);
  const waves = checkLadder(REPOSITORY).waves;
  const readOnly = waves.find(entry => entry.name === 'read-only');
  const integration = waves.find(entry => entry.name === 'integration');
  for (const name of ['sendAccountReadyEmail', 'sendWelcomeEmail']) {
    assert.equal(reach.has(name), true, name);
    assert.equal(readOnly.handlers.includes(name), false, `${name} left the read-only wave`);
    assert.ok(integration.handlers.includes(name), `${name} is in the integration wave`);
    // The wave is where the DERIVATION puts them, and that is unchanged by the
    // hold being lifted: both still need the integration runtime, so a value
    // naming them is only valid once that runtime serves `SendEmail`. What DID
    // change is the emitter — they are no longer withheld from it — so the two
    // halves are asserted apart, which is the confusion this test was written
    // over in the first place.
    assert.equal(integration.withheld.includes(name), false,
      `${name} is no longer withheld; the owner lifted the hold`);
    assert.ok(integration.adds.split(',').includes(name),
      `${name} is emitted in its wave's own slice`);
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

test('a wave needing the runtime is blocked where this service is not configured', () => {
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

/**
 * The owner's mail hold, as a property of the emitter rather than of whoever
 * is pasting.
 *
 * The read-only wave went live on 2026-09-25 as this tool's own output with
 * `sendAccountReadyEmail` and `sendWelcomeEmail` struck out BY HAND, and
 * nothing in the repository recorded the subtraction — so re-running
 * `--wave read-only`, or building the writes wave on top of it, would have
 * emitted both again and no check would have fired. D92's guard cannot help:
 * it reads `needsIntegration`, which is false for both because the shipped
 * code really is refusal-only, and it cannot see a Railway variable at all.
 */
test('the hold is empty, and the two account emails are in the emitted value', () => {
  // The owner emptied it on 2026-09-25. This is the assertion that would catch
  // it being quietly put back: the positive one. Every test below drives the
  // guards from a synthetic hold, so all of them pass with the real list
  // holding anything at all — only this one says what the real list IS.
  assert.deepEqual(heldNames, [], 'the owner hold is empty');
  assert.deepEqual(Object.keys(OWNER_HELD), []);
  const ladder = checkLadder(REPOSITORY);
  const full = cumulativeValue(ladder, ladder.waves.at(-1));
  for (const name of ['sendAccountReadyEmail', 'sendWelcomeEmail']) {
    assert.ok(full.names.includes(name), `${name} is missing from the full value`);
  }
  assert.deepEqual([...full.withheld], [], 'nothing is withheld from the full value');
  assert.equal(full.names.length, ladder.handlers,
    'the full value is every handler, with nothing held back');
});

test('a hold that comes back owes a real handler and a real reason', () => {
  // The two rules that outlive the lift. Vacuous over today's empty list, so
  // they are driven over a synthetic one as well — a rule only ever checked
  // against an empty set is a rule nobody has seen work.
  const placed = new Set(checkLadder(REPOSITORY).waves.flatMap(wave => wave.handlers));
  const check = held => {
    for (const [name, reason] of Object.entries(held)) {
      assert.ok(placed.has(name), `${name} is held but is not a handler; the hold guards nothing`);
      assert.ok(reason.length >= 40, `${name} owes a reason, not a label`);
    }
  };
  check(OWNER_HELD);
  check(syntheticHold(checkLadder(REPOSITORY)));
  // And the staleness rule really refuses: a hold over a name no wave has.
  assert.throws(() => check({ notAHandler: 'a'.repeat(40) }), /notAHandler/);
  // As does the reason rule, which is why the length is checked and not the
  // presence: a label passes a truthiness test and says nothing.
  const [real] = [...placed];
  assert.throws(() => check({ [real]: 'too short' }), /reason/);
});

test('no wave emits a held name, and every held name still belongs to one', () => {
  // Driven from a SYNTHETIC hold. With the real list empty this assertion is
  // true of any tree whatsoever, including one whose withholding was deleted,
  // so the real list would prove nothing here.
  const hold = syntheticHold(checkLadder(REPOSITORY));
  const heldNames = Object.keys(hold).sort();
  const ladder = checkLadder(REPOSITORY, hold);
  for (const wave of ladder.waves) {
    for (const name of heldNames) {
      assert.ok(!wave.adds.split(',').includes(name),
        `wave ${wave.name} emits ${name}`);
    }
  }
  // Membership is unchanged by a hold: the derivation is right about where the
  // tree puts each one, and the hold is orthogonal to it. Asserted per WAVE
  // rather than against one named wave, because the held set now spans two —
  // a version of this pinned `read-only` and broke the moment it did, which is
  // the assertion describing today's set rather than the property.
  for (const wave of ladder.waves) {
    const held = wave.handlers.filter(name => heldNames.includes(name)).sort();
    assert.deepEqual([...wave.withheld].sort(), held,
      `wave ${wave.name} does not report what it withheld`);
    assert.equal(wave.adds.split(',').filter(Boolean).length,
      wave.handlers.length - held.length,
      `wave ${wave.name} emits a different count than its membership less its holds`);
  }
  // And every held name is somewhere, or the hold guards a name no wave has.
  for (const name of heldNames) {
    assert.ok(ladder.waves.some(wave => wave.handlers.includes(name)),
      `${name} is held but belongs to no wave`);
  }
});

test('every cumulative value excludes the held names, not just their own wave', () => {
  // The real failure mode is the NEXT wave: `mutating` is pasted as
  // read-only's names plus its own, so a hold that only applied to one wave's
  // slice would leak the moment the operator moved on. Driven through
  // `cumulativeValue`, which is what the CLI prints — an earlier version of
  // this test called `releasable` itself and passed with the CLI's own
  // withholding deleted.
  const hold = syntheticHold(checkLadder(REPOSITORY));
  const heldNames = Object.keys(hold).sort();
  const ladder = checkLadder(REPOSITORY, hold);
  for (const wave of ladder.waves) {
    const { names, withheld } = cumulativeValue(ladder, wave, hold);
    const membership = ladder.waves.slice(0, ladder.waves.indexOf(wave) + 1)
      .flatMap(entry => entry.handlers);
    for (const name of heldNames) {
      assert.ok(!names.includes(name), `the value through ${wave.name} carries ${name}`);
    }
    assert.equal(names.length, membership.length - membership.filter(n => heldNames.includes(n)).length);
    // And once a held name has been passed, every later wave keeps reporting
    // it, so the operator is told at the wave they are actually setting.
    const expected = membership.filter(name => heldNames.includes(name));
    assert.deepEqual([...withheld].sort(), expected.sort());
  }
  // The last wave carries both, which is the case that matters: whoever
  // releases the full surface must still be told these two are not in it.
  const last = cumulativeValue(ladder, ladder.waves.at(-1), hold);
  assert.deepEqual([...last.withheld].sort(), heldNames);
  assert.equal(last.names.length, ladder.handlers - heldNames.length);
});

test('the emitted-value guard bites when an emitter forgets to withhold', () => {
  // Driven with a wave the emitter would never build, because that is the case
  // it exists for. Asserting only that the real ladder is clean would pass
  // with the guard deleted.
  const hold = syntheticHold(checkLadder(REPOSITORY));
  const heldNames = Object.keys(hold).sort();
  assert.deepEqual(heldLeaks([{ name: 'read-only', adds: 'getDashboardData,searchPDFs' }], hold), []);
  assert.deepEqual(
    heldLeaks([{ name: 'read-only', adds: `getDashboardData,${heldNames[0]}` }], hold),
    [{ wave: 'read-only', handlers: [heldNames[0]] }],
  );
  // And a substring of a held name is not a held name: `sendWelcomeEmailer`
  // would be a different capability, and matching it would refuse a value that
  // is fine.
  assert.deepEqual(heldLeaks([{ name: 'x', adds: `${heldNames[1]}er` }], hold), []);
});

test('a held name already serving on a deployment is reported, not passed over', () => {
  // The repository's half of the hold is the value it emits. This is the only
  // place the emitted value and the running one can be compared, so a
  // hand-edited value that put a held name live is visible here or nowhere.
  const hold = syntheticHold(checkLadder(REPOSITORY));
  const heldNames = Object.keys(hold).sort();
  const lines = [];
  const readiness = readinessOf({
    ready: true, released: true, authorityConfigured: true, integrationsRequired: false,
    integrationsConfigured: true, appId: 'a', appStated: true, revision: 'r',
    implemented: ['getDashboardData', ...heldNames],
    operations: ['getDashboardData', heldNames[0]],
  }, 'test');
  const code = reportDelta(
    ['getDashboardData'], readiness,
    { name: 'read-only', needsIntegration: false }, line => lines.push(line), hold,
  );
  const said = lines.join('\n');
  assert.match(said, /WITHHELD NAME IS LIVE/);
  assert.match(said, new RegExp(heldNames[0]));
  assert.equal(code, 1, 'a live held name is a non-zero exit, not a note');
});

test('the Auth-send gate fires on a real call and stays quiet on a comment', () => {
  // D92 reads `integration` and is blind to the route Supabase Auth takes, so
  // this is the same check over the other one. Proved by driving it, never by
  // reading it: a gate nobody has seen fire has not been shown to work.
  assert.equal(authSendReach(REPOSITORY).size, 0,
    'nothing in the service reaches an Auth send today; if that changed, declare it');
  assert.deepEqual(AUTH_SEND_DECLARED, {},
    'the declaration list is empty because the reach is; they move together');

  // A real call is refused, and the refusal names the file AND the call, since
  // "something somewhere sends mail" is not actionable.
  const reached = new Map([['account-email.mjs', ['inviteUserByEmail']]]);
  assert.throws(() => authSendHolds(reached, {}), error => {
    assert.equal(error.code, 'LADDER_AUTH_SEND_UNDECLARED');
    assert.deepEqual(error.detail.undeclared, [
      { file: 'account-email.mjs', calls: ['inviteUserByEmail'] }]);
    return true;
  });
  // Declared, it passes — that is how invitation delivery ships.
  authSendHolds(reached, { 'account-email.mjs': 'invitation delivery, released' });

  // And a declaration whose reach has gone is refused too. That is D47's shape:
  // a hold outlives its reason exactly where nothing can notice.
  assert.throws(() => authSendHolds(new Map(), { 'gone.mjs': 'why' }),
    error => error.code === 'LADDER_AUTH_SEND_UNDECLARED'
      && error.detail.declared_without_reach[0] === 'gone.mjs');

  // Every call this watches must be one Supabase actually mails on.
  assert.deepEqual([...AUTH_SEND_CALLS].sort(), ['generateLink', 'inviteUserByEmail',
    'resetPasswordForEmail', 'signInWithOtp', 'signUp']);
});

test('no wave exposes a field that could be mistaken for the operator value', () => {
  // The field was called `functions` and its comment said "what an operator
  // sets". Both were wrong: it is one wave's slice, and consecutive waves share
  // no names, so composing from it sets the new wave and REVOKES everything
  // already serving. Renamed to `adds`; this fails if the trap returns.
  const ladder = checkLadder(REPOSITORY);
  for (const wave of ladder.waves) {
    assert.ok(!Object.hasOwn(wave, 'functions'),
      `wave ${wave.name} carries a \`functions\` key again`);
    assert.ok(Object.hasOwn(wave, 'adds'), `wave ${wave.name} lost its \`adds\``);
  }
});

test('the value an operator sets only ever grows, wave by wave', () => {
  // The property the two representations violated. Asserted over the CUMULATIVE
  // value, because that is the one a release is composed from: each wave must
  // be a strict superset of the one before it, or setting it revokes a name the
  // deployment is serving. Wave 5 going out as its own 32 names would have
  // dropped the 29 live ones, patients and visits included.
  const ladder = checkLadder(REPOSITORY);
  let previous = [];
  for (const wave of ladder.waves) {
    const value = cumulativeValue(ladder, wave).names;
    for (const name of previous) {
      assert.ok(value.includes(name),
        `wave ${wave.name} drops ${name}, which an earlier wave released`);
    }
    assert.ok(value.length >= previous.length, `wave ${wave.name} shrinks the value`);
    assert.equal(value.length, new Set(value).size, `wave ${wave.name} repeats a name`);
    previous = value;
  }
  // And the per-wave slice is NOT that value, which is the whole point.
  const mutating = ladder.waves.find(wave => wave.name === 'mutating');
  assert.notEqual(mutating.adds, cumulativeValue(ladder, mutating).names.join(','));
});

/**
 * The integration wave's prerequisite is the OTHER service's state, and this
 * tool used to state it from a constant: "deployed and paused" appeared in four
 * places, was true when written, and went silently false the moment the runtime
 * was released. These hold the replacement to being a measurement.
 */

const RUNTIME_BODY = Object.freeze({
  ready: true, released: true, configured: true,
  operations: ['InvokeLLM', 'ExtractDataFromUploadedFile'], missingProviders: [],
  authorityMode: 'independent', base44ExecutionDependency: false,
  trafficCutoverVerified: false, revision: 'a'.repeat(40),
  browserContract: 'cm.integrations.v2', browserRevisionBound: true,
  browserReleased: false, browserOperations: [], browserReady: false,
});

test('the wave requirement is read from the allowlist, not typed here', () => {
  // Derived for the same reason the wave's membership is: a second copy of the
  // brokered set would let this gate pass a runtime serving something else.
  const required = brokeredOperationsRequired(REPOSITORY);
  assert.deepEqual([...required], ['InvokeLLM', 'ExtractDataFromUploadedFile']);
  // And NOT the delivery half. That is a DIFFERENT question — whether the value
  // being written releases mail — and `requiredRuntimeOperations` answers it
  // below. This one stays the unconditional set, so a reader of it still sees
  // exactly what any deployment may ask the runtime for.
  assert.ok(!required.includes('SendEmail'));
  const source = readFileSync(join(REPOSITORY, 'services/pennsync-api/integrations.mjs'), 'utf8');
  assert.match(source, /DELIVERY_OPERATIONS/, 'the delivery set is what this must not pick up');
});

test('every allowlist this tool parses equals the service\'s own declaration', () => {
  // Parsed rather than typed, so the comparison is against the exported value
  // the service actually uses. A literal here would pass while the service
  // moved underneath it, which is the drift this whole change is about.
  assert.deepEqual([...brokeredOperationsRequired(REPOSITORY)], [...BROKERED_OPERATIONS]);
  assert.deepEqual([...deliveryOperationsRequired(REPOSITORY)], [...DELIVERY_OPERATIONS]);
  assert.deepEqual(deliveryReleaseSetting(REPOSITORY),
    { variable: DELIVERY_RELEASE_ENV, value: DELIVERY_RELEASE_VALUE });
  // The two sets stay disjoint: `DELIVERY_OPERATIONS` exists so the ratchet
  // cannot quietly acquire a sender, and a merge of the two lists would erase
  // the distinction this tool now depends on.
  const brokered = new Set(brokeredOperationsRequired(REPOSITORY));
  assert.ok([...deliveryOperationsRequired(REPOSITORY)].every(name => !brokered.has(name)));
});

test('the requirement follows the VALUE, and the delivery half arrives with the senders', () => {
  // The defect this replaces: the requirement was the unconditional set always,
  // so a value carrying both senders asked a runtime for two operations and
  // the api would ask it for three. Driven from the real ladder rather than a
  // fixture, because the whole point is that the value decides.
  const ladder = checkLadder(REPOSITORY);
  const waveNamed = name => cumulativeValue(ladder, ladder.waves.find(wave => wave.name === name)).names;
  const senders = [...deliveryDependents(REPOSITORY)];
  assert.ok(senders.length, 'the registry declares at least one outbound sender');

  const integration = requiredRuntimeOperations(REPOSITORY, waveNamed('integration'));
  assert.deepEqual([...integration.senders], senders.filter(name => waveNamed('integration').includes(name)));
  assert.ok(integration.required.includes('SendEmail'));
  // Every unconditional name is still there: the delivery half ADDS.
  for (const name of brokeredOperationsRequired(REPOSITORY)) assert.ok(integration.required.includes(name));

  const readOnly = requiredRuntimeOperations(REPOSITORY, waveNamed('read-only'));
  assert.deepEqual([...readOnly.senders], []);
  assert.deepEqual([...readOnly.required], [...brokeredOperationsRequired(REPOSITORY)]);
  assert.ok(!readOnly.required.includes('SendEmail'),
    'a value naming no sender must not make an unrelated wave wait on mail');

  // And it is a property of the NAMES, not of the wave: hand it the senders
  // alone and the delivery half still arrives.
  assert.ok(requiredRuntimeOperations(REPOSITORY, senders).required.includes('SendEmail'));
  assert.ok(!requiredRuntimeOperations(REPOSITORY, []).required.includes('SendEmail'));
});

test('every sender also reaches the runtime, which is what the deployment gate leans on', () => {
  // `--integration-deployment` returns early on `wave.needsIntegration`, so a
  // value whose requirement carries `SendEmail` would have that requirement
  // computed and then discarded, with the operator told the wave "needs no
  // runtime" about a value that asks the runtime for mail.
  //
  // It cannot happen while every `needsDelivery` handler is also
  // `needsIntegration` — true by construction, since a sender reaches the
  // runtime in order to send. That fact was load-bearing and unasserted, which
  // is the exact shape this change exists to fix, so it is asserted rather than
  // worked around: a handler declared `needsDelivery` without `needsIntegration`
  // fails here instead of quietly skipping the gate.
  const senders = deliveryDependents(REPOSITORY);
  const reaches = integrationDependents(REPOSITORY);
  assert.ok(senders.size, 'the registry declares at least one outbound sender');
  const orphans = [...senders].filter(name => !reaches.has(name));
  assert.deepEqual(orphans, [],
    'a sender that does not declare needsIntegration would skip the runtime gate entirely');
  // And the waves follow from it: every wave whose value names a sender is a
  // wave the gate will actually probe.
  const ladder = checkLadder(REPOSITORY);
  for (const wave of ladder.waves) {
    const { senders: named } = requiredRuntimeOperations(REPOSITORY, cumulativeValue(ladder, wave).names);
    if (named.length) assert.ok(wave.needsIntegration, `${wave.name} names a sender and skips the runtime gate`);
  }
});

test('a runtime not serving the delivery operation no longer passes a value that releases mail', () => {
  // The bite. With the old requirement this runtime passed, because nothing
  // asked it for `SendEmail`; the assertion below is written so that reverting
  // `requiredRuntimeOperations` to the unconditional set fails it.
  const ladder = checkLadder(REPOSITORY);
  const names = cumulativeValue(ladder, ladder.waves.find(wave => wave.name === 'integration')).names;
  const required = requiredRuntimeOperations(REPOSITORY, names).required;
  const withoutMail = {
    configured: true, released: true, ready: true,
    operations: [...brokeredOperationsRequired(REPOSITORY)], missingProviders: [],
  };
  const problems = integrationRuntimeHolds(required, withoutMail);
  assert.ok(problems.some(problem => problem.includes('not serving SendEmail')), problems.join('; '));
  assert.deepEqual(integrationRuntimeHolds(brokeredOperationsRequired(REPOSITORY), withoutMail), [],
    'the unconditional set is what used to let this through — kept as the contrast');

  // `missingProviders` had the same reach and therefore the same hole: a
  // runtime serving SendEmail with no provider key configured is the likelier
  // failure of the two.
  const keyless = { ...withoutMail, operations: [...required], missingProviders: ['SendEmail'] };
  assert.ok(integrationRuntimeHolds(required, keyless)
    .some(problem => problem.includes('provider config is incomplete for SendEmail')));
  assert.deepEqual(integrationRuntimeHolds(brokeredOperationsRequired(REPOSITORY), keyless), []);
});

test('the emitted wave says what the same write owes, and says nothing where no sender is named', () => {
  // Driven through the CLI an operator actually runs, because the requirement
  // and the notice are what reach them; asserting the function alone would pass
  // with neither line printed.
  const emit = wave => execFileSync(process.execPath,
    ['tools-pennsync-release-ladder.mjs', '--wave', wave], { cwd: REPOSITORY, encoding: 'utf8' });

  const integration = emit('integration');
  assert.match(integration, /needs the integration runtime, serving [^\n]*SendEmail/);
  assert.match(integration, new RegExp(`${DELIVERY_RELEASE_ENV}=${DELIVERY_RELEASE_VALUE}`));
  // Named as what THIS write owes rather than checked against a deployment: a
  // value that releases mail is written against one where mail is not yet
  // released, so a refusal on the current reading would refuse the correct
  // write. That is not a theory — the live api read `deliveryReleased: false`
  // at 16:16Z on 2026-09-25 while the value about to be written turned it on.
  assert.match(integration, /the same write must set/);
  for (const sender of deliveryDependents(REPOSITORY)) assert.match(integration, new RegExp(sender));

  const readOnly = emit('read-only');
  assert.ok(!readOnly.includes('SendEmail'), readOnly);
  assert.ok(!readOnly.includes(DELIVERY_RELEASE_ENV), readOnly);
});

test('a body the runtime does not publish is refused, and so is the other service\'s', () => {
  assert.deepEqual(runtimeReadinessOf(RUNTIME_BODY, 'x').operations,
    ['InvokeLLM', 'ExtractDataFromUploadedFile']);
  // The business API answers `operations`, `released`, `ready` and `revision`
  // too, so a first draft accepted its body and printed 61 handler names as
  // what "the runtime is serving". Refused BY NAME on `implemented`.
  const businessApi = { ...RUNTIME_BODY, implemented: ['listAuthorizedPatients'], operations: ['listAuthorizedPatients'] };
  assert.throws(() => runtimeReadinessOf(businessApi, 'https://api.example/readyz'),
    error => error instanceof LadderError && error.code === 'LADDER_RUNTIME_IS_THE_BUSINESS_API');
  // And it fails closed on a shape it does not recognise rather than reading
  // absent fields as satisfied.
  for (const key of ['operations', 'browserOperations', 'missingProviders', 'configured', 'released', 'ready', 'revision']) {
    const body = { ...RUNTIME_BODY };
    delete body[key];
    assert.throws(() => runtimeReadinessOf(body, 'x'),
      error => error instanceof LadderError && error.code === 'LADDER_RUNTIME_UNREADABLE',
      `a body without ${key} was accepted`);
  }
});

test('the app binding is read when that service publishes it, and absent when it does not', () => {
  // OPTIONAL on purpose. The runtime began publishing this pair after the
  // reader was written and a merge does not deploy it, so a body without it is
  // a current deployment: refusing one would make this gate unusable against
  // the very service it measures, which is the opposite of the failure it was
  // built for.
  const unpublished = runtimeReadinessOf(RUNTIME_BODY, 'x');
  assert.equal(unpublished.appId, null);
  assert.equal(unpublished.appStated, null);

  const published = runtimeReadinessOf({ ...RUNTIME_BODY, appId: '6a9881683dc68a0bd54f1ef7', appStated: true }, 'x');
  assert.equal(published.appId, '6a9881683dc68a0bd54f1ef7');
  assert.equal(published.appStated, true);
  // Read, not judged: which id is right for a target is that service's own
  // startup check, and a second copy of its pin here is the defect this whole
  // file exists to remove.
  const other = runtimeReadinessOf({ ...RUNTIME_BODY, appId: '694ec16e72e01b60d22f7cbf', appStated: false }, 'x');
  assert.equal(other.appId, '694ec16e72e01b60d22f7cbf');
  assert.equal(other.appStated, false);

  // What IS refused: a half-published pair, and either field of the wrong
  // type. `undefined` printed beside a real id has the shape of a measurement
  // with nothing behind it.
  // Both branches of the operator's line are proved by RUNNING them. The live
  // runtime publishes no binding yet, so the populated branch cannot be driven
  // end to end against it, and scanning the tool for the template literal
  // would prove the text exists rather than that it renders.
  assert.equal(appBindingLine(published),
    '# app binding 6a9881683dc68a0bd54f1ef7, stated by the operator true');
  assert.equal(appBindingLine(other),
    '# app binding 694ec16e72e01b60d22f7cbf, stated by the operator false');
  assert.match(appBindingLine(unpublished), /publishes no app binding/);
  assert.ok(!/6a9881683dc68a0bd54f1ef7|undefined|null/.test(appBindingLine(unpublished)),
    'the absent branch names an id or renders an empty read');

  for (const body of [
    { ...RUNTIME_BODY, appId: '6a9881683dc68a0bd54f1ef7' },
    { ...RUNTIME_BODY, appStated: true },
    { ...RUNTIME_BODY, appId: 694, appStated: true },
    { ...RUNTIME_BODY, appId: '6a9881683dc68a0bd54f1ef7', appStated: 'yes' },
    { ...RUNTIME_BODY, appId: null, appStated: null },
  ]) {
    assert.throws(() => runtimeReadinessOf(body, 'x'),
      error => error instanceof LadderError && error.code === 'LADDER_RUNTIME_APP_BINDING_UNREADABLE',
      `accepted ${JSON.stringify({ appId: body.appId, appStated: body.appStated })}`);
  }
});

test('the gate names every reason a wave does not hold against the runtime', () => {
  const required = brokeredOperationsRequired(REPOSITORY);
  assert.deepEqual([...integrationRuntimeHolds(required, runtimeReadinessOf(RUNTIME_BODY, 'x'))], []);
  const paused = runtimeReadinessOf({ ...RUNTIME_BODY, ready: false, released: false, operations: [] }, 'x');
  const reasons = integrationRuntimeHolds(required, paused);
  assert.ok(reasons.some(reason => reason.includes('not released')));
  assert.ok(reasons.some(reason => reason.includes('not serving InvokeLLM')));
  // A provider gap is named on its own rather than folded into "not ready",
  // which would send an operator to the release flag for an empty key.
  const keyless = runtimeReadinessOf({ ...RUNTIME_BODY, ready: false, missingProviders: ['InvokeLLM'] }, 'x');
  assert.ok(integrationRuntimeHolds(required, keyless)
    .some(reason => reason.includes('provider config is incomplete for InvokeLLM')));
  // An unready runtime that this check cannot explain still fails, rather than
  // holding because none of the named reasons matched.
  const unexplained = runtimeReadinessOf({ ...RUNTIME_BODY, ready: false }, 'x');
  assert.equal(integrationRuntimeHolds(required, unexplained).length, 1);
});

test('the tool no longer states the runtime\'s condition from a constant', () => {
  // Comments are stripped first and that distinction is the point: the header
  // explains this history and necessarily contains the old phrase, so a scan of
  // the page would fail on the very note recording the fix. This means absent
  // from the CODE.
  const source = readFileSync(join(REPOSITORY, 'tools-pennsync-release-ladder.mjs'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/deployed and paused/.test(source),
    'a wave reason asserts the other service\'s state again');
  assert.ok(!/paused runtime/.test(source), 'a wave reason calls the runtime paused again');
  // The replacement says what the wave REQUIRES.
  const integration = checkLadder(REPOSITORY).waves.find(wave => wave.name === 'integration');
  assert.match(integration.reason, /must therefore be released and serving/);
});

test('the gate says what it does not prove, without listing the other service\'s defects', () => {
  // A gate that read "the runtime serves what this wave needs" and stopped
  // there would be the literal it replaced, one level up. The first version
  // said so by ENUMERATING two states of that service — a production app
  // binding and a revoked authority key — and asserting it published no app id
  // so neither could be seen. Within a day the runtime refused a mismatched
  // binding at startup, its preflight learned to tell a revoked key apart, and
  // it began publishing the binding: three claims of mine going stale at once,
  // in the output of the tool written to stop that. So the bound is stated as
  // a property of THIS check and the binding is reported as a reading.
  // Comments are stripped, so this is about what an operator READS.
  const source = readFileSync(join(REPOSITORY, 'tools-pennsync-release-ladder.mjs'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(source, /NOT proof it can answer/);
  assert.match(source, /asks the SHAPE of its/);
  // The binding is printed from what was read, and its absence is said plainly
  // rather than asserted as a property of that service.
  assert.match(source, /app binding \$\{runtime\.appId\}/);
  assert.match(source, /publishes no app binding/);
  assert.ok(!/publishes no app id/.test(source), 'the gate asserts the missing pair again');
  assert.ok(!/revoked/.test(source), 'the gate enumerates that service\'s failure modes again');
  // The preflight is named as what probes further; how it decides is its own
  // and changed once already, so this no longer describes its pass condition.
  assert.match(source, /INTEGRATIONS_PREFLIGHT=read-only/);
  assert.ok(!/401\/403/.test(source), 'the gate states the preflight\'s pass condition again');
});
