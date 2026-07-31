import test from 'node:test';
import assert from 'node:assert/strict';

// Hook imports @tanstack/react-virtual (browser). Threshold contracts live in
// src/lib/virtualListConfig.test.js so node:test stays free of React deps.
test('virtual list threshold tests live in virtualListConfig.test.js', () => {
  assert.equal(true, true);
});
