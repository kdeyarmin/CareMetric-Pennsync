import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { PGlite } from '@electric-sql/pglite';
import { applyEnrollmentPlan, ENROLLMENT_CONTRACT } from '../../../tools-pennsync-enroll.mjs';

/**
 * Enrollment against a real database, which is where most of it is decided.
 *
 * D6 says identity moves by re-enrollment and never by credential copy, so this
 * tool is the only path a person's identity takes into the owned store. The
 * offline suite holds the plan boundary; this holds the parts only the database
 * can answer: that the native account already exists and belongs to the person
 * named, that the deployment being written to is the one the plan is for, that
 * an identity already recorded cannot be quietly restated, and that a run either
 * lands whole or leaves nothing.
 *
 * It also proves the point of the deployment pin: the same tool, the same plan
 * shape, enrolls a production identity into a production-pinned database and is
 * refused by the staging one. Before that migration neither was possible.
 */
const sha = value => createHash('sha256').update(value).digest('hex');
const STAGING_APP = '6a9881683dc68a0bd54f1ef7';
const PRODUCTION_APP = '694ec16e72e01b60d22f7cbf';
const EVIDENCE = new Map();
const uuid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const base44 = n => `${'a'.repeat(24 - String(n).length)}${n}`;
const email = n => `person${n}@example.test`;

function evidence(n) {
  const bytes = `operator verification record for person ${n}\n`;
  EVIDENCE.set(`evidence/person-${n}.txt`, bytes);
  return { path: `evidence/person-${n}.txt`, sha256: sha(bytes) };
}
const readEvidence = path => {
  const bytes = EVIDENCE.get(path);
  if (bytes === undefined) throw new Error('no such evidence');
  return Readable.from([Buffer.from(bytes)]);
};

function person(n, { agency = 'agency-a', role = 'clinician' } = {}) {
  const proof = evidence(n);
  return {
    auth_user_id: uuid(n), base44_user_id: base44(n), expected_email: email(n),
    evidence_path: proof.path, evidence_sha256: proof.sha256,
    memberships: [{ id: `membership-${n}`, agency_id: agency, tenant_role: role }],
  };
}

function makePlan({ app = STAGING_APP, agencies, enrollments }) {
  const raw = JSON.stringify({
    contract: ENROLLMENT_CONTRACT,
    app_id: app,
    agencies,
    enrollments,
  });
  return { rawPlan: raw, expectedPlanSha256: sha(raw), readEvidence };
}
const AGENCY_A = { id: 'agency-a', name: 'Synthetic Agency A', status: 'active' };

async function deploy(requestedApp) {
  const db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  if (requestedApp) {
    await db.query('select set_config($1,$2,false)', ['pennsync.deployment_app_id', requestedApp]);
  }
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(n => n.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  }
  return db;
}

const native = (db, n, patch = {}) => {
  const row = { confirmed: 'clock_timestamp()', banned: null, deleted: null, anonymous: false,
    address: email(n), ...patch };
  return db.query(`insert into auth.users (id, email, email_confirmed_at, banned_until, deleted_at, is_anonymous)
    values ($1, $2, ${row.confirmed}, $3, $4, $5)`, [uuid(n), row.address, row.banned, row.deleted, row.anonymous]);
};

async function refuses(db, plan, code) {
  const error = await applyEnrollmentPlan({ db, ...plan }).then(() => null, cause => cause);
  assert.ok(error, `expected ${code}, but the plan applied`);
  assert.equal(error.code, code);
}

let staging, production;
before(async () => { staging = await deploy(); production = await deploy(PRODUCTION_APP); });
after(async () => { await staging?.close(); await production?.close(); });

test('a verified plan writes the agency, the identity and the membership together', async () => {
  await native(staging, 1);
  const plan = makePlan({ agencies: [AGENCY_A], enrollments: [person(1)] });
  const receipt = await applyEnrollmentPlan({ db: staging, ...plan });
  assert.equal(receipt.contract, ENROLLMENT_CONTRACT);
  assert.equal(receipt.app_id, STAGING_APP);
  assert.equal(receipt.plan_sha256, plan.expectedPlanSha256);
  assert.deepEqual({ ...receipt.created }, { agencies: 1, identities: 1, memberships: 1 });
  assert.deepEqual({ ...receipt.planned }, { agencies: 1, identities: 1, memberships: 1 });

  const identity = (await staging.query(`select base44_user_id, expected_email, source_evidence_sha256,
    enabled, revoked_at, version::int from pennsync_private.identity_map where app_id=$1`, [STAGING_APP])).rows;
  assert.equal(identity.length, 1);
  assert.equal(identity[0].base44_user_id, base44(1));
  assert.equal(identity[0].expected_email, email(1));
  // The digest stored is the one this run computed from the bytes it read.
  assert.equal(identity[0].source_evidence_sha256, sha(EVIDENCE.get('evidence/person-1.txt')));
  assert.deepEqual([identity[0].enabled, identity[0].revoked_at, identity[0].version], [true, null, 1]);

  const membership = (await staging.query(`select id, agency_id, tenant_role, status
    from pennsync_private.membership where app_id=$1`, [STAGING_APP])).rows;
  assert.deepEqual(membership, [{ id: 'membership-1', agency_id: 'agency-a', tenant_role: 'clinician', status: 'active' }]);

  const stored = (await staging.query(`select plan_sha256, projection_sha256, identity_count, agency_count,
    membership_count, operator_role from pennsync_private.enrollment_receipt where app_id=$1`, [STAGING_APP])).rows;
  assert.equal(stored.length, 1);
  assert.equal(stored[0].plan_sha256, plan.expectedPlanSha256);
  assert.equal(stored[0].projection_sha256, receipt.projection_sha256);
  assert.deepEqual([stored[0].identity_count, stored[0].agency_count, stored[0].membership_count], [1, 1, 1]);
  assert.equal(stored[0].operator_role, receipt.operator_role);
});

test('the same plan cannot be applied twice, and the receipt cannot be erased', async () => {
  const plan = makePlan({ agencies: [AGENCY_A], enrollments: [person(1)] });
  await refuses(staging, plan, 'ENROLL_PLAN_ALREADY_APPLIED');
  for (const statement of ['update pennsync_private.enrollment_receipt set identity_count = 99',
    'delete from pennsync_private.enrollment_receipt', 'truncate pennsync_private.enrollment_receipt']) {
    await assert.rejects(staging.exec(statement), /PENNSYNC_APPEND_ONLY_ENROLLMENT_RECEIPT/, statement);
  }
});

test('a later plan adds people without disturbing the ones already enrolled', async () => {
  await native(staging, 2);
  const plan = makePlan({ agencies: [AGENCY_A],
    enrollments: [person(1), person(2, { role: 'agency_admin' })] });
  const receipt = await applyEnrollmentPlan({ db: staging, ...plan });
  // Person 1 and the agency were already correct, so this run created neither.
  assert.deepEqual({ ...receipt.created }, { agencies: 0, identities: 1, memberships: 1 });
  assert.deepEqual({ ...receipt.planned }, { agencies: 1, identities: 2, memberships: 2 });
  const versions = (await staging.query(
    'select version::int from pennsync_private.identity_map where app_id=$1 order by base44_user_id', [STAGING_APP])).rows;
  assert.deepEqual(versions, [{ version: 1 }, { version: 1 }], 'an existing identity must not be rewritten');
});

test('a plan that contradicts the record is refused rather than reconciled', async () => {
  // Identity provenance is immutable by trigger, so there is no version of this
  // the tool could apply: a differing plan is a plan about a different person.
  const changed = person(1);
  await refuses(staging, makePlan({ agencies: [AGENCY_A],
    enrollments: [{ ...changed, evidence_sha256: sha('different corroboration') }] }), 'ENROLL_EVIDENCE_MISMATCH');
  EVIDENCE.set('evidence/person-1.txt', 'a different operator record\n');
  await refuses(staging, makePlan({ agencies: [AGENCY_A],
    enrollments: [{ ...changed, evidence_sha256: sha('a different operator record\n') }] }), 'ENROLL_IDENTITY_CONFLICT');
  EVIDENCE.set('evidence/person-1.txt', 'operator verification record for person 1\n');

  await refuses(staging, makePlan({ agencies: [{ ...AGENCY_A, name: 'Synthetic Agency Renamed' }],
    enrollments: [person(1)] }), 'ENROLL_AGENCY_CONFLICT');
  await refuses(staging, makePlan({ agencies: [AGENCY_A],
    enrollments: [person(1, { role: 'manager' })] }), 'ENROLL_MEMBERSHIP_CONFLICT');

  // A second native account claiming an address or legacy id already mapped.
  await native(staging, 3, { address: email(1) });
  await refuses(staging, makePlan({ agencies: [AGENCY_A],
    enrollments: [{ ...person(3), expected_email: email(1) }] }), 'ENROLL_IDENTITY_CLAIMED');
});

test('the native account must already exist and belong to the person named', async () => {
  const plan = n => makePlan({ agencies: [AGENCY_A], enrollments: [person(n)] });
  await refuses(staging, plan(10), 'ENROLL_NATIVE_IDENTITY_UNAVAILABLE');
  await native(staging, 11, { confirmed: 'null' });
  await refuses(staging, plan(11), 'ENROLL_NATIVE_IDENTITY_UNAVAILABLE');
  await native(staging, 12, { banned: new Date(Date.now() + 3600_000).toISOString() });
  await refuses(staging, plan(12), 'ENROLL_NATIVE_IDENTITY_UNAVAILABLE');
  await native(staging, 13, { deleted: new Date().toISOString() });
  await refuses(staging, plan(13), 'ENROLL_NATIVE_IDENTITY_UNAVAILABLE');
  await native(staging, 14, { anonymous: true });
  await refuses(staging, plan(14), 'ENROLL_NATIVE_IDENTITY_UNAVAILABLE');
  // Present and healthy, but the invitation went to a different address.
  await native(staging, 15, { address: 'someone.else@example.test' });
  await refuses(staging, plan(15), 'ENROLL_NATIVE_EMAIL_MISMATCH');
  assert.equal((await staging.query('select count(*)::int n from pennsync_private.identity_map')).rows[0].n, 2,
    'no refused run may leave an identity behind');
});

test('a run that fails partway leaves nothing behind', async () => {
  await native(staging, 20);
  // Person 21 has no native account, so the run fails after person 20's rows
  // have been written inside the transaction.
  await refuses(staging, makePlan({ agencies: [{ id: 'agency-r', name: 'Synthetic Agency R', status: 'trial' }],
    enrollments: [person(20, { agency: 'agency-r' }), person(21, { agency: 'agency-r' })] }),
  'ENROLL_NATIVE_IDENTITY_UNAVAILABLE');
  const left = await staging.query(`select
    (select count(*)::int from pennsync_private.agency where id='agency-r') agencies,
    (select count(*)::int from pennsync_private.identity_map where base44_user_id=$1) identities,
    (select count(*)::int from pennsync_private.membership where agency_id='agency-r') memberships,
    (select count(*)::int from pennsync_private.enrollment_receipt) receipts`, [base44(20)]);
  assert.deepEqual(left.rows[0], { agencies: 0, identities: 0, memberships: 0, receipts: 2 });
});

test('enrollment is refused into a deployment the plan is not for', async () => {
  await native(staging, 30);
  await refuses(staging, makePlan({ app: PRODUCTION_APP, agencies: [AGENCY_A], enrollments: [person(30)] }),
    'ENROLL_DEPLOYMENT_MISMATCH');
  await native(production, 31);
  await refuses(production, makePlan({ app: STAGING_APP, agencies: [AGENCY_A], enrollments: [person(31)] }),
    'ENROLL_DEPLOYMENT_MISMATCH');
});

test('a production-pinned deployment enrolls a production identity', async () => {
  // The payoff of the deployment pin. Nothing about this was possible while both
  // app-id layers were staging literals: the domain refused the row and the
  // entry gate refused the app. The agency name is still `Synthetic ` because
  // that constraint is a separate control on a separate schedule.
  const plan = makePlan({ app: PRODUCTION_APP,
    agencies: [{ id: 'agency-p', name: 'Synthetic Agency P', status: 'active' }],
    enrollments: [person(31, { agency: 'agency-p', role: 'agency_admin' })] });
  const receipt = await applyEnrollmentPlan({ db: production, ...plan });
  assert.equal(receipt.app_id, PRODUCTION_APP);
  assert.deepEqual({ ...receipt.created }, { agencies: 1, identities: 1, memberships: 1 });
  const rows = (await production.query(`select app_id, base44_user_id, expected_email
    from pennsync_private.identity_map`)).rows;
  assert.deepEqual(rows, [{ app_id: PRODUCTION_APP, base44_user_id: base44(31), expected_email: email(31) }]);
  // And the staging database still holds none of it.
  assert.equal((await staging.query('select count(*)::int n from pennsync_private.identity_map where app_id=$1',
    [PRODUCTION_APP])).rows[0].n, 0);
});

test('an untrusted database role cannot enroll anyone', async () => {
  await staging.exec('reset role');
  await staging.exec(`do $$ begin
    if not exists (select 1 from pg_roles where rolname='pennsync_enroll_untrusted') then
      create role pennsync_enroll_untrusted nologin; end if; end $$`);
  await staging.exec('grant usage on schema pennsync_private to pennsync_enroll_untrusted');
  await staging.exec('set role pennsync_enroll_untrusted');
  await native(staging, 40).catch(() => {});
  await refuses(staging, makePlan({ agencies: [AGENCY_A], enrollments: [person(40)] }), 'ENROLL_ROLE_UNTRUSTED');
  await staging.exec('reset role');
});


/**
 * D99's new kind, against the real migration.
 *
 * The offline suite holds the plan boundary and the switch; these are the three
 * things only the database answers: that a minted identity is admitted and
 * recorded as such, that the two id spaces cannot be crossed however a writer
 * tries, and that a revocation cannot rewrite the kind on its way through.
 */
const MINTED = '99';
const minted = n => `ffffffff${'1'.repeat(16 - String(n).length)}${n}`;
const OPEN = { PENNSYNC_ENROLL_NEW_STAFF: 'enabled-v1' };

test('a person who never held a Base44 account is admitted and recorded as such', async () => {
  await native(staging, 40);
  const proof = evidence(40);
  const plan = makePlan({
    agencies: [AGENCY_A],
    enrollments: [{
      auth_user_id: uuid(40), base44_user_id: minted(MINTED), provenance: 'locally_verified',
      expected_email: email(40), evidence_path: proof.path, evidence_sha256: proof.sha256,
      memberships: [{ id: 'membership-40', agency_id: 'agency-a', tenant_role: 'clinician' }],
    }],
  });
  const receipt = await applyEnrollmentPlan({ db: staging, ...plan, env: OPEN });
  assert.equal(receipt.created.identities, 1);
  const rows = (await staging.query(`select provenance, base44_user_id, enabled
    from pennsync_private.identity_map where auth_user_id = $1`, [uuid(40)])).rows;
  assert.deepEqual(rows, [{ provenance: 'locally_verified', base44_user_id: minted(MINTED), enabled: true }]);
  // And the membership that followed keys to the same minted id, so every
  // downstream reader — caller_roster, caller_user_id, the record policies —
  // sees an ordinary 24-character user id.
  const member = (await staging.query(`select base44_user_id, membership_key, status
    from pennsync_private.membership where auth_user_id = $1`, [uuid(40)])).rows;
  assert.deepEqual(member, [{ base44_user_id: minted(MINTED),
    membership_key: `agency-a:${minted(MINTED)}`, status: 'active' }]);
  // The switch is the tool's, so with it closed the same plan never reaches here.
  await refuses(staging, { ...plan, env: {} }, 'ENROLL_NEW_STAFF_RELEASE_PAUSED');
});

test('the store keeps the two id spaces disjoint, whatever a writer says', async () => {
  // Planted directly, not through the tool: this is the constraint's own half,
  // and the reason the tool's matching check is not the only thing standing here.
  await native(staging, 41);
  const insert = (id, provenance) => staging.query(`insert into pennsync_private.identity_map
    (app_id, auth_user_id, base44_user_id, provenance, expected_email, source_evidence_sha256, verified_at)
    values ($1,$2,$3,$4,$5,$6,clock_timestamp())`,
  [STAGING_APP, uuid(41), id, provenance, email(41), sha('x')]);
  await assert.rejects(insert(minted('41'), 'base44_migrated'), /identity_map_provenance_id_space/);
  await assert.rejects(insert(base44(41), 'locally_verified'), /identity_map_provenance_id_space/);
  await assert.rejects(insert(minted('41'), 'imported'), /provenance_check|violates check/);
  // And the DEFAULT is what makes a forgetful writer fail closed rather than
  // recording a minted identity as a migrated one.
  await assert.rejects(staging.query(`insert into pennsync_private.identity_map
    (app_id, auth_user_id, base44_user_id, expected_email, source_evidence_sha256, verified_at)
    values ($1,$2,$3,$4,$5,clock_timestamp())`,
  [STAGING_APP, uuid(41), minted('41'), email(41), sha('x')]), /identity_map_provenance_id_space/);
});

test('a revocation cannot rewrite how somebody was admitted', async () => {
  // The trigger enumerates the columns it protects, so adding one left it
  // mutable inside the ONE update the trigger permits. Planted as that exact
  // update: a legitimate revocation carrying a provenance change with it.
  await native(staging, 42);
  const proof = evidence(42);
  await applyEnrollmentPlan({
    db: staging,
    ...makePlan({
      agencies: [AGENCY_A],
      enrollments: [{
        auth_user_id: uuid(42), base44_user_id: minted('42'), provenance: 'locally_verified',
        expected_email: email(42), evidence_path: proof.path, evidence_sha256: proof.sha256,
        memberships: [{ id: 'membership-42', agency_id: 'agency-a', tenant_role: 'clinician' }],
      }],
    }),
    env: OPEN,
  });
  const revoke = extra => staging.query(`update pennsync_private.identity_map
    set enabled = false, revoked_at = clock_timestamp(), version = version + 1${extra}
    where app_id = $1 and auth_user_id = $2`, [STAGING_APP, uuid(42)]);
  await assert.rejects(revoke(`, provenance = 'base44_migrated'`), /PENNSYNC_IMMUTABLE_IDENTITY/);
  // The control: the same revocation without the smuggled column is permitted,
  // so the refusal above is about `provenance` and not about revoking at all.
  await revoke('');
  const rows = (await staging.query(`select provenance, enabled from pennsync_private.identity_map
    where auth_user_id = $1`, [uuid(42)])).rows;
  assert.deepEqual(rows, [{ provenance: 'locally_verified', enabled: false }]);
});
