import test from 'node:test';
import assert from 'node:assert/strict';
import { VIRTUALIZE_THRESHOLD } from './useVirtualList.js';

test('virtualize threshold is high enough to skip trivial lists', () => {
  assert.ok(VIRTUALIZE_THRESHOLD >= 20);
  assert.ok(VIRTUALIZE_THRESHOLD <= 100);
});
