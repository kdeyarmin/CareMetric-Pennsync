import test from 'node:test';
import assert from 'node:assert/strict';
import { VIRTUALIZE_THRESHOLD, shouldVirtualizeList } from './virtualListConfig.js';

test('virtualize threshold is in a practical band', () => {
  assert.ok(VIRTUALIZE_THRESHOLD >= 20);
  assert.ok(VIRTUALIZE_THRESHOLD <= 100);
});

test('shouldVirtualizeList respects explicit enabled flag', () => {
  assert.equal(shouldVirtualizeList(5, true), true);
  assert.equal(shouldVirtualizeList(500, false), false);
});

test('shouldVirtualizeList uses threshold when enabled is omitted', () => {
  assert.equal(shouldVirtualizeList(VIRTUALIZE_THRESHOLD - 1), false);
  assert.equal(shouldVirtualizeList(VIRTUALIZE_THRESHOLD), true);
});
