import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

import { callArguments } from '../../tools-entity-call-arguments.mjs';
import { ARGUMENTS_UNSUPPORTED, ENTITY_ROUTES, ROUTED_OPERATIONS }
  from './independentEntityRoutes.js';

const REPOSITORY = fileURLToPath(new URL('../..', import.meta.url));

/**
 * The two entity operations of the seven operational tables that stay on
 * Base44 although their capabilities are built, as a check rather than a
 * paragraph.
 *
 * Both contracts are in this change with their refusal suites. What is missing
 * in each case is the route declaration, and in neither case is the reason a
 * property of the capability — so a note in a PR body saying so would go stale
 * the day the reason stops holding and nobody would return to it. Each group
 * below asserts its own reason instead, and fails the moment it lapses.
 *
 * A failure here is not a defect. It is the reminder: declare the route.
 */

/**
 * `Task.create` is provable — one of its two call sites in
 * `src/pages/ReferralTriage.jsx` passes a literal — and was held first by
 * `measureRoutes` subtracting served sites by (file, key) PAIR while counting
 * them individually, which made its three dispositions stop summing. #297
 * fixed that arithmetic and the hold survived it for a second reason worth
 * distinguishing: the regression test #297 shipped PLANTS `Task.create` as its
 * own route and asserts the measurement rises against a baseline taken
 * without it, so a declaration here puts that key in the baseline and the
 * assertion fails. That test is another batch's file. The route is one line
 * once its plant names a key no batch declares.
 */
const HELD_ON_THE_GATE = Object.freeze(['Task.create']);

/**
 * `NoteConversion.filter` is held on the CONTRACT, and this one is a real gap
 * rather than tooling. Its single call site in
 * `src/components/smartNote/persistVisitNote.js` narrows on five fields —
 * `recovery_request_id`, `created_by`, `nurse_email`, `patient_id` and
 * sometimes `visit_id` — and `contract_note_conversion_list` takes only the
 * first. The caller then requires EXACTLY ONE row and treats anything else as
 * an unconfirmed write, so a route that quietly dropped the other four would
 * turn a duplicate-detection read into a read that can return two rows and
 * fail the save. House rule: refuse a filter key the contract cannot express
 * rather than drop it — which here means not declaring the route until the
 * contract takes those predicates.
 */
const HELD_ON_THE_CONTRACT = Object.freeze(['NoteConversion.filter']);

test('every held operational operation is held, and none is quietly declared', () => {
  for (const key of [...HELD_ON_THE_GATE, ...HELD_ON_THE_CONTRACT]) {
    assert.ok(!ROUTED_OPERATIONS.includes(key),
      `${key} is declared now — delete it from this file's list`);
  }
});

test('Task.create is held on the gate rather than on the argument reader', () => {
  const sites = callArguments(REPOSITORY)
    .filter(site => site.entity === 'Task' && site.operation === 'create');
  const readable = sites.filter(site => site.arguments !== null);
  // The reason it is separate: it IS readable, so the reader is not what holds
  // it. If that stops being true, the group it belongs in has changed.
  assert.ok(readable.length > 0 && readable.length < sites.length,
    'Task.create is no longer a partly readable key — re-read why it is held');
  const files = new Set(readable.map(site => site.file));
  const mixed = [...files].filter(file =>
    sites.some(site => site.file === file && site.arguments === null));
  assert.deepEqual(mixed, ['src/pages/ReferralTriage.jsx'],
    'the mixed file this waits on is no longer the one named above');
});

test('NoteConversion.filter is held on what its contract cannot express', async () => {
  const { RECORD_CONTRACTS } = await import('../../services/pennsync-api/record-contracts.mjs');
  const params = RECORD_CONTRACTS.listNoteConversions.params;
  // The four the call site also narrows on. When the contract grows them, this
  // fails and the route is two lines.
  for (const field of ['created_by', 'nurse_email', 'patient_id', 'visit_id']) {
    assert.ok(!params.includes(field),
      `listNoteConversions takes ${field} now — declare NoteConversion.filter`);
  }
  assert.ok(params.includes('recovery_request_id'),
    'the one predicate it does take has gone — re-read this hold');
});

/**
 * The seam between a read's projection and the write beside it.
 *
 * Batch E measured this on its own pair: a screen that saves
 * `{ ...row, one_field: value }` sends exactly the read's projection, so
 * WIDENING THE READ BY ONE COLUMN MAKES EVERY SAVE FAIL, with both contracts'
 * suites green and neither wrong on its own. The four `AgencySettings` panels
 * are the same shape from the other side: each mirrors the fetched row into a
 * form, field by field, and posts the form back. They do not spread the row —
 * checked, and the reason the whole-row projection does not reach
 * `FIELD_RESERVED` here — but every column they mirror is a column the save
 * must accept, and nothing else in the tree compares those two lists.
 *
 * So the pin is the mirrored columns, read out of the panels rather than
 * typed: add one to a screen, or drop one from `settings_writable()`, and this
 * says so at build time instead of the save failing in front of an
 * administrator.
 */
test('every AgencySettings column the admin panels mirror is one the save accepts', () => {
  const migration = readFileSync(resolve(REPOSITORY,
    'services/authority-store/supabase/record-migrations/'
    + '20260920580000_contract_operational_tables.sql'), 'utf8');
  const declaration = migration.match(
    /settings_writable\(\) returns text\[\][\s\S]*?\$writable\$;/);
  assert.ok(declaration, 'the writable set has moved or been renamed');
  const writable = new Set([...declaration[0].matchAll(/'([a-z0-9_]+)'/g)]
    .map(match => match[1]));

  const panels = ['A2PCompliancePanel', 'CallingHoursPanel', 'PhoneProvisioningPanel',
    'FaxReceivingToggle'].map(name => `src/components/admin/${name}.jsx`);
  let mirrored = 0;
  for (const panel of panels) {
    const source = readFileSync(resolve(REPOSITORY, panel), 'utf8');
    const columns = new Set([...source.matchAll(/\bsettings\??\.([a-z][a-z0-9_]+)/g)]
      .map(match => match[1]));
    // `id` is the row's own and is what tells a save from a create.
    columns.delete('id');
    mirrored += columns.size;
    const refused = [...columns].filter(column => !writable.has(column)).sort();
    assert.deepEqual(refused, [],
      `${panel} mirrors columns the save would refuse: ${refused.join(', ')}`);
  }
  // Without this the loop passes on a tree where the panels were renamed away
  // and every column set came back empty.
  assert.ok(mirrored > 20, `only ${mirrored} columns mirrored — the panels were not read`);
});

/**
 * The arity of each operational route, against the signature it replaces.
 *
 * #302's guard refuses arguments PAST the declared arity, so a number that is
 * too GENEROUS fails open on exactly the case the guard exists to catch — a
 * third argument to a two-argument route is accepted and silently dropped, and
 * the module loads clean either way. Both of these families take a rest
 * parameter, so `request.length` is 0 and the number is declared by hand;
 * over-declaring either by one changes nothing that any other test in the tree
 * can see, which is measured rather than assumed.
 *
 * So the number is checked against the thing it is a number OF: the Base44
 * entity method's own signature, which is what a call site is written to.
 * `list(sort, limit)` is two, `filter(query, sort, limit)` is three,
 * `create(payload)` is one, `update(id, payload)` is two. Every one of the
 * declared routes agrees with this table today, not only the operational ones,
 * but this asserts the ones this change owns — the rest are their authors' to
 * pin, and a check that fails somebody else's correct route is worse than none.
 */
test('each operational route declares the arity its entity method has', () => {
  const SIGNATURE = { list: 2, filter: 3, create: 1, update: 2, delete: 1, get: 1 };
  const operational = Object.entries(ENTITY_ROUTES)
    .filter(([, route]) => route.projection === 'operational_row');
  assert.ok(operational.length >= 19,
    `only ${operational.length} operational routes found — the projection name has moved`);
  for (const [key, route] of operational) {
    const operation = key.split('.')[1];
    const expected = SIGNATURE[operation];
    assert.ok(expected !== undefined, `${key}: no signature recorded for ${operation}`);
    assert.equal(route.arity, expected,
      `${key} declares arity ${route.arity}; ${operation} takes ${expected}`);
    // And the guard is really wired at that number, rather than the number
    // merely being written down beside a route that accepts anything. The
    // assertion is on `detail`, not the code: every refusal in that module
    // carries the same `ARGUMENTS_UNSUPPORTED`, so a route that rejects the
    // filler for a reason of its own — a sort it cannot honour, a filter field
    // it does not take — would satisfy a code-only check vacuously.
    assert.throws(() => route.request(...Array.from({ length: expected + 1 })),
      error => error.code === ARGUMENTS_UNSUPPORTED && error.detail === 'argument_count',
      `${key} accepts one argument too many`);
  }
});
