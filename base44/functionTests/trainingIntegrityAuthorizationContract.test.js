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

  const serverOwnedTraining = {
    TrainingCompletion: {
      $or: [
        { 'data.nurse_email': '{{user.email}}' },
        { user_condition: { role: 'admin' } },
      ],
    },
    TrainingAssignment: {
      $or: [
        { 'data.assigned_to_user_id': '{{user.email}}' },
        { user_condition: { role: 'admin' } },
      ],
    },
  };
  for (const [entity, readRule] of Object.entries(serverOwnedTraining)) {
    const schema = JSON5.parse(await readFile(
      new URL(`../entities/${entity}.jsonc`, import.meta.url),
      'utf8',
    ));
    assert.deepEqual(schema.rls.read, readRule, `${entity}.read`);
    assert.equal(schema.rls.create, false, `${entity}.create`);
    assert.equal(schema.rls.update, false, `${entity}.update`);
    assert.equal(schema.rls.delete, false, `${entity}.delete`);
  }
});

test('frontend cannot directly write training integrity evidence or globally list protected records', async () => {
  const violations = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
      if (entry.isDirectory()) await walk(url);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name)) {
        const source = await readFile(url, 'utf8');
        for (const match of source.matchAll(
          /base44\.entities\.(ScenarioAttempt|TrainingRecommendation|TrainingCompletion|TrainingAssignment)\.(create|bulkCreate|update|delete)\b|base44\.entities\.(PlanEnrollment|TrainingRecommendation)\.list\b/g,
        )) {
          violations.push(`${url.pathname}: ${match[0]}`);
        }
      }
    }
  }
  await walk(new URL('../../src/', import.meta.url));
  assert.deepEqual(violations, []);
});

test('learner assignment lifecycle uses brokers that derive assignment and completion fields', async () => {
  const hub = await readFile(new URL('../../src/pages/NurseTrainingHub.jsx', import.meta.url), 'utf8');
  const player = await readFile(new URL('../../src/pages/TrainingCoursePlayer.jsx', import.meta.url), 'utf8');
  assert.match(hub, /await selfEnrollCourse\(\{ courseId: module\.course_id \}\)/);
  assert.doesNotMatch(hub, /base44\.entities\.TrainingAssignment\./);
  assert.match(hub, /error\?\.response\?\.data\?\.error/);
  assert.match(player, /startTrainingAssignment\(\{ assignmentId \}\)/);
  assert.match(player, /await gradeTrainingAttempt\(\{/);
});

test('self-enrollment broker ignores forged owner and completion evidence', async () => {
  let created;
  const client = {
    auth: { me: async () => ({ email: 'learner@example.test', full_name: 'Learner' }) },
    asServiceRole: { entities: {
      TrainingCourse: { filter: async () => [{
        id: 'course-1',
        title: 'Elective',
        status: 'published',
        passing_score: 85,
        training_type: 'elective',
      }] },
      TrainingAssignment: {
        filter: async () => [],
        create: async (payload) => {
          created = payload;
          return { id: 'assignment-1', ...payload };
        },
        delete: async () => {},
      },
      TrainingAuditLog: { create: async () => ({ id: 'audit-1' }) },
    } },
  };
  const handler = await loadFunction('selfEnrollCourse', client);
  const response = await handler(request({
    courseId: 'course-1',
    assigned_to_user_id: 'victim@example.test',
    status: 'completed',
    score_percentage: 100,
    pass_fail_result: 'passed',
    completion_date: '2000-01-01T00:00:00.000Z',
  }));
  const json = await response.json();

  assert.equal(response.status, 200);
  assert.equal(json.assignment_id, 'assignment-1');
  assert.equal(created.assigned_to_user_id, 'learner@example.test');
  assert.equal(created.status, 'assigned');
  assert.equal(created.passing_score_required, 85);
  assert.equal(created.progress_percentage, 0);
  assert.equal(created.score_percentage, undefined);
  assert.equal(created.pass_fail_result, undefined);
  assert.equal(created.completion_date, undefined);
});

test('self-enrollment broker opens an existing required assignment but cannot create one', async () => {
  let existingRows = [{
    id: 'required-assignment-1',
    course_id: 'required-course-1',
    assigned_to_user_id: 'learner@example.test',
    archived_status: false,
  }];
  let creates = 0;
  const client = {
    auth: { me: async () => ({ email: 'learner@example.test' }) },
    asServiceRole: { entities: {
      TrainingCourse: { filter: async () => [{
        id: 'required-course-1',
        title: 'Required In-Service',
        status: 'published',
        is_mandatory: true,
        training_type: 'in_service',
      }] },
      TrainingAssignment: {
        filter: async () => existingRows,
        create: async () => { creates += 1; return { id: 'forged' }; },
      },
      TrainingAuditLog: { create: async () => ({ id: 'audit-1' }) },
    } },
  };
  const handler = await loadFunction('selfEnrollCourse', client);

  const assigned = await handler(request({ courseId: 'required-course-1' }));
  assert.equal(assigned.status, 200);
  assert.deepEqual(await assigned.json(), {
    success: true,
    already_enrolled: true,
    assignment_id: 'required-assignment-1',
  });

  existingRows = [];
  const unassigned = await handler(request({ courseId: 'required-course-1' }));
  const rejected = await unassigned.json();
  assert.equal(unassigned.status, 400);
  assert.match(rejected.error, /assigned by your administrator/i);
  assert.equal(creates, 0);
});

test('self-enrollment rejects non-scalar course identifiers before privileged reads', async () => {
  let courseReads = 0;
  let assignmentReads = 0;
  let creates = 0;
  const client = {
    auth: { me: async () => ({ email: 'learner@example.test' }) },
    asServiceRole: { entities: {
      TrainingCourse: { filter: async () => { courseReads += 1; return []; } },
      TrainingAssignment: {
        filter: async () => { assignmentReads += 1; return []; },
        create: async () => { creates += 1; return { id: 'forged' }; },
      },
    } },
  };
  const handler = await loadFunction('selfEnrollCourse', client);
  for (const courseId of [{ $ne: null }, ['course-1'], ' course-1 ', 'x'.repeat(201)]) {
    const response = await handler(request({ courseId }));
    assert.equal(response.status, 400);
  }
  assert.equal(courseReads, 0);
  assert.equal(assignmentReads, 0);
  assert.equal(creates, 0);
});

test('self-enrollment requires one exact course row from a bounded lookup', async () => {
  let courseRows = [
    { id: 'course-1', title: 'First', status: 'published', training_type: 'elective' },
    { id: 'course-1', title: 'Duplicate', status: 'published', training_type: 'elective' },
  ];
  let assignmentReads = 0;
  const client = {
    auth: { me: async () => ({ email: 'learner@example.test' }) },
    asServiceRole: { entities: {
      TrainingCourse: { filter: async (filter, sort, limit) => {
        assert.deepEqual(filter, { id: 'course-1' });
        assert.equal(sort, undefined);
        assert.equal(limit, 2);
        return courseRows;
      } },
      TrainingAssignment: {
        filter: async () => { assignmentReads += 1; return []; },
      },
    } },
  };
  const handler = await loadFunction('selfEnrollCourse', client);

  const duplicate = await handler(request({ courseId: 'course-1' }));
  assert.equal(duplicate.status, 409);

  courseRows = [{ id: 'different-course', title: 'Wrong', status: 'published' }];
  const mismatched = await handler(request({ courseId: 'course-1' }));
  assert.equal(mismatched.status, 409);
  assert.equal(assignmentReads, 0);
});

test('self-enrollment fails closed on duplicate or truncated active-assignment history', async () => {
  let mode = 'duplicate';
  let creates = 0;
  const assignment = (id, archivedStatus = false) => ({
    id,
    course_id: 'course-1',
    assigned_to_user_id: 'learner@example.test',
    archived_status: archivedStatus,
  });
  const client = {
    auth: { me: async () => ({ email: 'learner@example.test' }) },
    asServiceRole: { entities: {
      TrainingCourse: { filter: async () => [{
        id: 'course-1', title: 'Elective', status: 'published', training_type: 'elective',
      }] },
      TrainingAssignment: {
        filter: async (_filter, _sort, limit) => {
          assert.equal(limit, 500);
          if (mode === 'duplicate') return [assignment('assignment-1'), assignment('assignment-2')];
          return Array.from({ length: limit }, (_, index) => assignment(`archived-${index}`, true));
        },
        create: async () => { creates += 1; return { id: 'forged' }; },
      },
    } },
  };
  const handler = await loadFunction('selfEnrollCourse', client);

  const duplicate = await handler(request({ courseId: 'course-1' }));
  assert.equal(duplicate.status, 409);
  assert.match((await duplicate.json()).error, /multiple active/i);

  mode = 'truncated';
  const truncated = await handler(request({ courseId: 'course-1' }));
  assert.equal(truncated.status, 409);
  assert.match((await truncated.json()).error, /history is ambiguous/i);
  assert.equal(creates, 0);
});

test('self-enrollment does not create when the immediate assignment recheck fails', async () => {
  let assignmentReads = 0;
  let creates = 0;
  const client = {
    auth: { me: async () => ({ email: 'learner@example.test' }) },
    asServiceRole: { entities: {
      TrainingCourse: { filter: async () => [{
        id: 'course-1', title: 'Elective', status: 'published', training_type: 'elective',
      }] },
      TrainingAssignment: {
        filter: async () => {
          assignmentReads += 1;
          if (assignmentReads === 1) return [];
          throw new Error('simulated recheck failure');
        },
        create: async () => { creates += 1; return { id: 'forged' }; },
      },
    } },
  };
  const handler = await loadFunction('selfEnrollCourse', client);
  const response = await handler(request({ courseId: 'course-1' }));
  assert.equal(response.status, 500);
  assert.equal(assignmentReads, 2);
  assert.equal(creates, 0);
});

test('start-assignment broker ignores forged score and completion evidence', async () => {
  let updated;
  const client = {
    auth: { me: async () => ({ email: 'learner@example.test', full_name: 'Learner' }) },
    asServiceRole: { entities: {
      TrainingAssignment: {
        filter: async () => [{
          id: 'assignment-1',
          assigned_to_user_id: 'learner@example.test',
          status: 'assigned',
          progress_percentage: 0,
          latest_attempt_number: 0,
        }],
        update: async (_id, payload) => { updated = payload; },
      },
      TrainingAuditLog: { create: async () => ({ id: 'audit-1' }) },
    } },
  };
  const handler = await loadFunction('startTrainingAssignment', client);
  const response = await handler(request({
    assignmentId: 'assignment-1',
    status: 'completed',
    score_percentage: 100,
    pass_fail_result: 'passed',
    completion_date: '2000-01-01T00:00:00.000Z',
  }));

  assert.equal(response.status, 200);
  assert.equal(updated.status, 'in_progress');
  assert.equal(updated.progress_percentage, 5);
  assert.equal(updated.score_percentage, undefined);
  assert.equal(updated.pass_fail_result, undefined);
  assert.equal(updated.completion_date, undefined);
  assert.ok(updated.started_date);
  assert.ok(updated.last_accessed);
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
    gradeTrainingAttempt: 'gradeTrainingAttempt',
    submitScenarioAttempt: 'submitScenarioAttempt',
    listTenantTrainingIntegrityRecords: 'listTenantTrainingIntegrityRecords',
    selfEnrollCourse: 'selfEnrollCourse',
    startTrainingAssignment: 'startTrainingAssignment',
  };
  for (const [file, functionName] of Object.entries(expected)) {
    const source = await readFile(new URL(`../../src/functions/${file}.js`, import.meta.url), 'utf8');
    assert.match(source, new RegExp(`base44\\.functions\\.invoke\\('${functionName}', payload\\)`));
    assert.doesNotMatch(source, /base44\.entities\.|auth\.updateMe/);
  }
});
