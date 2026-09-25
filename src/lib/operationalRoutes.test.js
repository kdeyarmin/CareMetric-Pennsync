import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

import { callArguments } from '../../tools-entity-call-arguments.mjs';
import { ROUTED_OPERATIONS } from './independentEntityRoutes.js';

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
