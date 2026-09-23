import test from 'node:test';
import assert from 'node:assert/strict';
import { compare, diff, fingerprints, readPin } from './tools-pennsync-migration-fingerprints.mjs';

/**
 * The ratchet over migration TEXT, and what a failure here means.
 *
 * This is not a style rule. The migrate tool matches on a migration's name and
 * holds no content hash, so a file edited after it has been applied is skipped
 * on every deployment that ran it and applied in full on every new one. D82
 * regenerated the record store and main went green with the hosted staging
 * store missing a policy; the only check that could see it runs on `main`.
 */
test('every committed migration is pinned, and none has changed since it was', () => {
  const { added, removed, changed } = compare();
  assert.deepEqual(changed, [],
    'A migration that has been merged has very likely been applied to a deployment, '
    + 'and the ledger keys on its NAME — so editing it changes what a NEW store gets '
    + 'and nothing else. Ship a forward migration carrying the change to stores that '
    + 'already ran this file (`tools-pennsync-record-catchup.mjs` is the worked '
    + 'example), then re-pin with `node tools-pennsync-migration-fingerprints.mjs '
    + '--write`. If no deployment has run this file yet, re-pin alone is the answer '
    + 'and say so in the change.');
  assert.deepEqual(added, [],
    'a new migration: `node tools-pennsync-migration-fingerprints.mjs --write`');
  assert.deepEqual(removed, [],
    'a pinned migration is gone; deleting one leaves MIGRATE_LEDGER_UNKNOWN '
    + 'on every deployment that applied it');
});

test('the pin covers both sequences and is not quietly empty', () => {
  // Two absent values are equal, so a pin that came out empty would make the
  // test above pass without reading a migration. The same failure the hosted
  // suite guards with "the reference build produced a store to compare
  // against".
  const pinned = Object.keys(readPin());
  assert.equal(pinned.length, Object.keys(fingerprints()).length);
  assert.ok(pinned.filter(name => name.startsWith('migrations/')).length > 1);
  assert.ok(pinned.filter(name => name.startsWith('record-migrations/')).length > 1);
});

test('the record store and its catch-up are both pinned, because they move together', () => {
  // Named rather than counted: the generated file is the one AGENTS.md tells
  // you to regenerate, and the catch-up is what carries a regeneration to a
  // store that exists. A pin missing either would leave the pair unguarded in
  // exactly the direction that failed.
  const pinned = readPin();
  assert.ok('record-migrations/20260919170000_record_store.sql' in pinned);
  assert.ok('record-migrations/20260920530000_profile_self_write.sql' in pinned);
});

test('the three findings are reported apart, because they ask for different things', () => {
  // A changed file is the alarm; an added one is housekeeping. Driven over
  // fixtures rather than the tree, so the distinction is proved without
  // editing a migration to see it.
  assert.deepEqual(diff({ a: '1', b: '2' }, { a: '1', b: '2' }),
    { added: [], removed: [], changed: [], count: 2 });
  assert.deepEqual(diff({ a: '9', b: '2' }, { a: '1', b: '2' }).changed, ['a']);
  assert.deepEqual(diff({ a: '1', c: '3' }, { a: '1' }).added, ['c']);
  assert.deepEqual(diff({ a: '1' }, { a: '1', z: '4' }).removed, ['z']);
  // A rename is both, and reads as both rather than as a silent swap.
  const renamed = diff({ b: '1' }, { a: '1' });
  assert.deepEqual([renamed.added, renamed.removed, renamed.changed], [['b'], ['a'], []]);
});
