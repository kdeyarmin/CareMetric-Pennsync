import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const entities = path.resolve(here, '../entities');

function readJsonc(name) {
  const source = fs.readFileSync(path.join(entities, `${name}.jsonc`), 'utf8');
  return Function(`"use strict"; return (${source});`)();
}

function assertImmutableOwnershipPolicy(rule, field) {
  assert.deepEqual(rule, {
    $and: [
      { created_by: '{{user.email}}' },
      { [`data.${field}`]: '{{user.email}}' },
    ],
  });
}

test('NotificationPreference writes are restricted to the authenticated owner', () => {
  const schema = readJsonc('NotificationPreference');
  assert.equal(schema.required.includes('user_email'), true);
  assert.deepEqual(schema.rls.create, { 'data.user_email': '{{user.email}}' });
  assertImmutableOwnershipPolicy(schema.rls.update, 'user_email');
  assertImmutableOwnershipPolicy(schema.rls.delete, 'user_email');
  assert.deepEqual(schema.rls.read, { 'data.user_email': '{{user.email}}' });
});

test('ScenarioAttempt is owner-readable and writable only by the grading broker', () => {
  const schema = readJsonc('ScenarioAttempt');
  assert.equal(schema.required.includes('user_id'), true);
  assert.deepEqual(schema.rls.read, { 'data.user_id': '{{user.email}}' });
  assert.equal(schema.rls.create, false);
  assert.equal(schema.rls.update, false);
  assert.equal(schema.rls.delete, false);
});

test('PlanEnrollment is owner-readable and writable only by backend functions', () => {
  const schema = readJsonc('PlanEnrollment');
  assert.deepEqual(schema.rls.read, { 'data.user_id': '{{user.email}}' });
  assert.equal(schema.rls.create, false);
  assert.equal(schema.rls.update, false);
  assert.equal(schema.rls.delete, false);
});

test('TrainingRecommendation is owner-readable and service-write-only', () => {
  const schema = readJsonc('TrainingRecommendation');
  assert.deepEqual(schema.rls.read, { 'data.nurse_email': '{{user.email}}' });
  assert.equal(schema.rls.create, false);
  assert.equal(schema.rls.update, false);
  assert.equal(schema.rls.delete, false);
});
