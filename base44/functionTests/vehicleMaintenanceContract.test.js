import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import JSON5 from 'json5';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const url = new URL('../functions/manageVehicleMaintenance/entry.ts', import.meta.url);
const temporary = join(tmpdir(), `fleet-contract-${Date.now()}-${Math.random().toString(16).slice(2)}.mjs`);
const source = (await readFile(url, 'utf8'))
  .replace(/import \{ createClientFromRequest \} from 'npm:[^']+';/, '')
  .replace(/^Deno\.serve\(.*\);$/m, '');
await writeFile(temporary, transpileTs(source).outputText);
const { handleVehicleMaintenance } = await import(pathToFileURL(temporary).href);
await unlink(temporary);
const clone = value => JSON.parse(JSON.stringify(value));
const employee = { id: 'employee-1', email: 'staff@example.test', full_name: 'Test Driver', role: 'user', is_active: true };
const admin = { id: 'admin-1', email: 'admin@example.test', full_name: 'Fleet Admin', role: 'user', is_active: true };
const owner = { id: 'owner-1', email: 'owner@example.test', full_name: 'Owner', role: 'admin' };
const member = (user, role = 'clinician') => ({ id: `member-${user.id}`, user_id: user.id, agency_id: 'agency-a', user_email_normalized: user.email, membership_key: `agency-a:${user.id}`, tenant_role: role, status: 'active', version: 1 });
const vehicle = (overrides = {}) => ({ id: 'vehicle-1', agency_id: 'agency-a', unit_name: 'Car 01', year: 2024, make: 'Toyota', model: 'Corolla', status: 'active', baseline_odometer: 10000, assigned_user_id: employee.id, assigned_user_name: employee.full_name, assigned_user_email: employee.email, version: 1, request_key: 'initial', ...overrides });
const entry = (overrides = {}) => ({ id: 'entry-1', agency_id: 'agency-a', vehicle_id: 'vehicle-1', request_key: 'initial-entry', service_date: '2026-01-15', odometer: 11000, service_type: 'oil_change', description: 'Oil and filter changed', recorded_at: '2026-01-15T12:00:00Z', submitted_by_user_id: employee.id, submitted_by_name: employee.full_name, entry_source: 'employee', review_status: 'pending', review_history: [], ...overrides });
const facts = { service_date: '2026-01-15', odometer: 11000, service_type: 'oil_change', description: 'Oil and filter changed', cost_cents: 8995 };
const vehicleFacts = { unit_name: 'Car 02', year: 2025, make: 'Ford', model: 'Escape', baseline_odometer: 12000, status: 'active', assigned_user_id: employee.id };

function harness({ user = employee, vehicles = [vehicle()], entries = [], ignoreScope = false, revokeAt = 0 } = {}) {
  const state = {
    Agency: [{ id: 'agency-a', agency_name: 'Test Agency', status: 'active' }, { id: 'agency-b', agency_name: 'Other Agency', status: 'active' }],
    AgencyMembership: [member(employee), member(admin, 'agency_admin')],
    User: [employee, admin, owner], FleetVehicle: clone(vehicles), FleetServiceEntry: clone(entries),
  };
  const writes = [];
  let authReads = 0;
  function match(row, query) {
    return Object.entries(query).every(([key, value]) => value && !Array.isArray(value) && typeof value === 'object' && '$ne' in value
      ? row[key] !== value.$ne : JSON.stringify(row[key]) === JSON.stringify(value));
  }
  const entities = Object.fromEntries(Object.keys(state).map(name => [name, {
    async filter(query, sort, limit = 50, skip = 0) {
      const found = state[name].filter(row => ignoreScope || match(row, query));
      if (sort) found.sort((a, b) => String(a[sort.replace(/^-/, '')] || '').localeCompare(String(b[sort.replace(/^-/, '')] || '')) * (sort.startsWith('-') ? -1 : 1));
      return clone(found.slice(skip, skip + limit));
    },
    async create(payload) {
      const row = { id: `${name}-${state[name].length + 1}`, ...clone(payload) };
      writes.push({ name, action: 'create', payload: clone(payload) }); state[name].push(row); return clone(row);
    },
    async updateMany(query, data) {
      const targets = state[name].filter(row => match(row, query));
      for (const row of targets) Object.assign(row, clone(data.$set));
      writes.push({ name, action: 'update', query: clone(query), data: clone(data) });
      return { success: true, updated: targets.length, has_more: false };
    },
  }]));
  const client = { asServiceRole: { entities }, auth: { async me() {
    authReads += 1;
    if (revokeAt && authReads >= revokeAt) state.AgencyMembership = state.AgencyMembership.filter(row => row.user_id !== user?.id);
    return user ? clone(user) : null;
  } } };
  async function call(action, payload = {}) {
    const response = await handleVehicleMaintenance(new Request('https://fleet.example.test', { method: 'POST', body: JSON.stringify({ action, ...(action === 'context' ? {} : { agency_id: 'agency-a' }), ...payload }) }), client, 'owner@example.test');
    return { status: response.status, body: await response.json() };
  }
  return { call, state, writes, client };
}

test('new entities deny direct CRUD for every client role', async () => {
  for (const name of ['FleetVehicle', 'FleetServiceEntry']) {
    const schema = JSON5.parse(await readFile(new URL(`../entities/${name}.jsonc`, import.meta.url), 'utf8'));
    assert.deepEqual(schema.rls, { create: false, read: false, update: false, delete: false });
  }
});
test('anonymous and disabled accounts are rejected without mutations', async () => {
  for (const user of [null, { ...employee, is_active: false }, { ...employee, disabled: true }, { ...employee, is_service: true }]) {
    const h = harness({ user }); const result = await h.call('vehicles');
    assert.ok([401, 403].includes(result.status)); assert.equal(h.writes.length, 0);
  }
});
test('employees see only their assigned, nonretired vehicles', async () => {
  const h = harness({ vehicles: [vehicle(), vehicle({ id: 'other', assigned_user_id: admin.id }), vehicle({ id: 'retired', status: 'retired' })] });
  const result = await h.call('vehicles', { include_retired: true });
  assert.equal(result.status, 200); assert.deepEqual(result.body.vehicles.map(row => row.id), ['vehicle-1']); assert.equal(result.body.can_manage, false);
});
test('agency admins see agency fleet but not foreign vehicles', async () => {
  const h = harness({ user: admin, vehicles: [vehicle(), vehicle({ id: 'foreign', agency_id: 'agency-b' })] });
  const result = await h.call('vehicles'); assert.equal(result.status, 200); assert.equal(result.body.vehicles.length, 1); assert.equal(result.body.can_manage, true);
});
test('editable profile fields cannot grant fleet administration', async () => {
  const h = harness({ user: { ...employee, account_type: 'agency_admin', is_manager: true, agency_id: 'agency-b' } });
  const result = await h.call('create_vehicle', { request_id: 'request-1', vehicle: vehicleFacts });
  assert.equal(result.status, 403); assert.equal(h.writes.length, 0);
});
test('explicit foreign-tenant requests are denied', async () => {
  const result = await harness().call('vehicles', { agency_id: 'agency-b' }); assert.equal(result.status, 403);
});
test('duplicate or malformed memberships are fail-closed', async () => {
  const h = harness(); h.state.AgencyMembership.push({ ...member(employee), id: 'duplicate' });
  assert.equal((await h.call('vehicles')).status, 409);
});
test('wrongly scoped datastore results are rejected', async () => {
  const h = harness({ ignoreScope: true }); assert.equal((await h.call('vehicles')).status, 409);
});
test('protected owner can choose an explicit agency without inventing membership', async () => {
  const h = harness({ user: owner }); const result = await h.call('context');
  assert.equal(result.status, 200); assert.equal(result.body.agencies.length, 2); assert.ok(result.body.agencies.every(row => row.can_manage));
});
test('regular staff cannot access another driver history or spoof a vehicle identifier', async () => {
  const h = harness({ vehicles: [vehicle({ assigned_user_id: admin.id })] });
  assert.equal((await h.call('history', { vehicle_id: 'vehicle-1' })).status, 403);
  assert.equal((await h.call('history', { vehicle_id: { $ne: null } })).status, 400);
});
test('employee service entry stamps real identity and awaits admin review', async () => {
  const h = harness(); const result = await h.call('add_entry', { vehicle_id: 'vehicle-1', request_id: 'record-1', entry: facts });
  assert.equal(result.status, 200); assert.equal(result.body.entry.submitted_by_user_id, employee.id);
  assert.equal(result.body.entry.review_status, 'pending'); assert.equal(result.body.entry.cost_cents, 8995);
  assert.equal(h.state.FleetServiceEntry.length, 1);
});
test('identical sequential retries return the saved entry rather than duplicating it', async () => {
  const h = harness(); const payload = { vehicle_id: 'vehicle-1', request_id: 'record-1', entry: facts };
  const first = await h.call('add_entry', payload); const second = await h.call('add_entry', payload);
  assert.equal(second.status, 200); assert.equal(first.body.entry.id, second.body.entry.id); assert.equal(h.writes.length, 1);
  assert.equal((await h.call('add_entry', { ...payload, entry: { ...facts, description: 'Changed' } })).status, 409);
});
test('server refuses forged authors, review state, and tenant fields inside entry', async () => {
  for (const forged of [{ submitted_by_user_id: admin.id }, { review_status: 'reviewed' }, { agency_id: 'agency-b' }]) {
    const h = harness(); const result = await h.call('add_entry', { vehicle_id: 'vehicle-1', request_id: 'record-1', entry: { ...facts, ...forged } });
    assert.equal(result.status, 400); assert.equal(h.writes.length, 0);
  }
});
test('historical lower mileage is allowed, but negative/noninteger/invalid-date entries are not', async () => {
  assert.equal((await harness().call('add_entry', { vehicle_id: 'vehicle-1', request_id: 'history', entry: { ...facts, odometer: 9000 } })).status, 200);
  for (const invalid of [{ odometer: -1 }, { cost_cents: 1.1 }, { service_date: '2026-02-30' }, { service_date: '2999-01-01' }, { next_due_odometer: 1 }, { next_due_date: '2025-01-01' }]) {
    const h = harness(); assert.equal((await h.call('add_entry', { vehicle_id: 'vehicle-1', request_id: 'bad', entry: { ...facts, ...invalid } })).status, 400); assert.equal(h.writes.length, 0);
  }
});
test('unknown cost and zero charge are distinguished', async () => {
  for (const cost_cents of [undefined, 0]) {
    const h = harness(); const result = await h.call('add_entry', { vehicle_id: 'vehicle-1', request_id: 'cost', entry: { ...facts, cost_cents } });
    assert.equal(result.status, 200); assert.equal(result.body.entry.cost_cents, cost_cents);
  }
});
test('revocation before a mutation prevents the write', async () => {
  const h = harness({ revokeAt: 2 }); const result = await h.call('add_entry', { vehicle_id: 'vehicle-1', request_id: 'revoked', entry: facts });
  assert.equal(result.status, 403); assert.equal(h.writes.length, 0);
});
test('admin review retains original facts and all earlier annotations', async () => {
  const h = harness({ user: admin, entries: [entry()] });
  const payload = { vehicle_id: 'vehicle-1', entry_id: 'entry-1', expected_review_count: 0, status: 'needs_follow_up', note: 'Please confirm invoice amount.' };
  assert.equal((await h.call('review_entry', payload)).status, 200);
  assert.equal((await h.call('review_entry', { ...payload, expected_review_count: 1, status: 'reviewed', note: 'Confirmed.' })).status, 200);
  assert.equal(h.state.FleetServiceEntry[0].review_history.length, 2);
  assert.equal(h.state.FleetServiceEntry[0].description, entry().description);
  assert.equal(h.state.FleetServiceEntry[0].submitted_by_user_id, employee.id);
});
test('employees cannot review; stale reviews and empty follow-up notes are rejected', async () => {
  const payload = { vehicle_id: 'vehicle-1', entry_id: 'entry-1', expected_review_count: 0, status: 'reviewed', note: '' };
  assert.equal((await harness({ entries: [entry()] }).call('review_entry', payload)).status, 403);
  const h = harness({ user: admin, entries: [entry()] });
  assert.equal((await h.call('review_entry', { ...payload, expected_review_count: 1 })).status, 409);
  assert.equal((await h.call('review_entry', { ...payload, status: 'needs_follow_up' })).status, 400);
});
test('admin vehicle assignment must reference active same-agency staff', async () => {
  const h = harness({ user: admin });
  assert.equal((await h.call('create_vehicle', { request_id: 'newcar', vehicle: vehicleFacts })).status, 200);
  assert.equal((await h.call('create_vehicle', { request_id: 'badcar', vehicle: { ...vehicleFacts, assigned_user_id: owner.id } })).status, 404);
});
test('vehicle updates use a version condition and preserve original creation identity', async () => {
  const h = harness({ user: admin });
  const result = await h.call('update_vehicle', { vehicle_id: 'vehicle-1', expected_version: 1, vehicle: { ...vehicleFacts, assigned_user_id: '' } });
  assert.equal(result.status, 200); assert.equal(result.body.vehicle.version, 2); assert.equal(result.body.vehicle.assigned_user_id, '');
  assert.equal(h.writes[0].query.version, 1);
  assert.equal((await h.call('update_vehicle', { vehicle_id: 'vehicle-1', expected_version: 1, vehicle: vehicleFacts })).status, 409);
});
test('complete service history is paginated rather than silently truncated', async () => {
  const h = harness({ entries: Array.from({ length: 73 }, (_, index) => entry({ id: `entry-${index}` })) });
  const first = await h.call('history', { vehicle_id: 'vehicle-1' }); const second = await h.call('history', { vehicle_id: 'vehicle-1', offset: first.body.next_offset });
  assert.equal(first.body.entries.length, 50); assert.equal(second.body.entries.length, 23); assert.equal(second.body.next_offset, null);
});
test('retired vehicle history stays available to admin, not former driver', async () => {
  const options = { vehicles: [vehicle({ status: 'retired' })], entries: [entry()] };
  assert.equal((await harness({ ...options, user: admin }).call('history', { vehicle_id: 'vehicle-1' })).status, 200);
  assert.equal((await harness(options).call('history', { vehicle_id: 'vehicle-1' })).status, 403);
});
test('the broker offers no edit/delete action for original service facts', async () => {
  const h = harness({ user: admin, entries: [entry()] });
  for (const action of ['delete_vehicle', 'delete_entry', 'update_entry']) assert.equal((await h.call(action)).status, 400);
  assert.equal(h.writes.length, 0);
});
