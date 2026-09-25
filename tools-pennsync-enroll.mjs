#!/usr/bin/env node
/**
 * Operator-run enrollment for the owned authority store.
 *
 * D6 moves identity by re-enrollment, never by credential copy. A person is
 * verified out of band, accepts a Supabase Auth invitation themselves, and only
 * then does an operator bind the two together here. This tool writes that
 * binding — the `identity_map` row, the agencies it needs, and the memberships
 * that follow — and records the run in an append-only receipt.
 *
 * What it deliberately cannot do:
 *
 * - Create a native Auth account. Every enrollee must already exist in
 *   `auth.users`, confirmed, not banned, not deleted, and the address on that
 *   row must match the plan exactly. A person who never accepted their
 *   invitation cannot be enrolled by an operator on their behalf.
 * - Accept a bare evidence digest. The corroborating document is read and
 *   hashed here; a plan whose declared digest does not match the bytes is
 *   refused. `identity_map.source_evidence_sha256` then records provenance the
 *   operator actually held, not a number they typed.
 * - Enroll into the wrong deployment. The plan names an app id and the database
 *   names the one it serves; a mismatch refuses before anything is written, and
 *   the store's own domain would refuse the row regardless.
 * - Change anything already enrolled. Identity provenance is immutable by
 *   trigger, so a row that exists must match the plan exactly or the run fails.
 *   Re-running a plan that is already applied fails on the receipt.
 *
 * D99 adds a second kind of enrollment and takes none of that away. A person
 * who never held a Base44 account can now be admitted as `locally_verified`
 * rather than `base44_migrated`, with a minted id whose space the store keeps
 * disjoint from Base44's. Everything above still holds for them: the account is
 * not created here, the invitation is accepted by the person, and the evidence is
 * read and hashed rather than declared. The new kind is also SWITCHED OFF —
 * `PENNSYNC_ENROLL_NEW_STAFF` must read exactly `enabled-v1` — because the
 * decision to build it was explicitly a decision to invite nobody yet.
 *
 * It does not duplicate the store's own constraints, deliberately. Names, role
 * and status vocabularies, key shapes and the synthetic-shape rules are enforced
 * by the database, which is where they stay true when this file is out of date.
 * What is checked here is what the database cannot see: the plan's own
 * consistency, the evidence bytes, and the operator's intent.
 *
 * No diagnostic carries an address, a name or any plan content.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import nodePath, { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ENROLLMENT_CONTRACT = 'cm.pennsync.enrollment.v1';
export const TENANT_ROLES = Object.freeze(['agency_admin', 'manager', 'clinician',
  'office_staff', 'social_worker', 'spiritual_care']);
export const AGENCY_STATUSES = Object.freeze(['active', 'trial']);
/** Setup and recovery only; the store's own CHECK refuses it too. */
export const PLATFORM_OWNER = '6a98816d3dc68a0bd54f1ef8';
export const MAX_PLAN_BYTES = 128 * 1024;
export const MAX_EVIDENCE_BYTES = 256 * 1024;
export const LIMITS = Object.freeze({ agencies: 50, identities: 200, memberships: 400 });
/** The write lock every authority mutation takes, so enrollment serialises with them. */
export const APP_LOCK = Object.freeze([168344, 20260918]);

/**
 * D99. A second provenance kind, so a person who never held a Base44 account can
 * be admitted. `base44_migrated` is every row the ten-account migration writes
 * and stays the default for a plan that says nothing, so an existing plan parses
 * and projects as a migration exactly as before.
 *
 * The two id spaces are DISJOINT and the store enforces it: a locally verified
 * person's id is minted rather than issued, so it must begin `MINTED_PREFIX`,
 * and a migrated person's must not. Minting here and checking there is the same
 * division D30 follows for a declared uniqueness — the tool cannot be the only
 * thing standing between a minted id and a Base44 one.
 */
export const PROVENANCE_KINDS = Object.freeze(['base44_migrated', 'locally_verified']);
export const DEFAULT_PROVENANCE = 'base44_migrated';
export const MINTED_PREFIX = 'ffffffff';
/**
 * The new kind ships SWITCHED OFF. Kevin's decision was to build it and invite
 * nobody, so admitting a person who never held a Base44 account takes a
 * deliberate act by the operator running this tool, read exactly and untrimmed
 * as `PENNSYNC_API_RELEASE` and `PENNSYNC_API_DELIVERY` are. A migration plan is
 * unaffected: this gate is asked only for a `locally_verified` enrollment.
 */
export const NEW_STAFF_RELEASE_ENV = 'PENNSYNC_ENROLL_NEW_STAFF';
export const NEW_STAFF_RELEASE_VALUE = 'enabled-v1';
export const newStaffReleased = (env = process.env) =>
  env[NEW_STAFF_RELEASE_ENV] === NEW_STAFF_RELEASE_VALUE;

const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BASE44 = /^[a-f0-9]{24}$/;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const EMAIL = /^[^\s@]+@[^\s@]+$/;
const EVIDENCE_PATH = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}(?:\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}){0,3}$/;

export class EnrollError extends Error {
  constructor(code) { super(code); this.name = 'EnrollError'; this.code = code; }
}
const check = (value, code = 'ENROLL_PLAN_INVALID') => { if (!value) throw new EnrollError(code); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => isObject(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const byText = key => (left, right) => (left[key] < right[key] ? -1 : left[key] > right[key] ? 1 : 0);
const unique = values => new Set(values).size === values.length;

function parseAgency(raw) {
  check(exactKeys(raw, ['id', 'name', 'status']));
  check(typeof raw.id === 'string' && ID.test(raw.id));
  check(typeof raw.name === 'string' && raw.name === raw.name.trim()
    && raw.name.length >= 1 && raw.name.length <= 120);
  check(AGENCY_STATUSES.includes(raw.status));
  return Object.freeze({ id: raw.id, name: raw.name, status: raw.status });
}

function parseMembership(raw, agencyIds) {
  check(exactKeys(raw, ['id', 'agency_id', 'tenant_role']));
  check(typeof raw.id === 'string' && ID.test(raw.id));
  check(typeof raw.agency_id === 'string' && agencyIds.has(raw.agency_id), 'ENROLL_AGENCY_UNKNOWN');
  check(TENANT_ROLES.includes(raw.tenant_role));
  return Object.freeze({ id: raw.id, agency_id: raw.agency_id, tenant_role: raw.tenant_role });
}

function parseEnrollment(raw, agencyIds, env) {
  const BASE = ['auth_user_id', 'base44_user_id', 'expected_email',
    'evidence_path', 'evidence_sha256', 'memberships'];
  // Either shape is a complete plan entry: the migration's six keys, or those
  // six plus `provenance`. Kept as two exact shapes rather than one with an
  // optional key, because `exactKeys` refusing an unknown key is what keeps a
  // misspelled field from being silently dropped.
  check(exactKeys(raw, BASE) || exactKeys(raw, [...BASE, 'provenance']));
  const provenance = Object.hasOwn(raw, 'provenance') ? raw.provenance : DEFAULT_PROVENANCE;
  check(PROVENANCE_KINDS.includes(provenance), 'ENROLL_PROVENANCE_INVALID');
  check(typeof raw.auth_user_id === 'string' && UUID.test(raw.auth_user_id));
  check(typeof raw.base44_user_id === 'string' && BASE44.test(raw.base44_user_id));
  check(raw.base44_user_id !== PLATFORM_OWNER, 'ENROLL_PLATFORM_OWNER_REFUSED');
  // The id space check, which the store also enforces. A plan that names the
  // wrong kind for its id is refused here rather than at the insert, so the
  // operator is told which field is wrong.
  const minted = raw.base44_user_id.startsWith(MINTED_PREFIX);
  check(minted === (provenance === 'locally_verified'), 'ENROLL_PROVENANCE_ID_SPACE');
  // Switched off by default. Asked only for the new kind, and asked during
  // PARSING so a plan carrying one is refused before any connection is opened.
  if (provenance === 'locally_verified') {
    check(newStaffReleased(env), 'ENROLL_NEW_STAFF_RELEASE_PAUSED');
  }
  check(typeof raw.expected_email === 'string' && raw.expected_email.length >= 3
    && raw.expected_email.length <= 254 && EMAIL.test(raw.expected_email)
    && raw.expected_email === raw.expected_email.trim().toLowerCase(), 'ENROLL_EMAIL_NOT_NORMALIZED');
  check(typeof raw.evidence_path === 'string' && EVIDENCE_PATH.test(raw.evidence_path)
    && !raw.evidence_path.split('/').includes('..'), 'ENROLL_EVIDENCE_PATH_FORBIDDEN');
  check(typeof raw.evidence_sha256 === 'string' && HASH.test(raw.evidence_sha256));
  check(Array.isArray(raw.memberships) && raw.memberships.length >= 1);
  const memberships = raw.memberships.map(row => parseMembership(row, agencyIds));
  check(unique(memberships.map(row => row.agency_id)), 'ENROLL_MEMBERSHIP_AMBIGUOUS');
  return Object.freeze({
    auth_user_id: raw.auth_user_id,
    base44_user_id: raw.base44_user_id,
    provenance,
    expected_email: raw.expected_email,
    evidence_path: raw.evidence_path,
    evidence_sha256: raw.evidence_sha256,
    memberships: Object.freeze(memberships),
  });
}

/** Parse and fully validate a plan addressed by its own digest. Offline. */
export function parseEnrollmentPlan(rawPlan, expectedPlanSha256, env = process.env) {
  check(typeof rawPlan === 'string' && rawPlan.length > 0, 'ENROLL_PLAN_REQUIRED');
  check(Buffer.byteLength(rawPlan) <= MAX_PLAN_BYTES, 'ENROLL_PLAN_TOO_LARGE');
  check(typeof expectedPlanSha256 === 'string' && HASH.test(expectedPlanSha256), 'ENROLL_PLAN_SHA_REQUIRED');
  check(sha(rawPlan) === expectedPlanSha256, 'ENROLL_PLAN_MISMATCH');
  let raw;
  try { raw = JSON.parse(rawPlan); } catch { throw new EnrollError('ENROLL_PLAN_INVALID'); }
  check(exactKeys(raw, ['contract', 'app_id', 'agencies', 'enrollments']));
  check(raw.contract === ENROLLMENT_CONTRACT, 'ENROLL_CONTRACT_UNSUPPORTED');
  check(typeof raw.app_id === 'string' && BASE44.test(raw.app_id), 'ENROLL_APP_INVALID');
  check(Array.isArray(raw.agencies) && raw.agencies.length <= LIMITS.agencies, 'ENROLL_PLAN_TOO_LARGE');
  check(Array.isArray(raw.enrollments) && raw.enrollments.length >= 1
    && raw.enrollments.length <= LIMITS.identities, 'ENROLL_PLAN_TOO_LARGE');
  const agencies = raw.agencies.map(parseAgency);
  check(unique(agencies.map(row => row.id)), 'ENROLL_AGENCY_AMBIGUOUS');
  const agencyIds = new Set(agencies.map(row => row.id));
  const enrollments = raw.enrollments.map(row => parseEnrollment(row, agencyIds, env));
  check(unique(enrollments.map(row => row.auth_user_id)), 'ENROLL_IDENTITY_AMBIGUOUS');
  check(unique(enrollments.map(row => row.base44_user_id)), 'ENROLL_IDENTITY_AMBIGUOUS');
  check(unique(enrollments.map(row => row.expected_email)), 'ENROLL_IDENTITY_AMBIGUOUS');
  const memberships = enrollments.flatMap(row => row.memberships);
  check(memberships.length <= LIMITS.memberships, 'ENROLL_PLAN_TOO_LARGE');
  check(unique(memberships.map(row => row.id)), 'ENROLL_MEMBERSHIP_AMBIGUOUS');
  // Every membership needs an agency this plan also establishes, so a plan is
  // self-contained: nothing depends on a row an earlier run may or may not have left.
  check([...agencyIds].every(id => memberships.some(row => row.agency_id === id)), 'ENROLL_AGENCY_UNUSED');
  return Object.freeze({ contract: raw.contract, app_id: raw.app_id,
    agencies: Object.freeze(agencies), enrollments: Object.freeze(enrollments) });
}

/**
 * What the run will have written, in a canonical order. Recorded in the receipt
 * so a later audit compares against the outcome rather than the request.
 */
export function enrollmentProjectionSha256(plan) {
  return sha(JSON.stringify({
    app_id: plan.app_id,
    agencies: [...plan.agencies].sort(byText('id')),
    identities: [...plan.enrollments].sort(byText('base44_user_id')).map(row => ({
      auth_user_id: row.auth_user_id,
      base44_user_id: row.base44_user_id,
      // D99. In the projection because the receipt is what a later audit reads
      // to say what a run wrote, and which kind of identity was admitted is the
      // part of that this decision added.
      provenance: row.provenance,
      expected_email: row.expected_email,
      source_evidence_sha256: row.evidence_sha256,
      memberships: [...row.memberships].sort(byText('id')),
    })),
  }));
}

/** Hash the operator's corroborating bytes. A digest alone is never accepted. */
export async function verifyEnrollmentEvidence(plan, readEvidence) {
  check(typeof readEvidence === 'function', 'ENROLL_EVIDENCE_REQUIRED');
  for (const enrollment of plan.enrollments) {
    const hash = createHash('sha256');
    let length = 0;
    let stream;
    try { stream = readEvidence(enrollment.evidence_path); } catch { throw new EnrollError('ENROLL_EVIDENCE_UNREADABLE'); }
    try {
      for await (const bytes of stream) {
        length += bytes.length;
        check(length <= MAX_EVIDENCE_BYTES, 'ENROLL_EVIDENCE_TOO_LARGE');
        hash.update(bytes);
      }
    } catch (error) {
      throw error instanceof EnrollError ? error : new EnrollError('ENROLL_EVIDENCE_UNREADABLE');
    }
    check(length > 0, 'ENROLL_EVIDENCE_EMPTY');
    check(hash.digest('hex') === enrollment.evidence_sha256, 'ENROLL_EVIDENCE_MISMATCH');
  }
}

const REQUIRED_TABLES = Object.freeze(['agency', 'enrollment_receipt', 'identity_map', 'membership']);

async function preflight(db, plan) {
  const target = (await db.query(`select current_database() as database, current_user as role,
    (select (rolsuper or rolbypassrls) from pg_catalog.pg_roles where rolname = current_user) as trusted`)).rows[0];
  check(target?.trusted === true, 'ENROLL_ROLE_UNTRUSTED');
  // The database says which app it serves; the plan only asks. A mismatch stops
  // here rather than relying on the domain to refuse each row.
  const pin = (await db.query('select app_id from pennsync_private.deployment')).rows;
  check(pin.length === 1, 'ENROLL_DEPLOYMENT_UNPINNED');
  check(pin[0].app_id === plan.app_id, 'ENROLL_DEPLOYMENT_MISMATCH');
  const tables = (await db.query(`select c.relname as name, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
      not exists(select 1 from pg_catalog.pg_policy p where p.polrelid = c.oid) as no_policies,
      not (has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
        or has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
        or has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE')) as private
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'pennsync_private' and c.relkind = 'r' and c.relname = any($1) order by c.relname`,
  [[...REQUIRED_TABLES]])).rows;
  check(tables.length === REQUIRED_TABLES.length, 'ENROLL_SCHEMA_UNSAFE');
  check(tables.every(row => row.rls && row.forced && row.no_policies && row.private), 'ENROLL_SCHEMA_UNSAFE');
  return { database: target.database, operator_role: target.role };
}

async function privateLogging(db) {
  // Addresses are identifiers. Statement logging would copy every one of them
  // into the server log, where nothing in this design protects them.
  try {
    await db.query("set local log_statement='none'");
    await db.query('set local log_parameter_max_length=0');
    await db.query('set local log_parameter_max_length_on_error=0');
    const value = (await db.query(`select current_setting('log_statement') as statements,
      current_setting('log_parameter_max_length') as parameters,
      current_setting('log_parameter_max_length_on_error') as error_parameters`)).rows[0];
    check(value.statements === 'none' && value.parameters === '0'
      && value.error_parameters === '0', 'ENROLL_LOGGING_UNSAFE');
  } catch { throw new EnrollError('ENROLL_LOGGING_UNSAFE'); }
}

async function writeAgency(db, plan, agency) {
  const existing = (await db.query(
    'select name, status from pennsync_private.agency where app_id=$1 and id=$2 for share',
    [plan.app_id, agency.id])).rows;
  if (existing.length === 0) {
    await db.query('insert into pennsync_private.agency (app_id, id, name, status) values ($1,$2,$3,$4)',
      [plan.app_id, agency.id, agency.name, agency.status]);
    return 1;
  }
  check(existing[0].name === agency.name && existing[0].status === agency.status, 'ENROLL_AGENCY_CONFLICT');
  return 0;
}

async function writeIdentity(db, plan, enrollment) {
  // The person must already hold the native account. This tool never creates one.
  const native = (await db.query(`select lower(u.email) as email from auth.users u
    where u.id = $1 and u.deleted_at is null and u.is_anonymous is false
      and u.email_confirmed_at is not null and u.email_confirmed_at <= clock_timestamp()
      and (u.banned_until is null or u.banned_until <= clock_timestamp()) for share`,
  [enrollment.auth_user_id])).rows;
  check(native.length === 1, 'ENROLL_NATIVE_IDENTITY_UNAVAILABLE');
  check(native[0].email === enrollment.expected_email, 'ENROLL_NATIVE_EMAIL_MISMATCH');
  const existing = (await db.query(`select base44_user_id, provenance, expected_email,
      source_evidence_sha256, enabled, revoked_at
    from pennsync_private.identity_map where app_id=$1 and auth_user_id=$2 for share`,
  [plan.app_id, enrollment.auth_user_id])).rows;
  if (existing.length === 1) {
    // Provenance is immutable by trigger, so a differing row is not something
    // this run can reconcile; it is a plan that contradicts the record. The kind
    // is compared too: it is part of what the row records about the person, and
    // a plan that reclassified an enrolled identity would be exactly the change
    // the trigger refuses.
    check(existing[0].base44_user_id === enrollment.base44_user_id
      && existing[0].provenance === enrollment.provenance
      && existing[0].expected_email === enrollment.expected_email
      && existing[0].source_evidence_sha256 === enrollment.evidence_sha256
      && existing[0].enabled === true && existing[0].revoked_at === null, 'ENROLL_IDENTITY_CONFLICT');
    return 0;
  }
  const claimed = (await db.query(`select 1 from pennsync_private.identity_map
    where app_id=$1 and (base44_user_id=$2 or expected_email=$3) for share`,
  [plan.app_id, enrollment.base44_user_id, enrollment.expected_email])).rows;
  check(claimed.length === 0, 'ENROLL_IDENTITY_CLAIMED');
  // The kind is named rather than left to the column default. The default exists
  // so the rows that predate D99 are `base44_migrated` and so a writer that
  // forgets fails closed against the id-space constraint; a writer that knows
  // which kind it is writing says so.
  await db.query(`insert into pennsync_private.identity_map
    (app_id, auth_user_id, base44_user_id, provenance, expected_email, source_evidence_sha256, verified_at)
    values ($1,$2,$3,$4,$5,$6,clock_timestamp())`,
  [plan.app_id, enrollment.auth_user_id, enrollment.base44_user_id, enrollment.provenance,
    enrollment.expected_email, enrollment.evidence_sha256]);
  return 1;
}

async function writeMembership(db, plan, enrollment, membership) {
  const existing = (await db.query(`select id, tenant_role, status from pennsync_private.membership
    where app_id=$1 and agency_id=$2 and auth_user_id=$3 for share`,
  [plan.app_id, membership.agency_id, enrollment.auth_user_id])).rows;
  if (existing.length === 1) {
    check(existing[0].id === membership.id && existing[0].tenant_role === membership.tenant_role
      && existing[0].status === 'active', 'ENROLL_MEMBERSHIP_CONFLICT');
    return 0;
  }
  await db.query(`insert into pennsync_private.membership
    (app_id, id, agency_id, auth_user_id, base44_user_id, tenant_role, status)
    values ($1,$2,$3,$4,$5,$6,'active')`,
  [plan.app_id, membership.id, membership.agency_id, enrollment.auth_user_id,
    enrollment.base44_user_id, membership.tenant_role]);
  return 1;
}

/**
 * Apply a verified plan to an open connection, in one transaction, under the
 * same advisory lock the authority RPCs take for writes.
 */
export async function applyEnrollmentPlan({ db, rawPlan, expectedPlanSha256, readEvidence, env = process.env }) {
  check(!!db && typeof db.query === 'function', 'ENROLL_TARGET_REQUIRED');
  const plan = parseEnrollmentPlan(rawPlan, expectedPlanSha256, env);
  await verifyEnrollmentEvidence(plan, readEvidence);
  const target = await preflight(db, plan);
  const projectionSha256 = enrollmentProjectionSha256(plan);
  let started = false;
  let committing = false;
  try {
    await db.query('begin');
    started = true;
    await privateLogging(db);
    await db.query('select pg_catalog.pg_advisory_xact_lock($1,$2)', [APP_LOCK[0], APP_LOCK[1]]);
    const applied = (await db.query(
      'select 1 from pennsync_private.enrollment_receipt where app_id=$1 and plan_sha256=$2 for share',
      [plan.app_id, expectedPlanSha256])).rows;
    check(applied.length === 0, 'ENROLL_PLAN_ALREADY_APPLIED');
    let agencies = 0;
    let identities = 0;
    let memberships = 0;
    for (const agency of [...plan.agencies].sort(byText('id'))) agencies += await writeAgency(db, plan, agency);
    for (const enrollment of [...plan.enrollments].sort(byText('base44_user_id'))) {
      identities += await writeIdentity(db, plan, enrollment);
      for (const membership of [...enrollment.memberships].sort(byText('id'))) {
        memberships += await writeMembership(db, plan, enrollment, membership);
      }
    }
    await db.query(`insert into pennsync_private.enrollment_receipt
      (app_id, plan_sha256, projection_sha256, identity_count, agency_count, membership_count,
       database_name, operator_role) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [plan.app_id, expectedPlanSha256, projectionSha256, plan.enrollments.length,
      plan.agencies.length, plan.enrollments.reduce((n, row) => n + row.memberships.length, 0),
      target.database, target.operator_role]);
    committing = true;
    try { await db.query('commit'); } catch { throw new EnrollError('ENROLL_COMMIT_OUTCOME_UNKNOWN'); }
    return Object.freeze({
      contract: ENROLLMENT_CONTRACT,
      app_id: plan.app_id,
      plan_sha256: expectedPlanSha256,
      projection_sha256: projectionSha256,
      database_name: target.database,
      operator_role: target.operator_role,
      planned: Object.freeze({
        agencies: plan.agencies.length,
        identities: plan.enrollments.length,
        memberships: plan.enrollments.reduce((n, row) => n + row.memberships.length, 0),
      }),
      // What this run created, as opposed to what it found already correct.
      created: Object.freeze({ agencies, identities, memberships }),
    });
  } catch (error) {
    if (started && !committing) {
      try { await db.query('rollback'); } catch { /* A lost connection rolls back uncommitted work. */ }
    }
    throw error instanceof EnrollError ? error : new EnrollError('ENROLL_FAILED_DETAILS_REDACTED');
  }
}

/**
 * The containment decision, with its path module as an argument.
 *
 * It takes the module rather than reaching for `node:path` because the bug
 * this refuses to repeat is only reachable on Windows: `relative` answers in
 * the platform's separator, so a plan's `evidence/person-one.txt` came back
 * `evidence\person-one.txt` and an equality against the caller's spelling
 * refused every legitimate path. CI runs on Linux, where `sep` is `/` and the
 * normalisation below is a no-op, so a test that only drove the real reader
 * would pass whether or not the fix were present — which is what the first
 * version of its test did. Pass `path.win32` to exercise the case that broke.
 *
 * A plan spells its paths with forward slashes on every platform, so the
 * comparison is made in that spelling. The traversal refusals read `inside`
 * unchanged and are unaffected by the normalisation either way.
 */
export function evidencePathAllowed(pathModule, root, requested) {
  const full = pathModule.resolve(pathModule.join(root, requested));
  const inside = pathModule.relative(root, full);
  const asGiven = inside.split(pathModule.sep).join('/');
  return asGiven === requested && !inside.startsWith('..') && !pathModule.isAbsolute(inside);
}

/** Reads evidence from one directory and refuses to leave it. */
export function directoryEvidenceReader(evidenceDir) {
  const root = resolve(evidenceDir);
  return requested => {
    check(evidencePathAllowed(nodePath, root, requested), 'ENROLL_EVIDENCE_PATH_FORBIDDEN');
    return createReadStream(resolve(nodePath.join(root, requested)));
  };
}

export async function runEnrollCli({ env = process.env, write = console.log, error = console.error,
  connect = null } = {}) {
  let db = null;
  try {
    check(typeof env.PENNSYNC_ENROLL_DATABASE_URL === 'string', 'ENROLL_TARGET_REQUIRED');
    check(typeof env.PENNSYNC_ENROLL_PLAN === 'string', 'ENROLL_PLAN_REQUIRED');
    check(typeof env.PENNSYNC_ENROLL_EVIDENCE_DIR === 'string', 'ENROLL_EVIDENCE_REQUIRED');
    const rawPlan = await readFile(env.PENNSYNC_ENROLL_PLAN, 'utf8');
    const open = connect ?? (async url => {
      const require = createRequire(new URL('./services/authority-store/package.json', import.meta.url));
      const { Client } = require('pg');
      const client = new Client({ connectionString: url });
      await client.connect();
      return client;
    });
    db = await open(env.PENNSYNC_ENROLL_DATABASE_URL);
    const receipt = await applyEnrollmentPlan({
      db,
      rawPlan,
      expectedPlanSha256: env.PENNSYNC_ENROLL_PLAN_SHA256,
      readEvidence: directoryEvidenceReader(env.PENNSYNC_ENROLL_EVIDENCE_DIR),
      // The CLI's own environment, so `PENNSYNC_ENROLL_NEW_STAFF` is read from
      // the run the operator actually started rather than from the process.
      env,
    });
    write(JSON.stringify(receipt, null, 2));
    return 0;
  } catch (cause) {
    error(cause?.code === 'ENROLL_COMMIT_OUTCOME_UNKNOWN'
      ? 'Enrollment commit outcome is unknown. Reconcile this exact plan against the target before re-running.'
      : `Enrollment failed: ${cause?.code ?? 'ENROLL_FAILED_DETAILS_REDACTED'}. No plan content is included in this diagnostic.`);
    return 1;
  } finally {
    if (db && typeof db.end === 'function') {
      try { await db.end(); } catch { /* No content or credentials in cleanup diagnostics. */ }
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runEnrollCli();
}
