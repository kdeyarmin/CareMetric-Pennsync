import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ASSIGNABLE_ROLES, ASSIGNMENT_STATUSES, BACKFILL_CONTRACT, CARRIED_STATUS, LIMITS,
  RECONCILIATIONS, SKIPS, applyBackfill, main, normalizeEmail, planBackfill, readExport, summarize,
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
 * The largest of those, and the reason this file was rewritten: reading
 * `Patient.assigned_nurses` rather than `PatientCareTeamAssignment` would
 * resurrect access somebody revoked. The emails stay on the patient row after
 * the assignment built from them is suspended, so an email-sourced backfill
 * silently undoes a revocation. The first case below is that one.
 */
const ACTOR = '10000000-0000-4000-8000-000000000001';
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `6aac0000000000000000000${n}`;
const exported = (assignments, patients = []) =>
  JSON.stringify({ contract: BACKFILL_CONTRACT, app_id: APP, assignments, patients });
const roster = [
  { user_id: uid(1), email: 'nurse-a@example.invalid', agency_id: 'agency-a', membership_id: 'm-1', tenant_role: 'clinician', status: 'active' },
  { user_id: uid(1), email: 'nurse-a@example.invalid', agency_id: 'agency-b', membership_id: 'm-2', tenant_role: 'clinician', status: 'active' },
  { user_id: uid(2), email: 'social-a@example.invalid', agency_id: 'agency-a', membership_id: 'm-3', tenant_role: 'social_worker', status: 'active' },
  { user_id: uid(3), email: 'admin-a@example.invalid', agency_id: 'agency-a', membership_id: 'm-4', tenant_role: 'agency_admin', status: 'active' },
  { user_id: uid(4), email: 'office-a@example.invalid', agency_id: 'agency-a', membership_id: 'm-5', tenant_role: 'office_staff', status: 'active' },
  { user_id: uid(5), email: 'left-a@example.invalid', agency_id: 'agency-a', membership_id: 'm-6', tenant_role: 'clinician', status: 'revoked' },
];
const assign = (patient, user, status = 'active', agency = 'agency-a') =>
  ({ agency_id: agency, patient_id: patient, user_id: user, status });
const plan = (assignments, patients = [], existing = []) =>
  planBackfill(readExport(exported(assignments, patients)), roster, existing);
const reasons = result => Object.fromEntries(
  Object.entries(summarize(result).reasons).filter(([, count]) => count > 0));

test('an assignment somebody suspended or revoked is never resurrected', () => {
  // The whole reason this reads `PatientCareTeamAssignment` and not
  // `assigned_nurses`: the email stays on the patient row after the assignment
  // built from it is suspended, so an email-sourced backfill undoes the
  // revocation silently. Here the decision is visible and is honoured.
  const result = plan(
    [assign('p-1', uid(1), 'suspended'), assign('p-2', uid(1), 'revoked')],
    // ...and the addresses are STILL on both patient rows, as they would be.
    [{ id: 'p-1', agency_id: 'agency-a', assigned_nurses: ['nurse-a@example.invalid'] },
      { id: 'p-2', agency_id: 'agency-a', assigned_nurses: ['nurse-a@example.invalid'] }]);
  assert.deepEqual(result.grants, [], 'neither may be carried');
  assert.deepEqual(reasons(result), { status_not_active: 2 });
  // They are reported as reconciliations rather than silently dropped, so an
  // operator sees the addresses that no longer have a live assignment.
  assert.equal(result.reconcile.length, 2);
  assert.deepEqual([...new Set(result.reconcile.map(entry => entry.reason))], [...RECONCILIATIONS]);
  assert.equal(CARRIED_STATUS, 'active');
  assert.deepEqual([...ASSIGNMENT_STATUSES], ['active', 'suspended', 'revoked']);
});

test('an active assignment carries, resolved by user id rather than by address', () => {
  const result = plan([assign('p-3', uid(1))]);
  assert.deepEqual(result.grants, [{ app_id: APP, agency_id: 'agency-a', patient_id: 'p-3', membership_id: 'm-1' }]);
  assert.deepEqual(result.skipped, []);
  // The same person, the same id, a patient in the OTHER agency they work for
  // — and the membership carried is that agency's, never the first found.
  assert.equal(plan([assign('p-4', uid(1), 'active', 'agency-b')]).grants[0].membership_id, 'm-2');
});

test('a nurse never acquires a chart from an agency that did not assign it', () => {
  const result = plan([assign('p-5', uid(1), 'active', 'agency-c')]);
  assert.deepEqual(result.grants, []);
  assert.deepEqual(reasons(result), { not_in_assignment_agency: 1 });
});

test('every ambiguity resolves to dropping the row, and says which', () => {
  const result = plan([
    assign('p-6', '6aac0000000000000000ffff'), // no identity in this deployment
    assign('p-6', uid(3)),                     // real, but a role that does not open charts
    assign('p-6', uid(4)),                     // likewise
    assign('p-6', uid(5)),                     // assignable role, but the membership is revoked
  ]);
  assert.deepEqual(result.grants, []);
  assert.deepEqual(reasons(result), { user_unknown: 1, role_not_assignable: 2, membership_revoked: 1 });
  // Every reason the tool can give is one the summary counts, so a new kind of
  // drop cannot be reported as nothing.
  assert.deepEqual([...SKIPS].sort(), Object.keys(summarize(result).reasons).sort());
});

test('an assignment already in the store is left exactly as it is', () => {
  const existing = [{ patient_id: 'p-7', membership_id: 'm-1', status: 'revoked' }];
  const result = plan([assign('p-7', uid(1))], [], existing);
  assert.deepEqual(result.grants, []);
  assert.deepEqual(reasons(result), { already_recorded: 1 });
});

test('the roles it carries are the ones the record store honours', () => {
  assert.deepEqual([...ASSIGNABLE_ROLES], ['clinician', 'social_worker', 'spiritual_care']);
  const result = plan([assign('p-8', uid(1)), assign('p-8', uid(2))]);
  assert.deepEqual(result.grants.map(grant => grant.membership_id), ['m-1', 'm-3']);
});

test('assigned_nurses is reconciled and never granted', () => {
  // An address with no assignment behind it at all. It is the earlier
  // in-Base44 migration's gap — or an assignment revoked since — and this tool
  // cannot tell those apart, so it names the pair and grants nothing.
  const orphan = plan([], [{ id: 'p-9', agency_id: 'agency-a',
    assigned_nurses: ['nurse-a@example.invalid'] }]);
  assert.deepEqual(orphan.grants, [], 'an address alone never becomes access');
  assert.deepEqual(orphan.reconcile, [{ patient_id: 'p-9', agency_id: 'agency-a',
    reason: 'nurse_without_active_assignment' }]);
  // An address whose assignment DID carry is not a finding: the two agree.
  const agreed = plan([assign('p-10', uid(1))],
    [{ id: 'p-10', agency_id: 'agency-a', assigned_nurses: ['nurse-a@example.invalid'] }]);
  assert.equal(agreed.grants.length, 1);
  assert.deepEqual(agreed.reconcile, []);
  // Nor is one whose assignment the store already holds.
  const held = plan([], [{ id: 'p-11', agency_id: 'agency-a', assigned_nurses: ['nurse-a@example.invalid'] }],
    [{ patient_id: 'p-11', membership_id: 'm-1', status: 'active' }]);
  assert.deepEqual(held.reconcile, []);
  // An address nobody in this deployment has is still only a finding.
  const stranger = plan([], [{ id: 'p-12', agency_id: 'agency-a', assigned_nurses: ['gone@example.invalid'] }]);
  assert.deepEqual(stranger.grants, []);
  assert.equal(stranger.reconcile.length, 1);
  assert.equal(normalizeEmail('  NURSE-A@Example.Invalid '), 'nurse-a@example.invalid');
});

test('a malformed export fails the run rather than carrying the rows that parsed', () => {
  const refuses = (assignments, code, patients = []) =>
    assert.throws(() => readExport(exported(assignments, patients)), error => error?.code === code, code);
  refuses([{ patient_id: 'p', user_id: uid(1), status: 'active' }], 'BACKFILL_ASSIGNMENT_AGENCY_INVALID');
  refuses([{ agency_id: 'a', user_id: uid(1), status: 'active' }], 'BACKFILL_ASSIGNMENT_PATIENT_INVALID');
  refuses([{ agency_id: 'a', patient_id: 'p', status: 'active' }], 'BACKFILL_ASSIGNMENT_USER_INVALID');
  // An email where a user id belongs — the substitution the entity's own
  // schema says never to make.
  refuses([{ agency_id: 'a', patient_id: 'p', user_id: 'nurse-a@example.invalid', status: 'active' }],
    'BACKFILL_ASSIGNMENT_USER_INVALID');
  for (const status of [undefined, null, '', 'pending', 'ACTIVE']) {
    refuses([{ agency_id: 'a', patient_id: 'p', user_id: uid(1), status }], 'BACKFILL_ASSIGNMENT_STATUS_INVALID');
  }
  refuses([], 'BACKFILL_NURSE_ADDRESS_INVALID', [{ id: 'p', agency_id: 'a', assigned_nurses: ['not an address'] }]);
  refuses([], 'BACKFILL_PATIENT_AGENCY_INVALID', [{ id: 'p', assigned_nurses: [] }]);
  assert.throws(() => readExport('{'), error => error?.code === 'BACKFILL_EXPORT_INVALID_JSON');
  assert.throws(() => readExport(JSON.stringify({ contract: 'other', app_id: APP, assignments: [] })),
    error => error?.code === 'BACKFILL_EXPORT_UNSUPPORTED');
  // A v1 export is refused by name: it carried `assigned_nurses` as authority,
  // and silently reading it under the new rules would grant from the wrong
  // source — which is the defect this contract version exists to mark.
  assert.throws(() => readExport(JSON.stringify({
    contract: 'cm.pennsync.assignment-backfill.v1', app_id: APP, patients: [] })),
  error => error?.code === 'BACKFILL_EXPORT_UNSUPPORTED');
  // An export with neither list is not malformed; it is a deployment with no
  // care teams, which the run reports as nothing to do.
  assert.deepEqual(readExport(JSON.stringify({ contract: BACKFILL_CONTRACT, app_id: APP })),
    { app_id: APP, assignments: [], patients: [] });
});

test('the report an operator reads carries counts, never a person or a patient', () => {
  const result = plan(
    [assign('p-13', uid(1)), assign('p-13', uid(3)), assign('p-14', uid(2))],
    [{ id: 'p-15', agency_id: 'agency-a', assigned_nurses: ['nurse-a@example.invalid'] }]);
  const report = summarize(result);
  assert.equal(report.grants, 2);
  assert.equal(report.patients, 2);
  assert.equal(report.agencies, 1);
  assert.equal(report.skipped, 1);
  assert.equal(report.reconcile, 1);
  const text = JSON.stringify(report);
  for (const secret of ['nurse-a', 'social-a', 'admin-a', 'p-13', 'p-14', 'p-15', 'example.invalid', uid(1)]) {
    assert.ok(!text.includes(secret), `the report must not carry ${secret}`);
  }
});

test('applying writes only what was reviewed, under the lock, or nothing', async () => {
  const statements = [];
  const execute = async (sql, params) => {
    statements.push([sql.trim().split(/\s+/).slice(0, 2).join(' '), params]);
    return { rows: sql.includes('insert') ? [{ patient_id: 'x' }] : [] };
  };
  const result = plan([assign('p-16', uid(1))]);
  assert.deepEqual(await applyBackfill(execute, result, { actorId: ACTOR, expectedDigest: result.digest }),
    { applied: 1 });
  assert.deepEqual(statements.map(entry => entry[0]),
    ['begin', 'select pg_advisory_xact_lock($1,$2)', 'insert into', 'commit']);
  // The row is written 'active' and attributed to the operator, never to the
  // clinician it is about. And into the PRODUCTION table, not the staging one.
  assert.equal(statements[2][1][4], ACTOR);
  assert.ok(statements.some(entry => String(entry[0]).includes('insert')));

  await assert.rejects(() => applyBackfill(execute, result, { actorId: ACTOR, expectedDigest: 'stale' }),
    error => error?.code === 'BACKFILL_PLAN_CHANGED');
  for (const actorId of [null, '', 'not-a-uuid', 42]) {
    await assert.rejects(() => applyBackfill(execute, result, { actorId, expectedDigest: result.digest }),
      error => error?.code === 'BACKFILL_ACTOR_INVALID');
  }
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
  const lines = [];
  const read = async () => exported(
    [assign('p-17', uid(1)), assign('p-17', uid(1), 'revoked')],
    [{ id: 'p-17', agency_id: 'agency-a', assigned_nurses: ['nurse-a@example.invalid'] }]);
  assert.equal(await main(['export.json'], { log: line => lines.push(line), read }), 0);
  const printed = JSON.parse(lines.join('\n'));
  assert.deepEqual(printed, { contract: BACKFILL_CONTRACT, app_id: APP,
    assignments: 2, active: 1, patients: 1, addresses: 1 });
  assert.equal(await main([], { log: line => lines.push(line), read }), 2);
  assert.equal(await main(['bad.json'], { log: line => lines.push(line), read: async () => '{' }), 1);
  assert.match(lines.at(-1), /BACKFILL_EXPORT_INVALID_JSON/);
  for (const secret of ['nurse-a', 'p-17', uid(1)]) assert.ok(!lines.join('\n').includes(secret));
});

test('the limits are real, so a runaway export is refused rather than read', () => {
  assert.ok(LIMITS.assignments >= 1000 && LIMITS.nursesPerPatient >= 10);
  const many = Array.from({ length: LIMITS.nursesPerPatient + 1 }, (_, n) => `n${n}@example.invalid`);
  assert.throws(() => readExport(exported([], [{ id: 'p', agency_id: 'a', assigned_nurses: many }])),
    error => error?.code === 'BACKFILL_NURSES_INVALID');
});
