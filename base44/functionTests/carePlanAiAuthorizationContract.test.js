import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { transpileTs } from '../../tools-transpile-ts.mjs';

// Released by the owner on 2026-10-08 ("turn everything on"): the care-plan
// AI endpoints and the referral drafting endpoints. What these tests pin is
// how each is safe to serve — authority decided from service-owned membership
// and care-team rows before the body, any record or the model; no editable
// profile field ever authorizes; and the output stays a draft (no care plan,
// no Patient write) except for the monitor's own idempotent proposals.

const AT = '2026-09-01T12:00:00.000Z';
const AGENCY = { id: 'agency-1', status: 'active', agency_name: 'Agency One' };
const OTHER_AGENCY = { id: 'agency-2', status: 'active', agency_name: 'Agency Two' };

function membership(user, agencyId, tenantRole, status = 'active') {
  return {
    id: `membership-${user.id}-${agencyId}`,
    membership_key: `${agencyId}:${user.id}`,
    agency_id: agencyId,
    user_id: user.id,
    user_email_normalized: user.email,
    tenant_role: tenantRole,
    status,
    version: 1,
    created_by_user_id: 'user-owner',
    last_transition_by_user_id: 'user-owner',
    last_transition_by_email_normalized: 'owner@example.com',
    last_transition_at: AT,
    last_transition_reason: 'Synthetic membership',
    activated_at: status === 'pending' ? null : AT,
    revoked_at: null,
    revocation_reason: null,
  };
}

const nurse = { id: 'user-nurse', email: 'nurse@example.com', role: 'user', is_active: true };
const outsider = { id: 'user-outsider', email: 'outsider@example.com', role: 'user', is_active: true };
const manager = { id: 'user-manager', email: 'manager@example.com', role: 'user', is_active: true };
const patient = {
  id: 'patient-1',
  agency_id: AGENCY.id,
  status: 'active',
  first_name: 'Robin',
  last_name: 'Synthetic',
  primary_diagnosis: 'Heart failure',
  created_by_user_id: 'user-someone-else',
};
const foreignPatient = { ...patient, id: 'patient-9', agency_id: OTHER_AGENCY.id };

function baseTables(overrides = {}) {
  return {
    Agency: [AGENCY, OTHER_AGENCY],
    AgencyMembership: [
      membership(nurse, AGENCY.id, 'clinician'),
      membership(outsider, AGENCY.id, 'clinician'),
      membership(manager, AGENCY.id, 'manager'),
    ],
    PatientCareTeamAssignment: [
      { id: 'assignment-1', agency_id: AGENCY.id, patient_id: patient.id, user_id: nurse.id, status: 'active' },
    ],
    Patient: [patient, foreignPatient],
    Visit: [],
    CarePlan: [{ id: 'plan-1', patient_id: patient.id, problem: 'Existing problem', status: 'active' }],
    ClinicalEvent: [],
    Incident: [],
    Medication: [],
    CarePlanProposal: [],
    PatientAlert: [],
    Notification: [],
    ...overrides,
  };
}

async function loadFunction(name, { user, tables = baseTables(), llm } = {}) {
  let source = await readFile(new URL(`../functions/${name}/entry.ts`, import.meta.url), 'utf8');
  source = source.replace(
    /import\s+\{\s*createClientFromRequest\s*\}\s+from\s+'npm:[^']+';?/,
    'const createClientFromRequest = globalThis.__carePlanAiClient;',
  );
  const temporary = join(tmpdir(), `care_plan_ai_${name}_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(temporary, transpileTs(source).outputText);
  const state = { tables: structuredClone(tables), reads: [], creates: [], deletes: [], updates: [], llm: [], bodyReads: 0 };
  let sequence = 0;
  const matches = (row, query) => Object.entries(query || {}).every(([key, value]) => row?.[key] === value);
  const entity = (table) => new Proxy({}, {
    get(_target, operation) {
      if (operation === 'filter') {
        return async (query, _sort, limit) => {
          state.reads.push({ table, query });
          const found = (state.tables[table] || []).filter((row) => matches(row, query));
          return structuredClone(Number.isFinite(limit) ? found.slice(0, limit) : found);
        };
      }
      if (operation === 'create') {
        return async (row) => {
          sequence += 1;
          const created = { id: `${table.toLowerCase()}-${String(sequence).padStart(3, '0')}`, ...structuredClone(row) };
          state.creates.push({ table, row: structuredClone(row) });
          (state.tables[table] ||= []).push(created);
          return structuredClone(created);
        };
      }
      if (operation === 'delete') {
        return async (id) => {
          state.deletes.push({ table, id });
          state.tables[table] = (state.tables[table] || []).filter((row) => row.id !== id);
        };
      }
      return async (...args) => {
        state.updates.push({ table, operation: String(operation), args });
        throw new Error(`${table}.${String(operation)} must not be called`);
      };
    },
  });
  const entities = new Proxy({}, { get: (_target, table) => entity(String(table)) });
  const client = {
    auth: { me: async () => user },
    entities,
    asServiceRole: {
      entities,
      integrations: {
        Core: {
          InvokeLLM: async (input) => {
            state.llm.push(input);
            if (llm) return llm(input);
            return {};
          },
        },
      },
    },
  };
  let handler;
  globalThis.__carePlanAiClient = () => client;
  globalThis.Deno = { env: { get: () => undefined }, serve: (candidate) => { handler = candidate; } };
  try {
    await import(`${pathToFileURL(temporary).href}?v=${Math.random()}`);
  } finally {
    await unlink(temporary).catch(() => {});
  }
  return {
    state,
    call: async (body) => {
      const request = new Request(`http://local/${name}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      });
      const readText = request.text.bind(request);
      request.text = async () => { state.bodyReads += 1; return readText(); };
      const response = await handler(request);
      return { status: response.status, json: await response.json() };
    },
  };
}

const PLAN = {
  problem: 'Impaired gas exchange', goal: 'SpO2 >= 92% within 30 days', interventions: ['Assess lung sounds'],
  target_days: 30, priority: 'high', frequency: 'Each visit', baseline_measurement: 'SpO2 89%',
  rationale: 'HF exacerbation', secret: 'dropped',
};

test('every released care-plan endpoint refuses an anonymous caller before the body is read', async () => {
  for (const name of [
    'generateCarePlanSuggestions', 'generateCarePlansFromReferral', 'generateCarePlanFromReferral',
    'generateAdmissionNoteFromReferral', 'monitorClinicalDataForCarePlanUpdates',
  ]) {
    const fn = await loadFunction(name, { user: null });
    const result = await fn.call({ patient_id: patient.id });
    assert.equal(result.status, 401, name);
    assert.equal(fn.state.bodyReads, 0, `${name}: body untouched`);
    assert.equal(fn.state.llm.length, 0, `${name}: no model call`);
    assert.deepEqual(fn.state.reads.filter((read) => read.table === 'Patient'), [], `${name}: no chart read`);
  }
});

test('care-plan suggestions require care-team access from membership and assignment rows, never the profile', async () => {
  // A clinician in the agency who is NOT on the care team, wearing a forged profile.
  const forged = { ...outsider, account_type: 'agency_admin', agency_id: AGENCY.id, is_manager: true, assigned_nurses: [] };
  let fn = await loadFunction('generateCarePlanSuggestions', { user: forged });
  let result = await fn.call({ patient_id: patient.id });
  assert.equal(result.status, 403);
  assert.equal(fn.state.llm.length, 0);
  assert.deepEqual(fn.state.reads.filter((read) => ['ClinicalEvent', 'Visit', 'Incident', 'CarePlan'].includes(read.table)), []);

  // A chart in another agency is refused even for a manager.
  fn = await loadFunction('generateCarePlanSuggestions', { user: manager });
  result = await fn.call({ patient_id: foreignPatient.id });
  assert.equal(result.status, 403);
  assert.equal(fn.state.llm.length, 0);

  // The assigned nurse gets sanitized, payment-neutral drafts and nothing is written.
  fn = await loadFunction('generateCarePlanSuggestions', {
    user: nurse,
    llm: () => ({ suggestions: [PLAN, { problem: '', goal: 'no problem' }], overall_assessment: 'Stable', critical_gaps_identified: ['Gap'] }),
  });
  result = await fn.call({ patient_id: patient.id });
  assert.equal(result.status, 200, JSON.stringify(result.json));
  assert.equal(result.json.review_required, true);
  assert.equal(result.json.suggestions.length, 1);
  assert.equal(result.json.suggestions[0].secret, undefined);
  assert.equal(result.json.patient_name, undefined, 'the answer does not echo the patient name');
  assert.deepEqual(fn.state.creates, []);
  assert.deepEqual(fn.state.updates, []);
  assert.doesNotMatch(fn.state.llm[0].prompt, /reimbursement tips|Insurance Considerations/);
  assert.doesNotMatch(fn.state.llm[0].prompt, /Robin|Synthetic/, 'the patient name is not sent to the model');
});

test('referral care plans for a chart are drafts: no Patient claim, no active CarePlan', async () => {
  let fn = await loadFunction('generateCarePlansFromReferral', { user: outsider });
  let result = await fn.call({ patient_id: patient.id, referral_data: { reason: 'CHF' } });
  assert.equal(result.status, 403);
  assert.equal(fn.state.llm.length, 0);

  fn = await loadFunction('generateCarePlansFromReferral', {
    user: nurse,
    llm: () => ({ care_plans: [PLAN], education_priorities: ['Diet'], coordination_needs: [] }),
  });
  result = await fn.call({ patient_id: patient.id, referral_data: { reason: 'CHF' }, primary_diagnosis: 'I50.9' });
  assert.equal(result.status, 200, JSON.stringify(result.json));
  assert.equal(result.json.care_plans_created, 0);
  assert.equal(result.json.review_required, true);
  assert.equal(result.json.care_plans[0].patient_id, patient.id);
  assert.equal(result.json.care_plans[0].ai_generated, true);
  assert.match(result.json.care_plans[0].target_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(fn.state.creates, [], 'no care plan is created');
  assert.deepEqual(fn.state.updates, [], 'no Patient claim is written');
  assert.match(fn.state.llm[0].prompt, /Existing problem/, 'active plans are passed so drafts do not duplicate them');
  assert.doesNotMatch(fn.state.llm[0].prompt, /PDGM/);
});

test('referral drafting endpoints admit only an active member, read no record and write nothing', async () => {
  for (const name of ['generateCarePlanFromReferral', 'generateAdmissionNoteFromReferral']) {
    const noMembership = { id: 'user-new', email: 'new@example.com', role: 'user', is_active: true, account_type: 'agency_admin', agency_id: AGENCY.id };
    let fn = await loadFunction(name, { user: noMembership });
    let result = await fn.call({ referralData: { reason: 'CHF' } });
    assert.equal(result.status, 403, `${name}: a forged profile with no membership`);
    assert.equal(fn.state.bodyReads, 0, `${name}: refused before the body`);
    assert.equal(fn.state.llm.length, 0);

    fn = await loadFunction(name, { user: nurse });
    result = await fn.call(JSON.stringify({ referralData: 'x'.repeat(70_000) }));
    assert.equal(result.status, 413, `${name}: bounded input`);
    assert.equal(fn.state.llm.length, 0);

    fn = await loadFunction(name, { user: nurse });
    result = await fn.call({ referralData: { reason: 'CHF' }, extra: true });
    assert.equal(result.status, 400, `${name}: unknown fields refused`);

    fn = await loadFunction(name, {
      user: nurse,
      llm: (input) => (input.response_json_schema ? { care_plans: [PLAN] } : 'Admission note draft'),
    });
    result = await fn.call({ referralData: { reason: 'CHF' } });
    assert.equal(result.status, 200, `${name}: ${JSON.stringify(result.json)}`);
    assert.equal(result.json.review_required, true);
    assert.deepEqual(fn.state.creates, [], `${name}: writes nothing`);
    const recordReads = fn.state.reads.filter((read) => !['AgencyMembership', 'Agency'].includes(read.table));
    assert.deepEqual(recordReads, [], `${name}: reads no clinical record`);
  }
});

const VISIT = {
  id: 'visit-1', patient_id: patient.id, status: 'completed', visit_type: 'routine_visit',
  visit_date: new Date().toISOString().slice(0, 10), created_by: 'nurse@example.com',
  vital_signs: { blood_pressure_systolic: 168, blood_pressure_diastolic: 95, oxygen_saturation: 90 },
  nurse_notes: 'Short of breath on exertion.',
};
const ANALYSIS = {
  requires_care_plan_update: true,
  confidence_score: 85,
  priority_level: 'urgent',
  summary: 'Hypoxia and hypertension',
  findings: [
    { finding_type: 'vital_threshold_met', severity: 'high', description: 'O2 90%', proposed_intervention: 'Notify physician' },
    { finding_type: 'care_gap', severity: 'low', description: 'Minor', proposed_intervention: 'None' },
  ],
};

test('the care-plan monitor is an agency lead tool scoped by the chart\'s own agency', async () => {
  const tables = baseTables({ Visit: [VISIT, { ...VISIT, id: 'visit-9', patient_id: foreignPatient.id }] });
  let fn = await loadFunction('monitorClinicalDataForCarePlanUpdates', { user: nurse, tables });
  let result = await fn.call({});
  assert.equal(result.status, 403, 'a clinician cannot run the monitor');
  assert.equal(fn.state.bodyReads, 0);

  const forged = { ...outsider, account_type: 'agency_admin', is_manager: true, agency_id: AGENCY.id };
  fn = await loadFunction('monitorClinicalDataForCarePlanUpdates', { user: forged, tables });
  result = await fn.call({});
  assert.equal(result.status, 403, 'a forged profile is not a manager');

  fn = await loadFunction('monitorClinicalDataForCarePlanUpdates', { user: manager, tables, llm: () => ANALYSIS });
  result = await fn.call({ patient_id: foreignPatient.id });
  assert.equal(result.status, 404, 'another agency\'s chart is not found');
  result = await fn.call({ agency_id: OTHER_AGENCY.id });
  assert.equal(result.status, 403, 'a manager cannot name another agency');
  assert.equal(fn.state.llm.length, 0);
});

test('the care-plan monitor proposes once per finding and day, never writes a Patient, and converges duplicates', async () => {
  const tables = baseTables({ Visit: [VISIT] });
  const fn = await loadFunction('monitorClinicalDataForCarePlanUpdates', { user: manager, tables, llm: () => ANALYSIS });
  let result = await fn.call({});
  assert.equal(result.status, 200, JSON.stringify(result.json));
  assert.equal(result.json.proposals_created, 1, 'the low-severity finding is skipped');
  const patientReads = fn.state.reads.filter((read) => read.table === 'Patient');
  assert.deepEqual(patientReads[0].query, { agency_id: AGENCY.id, status: 'active' });
  const proposal = fn.state.tables.CarePlanProposal[0];
  const day = new Date().toISOString().slice(0, 10);
  assert.equal(proposal.trigger_data.monitor_key, `${patient.id}:${day}:vital_threshold_met`);
  assert.equal('monitor_key' in proposal, false, 'the key lives inside trigger_data; no column is added');
  assert.equal(proposal.status, 'pending_review');
  assert.equal(proposal.assigned_nurse, nurse.email);
  const notice = fn.state.tables.Notification[0];
  assert.equal(notice.recipient_user_id, nurse.id);
  assert.equal(notice.recipient_membership_id, `membership-${nurse.id}-${AGENCY.id}`);
  assert.equal(JSON.stringify(notice).includes('Robin'), false, 'the notice names no patient');
  assert.equal(fn.state.tables.PatientAlert.length, 1);
  assert.deepEqual(fn.state.updates, [], 'no Patient or other row is updated');

  // A second scan the same day creates nothing new: no create call at all,
  // not merely a create that convergence later removes.
  const createsBefore = fn.state.creates.length;
  result = await fn.call({});
  assert.equal(result.json.proposals_created, 0);
  assert.equal(fn.state.creates.length, createsBefore);
  assert.deepEqual(fn.state.deletes, []);
  assert.equal(fn.state.tables.CarePlanProposal.length, 1);
  assert.equal(fn.state.tables.Notification.length, 1);
  assert.equal(fn.state.tables.PatientAlert.length, 1);

  // A duplicate left by two overlapping scans converges on the lowest id.
  fn.state.tables.CarePlanProposal.push({ ...proposal, id: 'careplanproposal-000' });
  await fn.call({});
  assert.deepEqual(fn.state.tables.CarePlanProposal.map((row) => row.id), ['careplanproposal-000']);
});

test('clinical data analysis reads a chart only after care-team access and asks for no risk prediction', async () => {
  let fn = await loadFunction('analyzeClinicalData', { user: null });
  let result = await fn.call({ action: 'analyze_trends', patient_id: patient.id });
  assert.equal(result.status, 401);
  assert.equal(fn.state.bodyReads, 0);

  // An agency member who is not on the care team: refused before any record or model.
  fn = await loadFunction('analyzeClinicalData', { user: outsider });
  result = await fn.call({ action: 'full_clinical_analysis', patient_id: patient.id });
  assert.equal(result.status, 403);
  assert.equal(fn.state.llm.length, 0);
  assert.deepEqual(fn.state.reads.filter((read) => ['ClinicalEvent', 'Visit'].includes(read.table)), []);

  // A forged profile with no membership cannot even extract from its own text.
  fn = await loadFunction('analyzeClinicalData', {
    user: { id: 'user-new', email: 'new@example.com', role: 'user', is_active: true, account_type: 'super_admin' },
  });
  result = await fn.call({ action: 'extract_events', noteText: 'BP 160/95' });
  assert.equal(result.status, 403);
  assert.equal(fn.state.llm.length, 0);

  fn = await loadFunction('analyzeClinicalData', {
    user: nurse,
    tables: baseTables({ Visit: [{ ...VISIT }] }),
    llm: () => JSON.stringify({
      vital_trends: [{ vital_type: 'bp', trend_direction: 'up' }],
      predictive_analytics: { readmission_risk_score: 80 },
      overall_trajectory: 'declining',
    }),
  });
  result = await fn.call({ action: 'analyze_trends', patient_id: patient.id });
  assert.equal(result.status, 200, JSON.stringify(result.json));
  assert.equal(result.json.vital_trends.length, 1);
  assert.equal(result.json.predictive_analytics, undefined, 'no risk prediction is returned');
  assert.doesNotMatch(fn.state.llm[0].prompt, /readmission|Readmission/);
  assert.doesNotMatch(fn.state.llm[0].prompt, /Robin|Synthetic/, 'the patient name is not sent to the model');
  assert.deepEqual(fn.state.creates, []);

  result = await fn.call({ action: 'extract_events', noteText: 'BP 160/95, new cough' });
  assert.equal(result.status, 200);
  assert.deepEqual(fn.state.creates, [], 'extraction persists nothing');
});
