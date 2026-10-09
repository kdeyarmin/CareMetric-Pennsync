import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { transpileTs } from '../../tools-transpile-ts.mjs';

// Released by the owner on 2026-10-08 ("turn everything on"):
// generateComprehensiveReport, batchAIAnalysis and monitorComplianceRisks.
// Each one used to read every tenant's rows through the service role and then
// decide scope from editable profile or chart fields (agency_name,
// account_type, created_by, assigned_nurses). These tests drive the real
// handlers and pin how each is safe now:
//   - the report: an agency_admin/manager rebuilt from an exact active
//     membership (or the built-in administrator naming an agency) gets ONE
//     agency's figures, and nothing is read before that is decided;
//   - the batch documentation AI: a chart is read alone, access is decided by
//     membership and the care-team table, and only then are its visits, its
//     OASIS upload or the model touched; the patient's name never reaches the
//     model;
//   - the documentation-compliance monitor: one agency at a time from
//     service-owned Agency rows, absence-based rules only where THAT agency is
//     the system of record, alerts deduplicated on a deterministic key, no
//     chart write and no risk score.

const SECRET = 'synthetic-internal-secret-0123456789abcdef';
const AT = '2026-09-01T12:00:00.000Z';
const daysAgo = (days) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

const agencies = [
  { id: 'agency-1', status: 'active', agency_name: 'Agency One' },
  { id: 'agency-2', status: 'trial', agency_name: 'Agency Two' },
  { id: 'agency-3', status: 'suspended', agency_name: 'Agency Three' },
];

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
    activated_at: AT,
    revoked_at: null,
    revocation_reason: null,
  };
}

const manager = { id: 'user-manager', email: 'manager@example.com', role: 'user', is_active: true, full_name: 'Manager One' };
const clinician = { id: 'user-clinician', email: 'clinician@example.com', role: 'user', is_active: true };
const otherManager = { id: 'user-other', email: 'other@example.com', role: 'user', is_active: true };
const admin = { id: 'user-admin', email: 'admin@example.com', role: 'admin', is_active: true };
// Every editable field the old code trusted, and no membership at all.
const forger = {
  id: 'user-forger',
  email: 'forger@example.com',
  role: 'user',
  is_active: true,
  agency_id: 'agency-1',
  agency_name: 'Agency One',
  account_type: 'agency_admin',
  is_manager: true,
};

function tables() {
  return {
    Agency: agencies,
    AgencyMembership: [
      membership(manager, 'agency-1', 'manager'),
      membership(clinician, 'agency-1', 'clinician'),
      membership(otherManager, 'agency-2', 'manager'),
    ],
    User: [
      { ...manager },
      { ...clinician, full_name: 'Clinician One' },
      { ...otherManager, full_name: 'Other Manager' },
    ],
    PatientCareTeamAssignment: [
      { id: 'assign-1', agency_id: 'agency-1', patient_id: 'patient-1', user_id: clinician.id, status: 'active' },
    ],
    Patient: [
      {
        id: 'patient-1', agency_id: 'agency-1', status: 'active', first_name: 'Example', last_name: 'Person',
        primary_diagnosis: 'CHF', created_by: 'forger@example.com', assigned_nurses: ['forger@example.com'],
      },
      { id: 'patient-2', agency_id: 'agency-1', status: 'discharged', first_name: 'Second', last_name: 'Person' },
      { id: 'patient-9', agency_id: 'agency-2', status: 'active', first_name: 'Other', last_name: 'Tenant', primary_diagnosis: 'COPD' },
      { id: 'patient-8', agency_id: 'agency-2', status: 'discharged', first_name: 'Other', last_name: 'Discharged' },
      { id: 'patient-7', agency_id: 'agency-3', status: 'active', first_name: 'Suspended', last_name: 'Tenant' },
    ],
    Visit: [
      { id: 'visit-1', agency_id: 'agency-1', patient_id: 'patient-1', status: 'completed', visit_date: daysAgo(2), visit_type: 'skilled_nursing', nurse_notes: 'Patient tolerated the visit well.', created_by: clinician.email },
      { id: 'visit-1b', agency_id: 'agency-1', patient_id: 'patient-1', status: 'completed', visit_date: daysAgo(4), visit_type: 'skilled_nursing', nurse_notes: 'Wound care.' },
      { id: 'visit-9', agency_id: 'agency-2', patient_id: 'patient-9', status: 'completed', visit_date: daysAgo(2), visit_type: 'skilled_nursing', nurse_notes: 'Routine.' },
      { id: 'visit-9b', agency_id: 'agency-2', patient_id: 'patient-9', status: 'completed', visit_date: daysAgo(3), visit_type: 'skilled_nursing', nurse_notes: 'Routine.' },
      { id: 'visit-7', agency_id: 'agency-3', patient_id: 'patient-7', status: 'completed', visit_date: daysAgo(2), visit_type: 'skilled_nursing', nurse_notes: 'Routine.' },
    ],
    Incident: [
      { id: 'incident-1', patient_id: 'patient-1', incident_type: 'fall', incident_date: daysAgo(3) },
      { id: 'incident-9', patient_id: 'patient-9', incident_type: 'fall', incident_date: daysAgo(3) },
      { id: 'incident-0', incident_type: 'fall', incident_date: daysAgo(3) },
    ],
    OASISUpload: [
      { id: 'oasis-1', agency_id: 'agency-1', patient_id: 'patient-1', created_date: new Date().toISOString() },
      { id: 'oasis-9', agency_id: 'agency-2', patient_id: 'patient-9', created_date: new Date().toISOString() },
    ],
    OASISAssessment: [],
    AgencySettings: [{ id: 'settings-1', agency_code: 'Agency One', pennsync_is_system_of_record: true }],
    PatientAlert: [],
  };
}

const REPLACEMENTS = [
  [/import\s+\{\s*createClientFromRequest\s*\}\s+from\s+'npm:[^']+';?/, 'const createClientFromRequest = globalThis.__releasedClient;'],
  [/import\s+jsPDF\s+from\s+'npm:jspdf@[^']+';?/, 'const jsPDF = globalThis.__releasedPdf;'],
];

class RecordingPdf {
  constructor() { this.lines = []; }
  text(value) { this.lines.push(String(value)); }
  output() { return new TextEncoder().encode(JSON.stringify(this.lines)).buffer; }
  setFontSize() {}
  setFont() {}
  setFillColor() {}
  setTextColor() {}
  rect() {}
  addPage() {}
}

async function load(name, { user, headers = {}, data = tables(), llm = null } = {}) {
  let source = await readFile(new URL(`../functions/${name}/entry.ts`, import.meta.url), 'utf8');
  for (const [pattern, replacement] of REPLACEMENTS) source = source.replace(pattern, replacement);
  const temporary = join(tmpdir(), `released_${name}_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(temporary, transpileTs(source).outputText);
  const state = {
    data: structuredClone(data),
    reads: [],
    creates: [],
    deletes: [],
    updates: [],
    prompts: [],
    bodyReads: 0,
  };
  const matches = (row, query) => Object.entries(query || {}).every(([key, value]) => {
    if (value && typeof value === 'object' && Array.isArray(value.$in)) return value.$in.includes(row?.[key]);
    return row?.[key] === value;
  });
  let nextId = 1;
  const entity = (table) => ({
    filter: async (query, _sort, limit) => {
      state.reads.push({ table, query: structuredClone(query) });
      const found = (state.data[table] || []).filter((row) => matches(row, query));
      return structuredClone(Number.isFinite(limit) ? found.slice(0, limit) : found);
    },
    list: async () => {
      state.reads.push({ table, query: null });
      return structuredClone(state.data[table] || []);
    },
    create: async (row) => {
      const created = { id: `created-${String(nextId++).padStart(4, '0')}`, created_date: new Date().toISOString(), ...row };
      state.creates.push({ table, row: structuredClone(created) });
      (state.data[table] ||= []).push(created);
      return structuredClone(created);
    },
    delete: async (id) => {
      state.deletes.push({ table, id });
      state.data[table] = (state.data[table] || []).filter((row) => row.id !== id);
      return { success: true };
    },
    update: async (id, patch) => {
      state.updates.push({ table, id, patch: structuredClone(patch) });
      throw new Error(`${table}.update must not be called`);
    },
  });
  const entities = new Proxy({}, { get: (_target, table) => entity(String(table)) });
  const integrations = {
    Core: {
      InvokeLLM: async ({ prompt }) => {
        state.prompts.push(prompt);
        return llm ? llm(prompt) : { compliance_score: 80, missing_elements: [], specific_gaps: [] };
      },
    },
  };
  let handler;
  globalThis.__releasedClient = () => ({
    auth: { me: async () => (user ? structuredClone(user) : null) },
    asServiceRole: { entities, integrations },
  });
  globalThis.__releasedPdf = RecordingPdf;
  globalThis.Deno = {
    env: { get: (key) => (key === 'INTERNAL_FN_SECRET' ? SECRET : undefined) },
    serve: (candidate) => { handler = candidate; },
  };
  try {
    await import(`${pathToFileURL(temporary).href}?v=${Math.random()}`);
  } finally {
    await unlink(temporary).catch(() => {});
  }
  return {
    state,
    call: async (body = {}) => {
      const request = new Request(`http://local/${name}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });
      for (const reader of ['text', 'json']) {
        const original = request[reader].bind(request);
        request[reader] = async () => { state.bodyReads += 1; return original(); };
      }
      const response = await handler(request);
      const type = response.headers.get('content-type') || '';
      if (type.includes('application/pdf')) {
        return { status: response.status, lines: JSON.parse(new TextDecoder().decode(await response.arrayBuffer())) };
      }
      return { status: response.status, json: await response.json() };
    },
  };
}

const clinicalReads = (state) => state.reads.filter((read) => !['AgencyMembership', 'Agency'].includes(read.table));

// ---------------------------------------------------------------- report ---

test('generateComprehensiveReport refuses a clinician and a forged profile before the body or any record', async () => {
  for (const user of [clinician, forger]) {
    const report = await load('generateComprehensiveReport', { user });
    const result = await report.call({ reportType: 'comprehensive', agency_id: 'agency-1' });
    assert.equal(result.status, 403, `${user.id} is refused`);
    assert.equal(report.state.bodyReads, 0, `${user.id} is refused before the body is read`);
    assert.deepEqual(clinicalReads(report.state), [], `${user.id} is refused before any record is read`);
  }
  const anonymous = await load('generateComprehensiveReport', { user: null });
  assert.equal((await anonymous.call({ reportType: 'comprehensive' })).status, 401);
});

test("generateComprehensiveReport gives an agency lead only their own agency's figures", async () => {
  const report = await load('generateComprehensiveReport', { user: manager });
  const result = await report.call({ reportType: 'comprehensive', dateRange: 30 });
  assert.equal(result.status, 200);
  assert.ok(result.lines.includes('Active Patients: 1 of 2 total'), result.lines.join('\n'));
  assert.ok(result.lines.includes('Total Visits: 2'));
  assert.ok(result.lines.some((line) => line.startsWith('Falls: 1 ')), 'only the agency chart incident counts');
  assert.ok(result.lines.includes('OASIS Assessments Uploaded: 1'));
  assert.ok(result.lines.includes('Total Nurses: 2'));
  assert.ok(!result.lines.some((line) => line.includes('Other Manager')), 'another agency staff member is never listed');
  for (const read of report.state.reads.filter((entry) => ['Patient', 'Visit', 'OASISUpload'].includes(entry.table))) {
    assert.equal(read.query?.agency_id, 'agency-1', `${read.table} is read by the caller's own agency`);
  }

  const crossing = await load('generateComprehensiveReport', { user: manager });
  const refused = await crossing.call({ reportType: 'comprehensive', agency_id: 'agency-2' });
  assert.equal(refused.status, 403, 'a lead may not name another agency');
  assert.deepEqual(clinicalReads(crossing.state), []);
});

test('generateComprehensiveReport lets the built-in administrator report on one named, enabled agency', async () => {
  const missing = await load('generateComprehensiveReport', { user: admin });
  assert.equal((await missing.call({ reportType: 'comprehensive' })).status, 400, 'the administrator must name an agency');

  const suspended = await load('generateComprehensiveReport', { user: admin });
  assert.equal((await suspended.call({ reportType: 'comprehensive', agency_id: 'agency-3' })).status, 403);
  assert.deepEqual(clinicalReads(suspended.state), [], 'a suspended agency is refused before its records are read');

  const report = await load('generateComprehensiveReport', { user: admin });
  const result = await report.call({ reportType: 'comprehensive', agency_id: 'agency-2' });
  assert.equal(result.status, 200);
  assert.ok(result.lines.includes('Active Patients: 1 of 2 total'), result.lines.join('\n'));
  assert.ok(result.lines.includes('Total Visits: 2'));
  assert.ok(result.lines.includes('Total Nurses: 1'));
});

// ----------------------------------------------------- batch documentation ---

test('batchAIAnalysis decides chart access from membership and the care team, never from editable fields', async () => {
  // The forged profile is named in the chart's created_by and assigned_nurses,
  // which is exactly what the old check accepted.
  const forged = await load('batchAIAnalysis', { user: forger });
  const refused = await forged.call({ analysisTypes: ['compliance'], roughNote: 'note', patientId: 'patient-1' });
  assert.equal(refused.status, 403);
  assert.equal(forged.state.bodyReads, 0, 'no membership means no body read');
  assert.equal(forged.state.prompts.length, 0);

  // A member of the agency who is not on the chart's care team.
  const outsider = structuredClone(tables());
  outsider.PatientCareTeamAssignment = [];
  const offTeam = await load('batchAIAnalysis', { user: clinician, data: outsider });
  const denied = await offTeam.call({ analysisTypes: ['compliance', 'oasis'], roughNote: 'note', enhancedNote: 'note', patientId: 'patient-1' });
  assert.equal(denied.status, 403);
  assert.deepEqual(
    offTeam.state.reads.filter((read) => ['Visit', 'OASISUpload'].includes(read.table)),
    [],
    'visits and the OASIS upload are not read before access is decided',
  );
  assert.equal(offTeam.state.prompts.length, 0, 'the model is never asked about a chart the caller cannot open');

  // Another agency's lead.
  const crossing = await load('batchAIAnalysis', { user: otherManager });
  assert.equal((await crossing.call({ analysisTypes: ['compliance'], roughNote: 'note', patientId: 'patient-1' })).status, 403);
  assert.equal(crossing.state.prompts.length, 0);
});

test("batchAIAnalysis serves the chart's care team and keeps the patient's name out of the prompt", async () => {
  const batch = await load('batchAIAnalysis', { user: clinician });
  const result = await batch.call({
    analysisTypes: ['compliance', 'oasis', 'pdgm'],
    roughNote: 'Heart failure follow-up.',
    enhancedNote: 'Heart failure follow-up, homebound due to dyspnea.',
    patientId: 'patient-1',
  });
  assert.equal(result.status, 200);
  assert.equal(result.json.success, true);
  assert.equal(result.json.analyses.pdgm.paymentAvailable, false, 'the PDGM type still answers unavailable');
  assert.equal(result.json.analyses.pdgm.calculationStatus, 'blocked');
  assert.equal(batch.state.prompts.length, 2);
  for (const prompt of batch.state.prompts) {
    assert.ok(prompt.includes('Heart failure follow-up'));
    assert.ok(!prompt.includes('Example') && !prompt.includes('Person'), 'the patient name never reaches the model');
  }
  assert.ok(batch.state.prompts.some((prompt) => /NEVER state, suggest or imply an OASIS response/.test(prompt)),
    'the OASIS analysis points to evidence and never proposes a response');

  const unknown = await load('batchAIAnalysis', { user: clinician });
  assert.equal((await unknown.call({ analysisTypes: ['risk_prediction'], roughNote: 'note' })).status, 400,
    'an analysis type outside the documentation set is refused');
  assert.equal(unknown.state.prompts.length, 0);
});

// -------------------------------------------------- compliance monitor ---

const alerts = (state) => state.data.PatientAlert;

test('monitorComplianceRisks refuses a caller who is neither an agency lead nor the scheduler', async () => {
  for (const user of [null, clinician, forger]) {
    const monitor = await load('monitorComplianceRisks', { user });
    const result = await monitor.call({});
    assert.ok([401, 403].includes(result.status), `${user?.id || 'anonymous'} is refused`);
    assert.deepEqual(clinicalReads(monitor.state), [], `${user?.id || 'anonymous'} reads no chart`);
    assert.equal(monitor.state.bodyReads, 0);
  }
});

test('the scheduled monitor scans each enabled agency separately and keeps absence rules per agency', async () => {
  const monitor = await load('monitorComplianceRisks', { user: null, headers: { 'x-internal-secret': SECRET } });
  const result = await monitor.call({});
  assert.equal(result.status, 200, JSON.stringify(result.json));
  assert.equal(result.json.agencies_scanned, 2, 'the suspended agency is not scanned');

  const created = alerts(monitor.state);
  const byPatient = (id) => created.filter((alert) => alert.patient_id === id).map((alert) => alert.title).sort();
  assert.deepEqual(byPatient('patient-1'), ['Incomplete Vital Signs Documentation', 'Missing Homebound Status Documentation']);
  assert.deepEqual(byPatient('patient-2'), ['Missing Discharge OASIS Assessment']);
  // Agency Two has no system-of-record row, so only the in-app rule runs there,
  // and it never adopts Agency One's settings row.
  assert.deepEqual(byPatient('patient-9'), ['Missing Homebound Status Documentation']);
  assert.deepEqual(byPatient('patient-8'), []);
  assert.deepEqual(byPatient('patient-7'), [], 'a suspended agency gets no alerts');

  for (const alert of created) {
    assert.equal('risk_score' in alert, false, 'no risk score is stored');
    assert.match(alert.triggered_by_rule_id, /^compliance-monitor:/);
  }
  const homebound = created.find((alert) => alert.patient_id === 'patient-1' && alert.title.startsWith('Missing Homebound'));
  assert.equal(homebound.severity, 'high', 'a documentation gap is not a critical clinical alert');
  assert.equal(homebound.flagged_urgent, false);

  for (const read of monitor.state.reads.filter((entry) => entry.table === 'Patient')) {
    assert.ok(['agency-1', 'agency-2'].includes(read.query.agency_id), 'charts are selected by their own agency_id');
  }
  assert.deepEqual(monitor.state.updates, [], 'no chart is written');
  assert.equal(monitor.state.reads.some((entry) => entry.table === 'User'), false, 'no profile scan decides tenancy');
});

test('the monitor is idempotent per patient, day and rule, and converges overlapping runs', async () => {
  const monitor = await load('monitorComplianceRisks', { user: null, headers: { 'x-internal-secret': SECRET } });
  await monitor.call({});
  const firstCount = alerts(monitor.state).length;
  const second = await load('monitorComplianceRisks', {
    user: null,
    headers: { 'x-internal-secret': SECRET },
    data: monitor.state.data,
  });
  const repeat = await second.call({});
  assert.equal(repeat.json.alerts_generated, 0);
  assert.equal(second.state.creates.length, 0, 'a repeated run creates nothing');
  assert.equal(second.state.deletes.length, 0, 'a repeated run removes nothing');
  assert.equal(alerts(second.state).length, firstCount);

  // Two overlapping runs both inserted the same alert: the lowest id survives.
  const day = new Date().toISOString().slice(0, 10);
  const key = `compliance-monitor:patient-9:${day}:missing-homebound-status-documentation`;
  const seeded = structuredClone(tables());
  seeded.PatientAlert = [
    { id: 'alert-b', patient_id: 'patient-9', triggered_by_rule_id: key, status: 'active' },
    { id: 'alert-a', patient_id: 'patient-9', triggered_by_rule_id: key, status: 'active' },
  ];
  const converging = await load('monitorComplianceRisks', { user: null, headers: { 'x-internal-secret': SECRET }, data: seeded });
  await converging.call({});
  const survivors = alerts(converging.state).filter((alert) => alert.triggered_by_rule_id === key);
  assert.deepEqual(survivors.map((alert) => alert.id), ['alert-a']);
  assert.equal(converging.state.creates.filter((entry) => entry.row.triggered_by_rule_id === key).length, 0);
});

test('an ambiguous or explicitly false system-of-record row keeps the absence-based rules off', async () => {
  const ambiguous = structuredClone(tables());
  ambiguous.AgencySettings.push({ id: 'settings-2', agency_code: 'Agency One', pennsync_is_system_of_record: false });
  const companion = structuredClone(tables());
  companion.AgencySettings = [
    { id: 'settings-1', agency_code: 'Agency One', pennsync_is_system_of_record: false },
    { id: 'settings-9', office_name: 'Agency Two', pennsync_is_system_of_record: false },
  ];
  for (const data of [ambiguous, companion]) {
    const monitor = await load('monitorComplianceRisks', { user: null, headers: { 'x-internal-secret': SECRET }, data });
    await monitor.call({});
    const titles = alerts(monitor.state).map((alert) => alert.title);
    assert.deepEqual(titles, ['Missing Homebound Status Documentation', 'Missing Homebound Status Documentation']);
  }
});

test('an agency lead runs the monitor for their own agency only', async () => {
  const monitor = await load('monitorComplianceRisks', { user: manager });
  const result = await monitor.call({});
  assert.equal(result.status, 200);
  assert.equal(result.json.agencies_scanned, 1);
  assert.ok(alerts(monitor.state).every((alert) => ['patient-1', 'patient-2'].includes(alert.patient_id)));

  const crossing = await load('monitorComplianceRisks', { user: manager });
  assert.equal((await crossing.call({ agency_id: 'agency-2' })).status, 403);
  assert.equal(crossing.state.reads.some((entry) => entry.table === 'Patient'), false);
});
