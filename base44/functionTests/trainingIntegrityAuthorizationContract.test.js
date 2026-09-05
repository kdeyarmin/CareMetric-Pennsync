import assert from 'node:assert/strict';
import { readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import JSON5 from 'json5';
import { transpileTs } from '../../tools-transpile-ts.mjs';

async function loadFunction(name, client, { superAdminEmail = '' } = {}) {
  let source = await readFile(new URL(`../functions/${name}/entry.ts`, import.meta.url), 'utf8');
  source = source.replace(
    /import\s+\{[^}]*\}\s+from\s+'npm:@base44\/sdk@[^']*';?/,
    'const createClientFromRequest = globalThis.__trainingIntegrityClient;',
  );
  const file = join(
    tmpdir(),
    `training_integrity_${name}_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
  );
  await writeFile(file, transpileTs(source).outputText);
  let handler;
  globalThis.__trainingIntegrityClient = () => client;
  globalThis.Deno = {
    serve: (candidate) => { handler = candidate; },
    env: { get: (key) => (key === 'SUPER_ADMIN_EMAIL' ? superAdminEmail : undefined) },
  };
  try {
    await import(pathToFileURL(file).href);
  } finally {
    await unlink(file).catch(() => {});
    delete globalThis.__trainingIntegrityClient;
  }
  return handler;
}

function request(body = {}) {
  return new Request('http://local/training-integrity', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const scenario = (overrides = {}) => ({
  id: 'scenario-1',
  course_id: 'course-1',
  passing_score: 80,
  max_attempts: 3,
  active: true,
  scenario_flow_json: {
    startNodeId: 'node-start',
    nodes: {
      'node-start': {
        choices: [
          { text: 'wrong', isCorrect: false, nextNodeId: null },
          { text: 'right', isCorrect: true, nextNodeId: 'node-end' },
        ],
      },
    },
  },
  ...overrides,
});

test('integrity entities expose only owner reads and server-owned evidence writes', async () => {
  const expected = {
    NotificationPreference: { 'data.user_email': '{{user.email}}' },
    ScenarioAttempt: { 'data.user_id': '{{user.email}}' },
    PlanEnrollment: { 'data.user_id': '{{user.email}}' },
    TrainingRecommendation: { 'data.nurse_email': '{{user.email}}' },
  };
  for (const [entity, readRule] of Object.entries(expected)) {
    const schema = JSON5.parse(await readFile(
      new URL(`../entities/${entity}.jsonc`, import.meta.url),
      'utf8',
    ));
    assert.deepEqual(schema.rls.read, readRule, entity);
    if (entity !== 'NotificationPreference') {
      assert.equal(schema.rls.create, false, entity);
      assert.equal(schema.rls.update, false, entity);
      assert.equal(schema.rls.delete, false, entity);
    }
  }
});

test('frontend cannot directly write attempt or recommendation evidence or globally list protected records', async () => {
  const violations = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
      if (entry.isDirectory()) await walk(url);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name)) {
        const source = await readFile(url, 'utf8');
        for (const match of source.matchAll(
          /base44\.entities\.(ScenarioAttempt|TrainingRecommendation)\.(create|update|delete)\b|base44\.entities\.(PlanEnrollment|TrainingRecommendation)\.list\b/g,
        )) {
          violations.push(`${url.pathname}: ${match[0]}`);
        }
      }
    }
  }
  await walk(new URL('../../src/', import.meta.url));
  assert.deepEqual(violations, []);
});

test('scenario broker derives owner, score, pass result, and canonical decisions from server data', async () => {
  let created;
  const client = {
    auth: { me: async () => ({ id: 'user-1', email: 'Learner@Example.test' }) },
    asServiceRole: { entities: {
      ClinicalScenario: { filter: async () => [scenario()] },
      TrainingAssignment: { filter: async () => [{
        id: 'assignment-1', course_id: 'course-1', assigned_to_user_id: 'learner@example.test',
      }] },
      ScenarioAttempt: {
        filter: async () => [],
        create: async (payload) => { created = payload; return { id: 'attempt-1' }; },
      },
    } },
  };
  const handler = await loadFunction('submitScenarioAttempt', client);
  const response = await handler(request({
    scenario_id: 'scenario-1',
    assignment_id: 'assignment-1',
    user_id: 'victim@example.test',
    score_percentage: 100,
    passed: true,
    decisions: [
      { node_id: 'node-start', choice_index: 0, isCorrect: true },
      { node_id: 'node-start', choice_index: 1, isCorrect: false },
    ],
  }));
  const json = await response.json();

  assert.equal(response.status, 200);
  assert.equal(json.attempt_id, 'attempt-1');
  assert.equal(json.score_percentage, 100);
  assert.equal(json.passed, true);
  assert.equal(created.user_id, 'learner@example.test');
  assert.equal(created.score_percentage, 100);
  assert.equal(created.passed, true);
  assert.deepEqual(created.decisions_made_json, [
    { nodeId: 'node-start', choiceIndex: 0, isCorrect: false },
    { nodeId: 'node-start', choiceIndex: 1, isCorrect: true },
  ]);
  assert.equal(created.time_spent_minutes, 0);
  assert.equal(created.started_at, created.completed_at);
});

test('scenario broker rejects foreign assignments and incomplete forged paths before writing', async () => {
  let writes = 0;
  const client = {
    auth: { me: async () => ({ id: 'user-1', email: 'learner@example.test' }) },
    asServiceRole: { entities: {
      ClinicalScenario: { filter: async () => [scenario()] },
      TrainingAssignment: { filter: async () => [{
        id: 'assignment-1', course_id: 'course-1', assigned_to_user_id: 'other@example.test',
      }] },
      ScenarioAttempt: {
        filter: async () => [],
        create: async () => { writes += 1; return { id: 'attempt-1' }; },
      },
    } },
  };
  const handler = await loadFunction('submitScenarioAttempt', client);
  const foreign = await handler(request({
    scenario_id: 'scenario-1',
    assignment_id: 'assignment-1',
    decisions: [{ node_id: 'node-start', choice_index: 1 }],
  }));
  assert.equal(foreign.status, 403);

  client.asServiceRole.entities.TrainingAssignment.filter = async () => [{
    id: 'assignment-1', course_id: 'course-1', assigned_to_user_id: 'learner@example.test',
  }];
  const incomplete = await handler(request({
    scenario_id: 'scenario-1',
    decisions: [{ node_id: 'node-start', choice_index: 0 }],
  }));
  assert.equal(incomplete.status, 409);
  assert.equal(writes, 0);
});

test('scenario broker rejects anonymous callers before privileged reads', async () => {
  let reads = 0;
  const client = {
    auth: { me: async () => { throw new Error('login required'); } },
    asServiceRole: { entities: {
      ClinicalScenario: { filter: async () => { reads += 1; return []; } },
    } },
  };
  const handler = await loadFunction('submitScenarioAttempt', client);
  const response = await handler(request({
    scenario_id: 'scenario-1',
    decisions: [{ node_id: 'node-start', choice_index: 1 }],
  }));
  assert.equal(response.status, 401);
  assert.equal(reads, 0);
});

const membership = (overrides = {}) => ({
  id: 'membership-admin',
  membership_key: 'agency-a:user-admin',
  agency_id: 'agency-a',
  user_id: 'user-admin',
  user_email_normalized: 'manager@example.test',
  tenant_role: 'agency_admin',
  status: 'active',
  ...overrides,
});

function tenantReadClient({
  user = { id: 'user-admin', email: 'Manager@Example.test', role: 'user' },
  callerMemberships = [membership()],
  roster = [membership()],
  planRows = [],
  recommendationRows = [],
} = {}) {
  let recordReads = 0;
  const client = {
    auth: { me: async () => user },
    asServiceRole: { entities: {
      AgencyMembership: { filter: async (filter) => {
        if (filter.user_id) return callerMemberships;
        return roster;
      } },
      Agency: { filter: async () => [{ id: 'agency-a', status: 'active' }] },
      PlanEnrollment: {
        list: async () => { recordReads += 1; return planRows; },
        filter: async () => { recordReads += 1; return planRows; },
      },
      TrainingRecommendation: {
        list: async () => { recordReads += 1; return recommendationRows; },
      },
    } },
  };
  return { client, getRecordReads: () => recordReads };
}

test('tenant read broker uses immutable membership role and strips foreign-agency records', async () => {
  const { client } = tenantReadClient({
    roster: [
      membership(),
      membership({
        id: 'member-learner', membership_key: 'agency-a:user-learner', user_id: 'user-learner',
        user_email_normalized: 'learner@example.test', tenant_role: 'clinician',
      }),
    ],
    planRows: [
      { id: 'own', user_id: 'learner@example.test', plan_name: 'Agency A plan' },
      { id: 'foreign', user_id: 'other-agency@example.test', plan_name: 'Private plan' },
    ],
  });
  const handler = await loadFunction('listTenantTrainingIntegrityRecords', client);
  const response = await handler(request({ resource: 'plan_enrollments', limit: 20 }));
  const json = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(json.records, [{ id: 'own', user_id: 'learner@example.test', plan_name: 'Agency A plan' }]);
  assert.equal(json.scope.agency_id, 'agency-a');
});

test('mutable admin claims and bare built-in admin role cannot replace immutable membership', async () => {
  for (const user of [
    { id: 'attacker', email: 'attacker@example.test', role: 'user', account_type: 'super_admin', agency_id: 'agency-a' },
    { id: 'attacker', email: 'attacker@example.test', role: 'admin', account_type: 'agency_admin', agency_id: 'agency-a' },
  ]) {
    const { client, getRecordReads } = tenantReadClient({ user, callerMemberships: [], roster: [] });
    const handler = await loadFunction('listTenantTrainingIntegrityRecords', client, {
      superAdminEmail: 'owner@example.test',
    });
    const response = await handler(request({ resource: 'training_recommendations' }));
    assert.equal(response.status, 403);
    assert.equal(getRecordReads(), 0);
  }
});

test('non-privileged tenant membership cannot invoke administrative record reads', async () => {
  const clinician = membership({ tenant_role: 'clinician' });
  const { client, getRecordReads } = tenantReadClient({
    callerMemberships: [clinician],
    roster: [clinician],
  });
  const handler = await loadFunction('listTenantTrainingIntegrityRecords', client);
  const response = await handler(request({ resource: 'plan_enrollments' }));
  assert.equal(response.status, 403);
  assert.equal(getRecordReads(), 0);
});

test('exact secret-bound platform owner can read unscoped records without mutable claims', async () => {
  const { client } = tenantReadClient({
    user: { id: 'owner-id', email: 'Owner@Example.test', role: 'admin', account_type: 'user' },
    callerMemberships: [],
    recommendationRows: [
      { id: 'rec-1', nurse_email: 'any@example.test', recommendation_text: 'Server result' },
    ],
  });
  const handler = await loadFunction('listTenantTrainingIntegrityRecords', client, {
    superAdminEmail: 'owner@example.test',
  });
  const response = await handler(request({ resource: 'training_recommendations' }));
  const json = await response.json();
  assert.equal(response.status, 200);
  assert.equal(json.records[0].id, 'rec-1');
  assert.equal(json.scope.is_platform_owner, true);
  assert.equal(json.scope.agency_id, null);
});

test('client wrappers invoke only their matching integrity brokers', async () => {
  const expected = {
    submitScenarioAttempt: 'submitScenarioAttempt',
    listTenantTrainingIntegrityRecords: 'listTenantTrainingIntegrityRecords',
  };
  for (const [file, functionName] of Object.entries(expected)) {
    const source = await readFile(new URL(`../../src/functions/${file}.js`, import.meta.url), 'utf8');
    assert.match(source, new RegExp(`base44\\.functions\\.invoke\\('${functionName}', payload\\)`));
    assert.doesNotMatch(source, /base44\.entities\.|auth\.updateMe/);
  }
});
