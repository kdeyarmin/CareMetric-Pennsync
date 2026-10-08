import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const ROOT = process.cwd();
const read = (relative) => readFileSync(path.join(ROOT, relative), 'utf8');

// 2026-10-08 owner decision: patient education and discharge-summary
// generation are back on. The legacy Patient.assigned_nurses / agency_name
// checks are replaced by callerMayAccessPatient (the built-in administrator, or
// a member of the chart's agency who manages it, created the chart, or holds an
// active PatientCareTeamAssignment for it). These tests drive the real entry
// modules against an in-memory Base44 client.

const EDUCATION = 'base44/functions/generatePatientEducation/entry.ts';
const DISCHARGE = 'base44/functions/generateDischargeSummary/entry.ts';

const handlerBody = (source) => source.slice(source.lastIndexOf('// <<<END SHARED HELPER'));

const ADMIN = { id: 'admin-1', email: 'admin@example.test', role: 'admin', is_active: true };
const NURSE = { id: 'nurse-1', email: 'nurse@example.test', role: 'user', is_active: true };
const PATIENT = {
  id: 'patient-1',
  agency_id: 'agency-a',
  first_name: 'Pat',
  last_name: 'Example',
  primary_diagnosis: 'CHF',
  secondary_diagnoses: ['HTN'],
  created_by_user_id: 'someone-else',
  // A stale legacy address grants nothing on its own.
  assigned_nurses: ['nurse@example.test'],
};

const membership = (overrides = {}) => ({
  id: 'membership-1',
  membership_key: 'agency-a:nurse-1',
  agency_id: 'agency-a',
  user_id: 'nurse-1',
  user_email_normalized: 'nurse@example.test',
  tenant_role: 'clinician',
  status: 'active',
  version: 1,
  created_by_user_id: 'admin-1',
  last_transition_by_user_id: 'admin-1',
  last_transition_by_email_normalized: 'admin@example.test',
  last_transition_at: '2026-10-01T00:00:00.000Z',
  last_transition_reason: 'Membership setup',
  activated_at: '2026-10-01T00:00:01.000Z',
  ...overrides,
});

const assignment = (overrides = {}) => ({
  id: 'assignment-1',
  agency_id: 'agency-a',
  patient_id: 'patient-1',
  user_id: 'nurse-1',
  status: 'active',
  ...overrides,
});

const matches = (row, query) => Object.entries(query || {}).every(([key, value]) => row?.[key] === value);

async function loadGenerator(relative, {
  caller = NURSE,
  patients = [PATIENT],
  memberships = [membership()],
  assignments = [],
  visits = [],
  llm = () => 'Generated narrative',
} = {}) {
  let source = read(relative);
  source = source.replace(
    /import\s+\{\s*createClientFromRequest\s*\}\s+from\s+'npm:[^']+';/,
    'const createClientFromRequest = globalThis.__generatorMakeClient;',
  );
  const calls = {
    requests: [],
    patientFilters: [],
    visitFilters: [],
    assignmentFilters: [],
    llmCalls: 0,
    userCreates: [],
    serviceCreates: [],
  };
  const table = (rows, log) => ({
    filter: async (query, sort, limit) => {
      log?.push({ query, sort, limit });
      return rows.filter((row) => matches(row, query)).slice(0, limit ?? rows.length).map((row) => ({ ...row }));
    },
    create: async (payload) => {
      calls.serviceCreates.push(payload);
      return { id: 'service-row', ...payload };
    },
  });
  const userSink = (name) => ({
    create: async (payload) => {
      calls.userCreates.push({ name, payload });
      return { id: `${name}-${calls.userCreates.length}`, created_by: caller.email, ...payload };
    },
  });
  globalThis.__generatorMakeClient = (req) => {
    calls.requests.push(req);
    return {
      auth: { me: async () => (caller ? { ...caller } : null) },
      entities: {
        PatientEducationDelivery: userSink('PatientEducationDelivery'),
        DischargeSummary: userSink('DischargeSummary'),
      },
      asServiceRole: {
        entities: {
          Patient: table(patients, calls.patientFilters),
          Visit: table(visits, calls.visitFilters),
          SentEducationMaterial: table([]),
          AgencyMembership: table(memberships),
          Agency: table([{ id: 'agency-a', agency_name: 'Agency A', status: 'active' }]),
          PatientCareTeamAssignment: table(assignments, calls.assignmentFilters),
          PatientEducationDelivery: table([]),
          DischargeSummary: table([]),
        },
      },
      integrations: {
        Core: {
          InvokeLLM: async (args) => {
            calls.llmCalls += 1;
            return llm(args);
          },
        },
      },
    };
  };
  const modulePath = path.join(
    tmpdir(),
    `generator_${path.basename(path.dirname(relative))}_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
  );
  await writeFile(modulePath, transpileTs(source).outputText);
  const previousDeno = globalThis.Deno;
  let handler = null;
  globalThis.Deno = {
    serve: (candidate) => { handler = candidate; },
    env: { get: () => undefined },
  };
  try {
    await import(pathToFileURL(modulePath).href);
  } finally {
    globalThis.Deno = previousDeno;
    await unlink(modulePath).catch(() => {});
  }
  assert.equal(typeof handler, 'function');
  const invoke = async (body, method = 'POST') => {
    const previous = globalThis.Deno;
    globalThis.Deno = { env: { get: () => undefined } };
    try {
      return await handler(new Request('https://local.test/generator', {
        method,
        ...(method === 'POST' ? { body: JSON.stringify(body ?? {}), headers: { 'content-type': 'application/json' } } : {}),
      }));
    } finally {
      globalThis.Deno = previous;
    }
  };
  return { invoke, calls };
}

const educationLlm = (args) => (args.response_json_schema
  ? { topics: [{ title: 'Managing CHF', reason: 'Primary diagnosis', key_points: ['Daily weights'] }] }
  : 'Weigh yourself every morning.');

test('generators pin their client and check chart access before any content use', () => {
  for (const relative of [EDUCATION, DISCHARGE]) {
    const source = read(relative);
    const body = handlerBody(source);
    assert.doesNotMatch(source, /GENERATION_PAUSED/, relative);
    assert.match(body, /createClientFromRequest\(userScopedClientRequest\(req, PENNSYNC_PRODUCTION_APP_ID\)\)/, relative);
    const access = body.indexOf('await callerMayAccessPatient(base44, user, patient)');
    assert.ok(access > -1, `${relative} must use the care-team access check`);
    assert.ok(body.indexOf('InvokeLLM') > access, `${relative} must not call the model before access`);
    assert.doesNotMatch(body, /assigned_nurses|agency_name|account_type/, relative);
    assert.match(body, /Response\.json\(body, \{\s*status,\s*headers: \{ \.\.\.NO_STORE_HEADERS/, relative);
  }
});

test('patient education: an assigned care-team member generates materials saved as their own', async () => {
  const { invoke, calls } = await loadGenerator(EDUCATION, {
    assignments: [assignment()],
    llm: educationLlm,
  });
  const response = await invoke({ patientId: 'patient-1' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.materials_generated, 1);
  assert.equal(calls.serviceCreates.length, 0, 'materials are never written with service-role authority');
  assert.deepEqual(calls.userCreates.map((row) => row.name), ['PatientEducationDelivery']);
  assert.equal(calls.userCreates[0].payload.patient_id, 'patient-1');
  assert.equal(calls.userCreates[0].payload.topic, 'Managing CHF');
  assert.deepEqual(calls.assignmentFilters[0].query, {
    agency_id: 'agency-a', patient_id: 'patient-1', user_id: 'nurse-1', status: 'active',
  });
  assert.equal(calls.requests[0].headers.get('Base44-App-Id'), '694ec16e72e01b60d22f7cbf');
});

test('patient education: a legacy nurse-list entry without an assignment is refused before the model', async () => {
  const { invoke, calls } = await loadGenerator(EDUCATION, { llm: educationLlm });
  const response = await invoke({ patientId: 'patient-1' });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'Patient not found or access denied' });
  assert.equal(calls.llmCalls, 0);
  assert.equal(calls.userCreates.length, 0);
});

test('patient education: another agency, a suspended assignment, or a missing chart all read the same', async () => {
  for (const options of [
    { assignments: [assignment()], patients: [{ ...PATIENT, agency_id: 'agency-b' }] },
    { assignments: [assignment({ status: 'suspended' })] },
    { assignments: [assignment()], patients: [] },
    { assignments: [assignment()], memberships: [membership({ status: 'revoked', revoked_at: '2026-10-02T00:00:00.000Z', revocation_reason: 'Left' })] },
  ]) {
    const { invoke, calls } = await loadGenerator(EDUCATION, { ...options, llm: educationLlm });
    const response = await invoke({ patientId: 'patient-1' });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'Patient not found or access denied' });
    assert.equal(calls.llmCalls, 0);
  }
});

test('patient education: managers, the chart creator and the built-in administrator are admitted', async () => {
  for (const options of [
    { memberships: [membership({ tenant_role: 'manager' })] },
    { memberships: [membership({ tenant_role: 'agency_admin' })] },
    { patients: [{ ...PATIENT, created_by_user_id: 'nurse-1' }] },
    { caller: ADMIN, memberships: [] },
  ]) {
    const { invoke, calls } = await loadGenerator(EDUCATION, { ...options, llm: educationLlm });
    const response = await invoke({ patientId: 'patient-1' });
    assert.equal(response.status, 200);
    assert.equal(calls.userCreates.length, 1);
  }
});

test('patient education: a visit from another chart is refused and malformed input is rejected', async () => {
  const { invoke, calls } = await loadGenerator(EDUCATION, {
    assignments: [assignment()],
    visits: [{ id: 'visit-9', patient_id: 'patient-2' }],
    llm: educationLlm,
  });
  const foreignVisit = await invoke({ patientId: 'patient-1', visitId: 'visit-9' });
  assert.equal(foreignVisit.status, 400);
  assert.equal(calls.llmCalls, 0);
  assert.equal((await invoke({ patientId: '$where' })).status, 400);
  assert.equal((await invoke({}, 'GET')).status, 405);
});

test('patient education: unusable model output is a 502, never an empty success', async () => {
  const { invoke, calls } = await loadGenerator(EDUCATION, {
    assignments: [assignment()],
    llm: () => ({ topics: 'not a list' }),
  });
  const response = await invoke({ patientId: 'patient-1' });
  assert.equal(response.status, 502);
  assert.equal(calls.userCreates.length, 0);
});

test('discharge summary: an assigned clinician drafts a summary stamped with their own address', async () => {
  const { invoke, calls } = await loadGenerator(DISCHARGE, {
    assignments: [assignment()],
    visits: [
      { id: 'visit-1', patient_id: 'patient-1', status: 'completed', visit_date: '2026-10-01', visit_type: 'admission' },
      { id: 'visit-x', patient_id: 'patient-1', status: 'completed', visit_date: '2026-10-03', visit_type: 'routine_visit' },
    ],
    llm: () => 'REASON FOR ADMISSION\nCHF exacerbation\n\nSUMMARY OF CARE\nStable.',
  });
  const response = await invoke({ patient_id: 'patient-1', discharge_date: '2026-10-08' });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(calls.serviceCreates.length, 0);
  assert.equal(calls.userCreates.length, 1);
  const draft = calls.userCreates[0];
  assert.equal(draft.name, 'DischargeSummary');
  assert.equal(draft.payload.generated_by, 'nurse@example.test');
  assert.equal(draft.payload.status, 'pending_review');
  assert.equal(draft.payload.discharge_date, '2026-10-08');
  assert.equal(draft.payload.visit_summary.total_visits, 2);
  // The model never decides the clinical conclusions on a signed document.
  assert.equal(draft.payload.discharge_disposition, undefined);
  assert.equal(draft.payload.functional_status.at_discharge, '');
});

test('discharge summary: refuses before reading visits or calling the model when access fails', async () => {
  const { invoke, calls } = await loadGenerator(DISCHARGE, {
    visits: [{ id: 'visit-1', patient_id: 'patient-1', status: 'completed' }],
  });
  const response = await invoke({ patient_id: 'patient-1' });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'Patient not found or access denied' });
  assert.equal(calls.visitFilters.length, 0);
  assert.equal(calls.llmCalls, 0);
  assert.equal(calls.userCreates.length, 0);
});

test('discharge summary: rejects an impossible discharge date and a non-POST method', async () => {
  const { invoke, calls } = await loadGenerator(DISCHARGE, { assignments: [assignment()] });
  assert.equal((await invoke({ patient_id: 'patient-1', discharge_date: '2026-02-31' })).status, 400);
  assert.equal(calls.patientFilters.length, 0);
  const methodDenied = await invoke(null, 'GET');
  assert.equal(methodDenied.status, 405);
  assert.equal(methodDenied.headers.get('allow'), 'POST');
});

test('the restored UI invokes the generators and reads only its own stored drafts', () => {
  const portal = read('src/components/hub-tabs/PatientEducationPortal.jsx');
  assert.match(portal, /functions\.invoke\("generatePatientEducation", \{ patientId \}\)/);
  assert.match(portal, /purpose:\s*"education_delivery"/);
  assert.doesNotMatch(portal, /entities\.(?:Patient|Visit)\b/);

  const workflow = read('src/components/discharge/DischargeSummaryWorkflow.jsx');
  assert.match(workflow, /functions\.invoke\('generateDischargeSummary'/);
  assert.match(workflow, /useAuthorizedPatient\(\{/);
  assert.doesNotMatch(workflow, /entities\.(?:Patient|Visit)\b/);

  const list = read('src/components/hub-tabs/DischargeSummaries.jsx');
  assert.match(list, /<DischargeSummaryGenerator/);
  assert.match(list, /useScopedPatients\(\{ purpose: 'roster'/);
  assert.doesNotMatch(list, /entities\.(?:Patient|Visit)\b/);
});

test('generator-only read purposes are not exposed by Patient or Visit brokers', () => {
  for (const relative of [
    'base44/functions/getAuthorizedPatient/entry.ts',
    'base44/functions/getAuthorizedVisit/entry.ts',
    'base44/functions/listAuthorizedVisits/entry.ts',
    'src/functions/getAuthorizedPatient.js',
    'src/functions/getAuthorizedVisit.js',
    'src/functions/listAuthorizedVisits.js',
  ]) {
    const source = read(relative);
    assert.doesNotMatch(source, /education_generation|discharge_summary_generation/);
  }
});
