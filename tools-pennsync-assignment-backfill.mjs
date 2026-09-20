#!/usr/bin/env node
/**
 * The care-team backfill D24 requires, and the one thing it must never do.
 *
 * D24 makes `pennsync_private.assignment` the authority on who may open a
 * chart. Today's real assignments do not live there: they live in
 * `Patient.assigned_nurses`, an array of email addresses on the patient row.
 * Moving authority without carrying those across means every clinician loses
 * access to their own patients on cutover. This carries them across.
 *
 * **The failure it must not have is the quiet one.** D21 recorded the
 * asymmetry and it decides every judgement in this file: a backfill that drops
 * a row is a support ticket — a clinician says they cannot see a patient and
 * an administrator grants them. A backfill that INVENTS a row is a disclosure,
 * and nobody reports it, because nothing looks wrong to the person who now has
 * access they should not. So every ambiguity resolves to dropping the row, and
 * every dropped row is named in the report rather than counted.
 *
 * What that means concretely:
 *
 * - **An address resolves exactly or not at all.** It is matched against
 *   `identity_map.expected_email` after the same normalisation the store
 *   applies (lowercase, trimmed) and nothing else. No display-name matching,
 *   no domain fallback, no nearest match. An address that resolves to nobody
 *   is dropped and named.
 * - **The membership must be in the PATIENT's agency.** A nurse who works for
 *   two agencies has two memberships; carrying an assignment into the wrong
 *   one would hand them a chart from an agency that never assigned it. A
 *   resolution that is not unique within the patient's agency is dropped.
 * - **It refuses rather than guesses about its own input.** A patient with no
 *   agency, an entry that is not a string, an address the store's own format
 *   rejects — each fails the run, because a malformed export is a reason to
 *   stop, not to carry on with the rows that happened to parse.
 * - **It never revokes.** An assignment already in the store is left exactly
 *   as it is, including a revoked one: this tool's evidence is an export of
 *   `assigned_nurses`, which cannot distinguish "never assigned" from "access
 *   deliberately withdrawn". Re-granting a revoked assignment is precisely the
 *   invented row above, arriving by a different route.
 *
 * Like `tools-pennsync-enroll.mjs`, the run is planned and reported before it
 * writes, the plan is digest-addressed so what was reviewed is what applies,
 * and no diagnostic carries an address, a name or a patient id.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export const BACKFILL_CONTRACT = 'cm.pennsync.assignment-backfill.v1';
/** The roles the record store's `caller_assigned_patients` actually honours. */
export const ASSIGNABLE_ROLES = Object.freeze(['clinician', 'social_worker', 'spiritual_care']);
export const MAX_EXPORT_BYTES = 64 * 1024 * 1024;
export const LIMITS = Object.freeze({ patients: 100000, nursesPerPatient: 200 });
/** The same write lock every authority mutation takes, so this serialises with them. */
export const APP_LOCK = Object.freeze([168344, 20260918]);

/** Why one nurse entry did not become an assignment. Reported, never silent. */
export const SKIPS = Object.freeze([
  'address_unknown',        // no enabled identity in this deployment has it
  'not_in_patient_agency',  // the person exists but holds no membership where the patient is
  'role_not_assignable',    // they hold a membership, but not one that opens charts
  'membership_revoked',     // the membership is not active
  'already_recorded',       // the store already has this assignment, in any status
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const APP = /^[a-f0-9]{24}$/;
/** The store's own address shape, so this cannot admit one the store refuses. */
const EMAIL = /^[^\s@]+@[^\s@]+$/;

export class BackfillError extends Error {
  constructor(code) { super(code); this.name = 'BackfillError'; this.code = code; }
}
const check = (value, code = 'BACKFILL_EXPORT_INVALID') => { if (!value) throw new BackfillError(code); };
const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');

/**
 * The store's normalisation, not a convenience one.
 *
 * `identity_map.expected_email` carries `expected_email = lower(btrim(...))`
 * as a CHECK, so this is the same transformation the database already applied
 * to the value being matched against. Anything more — stripping dots, ignoring
 * a plus-suffix — would match addresses the store considers different, which
 * is how an assignment lands on the wrong person.
 */
export const normalizeEmail = value => (typeof value === 'string' ? value.trim().toLowerCase() : null);

/**
 * Read an export into the shape this tool plans from.
 *
 * Only three fields per patient are read, and the rest of the row is ignored
 * rather than carried: this tool has no reason to hold a name, an address or a
 * diagnosis, and a tool that never reads them cannot leak them.
 */
export function readExport(raw) {
  check(typeof raw === 'string' && raw.length <= MAX_EXPORT_BYTES, 'BACKFILL_EXPORT_TOO_LARGE');
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new BackfillError('BACKFILL_EXPORT_INVALID_JSON'); }
  check(isObject(parsed));
  check(parsed.contract === BACKFILL_CONTRACT, 'BACKFILL_EXPORT_UNSUPPORTED');
  check(typeof parsed.app_id === 'string' && APP.test(parsed.app_id), 'BACKFILL_EXPORT_APP_INVALID');
  check(Array.isArray(parsed.patients) && parsed.patients.length <= LIMITS.patients);
  const patients = parsed.patients.map((patient) => {
    check(isObject(patient));
    check(typeof patient.id === 'string' && ID.test(patient.id), 'BACKFILL_PATIENT_ID_INVALID');
    // A patient with no agency cannot be assigned to anyone: there is no
    // tenant to resolve a membership within, and guessing one is the invented
    // row this file exists to refuse.
    check(typeof patient.agency_id === 'string' && ID.test(patient.agency_id), 'BACKFILL_PATIENT_AGENCY_INVALID');
    const nurses = patient.assigned_nurses ?? [];
    check(Array.isArray(nurses) && nurses.length <= LIMITS.nursesPerPatient, 'BACKFILL_NURSES_INVALID');
    const addresses = nurses.map((entry) => {
      const email = normalizeEmail(entry);
      // A malformed entry fails the RUN. An export this tool cannot read is a
      // reason to stop, not to carry on with the rows that happened to parse.
      check(email && EMAIL.test(email) && email.length <= 254, 'BACKFILL_NURSE_ADDRESS_INVALID');
      return email;
    });
    // The same address twice on one patient is one assignment.
    return { id: patient.id, agency_id: patient.agency_id, addresses: [...new Set(addresses)].sort() };
  });
  return { app_id: parsed.app_id, patients };
}

/**
 * What the run would write, decided against the store's own rows.
 *
 * `roster` is what the database answers for this deployment: one entry per
 * (email, agency) naming the membership, its role and its status. Everything
 * this function decides, it decides from that — never from the export, which
 * is the untrusted side.
 */
export function planBackfill({ app_id: appId, patients }, roster, existing) {
  const held = new Map();
  for (const entry of roster) {
    const email = normalizeEmail(entry.email);
    check(email && typeof entry.agency_id === 'string' && typeof entry.membership_id === 'string',
      'BACKFILL_ROSTER_INVALID');
    const key = `${email}\u0000${entry.agency_id}`;
    // A person cannot hold two memberships in one agency — the store's own
    // unique key says so — but a roster that somehow carried two would make
    // the resolution ambiguous, and ambiguity resolves to dropping the row.
    held.set(key, held.has(key) ? null : entry);
  }
  const recorded = new Set(existing.map(entry => `${entry.patient_id}\u0000${entry.membership_id}`));
  const grants = [];
  const skipped = [];
  const seen = new Set();
  for (const patient of patients) {
    for (const email of patient.addresses) {
      const drop = reason => skipped.push({ patient_id: patient.id, agency_id: patient.agency_id, reason });
      const entry = held.get(`${email}\u0000${patient.agency_id}`);
      if (entry === undefined) {
        // Either nobody in this deployment has the address, or the person
        // exists and holds nothing where this patient is. The two are told
        // apart for the report, because they need different remedies.
        const anywhere = roster.some(row => normalizeEmail(row.email) === email);
        drop(anywhere ? 'not_in_patient_agency' : 'address_unknown');
        continue;
      }
      if (entry === null) { drop('not_in_patient_agency'); continue; }
      if (entry.status !== 'active') { drop('membership_revoked'); continue; }
      if (!ASSIGNABLE_ROLES.includes(entry.tenant_role)) { drop('role_not_assignable'); continue; }
      const key = `${patient.id}\u0000${entry.membership_id}`;
      // Already in the store, in ANY status. A revoked assignment is access
      // somebody withdrew, and `assigned_nurses` cannot tell that from never
      // having been assigned — so re-granting it is the invented row arriving
      // by another route.
      if (recorded.has(key)) { drop('already_recorded'); continue; }
      if (seen.has(key)) continue;
      seen.add(key);
      grants.push({ app_id: appId, agency_id: patient.agency_id,
        patient_id: patient.id, membership_id: entry.membership_id });
    }
  }
  grants.sort((left, right) => (left.patient_id + left.membership_id)
    .localeCompare(right.patient_id + right.membership_id));
  return { app_id: appId, grants, skipped, digest: sha(JSON.stringify(grants)) };
}

/**
 * A report an operator can review before anything is written, and afterwards
 * as the record of what was.
 *
 * Counts and reasons only. A line of this may be pasted into a ticket, so it
 * carries no address, no name, and no patient id — a `not_in_patient_agency`
 * count of 40 is the finding, and the operator reads which rows from the plan
 * file, which stays where they can see it and this tool does not print.
 */
export function summarize(plan) {
  const reasons = Object.fromEntries(SKIPS.map(reason => [reason, 0]));
  for (const entry of plan.skipped) reasons[entry.reason] += 1;
  const agencies = new Set(plan.grants.map(grant => grant.agency_id));
  return {
    contract: BACKFILL_CONTRACT,
    app_id: plan.app_id,
    digest: plan.digest,
    grants: plan.grants.length,
    agencies: agencies.size,
    patients: new Set(plan.grants.map(grant => grant.patient_id)).size,
    skipped: plan.skipped.length,
    reasons,
  };
}

/**
 * Apply a plan, under the same lock and in one transaction.
 *
 * `execute` is the caller's — a `pg` client's `query`, or a test double. This
 * module opens no connection and holds no credential.
 *
 * The digest is checked against the plan being applied, so what an operator
 * reviewed is what runs: a plan regenerated against a store that changed in
 * between produces a different digest and is refused rather than applied.
 */
export async function applyBackfill(execute, plan, { actorId, expectedDigest }) {
  check(typeof actorId === 'string' && UUID.test(actorId), 'BACKFILL_ACTOR_INVALID');
  check(plan.digest === expectedDigest, 'BACKFILL_PLAN_CHANGED');
  if (!plan.grants.length) return { applied: 0 };
  await execute('begin');
  try {
    await execute('select pg_advisory_xact_lock($1,$2)', [APP_LOCK[0], APP_LOCK[1]]);
    let applied = 0;
    for (const grant of plan.grants) {
      // `on conflict do nothing`, not `do update`. A row that appeared between
      // planning and applying is somebody else's decision, and overwriting it
      // would be this tool deciding something it was not asked to.
      const result = await execute(
        `insert into pennsync_private.assignment
           (app_id, agency_id, patient_id, membership_id, status, changed_by)
         values ($1,$2,$3,$4,'active',$5)
         on conflict (app_id, patient_id, membership_id) do nothing
         returning patient_id`,
        [grant.app_id, grant.agency_id, grant.patient_id, grant.membership_id, actorId]);
      applied += (result?.rows ?? result ?? []).length;
    }
    await execute('commit');
    return { applied };
  } catch (error) {
    await execute('rollback').catch(() => {});
    throw error instanceof BackfillError ? error : new BackfillError('BACKFILL_APPLY_FAILED');
  }
}

export async function main(args = process.argv.slice(2), { log = console.log, read = readFile } = {}) {
  const [file, ...rest] = args;
  if (!file || rest.length) {
    log(JSON.stringify({ error: 'BACKFILL_USAGE', usage: 'tools-pennsync-assignment-backfill.mjs <export.json>' }));
    return 2;
  }
  try {
    // Planning only. Applying needs a connection and an operator, and this
    // command line deliberately takes neither: a tool that can write to a
    // production authority store by being run with one argument is one nobody
    // should have on their path.
    const parsed = readExport(await read(file, 'utf8'));
    log(JSON.stringify({ contract: BACKFILL_CONTRACT, app_id: parsed.app_id,
      patients: parsed.patients.length,
      addresses: parsed.patients.reduce((total, patient) => total + patient.addresses.length, 0) }, null, 2));
    return 0;
  } catch (error) {
    log(JSON.stringify({ error: error?.code ?? 'BACKFILL_FAILED' }));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main());
}
