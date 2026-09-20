import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ASSIGNABLE_ROLES, BACKFILL_CONTRACT, LIMITS, SKIPS, applyBackfill, main,
  normalizeEmail, planBackfill, readExport, summarize,
} from './tools-pennsync-assignment-backfill.mjs';

/**
 * Almost every case here is a row that is NOT carried.
 *
 * D21 recorded the asymmetry this tool is built around and it decides what is
 * worth testing: a dropped assignment is a support ticket — somebody says they
 * cannot see a patient and an administrator grants them — while an INVENTED
 * one is a disclosure nobody reports, because nothing looks wrong to the
 * person who now has access they should not.
 *
 * So the tests that matter are the ones proving a nurse does not acquire a
 * chart: through an address the store does not know, through a membership in
 * another agency, through a role that does not open charts, through a
 * membership that was revoked, and through an assignment somebody already
 * withdrew.
 */
const ACTOR = '10000000-0000-4000-8000-000000000001';
const APP = '6a9881683dc68a0bd54f1ef7';
const exported = (patients) => JSON.stringify({ contract: BACKFILL_CONTRACT, app_id: APP, patients });
const roster = [
  { email: 'nurse-a@example.invalid', agency_id: 'agency-a', membership_id: 'm-1', tenant_role: 'clinician', status: 'active' },
  { email: 'nurse-a@example.invalid', agency_id: 'agency-b', membership_id: 'm-2', tenant_role: 'clinician', status: 'active' },
  { email: 'social-a@example.invalid', agency_id: 'agency-a', membership_id: 'm-3', tenant_role: 'social_worker', status: 'active' },
  { email: 'admin-a@example.invalid', agency_id: 'agency-a', membership_id: 'm-4', tenant_role: 'agency_admin', status: 'active' },
  { email: 'office-a@example.invalid', agency_id: 'agency-a', membership_id: 'm-5', tenant_role: 'office_staff', status: 'active' },
  { email: 'left-a@example.invalid', agency_id: 'agency-a', membership_id: 'm-6', tenant_role: 'clinician', status: 'revoked' },
];
const plan = (patients, existing = []) => planBackfill(readExport(exported(patients)), roster, existing);
const reasons = result => Object.fromEntries(
  Object.entries(summarize(result).reasons).filter(([, count]) => count > 0));

test('an assignment is carried only when the store resolves it exactly', () => {
  const result = plan([{ id: 'p-1', agency_id: 'agency-a', assigned_nurses: ['nurse-a@example.invalid'] }]);
  assert.deepEqual(result.grants, [{ app_id: APP, agency_id: 'agency-a', patient_id: 'p-1', membership_id: 'm-1' }]);
  assert.deepEqual(result.skipped, []);
  // The same address, the same person, a patient in the OTHER agency they work
  // for — and the membership carried is that agency's, never the first found.
  const other = plan([{ id: 'p-2', agency_id: 'agency-b', assigned_nurses: ['nurse-a@example.invalid'] }]);
  assert.equal(other.grants[0].membership_id, 'm-2');
});

test('a nurse never acquires a chart from an agency that did not assign it', () => {
  // The defect this refuses: a nurse working for two agencies has two
  // memberships, and carrying the assignment into the wrong one hands them a
  // chart nobody gave them.
  const result = plan([{ id: 'p-3', agency_id: 'agency-c', assigned_nurses: ['nurse-a@example.invalid'] }]);
  assert.deepEqual(result.grants, []);
  assert.deepEqual(reasons(result), { not_in_patient_agency: 1 });
});

test('every ambiguity resolves to dropping the row, and says which', () => {
  const result = plan([{ id: 'p-4', agency_id: 'agency-a', assigned_nurses: [
    'nobody@example.invalid',     // no identity in this deployment
    'admin-a@example.invalid',    // real, but a role that does not open charts
    'office-a@example.invalid',   // likewise
    'left-a@example.invalid',     // real and assignable, but the membership is revoked
  ] }]);
  assert.deepEqual(result.grants, []);
  assert.deepEqual(reasons(result), {
    address_unknown: 1, role_not_assignable: 2, membership_revoked: 1,
  });
  // Every reason the tool can give is one the summary counts, so a new kind of
  // drop cannot be reported as nothing.
  assert.deepEqual([...SKIPS].sort(), Object.keys(summarize(result).reasons).sort());
});

test('an assignment somebody withdrew is not re-granted', () => {
  // `assigned_nurses` cannot tell "never assigned" from "access deliberately
  // withdrawn", so a row already in the store is left exactly as it is — in
  // ANY status. Re-granting a revoked assignment is the invented row arriving
  // by another route.
  const existing = [{ patient_id: 'p-5', membership_id: 'm-1', status: 'revoked' }];
  const result = plan([{ id: 'p-5', agency_id: 'agency-a', assigned_nurses: ['nurse-a@example.invalid'] }], existing);
  assert.deepEqual(result.grants, []);
  assert.deepEqual(reasons(result), { already_recorded: 1 });
});

test('the roles it carries are the ones the record store honours', () => {
  // A list that drifted from `caller_assigned_patients` would write rows that
  // grant nothing, or refuse rows that would have.
  assert.deepEqual([...ASSIGNABLE_ROLES], ['clinician', 'social_worker', 'spiritual_care']);
  const result = plan([{ id: 'p-6', agency_id: 'agency-a',
    assigned_nurses: ['nurse-a@example.invalid', 'social-a@example.invalid'] }]);
  assert.deepEqual(result.grants.map(grant => grant.membership_id), ['m-1', 'm-3']);
});

test('an address is matched the way the store stores it, and no further', () => {
  // The store's own CHECK is `expected_email = lower(btrim(...))`, so this
  // does exactly that. Anything more — stripping dots, ignoring a plus-suffix
  // — would match addresses the store considers different, which is how an
  // assignment lands on the wrong person.
  assert.equal(normalizeEmail('  NURSE-A@Example.Invalid '), 'nurse-a@example.invalid');
  const result = plan([{ id: 'p-7', agency_id: 'agency-a',
    assigned_nurses: ['  NURSE-A@Example.Invalid ', 'nurse-a@example.invalid'] }]);
  assert.equal(result.grants.length, 1, 'the same address twice is one assignment');
  for (const near of ['nursea@example.invalid', 'nurse-a+shift@example.invalid', 'nurse-a@example.invalid.uk']) {
    const miss = plan([{ id: 'p-8', agency_id: 'agency-a', assigned_nurses: [near] }]);
    assert.deepEqual(miss.grants, [], `${near} must not resolve to nurse-a`);
  }
});

test('a malformed export fails the run rather than carrying the rows that parsed', () => {
  const refuses = (patients, code) => assert.throws(() => readExport(exported(patients)),
    error => error?.code === code, code);
  refuses([{ id: 'p-9', assigned_nurses: [] }], 'BACKFILL_PATIENT_AGENCY_INVALID');
  refuses([{ id: 'p-9', agency_id: '', assigned_nurses: [] }], 'BACKFILL_PATIENT_AGENCY_INVALID');
  refuses([{ agency_id: 'agency-a', assigned_nurses: [] }], 'BACKFILL_PATIENT_ID_INVALID');
  for (const entry of [null, 42, {}, '', 'not an address', 'a@b c']) {
    refuses([{ id: 'p-9', agency_id: 'agency-a', assigned_nurses: [entry] }], 'BACKFILL_NURSE_ADDRESS_INVALID');
  }
  refuses([{ id: 'p-9', agency_id: 'agency-a', assigned_nurses: 'nurse-a@example.invalid' }],
    'BACKFILL_NURSES_INVALID');
  assert.throws(() => readExport('{'), error => error?.code === 'BACKFILL_EXPORT_INVALID_JSON');
  assert.throws(() => readExport(JSON.stringify({ contract: 'other', app_id: APP, patients: [] })),
    error => error?.code === 'BACKFILL_EXPORT_UNSUPPORTED');
  assert.throws(() => readExport(JSON.stringify({ contract: BACKFILL_CONTRACT, app_id: 'nope', patients: [] })),
    error => error?.code === 'BACKFILL_EXPORT_APP_INVALID');
  // A patient with no nurses at all is not malformed; it is a patient nobody
  // is assigned to, which is the commonest row in the export.
  assert.deepEqual(readExport(exported([{ id: 'p-9', agency_id: 'agency-a' }])).patients[0].addresses, []);
});

test('the report an operator reads carries counts, never a person or a patient', () => {
  const result = plan([
    { id: 'p-10', agency_id: 'agency-a', assigned_nurses: ['nurse-a@example.invalid', 'nobody@example.invalid'] },
    { id: 'p-11', agency_id: 'agency-a', assigned_nurses: ['social-a@example.invalid'] },
  ]);
  const report = summarize(result);
  assert.equal(report.grants, 2);
  assert.equal(report.patients, 2);
  assert.equal(report.agencies, 1);
  assert.equal(report.skipped, 1);
  const text = JSON.stringify(report);
  for (const secret of ['nurse-a', 'nobody', 'social-a', 'p-10', 'p-11', 'example.invalid']) {
    assert.ok(!text.includes(secret), `the report must not carry ${secret}`);
  }
});

test('applying writes only what was reviewed, under the lock, or nothing', async () => {
  const statements = [];
  const execute = async (sql, params) => {
    statements.push([sql.trim().split(/\s+/).slice(0, 2).join(' '), params]);
    return { rows: sql.includes('insert') ? [{ patient_id: 'x' }] : [] };
  };
  const result = plan([{ id: 'p-12', agency_id: 'agency-a', assigned_nurses: ['nurse-a@example.invalid'] }]);
  assert.deepEqual(await applyBackfill(execute, result, { actorId: ACTOR, expectedDigest: result.digest }),
    { applied: 1 });
  assert.deepEqual(statements.map(entry => entry[0]),
    ['begin', 'select pg_advisory_xact_lock($1,$2)', 'insert into', 'commit']);
  // The row is written 'active' and attributed to the operator, never to the
  // nurse it is about.
  assert.equal(statements[2][1][4], ACTOR);

  // A plan regenerated against a store that changed in between has a different
  // digest, and is refused rather than applied: what was reviewed is what runs.
  await assert.rejects(() => applyBackfill(execute, result, { actorId: ACTOR, expectedDigest: 'stale' }),
    error => error?.code === 'BACKFILL_PLAN_CHANGED');
  for (const actorId of [null, '', 'not-a-uuid', 42]) {
    await assert.rejects(() => applyBackfill(execute, result, { actorId, expectedDigest: result.digest }),
      error => error?.code === 'BACKFILL_ACTOR_INVALID');
  }
  // A failure rolls back rather than leaving half a care team in place.
  const rolled = [];
  const failing = async (sql) => {
    rolled.push(sql.trim().split(/\s+/)[0]);
    if (sql.includes('insert')) throw new Error('constraint');
    return { rows: [] };
  };
  await assert.rejects(() => applyBackfill(failing, result, { actorId: ACTOR, expectedDigest: result.digest }),
    error => error?.code === 'BACKFILL_APPLY_FAILED');
  assert.ok(rolled.includes('rollback'));
});

test('the command line plans and cannot write', async () => {
  // A tool that can write to a production authority store by being run with
  // one argument is one nobody should have on their path.
  const lines = [];
  const read = async () => exported([{ id: 'p-13', agency_id: 'agency-a',
    assigned_nurses: ['nurse-a@example.invalid'] }]);
  assert.equal(await main(['export.json'], { log: line => lines.push(line), read }), 0);
  const printed = JSON.parse(lines.join('\n'));
  assert.deepEqual(printed, { contract: BACKFILL_CONTRACT, app_id: APP, patients: 1, addresses: 1 });
  assert.equal(await main([], { log: line => lines.push(line), read }), 2);
  assert.equal(await main(['a', 'b'], { log: line => lines.push(line), read }), 2);
  assert.equal(await main(['bad.json'], { log: line => lines.push(line),
    read: async () => '{' }), 1);
  assert.match(lines.at(-1), /BACKFILL_EXPORT_INVALID_JSON/);
  // Nothing it prints carries an address or a patient id.
  assert.ok(!lines.join('\n').includes('nurse-a'));
  assert.ok(!lines.join('\n').includes('p-13'));
});

test('the limits are real, so a runaway export is refused rather than read', () => {
  assert.ok(LIMITS.patients >= 1000 && LIMITS.nursesPerPatient >= 10);
  const many = Array.from({ length: LIMITS.nursesPerPatient + 1 }, (_, n) => `n${n}@example.invalid`);
  assert.throws(() => readExport(exported([{ id: 'p-14', agency_id: 'agency-a', assigned_nurses: many }])),
    error => error?.code === 'BACKFILL_NURSES_INVALID');
});
