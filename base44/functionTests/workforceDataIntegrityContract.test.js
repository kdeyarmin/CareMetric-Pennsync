import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const employee = { id: 'employee-1', email: 'staff@example.test', full_name: 'Test Employee', role: 'user', is_active: true };
const membership = { id: 'membership-1', user_id: employee.id, user_email_normalized: employee.email,
  agency_id: 'agency-a', membership_key: 'agency-a:employee-1', tenant_role: 'clinician', status: 'active', version: 1,
  created_by_user_id: 'owner-1', last_transition_by_user_id: 'owner-1', last_transition_by_email_normalized: 'owner@example.test',
  last_transition_at: '2026-01-01T00:00:00.000Z', last_transition_reason: 'Initial assignment', activated_at: '2026-01-01T00:00:00.000Z' };
const baseBody = { pay_period_start: '2026-06-14', pay_period_end: '2026-06-27', status: 'draft', regular_hours: 80 };
const deepCopy = value => JSON.parse(JSON.stringify(value));
function harness(name, { failures = [], rows = {}, caller = employee } = {}) {
  const writes = [];
  const data = { AgencyMembership: [membership], Agency: [{ id: 'agency-a', agency_name: 'Agency A', status: 'active' }],
    User: [employee], EmployeePayrollProfile: [{ id: 'profile-1', employee_email: employee.email, service_type: 'home_health', earns_points: false, active: true, phone_reimbursement: 25 }],
    TimeOffRequest: [], VisitPointConfig: [], Timesheet: [], PersonnelCredential: [], ...deepCopy(rows) };
  const entities = new Proxy({}, { get(_, entity) { return {
    async filter(query, _sort, limit = 5000) {
      if (failures.includes(entity)) throw new Error('SYNTHETIC_DATASTORE_ERROR');
      return deepCopy((data[entity] || []).filter(row => Object.entries(query || {}).every(([key,value]) => value && typeof value === 'object' && '$in' in value ? value.$in.includes(row[key]) : row[key] === value)).slice(0,limit));
    },
    async list(_sort, limit = 5000) { if (failures.includes(entity)) throw new Error('SYNTHETIC_DATASTORE_ERROR'); return deepCopy((data[entity] || []).slice(0,limit)); },
    async get(id) { return deepCopy((data[entity] || []).find(row => row.id === id) || null); },
    async create(value) { const row = { id: 'new-' + entity, ...deepCopy(value) }; writes.push({ entity, action: 'create', row }); (data[entity] ||= []).push(row); return row; },
    async update(id, value) { const row = { id, ...deepCopy(value) }; writes.push({ entity, action: 'update', row }); return row; },
    async delete(id) { writes.push({ entity, action: 'delete', id }); },
  }; } });
  const client = { auth: { me: async () => caller }, asServiceRole: { entities, integrations: { Core: { SendEmail: async () => { throw new Error('Unexpected delivery'); } } } } };
  let handler;
  const source = readFileSync(new URL(`../functions/${name}/entry.ts`, import.meta.url), 'utf8').replace(/import \{ createClientFromRequest \} from 'npm:[^']+';/, '');
  new Function('createClientFromRequest', 'Deno', transpileTs(source).outputText)(() => client, { serve(callback) { handler = callback; }, env: { get() { return undefined; } } });
  return { writes, data, async call(body) {
    const response = await handler(new Request('https://example.test/' + name, { method: 'POST', body: JSON.stringify(body) }));
    return { status: response.status, body: await response.json() };
  } };
}

for (const entity of ['EmployeePayrollProfile', 'TimeOffRequest', 'Timesheet']) {
  test(`timesheet lookup failure for ${entity} cannot silently become zero or an empty record list`, async () => {
    const h = harness('submitTimesheet', { failures: [entity] });
    const r = await h.call(baseBody);
    assert.ok(r.status >= 400, JSON.stringify(r));
    assert.equal(h.writes.length, 0);
  });
}
test('visit-point lookup failure does not save zero calculated points', async () => {
  const h = harness('submitTimesheet', { failures: ['VisitPointConfig'], rows: { EmployeePayrollProfile: [{ id: 'p', employee_email: employee.email, service_type: 'home_health', earns_points: true, active: true }] } });
  const r = await h.call({ ...baseBody, visit_counts: { soc: 2 } });
  assert.ok(r.status >= 400, JSON.stringify(r)); assert.equal(h.writes.length, 0);
});
test('daily time entries must be unique calendar days inside their pay period', async () => {
  for (const daily_entries of [
    [{ date: '2026-06-13', regular_hours: 8 }], [{ date: '2026-06-28', regular_hours: 8 }],
    [{ date: '2026-02-30', regular_hours: 8 }], [{ date: '2026-06-15', regular_hours: 8 }, { date: '2026-06-15', regular_hours: 8 }],
    Array.from({length: 63}, () => ({ date: '2026-06-15', regular_hours: 1 })),
  ]) {
    const h = harness('submitTimesheet'); const r = await h.call({ ...baseBody, entry_mode: 'daily', daily_entries });
    assert.equal(r.status, 400, JSON.stringify(daily_entries)); assert.equal(h.writes.length, 0);
  }
});
test('invalid numeric input must not be converted into a valid zero payroll bucket', async () => {
  for (const invalid of [{ regular_hours: -1 }, { reimbursement: 'invalid' }, { miles: true }, { overtime_hours: {} }]) {
    const h = harness('submitTimesheet'); const r = await h.call({ ...baseBody, ...invalid });
    assert.equal(r.status, 400, JSON.stringify(invalid)); assert.equal(h.writes.length, 0);
  }
});
test('existing duplicate timesheets require reconciliation rather than overwriting an arbitrary row', async () => {
  const h = harness('submitTimesheet', { rows: { Timesheet: ['a','b'].map(id => ({ id, employee_email: employee.email, service_type: 'home_health', ...baseBody })) } });
  const r = await h.call(baseBody); assert.equal(r.status, 409); assert.equal(h.writes.length, 0);
});
test('valid daily entries retain exact totals and authoritative phone reimbursement', async () => {
  const h = harness('submitTimesheet');
  const r = await h.call({ ...baseBody, entry_mode: 'daily', daily_entries: [{ date: '2026-06-15', regular_hours: 7.5 }, { date: '2026-06-16', regular_hours: 8 }], phone_reimbursement: 999 });
  assert.equal(r.status, 200); assert.equal(r.body.timesheet.regular_hours, 15.5); assert.equal(r.body.timesheet.phone_reimbursement, 25);
});
test('time-off dates must be exact dates and half_day must be a boolean', async () => {
  for (const invalid of [{ start_date: '2026-06-15extra' }, { end_date: '2026-06-16T00:00:00Z' }, { half_day: 'false' }, { start_date: '2026-06-15', end_date: '9999-12-31' }]) {
    const h = harness('submitTimeOffRequest'); const r = await h.call({ start_date: '2026-06-15', end_date: '2026-06-16', ...invalid });
    assert.equal(r.status, 400, JSON.stringify(invalid)); assert.equal(h.writes.length, 0);
  }
});
test('credential date validation rejects impossible dates and inconsistent date order', async () => {
  for (const invalid of [{ expiration_date: '2026-02-30' }, { expiration_date: 'not-a-date' }, { issued_date: '2027-01-01' }]) {
    const h = harness('submitPersonnelCredential'); const r = await h.call({ credential: { item_type: 'license', title: 'Test license', expiration_date: '2026-12-31', ...invalid } });
    assert.equal(r.status, 400, JSON.stringify(invalid)); assert.equal(h.writes.length, 0);
  }
});
test('credential fields reject objects instead of persisting them as free text', async () => {
  const h = harness('submitPersonnelCredential'); const r = await h.call({ credential: { item_type: 'license', title: { unexpected: true }, expiration_date: '2026-12-31' } });
  assert.equal(r.status, 400); assert.equal(h.writes.length, 0);
});


test('staff without an active canonical membership cannot submit workforce requests', async () => {
  for (const name of ['submitTimesheet', 'submitTimeOffRequest']) {
    const h = harness(name, { rows: { AgencyMembership: [] } });
    const r = await h.call(name === 'submitTimesheet' ? baseBody : { start_date: '2026-06-15', end_date: '2026-06-16' });
    assert.equal(r.status, 403); assert.equal(h.writes.length, 0);
  }
});
test('an approver cannot self-declare a manager or administrator through profile fields', async () => {
  const impostor = { id: 'impostor', email: 'impostor@example.test', role: 'user', is_manager: true, account_type: 'agency_admin', agency_name: 'Agency A' };
  const impostorMembership = { ...membership, id: 'm-impostor', user_id: impostor.id, user_email_normalized: impostor.email, membership_key: 'agency-a:impostor' };
  for (const name of ['submitTimesheet', 'submitTimeOffRequest']) {
    const h = harness(name, { rows: { User: [employee, impostor], AgencyMembership: [membership, impostorMembership] } });
    const r = await h.call({ ...(name === 'submitTimesheet' ? baseBody : { start_date: '2026-06-15', end_date: '2026-06-16' }), manager_email: impostor.email });
    assert.ok([400,403].includes(r.status), JSON.stringify(r)); assert.equal(h.writes.length, 0);
  }
});
test('a same-agency membership-backed manager can be selected without editable role flags', async () => {
  const manager = { id: 'manager-1', email: 'manager@example.test', role: 'user', full_name: 'Real Manager', agency_name: 'Wrong editable name' };
  const managerMembership = { ...membership, id: 'm-manager', user_id: manager.id, user_email_normalized: manager.email, membership_key: 'agency-a:manager-1', tenant_role: 'manager' };
  for (const name of ['submitTimesheet', 'submitTimeOffRequest']) {
    const h = harness(name, { rows: { User: [employee, manager], AgencyMembership: [membership, managerMembership] } });
    const r = await h.call({ ...(name === 'submitTimesheet' ? baseBody : { start_date: '2026-06-15', end_date: '2026-06-16' }), manager_email: manager.email });
    assert.equal(r.status, 200, JSON.stringify(r));
  }
});


test('a self-declared educator role does not grant team training access', async () => {
  const h = harness('getTeamTrainingReadiness', { caller: { ...employee, training_role: 'educator' } });
  const r = await h.call({}); assert.equal(r.status, 403);
});
test('an empty required-training dataset is not reported as 100 percent complete', async () => {
  const h = harness('getTeamTrainingReadiness', { caller: { ...employee, role: 'admin' } });
  const r = await h.call({}); assert.equal(r.status, 200); assert.equal(r.body.overall.total, 0); assert.equal(r.body.overall.pct, null);
});
test('a capped team-training source refuses a misleading complete readiness result', async () => {
  const h = harness('getTeamTrainingReadiness', { caller: { ...employee, role: 'admin' }, rows: { TrainingAssignment: Array.from({length:5000}, (_,i)=>({id:'a'+i, status:'completed', required:true})) } });
  const r = await h.call({}); assert.ok(r.status >= 400);
});


test('training roster scope ignores employee-editable agency names', async () => {
  const foreign = { id:'foreign-1', email:'foreign@example.test', role:'user', is_active:true, agency_name:'Agency A' };
  const own = {...employee, agency_name:'A misleading editable name'};
  const h=harness('getTeamTrainingReadiness',{caller:own, rows:{
    User:[own,foreign], AgencyMembership:[{...membership,tenant_role:'agency_admin'}],
    TrainingAssignment:[{id:'own',assigned_to_user_id:employee.email,required:true,status:'completed'}, {id:'foreign',assigned_to_user_id:foreign.email,required:true,status:'assigned'}],
  }});
  const r=await h.call({}); assert.equal(r.status,200);assert.equal(r.body.overall.total,1);assert.equal(r.body.rows[0].employee,employee.email);
});
test('ambiguous staff lifecycle does not return a training compliance percentage', async () => {
  const other={...employee,id:'other',email:'other@example.test'};
  const base={...membership,id:'m-other',user_id:other.id,user_email_normalized:other.email,membership_key:'agency-a:other'};
  const h=harness('getTeamTrainingReadiness',{rows:{User:[employee,other],AgencyMembership:[{...membership,tenant_role:'agency_admin'},base,{...base,id:'m-other-revoked',status:'revoked',revoked_at:'2026-01-02T00:00:00.000Z',revocation_reason:'Moved'}]}});
  const r=await h.call({});assert.equal(r.status,409);assert.equal(r.body.overall,undefined);
});


test('fallback approval notices use membership-backed admins, never self-claimed profile admins', async () => {
  const real={id:'real-admin',email:'real@example.test',role:'user',full_name:'Actual administrator'};
  const fake={id:'fake-admin',email:'fake@example.test',role:'user',account_type:'super_admin',agency_name:'Agency A'};
  const memberFor=(person,role)=>({...membership,id:'membership-'+person.id,user_id:person.id,user_email_normalized:person.email,membership_key:'agency-a:'+person.id,tenant_role:role});
  for(const name of ['submitTimesheet','submitTimeOffRequest']) {
    const h=harness(name,{rows:{User:[employee,real,fake],AgencyMembership:[membership,memberFor(real,'agency_admin'),memberFor(fake,'clinician')]}});
    const r=await h.call(name==='submitTimesheet'?{...baseBody,status:'submitted'}:{start_date:'2026-06-15',end_date:'2026-06-16'});
    assert.equal(r.status,200);
    const recipients=h.writes.filter(row=>row.entity==='Notification').map(write=>write.row.user_email);
    assert.deepEqual(recipients,[real.email]);
  }
});
