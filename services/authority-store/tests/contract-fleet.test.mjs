import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { RECORD_MIGRATION_FILE, SCHEMA } from '../../../tools-entity-schema-plan.mjs';
import { BROKER_MIGRATION_FILE } from '../../../tools-record-brokers.mjs';

/**
 * Vehicle maintenance.
 *
 * Three things this file is really about. `FleetServiceReview` is one of D32's
 * four append-only entities — a read and an insert policy and no update or
 * delete policy at all — so a review INSERTS a row and never rewrites the
 * entry's array, which the original already says in its own words. The
 * `fleet_vehicle` policies are agency-WIDE, so the assignment narrowing is the
 * contract's (D45's rule again). And the original's `createOnce` reservation
 * protocol — a hashed claim appended to an array on a PARENT row — becomes a
 * real `for update` on that same parent, which is what it was emulating.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const FLEET = 'services/authority-store/supabase/record-migrations/'
  + '20260920310000_contract_fleet.sql';
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const email = n => ['', 'admin-a', 'clinician-a', 'clinician-empty', 'admin-b'][n]
  + '@example.invalid';
const base44Id = n => `6aac00000000${uid(n).slice(-12)}`;
const ADMIN_A = 1; const CLINICIAN_A = 2; const CLINICIAN_EMPTY = 3; const ADMIN_B = 4;
const VEHICLES = 'select "public"."pennsync_contract_fleet_vehicles"($1,$2,$3) as result';
const HISTORY = 'select "public"."pennsync_contract_fleet_history"($1,$2,$3) as result';
const CREATE = 'select "public"."pennsync_contract_fleet_vehicle_create"($1,$2,$3) as result';
const UPDATE = 'select "public"."pennsync_contract_fleet_vehicle_update"($1,$2,$3,$4) as result';
const ADD = 'select "public"."pennsync_contract_fleet_entry_add"($1,$2,$3,$4) as result';
const REVIEW = 'select "public"."pennsync_contract_fleet_entry_review"($1,$2,$3,$4,$5,$6,$7) as result';
const A = 'agency-a'; const B = 'agency-b';
const GOOD_VEHICLE = Object.freeze({
  unit_name: 'Unit 12', year: 2021, make: 'Ford', model: 'Transit',
  vin: '1FTBW2CM5MKA12345', license_plate: 'pa-1234', baseline_odometer: 48000,
  status: 'active', notes: 'Spare key in the office.',
});
const GOOD_ENTRY = Object.freeze({
  service_date: '2026-09-01', odometer: 51200, service_type: 'oil_change',
  description: 'Oil and filter, topped coolant.', service_provider: 'Ridge Auto',
  cost_cents: 8950, invoice_reference: 'RA-99',
});
let db;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  for (const file of [RECORD_MIGRATION_FILE, BROKER_MIGRATION_FILE, FLEET]) {
    await db.exec(readFileSync(resolve(repository, file), 'utf8'));
  }
  await db.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
  for (const [id, name] of [[A, 'Keystone Home Health'], [B, 'Allegheny Care Partners']]) {
    await db.query(`insert into ${SCHEMA}."agency"
      ("source_app_id","id","agency_name","status") values ($1,$2,$3,'active')`,
    [APP, id, name]);
  }
});
after(async () => db?.close());

async function as(n, sql, params = [], commit = true) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
      sub: uid(n), session_id: sid(n), role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600,
    })]);
    await db.exec('set local role authenticated');
    const { rows } = await db.query(sql, params);
    if (commit) await db.exec('commit'); else await db.exec('rollback');
    return rows[0].result;
  } catch (error) { await db.exec('rollback'); throw error; }
}
const create = (n, request, vehicle = GOOD_VEHICLE, agency = A) =>
  as(n, CREATE, [agency, request, JSON.stringify(vehicle)]);
const update = (n, id, version, vehicle, agency = A) =>
  as(n, UPDATE, [agency, id, version, JSON.stringify(vehicle)]);
const vehicles = (n, offset = null, retired = null, agency = A) =>
  as(n, VEHICLES, [agency, offset, retired]);
const history = (n, id, cursor = null, agency = A) => as(n, HISTORY, [agency, id, cursor]);
const add = (n, id, request, entry = GOOD_ENTRY, agency = A) =>
  as(n, ADD, [agency, id, request, JSON.stringify(entry)]);
const review = (n, vehicleId, entryId, request, count, status, note, agency = A) =>
  as(n, REVIEW, [agency, vehicleId, entryId, request, count, status,
    note === undefined ? null : JSON.stringify(note)]);
const refusal = (promise, code) => assert.rejects(promise, error => {
  assert.match(String(error?.message ?? error), new RegExp(code));
  return true;
}, `expected ${code}`);
const clear = async () => {
  for (const t of ['fleet_service_review', 'fleet_service_entry', 'fleet_vehicle']) {
    await db.query(`delete from ${SCHEMA}."${t}"`);
  }
};

test('only an agency administrator keeps the fleet', async () => {
  await clear();
  await refusal(create(CLINICIAN_A, 'req-1'), 'PENNSYNC_FLEET_FORBIDDEN');
  // An administrator of another agency does not hold this one at all, which
  // is a different answer from "you are here but not an administrator".
  await refusal(create(ADMIN_B, 'req-1'), 'PENNSYNC_FLEET_AGENCY_NOT_HELD');
  const made = await create(ADMIN_A, 'req-1');
  assert.equal(made.vehicle.unit_name, 'Unit 12');
  assert.equal(made.vehicle.license_plate, 'PA-1234', 'the plate is upper-cased');
  assert.equal(made.vehicle.vin, '1FTBW2CM5MKA12345');
  assert.equal(Number(made.vehicle.version), 1);
  await refusal(update(CLINICIAN_A, made.vehicle.id, 1, GOOD_VEHICLE),
    'PENNSYNC_FLEET_FORBIDDEN');
});

test('a resubmitted creation makes one vehicle, not two', async () => {
  // The original reserves a hashed claim on the AGENCY row and re-reads before
  // creating. Here the agency row is locked, so the check and the insert are
  // one transaction — which is what that protocol was emulating.
  await clear();
  const first = await create(ADMIN_A, 'req-dup');
  const again = await create(ADMIN_A, 'req-dup');
  assert.equal(again.deduplicated, true);
  assert.equal(again.vehicle.id, first.vehicle.id);
  assert.equal((await db.query(
    `select count(*)::int as n from ${SCHEMA}."fleet_vehicle"`)).rows[0].n, 1);
  // A different request id is a different vehicle.
  await create(ADMIN_A, 'req-other');
  assert.equal((await db.query(
    `select count(*)::int as n from ${SCHEMA}."fleet_vehicle"`)).rows[0].n, 2);
  // And the claim columns the original needs are not written at all.
  const row = (await db.query(`select "creation_claim_token","service_creation_claims"
    from ${SCHEMA}."fleet_vehicle" where "id" = $1`, [first.vehicle.id])).rows[0];
  assert.equal(row.creation_claim_token, null);
  assert.equal(row.service_creation_claims, null);
});

test('the vehicle facts are checked the way the original checks them', async () => {
  await clear();
  const bad = (patch, code = 'PENNSYNC_FLEET_FIELD_INVALID') =>
    refusal(create(ADMIN_A, 'req-bad', { ...GOOD_VEHICLE, ...patch }), code);
  await bad({ unit_name: '   ' });
  await bad({ year: 1899 });
  await bad({ year: 2500 });
  await bad({ status: 'sold' });
  await bad({ make: null });
  await bad({ baseline_odometer: -1 });
  await bad({ baseline_odometer: 1.5 });
  await bad({ vin: 'IOQ0000000000000Q' }, 'PENNSYNC_FLEET_VIN_INVALID');
  await refusal(create(ADMIN_A, 'req-bad', { ...GOOD_VEHICLE, colour: 'white' }),
    'PENNSYNC_FLEET_FIELD_UNSUPPORTED');
  await refusal(create(ADMIN_A, 'has spaces'), 'PENNSYNC_FLEET_REQUEST_INVALID');
  // A blank VIN and plate are allowed; the original returns '' for both.
  const made = await create(ADMIN_A, 'req-blank', { ...GOOD_VEHICLE, vin: '', license_plate: '' });
  assert.equal(made.vehicle.vin, '');
  assert.equal(made.vehicle.license_plate, '');
});

test('an assignee is proved through membership, never through a profile', async () => {
  await clear();
  await refusal(create(ADMIN_A, 'req-a', { ...GOOD_VEHICLE, assigned_user_id: base44Id(ADMIN_B) }),
    'PENNSYNC_FLEET_ASSIGNEE_UNKNOWN');
  await refusal(create(ADMIN_A, 'req-a', { ...GOOD_VEHICLE, assigned_user_id: 'nobody' }),
    'PENNSYNC_FLEET_ASSIGNEE_UNKNOWN');
  const made = await create(ADMIN_A, 'req-a',
    { ...GOOD_VEHICLE, assigned_user_id: base44Id(CLINICIAN_A) });
  assert.equal(made.vehicle.assigned_user_id, base44Id(CLINICIAN_A));
  assert.equal(made.vehicle.assigned_user_email, email(CLINICIAN_A));
  // D38's finding: the carried `user` table has no name column, so the
  // verified address is the display name rather than a `full_name` that does
  // not exist in this store.
  assert.equal(made.vehicle.assigned_user_name, email(CLINICIAN_A));
});

test('a driver sees the vehicle assigned to them and nobody else s', async () => {
  // `fleet_vehicle_read` is agency-WIDE, so this is the contract's rule.
  await clear();
  const mine = await create(ADMIN_A, 'v-mine',
    { ...GOOD_VEHICLE, unit_name: 'Unit 1', assigned_user_id: base44Id(CLINICIAN_A) });
  await create(ADMIN_A, 'v-theirs', { ...GOOD_VEHICLE, unit_name: 'Unit 2' });
  const retired = await create(ADMIN_A, 'v-retired', { ...GOOD_VEHICLE, unit_name: 'Unit 3',
    status: 'retired', assigned_user_id: base44Id(CLINICIAN_A) });
  const driver = await vehicles(CLINICIAN_A);
  assert.equal(driver.can_manage, false);
  assert.deepEqual(driver.vehicles.map(v => v.unit_name), ['Unit 1']);
  assert.equal((await vehicles(CLINICIAN_EMPTY)).vehicles.length, 0);
  // A manager sees the fleet, and the retired one only when they ask.
  assert.deepEqual((await vehicles(ADMIN_A)).vehicles.map(v => v.unit_name),
    ['Unit 1', 'Unit 2']);
  assert.deepEqual((await vehicles(ADMIN_A, 0, true)).vehicles.map(v => v.unit_name),
    ['Unit 1', 'Unit 2', 'Unit 3']);
  assert.equal((await vehicles(ADMIN_A)).can_manage, true);
  // And a driver cannot reach either of the two through any single-vehicle
  // action, including their own once it is retired.
  await refusal(history(CLINICIAN_A, retired.vehicle.id), 'PENNSYNC_FLEET_VEHICLE_NOT_YOURS');
  await refusal(add(CLINICIAN_A, (await vehicles(ADMIN_A)).vehicles[1].id, 'e-1'),
    'PENNSYNC_FLEET_VEHICLE_NOT_YOURS');
  assert.ok(mine.vehicle.id);
});

test('a save refuses a version somebody else already moved', async () => {
  await clear();
  const made = await create(ADMIN_A, 'v-1');
  await refusal(update(ADMIN_A, made.vehicle.id, 7, GOOD_VEHICLE),
    'PENNSYNC_FLEET_VEHICLE_STALE');
  const saved = await update(ADMIN_A, made.vehicle.id, 1,
    { ...GOOD_VEHICLE, unit_name: 'Unit 12A', status: 'out_of_service' });
  assert.equal(saved.vehicle.unit_name, 'Unit 12A');
  assert.equal(saved.vehicle.status, 'out_of_service');
  assert.equal(Number(saved.vehicle.version), 2);
  await refusal(update(ADMIN_A, made.vehicle.id, 1, GOOD_VEHICLE),
    'PENNSYNC_FLEET_VEHICLE_STALE');
  await refusal(update(ADMIN_A, 'no-such-vehicle', 1, GOOD_VEHICLE),
    'PENNSYNC_FLEET_VEHICLE_NOT_FOUND');
});

test('the service log takes completed work, on a vehicle still in service', async () => {
  await clear();
  const made = await create(ADMIN_A, 'v-1',
    { ...GOOD_VEHICLE, assigned_user_id: base44Id(CLINICIAN_A) });
  const id = made.vehicle.id;
  const tomorrow = new Date(Date.now() + 172800000).toISOString().slice(0, 10);
  await refusal(add(CLINICIAN_A, id, 'e-x', { ...GOOD_ENTRY, service_date: tomorrow }),
    'PENNSYNC_FLEET_SERVICE_DATE_FUTURE');
  await refusal(add(CLINICIAN_A, id, 'e-x', { ...GOOD_ENTRY, next_due_date: '2026-08-01' }),
    'PENNSYNC_FLEET_NEXT_DATE_BEFORE');
  await refusal(add(CLINICIAN_A, id, 'e-x', { ...GOOD_ENTRY, next_due_odometer: 1 }),
    'PENNSYNC_FLEET_NEXT_ODOMETER_BEFORE');
  await refusal(add(CLINICIAN_A, id, 'e-x', { ...GOOD_ENTRY, service_type: 'detailing' }),
    'PENNSYNC_FLEET_FIELD_INVALID');
  await refusal(add(CLINICIAN_A, id, 'e-x', { ...GOOD_ENTRY, description: '' }),
    'PENNSYNC_FLEET_FIELD_INVALID');
  const entry = (await add(CLINICIAN_A, id, 'e-1')).entry;
  assert.equal(entry.service_type, 'oil_change');
  assert.equal(Number(entry.cost_cents), 8950);
  // The driver's entry is an employee's; an administrator's is an admin's.
  assert.equal(entry.entry_source, 'employee');
  assert.equal(entry.submitted_by_email, email(CLINICIAN_A));
  assert.equal(entry.review_status, 'pending');
  assert.deepEqual(entry.review_history, []);
  assert.equal((await add(ADMIN_A, id, 'e-2')).entry.entry_source, 'admin');
  // A resubmission is the same entry.
  assert.equal((await add(CLINICIAN_A, id, 'e-1')).deduplicated, true);
  assert.equal((await db.query(
    `select count(*)::int as n from ${SCHEMA}."fleet_service_entry"`)).rows[0].n, 2);
  // A retired vehicle keeps its history and takes no new work.
  await update(ADMIN_A, id, 1, { ...GOOD_VEHICLE, status: 'retired',
    assigned_user_id: base44Id(CLINICIAN_A) });
  await refusal(add(ADMIN_A, id, 'e-3'), 'PENNSYNC_FLEET_VEHICLE_RETIRED');
  assert.equal((await history(ADMIN_A, id)).entries.length, 2);
});

test('a review appends an immutable row and never rewrites the entry', async () => {
  // D32: `fleet_service_review` has a read and an insert policy and no update
  // or delete policy at all, and the original says why in its own words —
  // "concurrent administrators cannot erase each other".
  await clear();
  const vehicle = (await create(ADMIN_A, 'v-1')).vehicle;
  const entry = (await add(ADMIN_A, vehicle.id, 'e-1')).entry;
  await refusal(review(CLINICIAN_A, vehicle.id, entry.id, 'r-1', 0, 'reviewed', 'fine'),
    'PENNSYNC_FLEET_FORBIDDEN');
  await refusal(review(ADMIN_A, vehicle.id, entry.id, 'r-1', 0, 'approved', 'fine'),
    'PENNSYNC_FLEET_REVIEW_STATUS_INVALID');
  // `needs_follow_up` requires a note; `reviewed` does not.
  await refusal(review(ADMIN_A, vehicle.id, entry.id, 'r-1', 0, 'needs_follow_up', '  '),
    'PENNSYNC_FLEET_FIELD_INVALID');
  const first = await review(ADMIN_A, vehicle.id, entry.id, 'r-1', 0, 'reviewed', null);
  assert.equal(first.entry.review_history.length, 1);
  assert.equal(first.entry.review_status, 'reviewed', 'the latest event, not the stored column');
  // The stored column is untouched: the answer derives it.
  assert.equal((await db.query(
    `select "review_status","review_history" from ${SCHEMA}."fleet_service_entry"
     where "id" = $1`, [entry.id])).rows[0].review_status, 'pending');
  const second = await review(ADMIN_A, vehicle.id, entry.id, 'r-2', 1,
    'needs_follow_up', 'Brake wear, book it in.');
  assert.equal(second.entry.review_history.length, 2);
  assert.equal(second.entry.review_status, 'needs_follow_up');
  assert.deepEqual(second.entry.review_history.map(r => r.status),
    ['reviewed', 'needs_follow_up']);
  assert.equal(second.entry.review_history[1].reviewer_name, email(ADMIN_A));
  // A replayed review is the same review.
  assert.equal((await review(ADMIN_A, vehicle.id, entry.id, 'r-2', 1,
    'needs_follow_up', 'Brake wear, book it in.')).deduplicated, true);
  assert.equal((await db.query(
    `select count(*)::int as n from ${SCHEMA}."fleet_service_review"`)).rows[0].n, 2);
});

test('an omitted review request id is derived from the review itself', async () => {
  // The original digests the review's own content when the caller sends no
  // request id, so a double-submitted form is one annotation.
  await clear();
  const vehicle = (await create(ADMIN_A, 'v-1')).vehicle;
  const entry = (await add(ADMIN_A, vehicle.id, 'e-1')).entry;
  await review(ADMIN_A, vehicle.id, entry.id, null, 0, 'reviewed', 'Looks right.');
  const again = await review(ADMIN_A, vehicle.id, entry.id, null, 0, 'reviewed', 'Looks right.');
  assert.equal(again.deduplicated, true);
  assert.equal((await db.query(
    `select count(*)::int as n from ${SCHEMA}."fleet_service_review"`)).rows[0].n, 1);
  // A different note is a different review.
  await review(ADMIN_A, vehicle.id, entry.id, null, 1, 'reviewed', 'Second look.');
  assert.equal((await db.query(
    `select count(*)::int as n from ${SCHEMA}."fleet_service_review"`)).rows[0].n, 2);
});

test('a review count ahead of the history is refused, behind it is not', async () => {
  // The original's rule exactly: another administrator's annotation arriving
  // first does not invalidate yours, but claiming to have seen more than
  // exists does.
  await clear();
  const vehicle = (await create(ADMIN_A, 'v-1')).vehicle;
  const entry = (await add(ADMIN_A, vehicle.id, 'e-1')).entry;
  await refusal(review(ADMIN_A, vehicle.id, entry.id, 'r-1', 3, 'reviewed', null),
    'PENNSYNC_FLEET_REVIEW_STALE');
  await review(ADMIN_A, vehicle.id, entry.id, 'r-1', 0, 'reviewed', null);
  const behind = await review(ADMIN_A, vehicle.id, entry.id, 'r-2', 0, 'reviewed', 'Also fine.');
  assert.equal(behind.entry.review_history.length, 2);
});

test('the history page is a keyset the original had to fake', async () => {
  // The original runs up to three queries and re-sorts in JavaScript because
  // "The SDK supports one sort field". The cursor's shape is kept verbatim,
  // because already-published clients forward the opaque token.
  await clear();
  const vehicle = (await create(ADMIN_A, 'v-1')).vehicle;
  for (let i = 0; i < 55; i += 1) {
    const day = `2026-0${1 + Math.floor(i / 28)}-${String((i % 28) + 1).padStart(2, '0')}`;
    await add(ADMIN_A, vehicle.id, `e-${i}`, { ...GOOD_ENTRY, service_date: day,
      description: `Service ${i}` });
  }
  const first = await history(ADMIN_A, vehicle.id);
  assert.equal(first.entries.length, 50);
  assert.ok(first.next_cursor);
  assert.equal(first.next_offset, first.next_cursor, 'the compatibility alias the original keeps');
  assert.match(first.next_cursor, new RegExp(`^v1:${A}:${vehicle.id}:\\d{4}-\\d{2}-\\d{2}:`));
  // Newest first, and strictly descending on (service_date, id).
  const key = row => `${row.service_date}|${row.id}`;
  assert.deepEqual(first.entries.map(key), [...first.entries.map(key)].sort().reverse());
  const second = await history(ADMIN_A, vehicle.id, first.next_cursor);
  assert.equal(second.entries.length, 5);
  assert.equal(second.next_cursor, null);
  // No row appears on both pages, and together they are the whole log.
  const ids = new Set([...first.entries, ...second.entries].map(row => row.id));
  assert.equal(ids.size, 55);
  // A cursor for another vehicle, or a malformed one, is refused rather than
  // silently paging something else.
  await refusal(history(ADMIN_A, vehicle.id, `v1:${A}:other:2026-01-01:abc`),
    'PENNSYNC_FLEET_CURSOR_INVALID');
  await refusal(history(ADMIN_A, vehicle.id, 'v2:x:y:2026-01-01:abc'),
    'PENNSYNC_FLEET_CURSOR_INVALID');
  await refusal(history(ADMIN_A, vehicle.id, `v1:${A}:${vehicle.id}:2026-13-01:abc`),
    'PENNSYNC_FLEET_FIELD_INVALID');
});

test('the vehicle list pages by offset and says when there is more', async () => {
  await clear();
  for (let i = 0; i < 52; i += 1) {
    await create(ADMIN_A, `v-${i}`,
      { ...GOOD_VEHICLE, unit_name: `Unit ${String(i).padStart(3, '0')}` });
  }
  const first = await vehicles(ADMIN_A);
  assert.equal(first.vehicles.length, 50);
  assert.equal(first.next_offset, 50);
  assert.equal(first.vehicles[0].unit_name, 'Unit 000');
  const second = await vehicles(ADMIN_A, 50);
  assert.equal(second.vehicles.length, 2);
  assert.equal(second.next_offset, null);
  await refusal(vehicles(ADMIN_A, -1), 'PENNSYNC_FLEET_OFFSET_INVALID');
  await refusal(vehicles(ADMIN_A, 2000000), 'PENNSYNC_FLEET_OFFSET_INVALID');
});

test('an agency reaches none of another agency s fleet', async () => {
  await clear();
  await create(ADMIN_A, 'v-a');
  const theirs = await create(ADMIN_B, 'v-b', GOOD_VEHICLE, B);
  assert.equal((await vehicles(ADMIN_B, null, null, B)).vehicles.length, 1);
  await refusal(vehicles(ADMIN_A, null, null, B), 'PENNSYNC_FLEET_AGENCY_NOT_HELD');
  await refusal(create(ADMIN_A, 'v-x', GOOD_VEHICLE, B), 'PENNSYNC_FLEET_AGENCY_NOT_HELD');
  await refusal(history(ADMIN_A, theirs.vehicle.id), 'PENNSYNC_FLEET_VEHICLE_NOT_FOUND');
  await refusal(update(ADMIN_A, theirs.vehicle.id, 1, GOOD_VEHICLE),
    'PENNSYNC_FLEET_VEHICLE_NOT_FOUND');
});

test('the two actions this contract does not serve are served already', async () => {
  // `context` is `contract_tenant_memberships` (D34) and `staff` is
  // `contract_roster` (D22); the handler routes both. Read rather than
  // asserted, so that deleting either contract fails here.
  const source = readFileSync(resolve(repository, FLEET), 'utf8');
  for (const absent of ['contract_fleet_context', 'contract_fleet_staff']) {
    assert.equal(source.includes(absent), false, `${absent} should not exist`);
  }
  const handlers = readFileSync(
    resolve(repository, 'services/pennsync-api/handlers.mjs'), 'utf8');
  const body = handlers.slice(handlers.indexOf('manageVehicleMaintenance:'),
    handlers.indexOf('manageVehicleMaintenance:') + 2600);
  assert.match(body, /listMyTenantMemberships/);
  assert.match(body, /listAgencyRoster/);
});
