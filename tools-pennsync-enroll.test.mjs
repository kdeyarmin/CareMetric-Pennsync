import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ENROLLMENT_CONTRACT, LIMITS, PLATFORM_OWNER, TENANT_ROLES,
  directoryEvidenceReader, enrollmentProjectionSha256, parseEnrollmentPlan,
  runEnrollCli, verifyEnrollmentEvidence,
} from './tools-pennsync-enroll.mjs';

/**
 * The offline half of enrollment: everything decidable without a database.
 *
 * D6 makes this tool the only way a person's identity reaches the owned store,
 * so the plan it accepts is the boundary. These tests hold that boundary where
 * the database cannot: a plan that contradicts itself, an address that is not
 * canonical, an evidence digest the operator did not actually hold.
 */
const sha = value => createHash('sha256').update(value).digest('hex');
const EVIDENCE = 'operator verification record, corroborated out of band\n';
const EVIDENCE_SHA = sha(EVIDENCE);
const APP = '6a9881683dc68a0bd54f1ef7';

function plan(overrides = {}) {
  const base = {
    contract: ENROLLMENT_CONTRACT,
    app_id: APP,
    agencies: [{ id: 'agency-a', name: 'Synthetic Agency A', status: 'active' }],
    enrollments: [{
      auth_user_id: '10000000-0000-4000-8000-000000000001',
      base44_user_id: 'a'.repeat(24),
      expected_email: 'person.one@example.test',
      evidence_path: 'evidence/person-one.txt',
      evidence_sha256: EVIDENCE_SHA,
      memberships: [{ id: 'membership-1', agency_id: 'agency-a', tenant_role: 'clinician' }],
    }],
  };
  return JSON.stringify({ ...base, ...overrides });
}
const parse = raw => parseEnrollmentPlan(raw, sha(raw));
const refuses = (raw, code) => assert.throws(() => parse(raw), error => error.code === code, code);
/** Swap one field of the single enrollment, keeping the rest of the plan intact. */
const withEnrollment = patch => {
  const base = JSON.parse(plan());
  return plan({ enrollments: [{ ...base.enrollments[0], ...patch }] });
};

test('a plan is addressed by its own digest', () => {
  const raw = plan();
  assert.equal(parse(raw).app_id, APP);
  assert.throws(() => parseEnrollmentPlan(raw, sha(`${raw} `)), error => error.code === 'ENROLL_PLAN_MISMATCH');
  assert.throws(() => parseEnrollmentPlan(raw, 'not-a-digest'), error => error.code === 'ENROLL_PLAN_SHA_REQUIRED');
  assert.throws(() => parseEnrollmentPlan('', sha('')), error => error.code === 'ENROLL_PLAN_REQUIRED');
  assert.throws(() => parseEnrollmentPlan('x'.repeat(200 * 1024), sha('x'.repeat(200 * 1024))),
    error => error.code === 'ENROLL_PLAN_TOO_LARGE');
  assert.throws(() => parseEnrollmentPlan('{', sha('{')), error => error.code === 'ENROLL_PLAN_INVALID');
});

test('only this contract and a well-formed app id are accepted', () => {
  refuses(plan({ contract: 'cm.pennsync.enrollment.v2' }), 'ENROLL_CONTRACT_UNSUPPORTED');
  for (const app of ['', 'not-an-app', APP.toUpperCase(), `${APP}x`, APP.slice(0, -1)]) {
    refuses(plan({ app_id: app }), 'ENROLL_APP_INVALID');
  }
  // Which app this store actually serves is the database's answer, not the
  // plan's; the plan only has to name one coherently.
  assert.equal(parse(plan({ app_id: '694ec16e72e01b60d22f7cbf' })).app_id, '694ec16e72e01b60d22f7cbf');
});

test('an address must already be canonical, because the store stores it verbatim', () => {
  for (const email of ['Person.One@Example.test', ' person.one@example.test', 'person.one@example.test ',
    'person.one@example.test\n']) {
    refuses(withEnrollment({ expected_email: email }), 'ENROLL_EMAIL_NOT_NORMALIZED');
  }
  for (const email of ['', 'no-at-sign', 'two@at@signs', 'a@', '@b']) {
    refuses(withEnrollment({ expected_email: email }), 'ENROLL_EMAIL_NOT_NORMALIZED');
  }
});

test('the protected platform owner cannot be enrolled by any plan', () => {
  refuses(withEnrollment({ base44_user_id: PLATFORM_OWNER }), 'ENROLL_PLATFORM_OWNER_REFUSED');
});

test('a plan must be self-consistent before any row is written', () => {
  const two = JSON.parse(plan()).enrollments[0];
  const second = { ...two, auth_user_id: randomUUID(), base44_user_id: 'b'.repeat(24),
    expected_email: 'person.two@example.test',
    memberships: [{ id: 'membership-2', agency_id: 'agency-a', tenant_role: 'manager' }] };
  assert.equal(parse(plan({ enrollments: [two, second] })).enrollments.length, 2);
  for (const [field, value] of [['auth_user_id', two.auth_user_id], ['base44_user_id', two.base44_user_id],
    ['expected_email', two.expected_email]]) {
    refuses(plan({ enrollments: [two, { ...second, [field]: value }] }), 'ENROLL_IDENTITY_AMBIGUOUS');
  }
  // One membership id cannot describe two people, and one person cannot hold
  // two memberships in the same agency.
  refuses(plan({ enrollments: [two, { ...second, memberships: two.memberships }] }), 'ENROLL_MEMBERSHIP_AMBIGUOUS');
  refuses(withEnrollment({ memberships: [
    { id: 'membership-1', agency_id: 'agency-a', tenant_role: 'clinician' },
    { id: 'membership-2', agency_id: 'agency-a', tenant_role: 'manager' }] }), 'ENROLL_MEMBERSHIP_AMBIGUOUS');
  // A membership must name an agency this same plan establishes, and an agency
  // nobody joins would be a row created for no stated reason.
  refuses(withEnrollment({ memberships: [{ id: 'membership-1', agency_id: 'agency-z', tenant_role: 'clinician' }] }),
    'ENROLL_AGENCY_UNKNOWN');
  refuses(plan({ agencies: [{ id: 'agency-a', name: 'Synthetic Agency A', status: 'active' },
    { id: 'agency-b', name: 'Synthetic Agency B', status: 'trial' }] }), 'ENROLL_AGENCY_UNUSED');
  refuses(plan({ agencies: [{ id: 'agency-a', name: 'Synthetic Agency A', status: 'active' },
    { id: 'agency-a', name: 'Synthetic Agency A', status: 'trial' }] }), 'ENROLL_AGENCY_AMBIGUOUS');
});

test('the vocabularies the store enforces are refused here too, before the connection opens', () => {
  for (const role of ['owner', 'platform_owner', 'admin', '', 'Clinician']) {
    refuses(withEnrollment({ memberships: [{ id: 'membership-1', agency_id: 'agency-a', tenant_role: role }] }),
      'ENROLL_PLAN_INVALID');
  }
  assert.deepEqual([...TENANT_ROLES].sort(), ['agency_admin', 'clinician', 'manager',
    'office_staff', 'social_worker', 'spiritual_care']);
  for (const status of ['suspended', 'closed', '']) {
    refuses(plan({ agencies: [{ id: 'agency-a', name: 'Synthetic Agency A', status }] }), 'ENROLL_PLAN_INVALID');
  }
});

test('an unknown or missing field is a refusal, never a field quietly ignored', () => {
  refuses(plan({ note: 'for the auditors' }), 'ENROLL_PLAN_INVALID');
  refuses(withEnrollment({ tenant_role: 'agency_admin' }), 'ENROLL_PLAN_INVALID');
  const base = JSON.parse(plan()).enrollments[0];
  for (const field of Object.keys(base)) {
    const partial = { ...base };
    delete partial[field];
    assert.throws(() => parse(plan({ enrollments: [partial] })), error => error.code?.startsWith('ENROLL_'),
      `a plan missing ${field} must be refused`);
  }
});

test('an evidence path cannot leave the operator\'s evidence directory', () => {
  for (const path of ['../secrets.txt', '/etc/passwd', 'evidence/../../x', '', 'a'.repeat(200),
    './evidence/x', 'evidence//x']) {
    refuses(withEnrollment({ evidence_path: path }), 'ENROLL_EVIDENCE_PATH_FORBIDDEN');
  }
});

test('evidence is verified from the bytes, never taken as a declared digest', async () => {
  const parsed = parse(plan());
  await verifyEnrollmentEvidence(parsed, () => Readable.from([Buffer.from(EVIDENCE)]));
  const rejects = (read, code) => assert.rejects(() => verifyEnrollmentEvidence(parsed, read),
    error => error.code === code, code);
  await rejects(() => Readable.from([Buffer.from(`${EVIDENCE}tampered`)]), 'ENROLL_EVIDENCE_MISMATCH');
  await rejects(() => Readable.from([]), 'ENROLL_EVIDENCE_EMPTY');
  await rejects(() => Readable.from([Buffer.alloc(300 * 1024)]), 'ENROLL_EVIDENCE_TOO_LARGE');
  await rejects(() => { throw new Error('no such file'); }, 'ENROLL_EVIDENCE_UNREADABLE');
  await rejects(() => Readable.from((function* () { throw new Error('read failed'); })()), 'ENROLL_EVIDENCE_UNREADABLE');
  await assert.rejects(() => verifyEnrollmentEvidence(parsed, null), error => error.code === 'ENROLL_EVIDENCE_REQUIRED');
  // The digest is read in chunks, so a stream that arrives in pieces must hash
  // to the same value as one that arrives whole.
  await verifyEnrollmentEvidence(parsed,
    () => Readable.from([...Buffer.from(EVIDENCE)].map(byte => Buffer.from([byte]))));
});

test('the projection digest covers what will be written, in a stable order', () => {
  const one = JSON.parse(plan()).enrollments[0];
  const two = { ...one, auth_user_id: '10000000-0000-4000-8000-000000000002',
    base44_user_id: 'b'.repeat(24), expected_email: 'person.two@example.test',
    memberships: [{ id: 'membership-2', agency_id: 'agency-a', tenant_role: 'manager' }] };
  const forward = enrollmentProjectionSha256(parse(plan({ enrollments: [one, two] })));
  const reverse = enrollmentProjectionSha256(parse(plan({ enrollments: [two, one] })));
  assert.equal(forward, reverse, 'plan order must not change the digest');
  assert.notEqual(forward, enrollmentProjectionSha256(parse(plan({ enrollments: [one] }))));
  // The evidence digest is part of the projection: the same person enrolled on
  // different corroboration is a different outcome.
  assert.notEqual(enrollmentProjectionSha256(parse(plan())),
    enrollmentProjectionSha256(parse(withEnrollment({ evidence_sha256: sha('other') }))));
  // The evidence *path* is not: where the operator filed the document does not
  // change what the store now holds.
  assert.equal(enrollmentProjectionSha256(parse(plan())),
    enrollmentProjectionSha256(parse(withEnrollment({ evidence_path: 'evidence/renamed.txt' }))));
});

test('the bounded limits are the ones the receipt column can hold', () => {
  assert.deepEqual({ ...LIMITS }, { agencies: 50, identities: 200, memberships: 400 });
});

test('the directory reader refuses a path that escapes its root', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pennsync-enroll-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'evidence'), { recursive: true });
  await writeFile(join(root, 'evidence', 'person-one.txt'), EVIDENCE);
  const read = directoryEvidenceReader(root);
  // A plan spells its evidence path with forward slashes, and that has to read
  // on every platform. `relative` answers in the platform's separator, which
  // made this reader forbid every legitimate path on Windows.
  assert.doesNotThrow(() => read('evidence/person-one.txt').destroy());
  await verifyEnrollmentEvidence(parse(plan()), read);
  for (const path of ['../outside.txt', '/etc/passwd', 'evidence/../../outside.txt']) {
    assert.throws(() => read(path), error => error.code === 'ENROLL_EVIDENCE_PATH_FORBIDDEN', path);
  }
});

test('the CLI reports a code and never echoes plan content', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pennsync-enroll-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const planPath = join(root, 'plan.json');
  const raw = plan();
  await writeFile(planPath, raw);
  await mkdir(join(root, 'evidence'), { recursive: true });
  await writeFile(join(root, 'evidence', 'person-one.txt'), EVIDENCE);
  const lines = [];
  const run = (env, connect) => runEnrollCli({
    env, connect, write: value => lines.push(value), error: value => lines.push(value),
  });

  assert.equal(await run({}), 1);
  assert.match(lines.at(-1), /ENROLL_TARGET_REQUIRED/);
  assert.equal(await run({ PENNSYNC_ENROLL_DATABASE_URL: 'postgres://x' }), 1);
  assert.match(lines.at(-1), /ENROLL_PLAN_REQUIRED/);
  assert.equal(await run({ PENNSYNC_ENROLL_DATABASE_URL: 'postgres://x', PENNSYNC_ENROLL_PLAN: planPath }), 1);
  assert.match(lines.at(-1), /ENROLL_EVIDENCE_REQUIRED/);

  // A plan whose digest was not supplied never reaches the database: the
  // connection opens, nothing is written, and the connection is closed.
  let ended = 0;
  const connect = async () => ({ query: async () => { throw new Error('must not be reached'); }, end: async () => { ended += 1; } });
  assert.equal(await run({ PENNSYNC_ENROLL_DATABASE_URL: 'postgres://x', PENNSYNC_ENROLL_PLAN: planPath,
    PENNSYNC_ENROLL_EVIDENCE_DIR: root }, connect), 1);
  assert.match(lines.at(-1), /ENROLL_PLAN_SHA_REQUIRED/);
  assert.equal(ended, 1, 'the connection must be closed even when the plan is refused');
  for (const line of lines) {
    assert.doesNotMatch(line, /example\.test|Synthetic Agency|membership-1/, 'a diagnostic leaked plan content');
  }
});
