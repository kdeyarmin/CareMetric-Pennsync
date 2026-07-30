import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AXE_TAGS,
  AXE_FAIL_IMPACTS,
  axeRulesForEnvironment,
  axeRunOptions,
  filterFailingViolations,
  formatAxeViolations,
} from './axeRules.js';

test('axe tags cover WCAG 2.0/2.1 A and AA', () => {
  assert.ok(AXE_TAGS.includes('wcag2a'));
  assert.ok(AXE_TAGS.includes('wcag2aa'));
  assert.ok(AXE_TAGS.includes('wcag21a'));
  assert.ok(AXE_TAGS.includes('wcag21aa'));
});

test('jsdom env disables color-contrast', () => {
  const rules = axeRulesForEnvironment('jsdom');
  assert.equal(rules['color-contrast'].enabled, false);
});

test('browser env does not disable color-contrast by default', () => {
  const rules = axeRulesForEnvironment('browser');
  assert.equal(rules['color-contrast'], undefined);
});

test('run options include tags and resultTypes', () => {
  const opts = axeRunOptions('browser');
  assert.deepEqual(opts.runOnly.values, [...AXE_TAGS]);
  assert.ok(opts.resultTypes.includes('violations'));
});

test('fail filter keeps only critical/serious', () => {
  const failing = filterFailingViolations([
    { id: 'a', impact: 'critical' },
    { id: 'b', impact: 'serious' },
    { id: 'c', impact: 'moderate' },
    { id: 'd', impact: 'minor' },
  ]);
  assert.deepEqual(failing.map((v) => v.id), ['a', 'b']);
  assert.ok(AXE_FAIL_IMPACTS.includes('critical'));
});

test('formatAxeViolations is readable', () => {
  const text = formatAxeViolations([
    { id: 'button-name', impact: 'critical', help: 'Buttons must have discernible text', nodes: [{}, {}] },
  ]);
  assert.match(text, /button-name/);
  assert.match(text, /critical/);
  assert.match(text, /2 node/);
});
