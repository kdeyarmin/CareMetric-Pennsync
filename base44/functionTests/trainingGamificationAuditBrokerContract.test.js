import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import JSON5 from 'json5';
import { transpileTs } from '../../tools-transpile-ts.mjs';

async function loadFunction(name, client) {
  let source = await readFile(new URL(`../functions/${name}/entry.ts`, import.meta.url), 'utf8');
  source = source.replace(
    /import\s+\{[^}]*\}\s+from\s+'npm:@base44\/sdk@[^']*';?/,
    'const createClientFromRequest = globalThis.__trainingBrokerClient;',
  );
  const file = join(tmpdir(), `training_broker_${name}_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(file, transpileTs(source).outputText);
  let handler;
  globalThis.__trainingBrokerClient = () => client;
  globalThis.Deno = {
    serve: (candidate) => { handler = candidate; },
    env: { get: () => undefined },
  };
  try {
    await import(pathToFileURL(file).href);
  } finally {
    await unlink(file).catch(() => {});
    delete globalThis.__trainingBrokerClient;
  }
  return handler;
}

function request(body = {}) {
  return new Request('http://local/training-broker', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('training audit and achievement entities deny every direct SDK operation', async () => {
  for (const entity of ['TrainingAuditLog', 'UserBadge', 'Leaderboard']) {
    const schema = JSON5.parse(await readFile(
      new URL(`../entities/${entity}.jsonc`, import.meta.url),
      'utf8',
    ));
    assert.deepEqual(schema.rls, {
      create: false,
      read: false,
      update: false,
      delete: false,
    });
  }
});

test('frontend has no direct TrainingAuditLog, UserBadge, or Leaderboard SDK access', async () => {
  const violations = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
      if (entry.isDirectory()) await walk(url);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name)) {
        const source = await readFile(url, 'utf8');
        const match = source.match(/base44\.entities\.(TrainingAuditLog|UserBadge|Leaderboard)\b/g);
        if (match) violations.push(`${url.pathname}: ${match.join(', ')}`);
      }
    }
  }
  await walk(new URL('../../src/', import.meta.url));
  assert.deepEqual(violations, []);
});

test('gamification broker ignores requested identities and filters leaked service rows', async () => {
  const queries = [];
  const client = {
    auth: { me: async () => ({ email: 'Nurse@Example.test', is_active: true }) },
    asServiceRole: { entities: {
      Leaderboard: { filter: async (...args) => {
        queries.push(['leaderboard', ...args]);
        return [
          { id: 'foreign-board', user_id: 'victim@example.test', total_points: 999 },
          { id: 'own-board', user_id: 'nurse@example.test', user_name: 'Nurse', total_points: 42, courses_completed: 3 },
        ];
      } },
      UserBadge: { filter: async (...args) => {
        queries.push(['badges', ...args]);
        return [
          { id: 'foreign-badge', user_id: 'victim@example.test', badge_name: 'Private' },
          {
            id: 'own-badge', user_id: 'NURSE@example.test', badge_name: 'Safe', displayed: true,
            points_awarded: 10, trigger_context: { rarity: 'rare', attempt_id: 'must-not-leak' },
          },
          { id: 'hidden-own-badge', user_id: 'nurse@example.test', displayed: false },
        ];
      } },
    } },
  };
  const handler = await loadFunction('getMyTrainingGamification', client);
  const response = await handler(request({ userId: 'victim@example.test' }));
  const json = await response.json();

  assert.equal(response.status, 200);
  assert.equal(json.leaderboard.id, 'own-board');
  assert.equal(json.leaderboard.total_points, 42);
  assert.equal(json.leaderboard.user_id, undefined);
  assert.deepEqual(json.badges, [{
    id: 'own-badge',
    badge_name: 'Safe',
    badge_type: '',
    earned_at: null,
    points_awarded: 10,
    trigger_context: { rarity: 'rare' },
  }]);
  assert.equal(json.team_rank_available, false);
  assert.deepEqual(queries[0].slice(0, 3), ['leaderboard', { user_id: 'Nurse@Example.test' }, '-updated_date']);
  assert.deepEqual(queries[1].slice(0, 3), ['badges', { user_id: 'Nurse@Example.test', displayed: true }, '-earned_at']);
});

test('anonymous gamification requests fail before privileged reads', async () => {
  let reads = 0;
  const client = {
    auth: { me: async () => { throw new Error('login required'); } },
    asServiceRole: { entities: {
      Leaderboard: { filter: async () => { reads += 1; return []; } },
      UserBadge: { filter: async () => { reads += 1; return []; } },
    } },
  };
  const handler = await loadFunction('getMyTrainingGamification', client);
  const response = await handler(request());
  assert.equal(response.status, 401);
  assert.equal(reads, 0);
});

test('mutable account claims cannot write a training audit event', async () => {
  let reads = 0;
  let writes = 0;
  const client = {
    auth: { me: async () => ({
      email: 'attacker@example.test', role: 'user', account_type: 'super_admin', is_active: true,
    }) },
    asServiceRole: { entities: {
      TrainingCourse: { filter: async () => { reads += 1; return []; } },
      TrainingAuditLog: { create: async () => { writes += 1; return {}; } },
    } },
  };
  const handler = await loadFunction('recordTrainingAuditEvent', client);
  const response = await handler(request({ courseId: 'course-1', action: 'course_archived' }));
  assert.equal(response.status, 403);
  assert.equal(reads, 0);
  assert.equal(writes, 0);
});

test('audit broker derives actor and canonical state instead of accepting spoofed fields', async () => {
  let created;
  const course = {
    id: 'course-1', title: 'Fall Prevention', status: 'published', training_type: 'in_service',
    published_by: 'reviewer@example.test', approved_by: 'reviewer@example.test', needs_sme_review: false,
  };
  const client = {
    auth: { me: async () => ({
      email: 'Reviewer@Example.test', full_name: 'Clinical Reviewer', role: 'admin', is_active: true,
    }) },
    asServiceRole: { entities: {
      TrainingCourse: { filter: async () => [
        { ...course, id: 'foreign-course' },
        course,
      ] },
      TrainingAuditLog: { create: async (payload) => { created = payload; return { id: 'event-1' }; } },
    } },
  };
  const handler = await loadFunction('recordTrainingAuditEvent', client);
  const response = await handler(request({
    courseId: 'course-1',
    action: 'course_published',
    actor_id: 'spoofed@example.test',
    severity: 'critical',
    after_json: { status: 'archived' },
  }));
  const json = await response.json();

  assert.equal(response.status, 200);
  assert.equal(json.event_id, 'event-1');
  assert.equal(created.actor_id, 'reviewer@example.test');
  assert.equal(created.actor_name, 'Clinical Reviewer');
  assert.equal(created.entity_type, 'TrainingCourse');
  assert.equal(created.entity_id, 'course-1');
  assert.equal(created.severity, 'info');
  assert.equal(created.reason, 'sme_approved');
  assert.equal(created.after_json.status, 'published');
  assert.equal(created.after_json.title, 'Fall Prevention');
});

test('audit broker rejects operator ids and mismatched course states before writing', async () => {
  let reads = 0;
  let writes = 0;
  const client = {
    auth: { me: async () => ({ email: 'admin@example.test', role: 'admin', is_active: true }) },
    asServiceRole: { entities: {
      TrainingCourse: { filter: async () => {
        reads += 1;
        return [{ id: 'course-1', status: 'draft', created_by: 'someone-else@example.test' }];
      } },
      TrainingAuditLog: { create: async () => { writes += 1; return {}; } },
    } },
  };
  const handler = await loadFunction('recordTrainingAuditEvent', client);

  const operatorResponse = await handler(request({ courseId: { $ne: null }, action: 'course_created' }));
  assert.equal(operatorResponse.status, 400);
  assert.equal(reads, 0);

  const mismatchResponse = await handler(request({ courseId: 'course-1', action: 'course_created' }));
  assert.equal(mismatchResponse.status, 409);
  assert.equal(reads, 1);
  assert.equal(writes, 0);
});
