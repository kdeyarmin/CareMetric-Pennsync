#!/usr/bin/env node
/**
 * The care-team backfill D24 requires, and the one thing it must never do.
 *
 * D24 makes the authority store's assignment model the authority on who may
 * open a chart. Today's care teams do not live there yet, so they have to be
 * carried across: moving authority without the rows means every clinician
 * loses access to their own patients on cutover.
 *
 * **What it carries, and why not the obvious thing.** A first version read
 * `Patient.assigned_nurses`, an array of email addresses on the patient row.
 * That is the wrong source and reading the modules says so plainly:
 * `listAuthorizedPatients` states in its own header that "mutable
 * assigned_nurses email values are not treated as authority", and the entity
 * it does trust — `PatientCareTeamAssignment` — carries a `source` enum whose
 * values include `legacy_assigned_nurses`. **The migration off
 * `assigned_nurses` already happened inside Base44.** Those emails were turned
 * into server-owned assignment rows, with provenance recorded, and the
 * assignment rows have a lifecycle the emails do not: grant, activate,
 * suspend, revoke.
 *
 * So reading `assigned_nurses` now would re-derive a derivation and, worse,
 * **resurrect access somebody revoked** — an email left on a patient row long
 * after the assignment built from it was suspended. That is precisely the
 * invented row this file exists to refuse, arriving by a route the first
 * version did not check.
 *
 * It carries `PatientCareTeamAssignment` instead, which also makes two other
 * problems disappear: a creator keeps their own patients, because the original
 * records that as an assignment with `source: 'patient_creator'` rather than
 * as a separate rule; and resolution is by **Base44 user id**, not by email,
 * so none of the address-matching hazards below can arise at all.
 *
 * **The failure it must not have is the quiet one.** D21 recorded the
 * asymmetry and it decides every judgement here: a backfill that drops a row
 * is a support ticket — a clinician says they cannot see a patient and an
 * administrator grants them. A backfill that INVENTS a row is a disclosure,
 * and nobody reports it, because nothing looks wrong to the person who now has
 * access they should not. So every ambiguity resolves to dropping the row, and
 * every dropped row is named in the report rather than counted.
 *
 * Concretely:
 *
 * - **Only an `active` assignment carries.** `suspended` is reversible and
 *   `revoked` is terminal; both mean somebody decided this person should not
 *   have the chart, and carrying either would undo that decision silently.
 * - **A user id resolves exactly or not at all.** It is matched against
 *   `identity_map.base44_user_id`, the same id the original treats as
 *   authoritative and which its schema says never to substitute an email for.
 * - **The membership must be in the ASSIGNMENT's agency.** A nurse who works
 *   for two agencies has two memberships; carrying an assignment into the
 *   wrong one would hand them a chart from an agency that never assigned it.
 * - **`assigned_nurses` is reconciled, never granted.** An address on a
 *   patient row with no active assignment behind it is REPORTED, so an
 *   operator can see what the earlier in-Base44 migration did not carry. It
 *   never becomes a row here: this tool cannot tell "never migrated" from
 *   "migrated and later revoked", and guessing is the disclosure.
 * - **It refuses rather than guesses about its own input.** A malformed export
 *   fails the run, because an export this tool cannot read is a reason to
 *   stop, not to carry on with the rows that happened to parse.
 *
 * Like `tools-pennsync-enroll.mjs`, the run is planned and reported before it
 * writes, the plan is digest-addressed so what was reviewed is what applies,
 * and no diagnostic carries an address, a name or a patient id.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const BACKFILL_CONTRACT = 'cm.pennsync.assignment-backfill.v2';
/** The roles the record store's `caller_assigned_patients` actually honours. */
export const ASSIGNABLE_ROLES = Object.freeze(['clinician', 'social_worker', 'spiritual_care']);
/** The only assignment state that means "this person has this chart, now". */
export const CARRIED_STATUS = 'active';
/** `PatientCareTeamAssignment.status`, as its schema declares it. */
export const ASSIGNMENT_STATUSES = Object.freeze(['active', 'suspended', 'revoked']);
export const MAX_EXPORT_BYTES = 64 * 1024 * 1024;
export const LIMITS = Object.freeze({ assignments: 200000, patients: 100000, nursesPerPatient: 200 });
/** The same write lock every authority mutation takes, so this serialises with them. */
export const APP_LOCK = Object.freeze([168344, 20260918]);

/** Why one assignment did not carry. Reported, never silent. */
export const SKIPS = Object.freeze([
  'status_not_active',      // suspended or revoked: somebody decided against this
  'user_unknown',           // no enabled identity in this deployment has that id
  'not_in_assignment_agency', // the person exists but holds no membership there
  'role_not_assignable',    // they hold a membership, but not one that opens charts
  'membership_revoked',     // the membership is not active
  'already_recorded',       // the store already has this assignment, in any status
]);
/**
 * Findings about `Patient.assigned_nurses` that are reported and never acted
 * on. An address with no active assignment behind it is the earlier in-Base44
 * migration's gap, and this tool cannot tell that from an assignment somebody
 * revoked afterwards — so it says so and grants nothing.
 */
export const RECONCILIATIONS = Object.freeze(['nurse_without_active_assignment']);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const APP = /^[a-f0-9]{24}$/;
/** A built-in Base44 User id, the shape `identity_map.base44_user_id` carries. */
const BASE44 = /^[a-f0-9]{24}$/;
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
 * Two lists, and only one of them can produce a grant. `assignments` are
 * `PatientCareTeamAssignment` rows — the server-owned care team the original
 * actually trusts. `patients` carries `assigned_nurses` for RECONCILIATION
 * only, so the report can name addresses the earlier in-Base44 migration left
 * behind without this tool deciding what they meant.
 *
 * Only the fields that decide something are read, and the rest of each row is
 * ignored rather than carried: this tool has no reason to hold a name, a
 * diagnosis or a note, and a tool that never reads them cannot leak them.
 */
export function readExport(raw) {
  check(typeof raw === 'string' && raw.length <= MAX_EXPORT_BYTES, 'BACKFILL_EXPORT_TOO_LARGE');
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new BackfillError('BACKFILL_EXPORT_INVALID_JSON'); }
  check(isObject(parsed));
  check(parsed.contract === BACKFILL_CONTRACT, 'BACKFILL_EXPORT_UNSUPPORTED');
  check(typeof parsed.app_id === 'string' && APP.test(parsed.app_id), 'BACKFILL_EXPORT_APP_INVALID');

  const rows = parsed.assignments ?? [];
  check(Array.isArray(rows) && rows.length <= LIMITS.assignments, 'BACKFILL_ASSIGNMENTS_INVALID');
  const assignments = rows.map((row) => {
    check(isObject(row), 'BACKFILL_ASSIGNMENT_INVALID');
    check(typeof row.agency_id === 'string' && ID.test(row.agency_id), 'BACKFILL_ASSIGNMENT_AGENCY_INVALID');
    check(typeof row.patient_id === 'string' && ID.test(row.patient_id), 'BACKFILL_ASSIGNMENT_PATIENT_INVALID');
    // The built-in Base44 User id, which the entity's own schema calls
    // authoritative and says never to substitute an email for.
    check(typeof row.user_id === 'string' && BASE44.test(row.user_id), 'BACKFILL_ASSIGNMENT_USER_INVALID');
    check(typeof row.status === 'string' && ASSIGNMENT_STATUSES.includes(row.status),
      'BACKFILL_ASSIGNMENT_STATUS_INVALID');
    return { agency_id: row.agency_id, patient_id: row.patient_id, user_id: row.user_id, status: row.status };
  });

  const declared = parsed.patients ?? [];
  check(Array.isArray(declared) && declared.length <= LIMITS.patients, 'BACKFILL_PATIENTS_INVALID');
  const patients = declared.map((patient) => {
    check(isObject(patient), 'BACKFILL_PATIENT_INVALID');
    check(typeof patient.id === 'string' && ID.test(patient.id), 'BACKFILL_PATIENT_ID_INVALID');
    check(typeof patient.agency_id === 'string' && ID.test(patient.agency_id), 'BACKFILL_PATIENT_AGENCY_INVALID');
    const nurses = patient.assigned_nurses ?? [];
    check(Array.isArray(nurses) && nurses.length <= LIMITS.nursesPerPatient, 'BACKFILL_NURSES_INVALID');
    const addresses = nurses.map((entry) => {
      const email = normalizeEmail(entry);
      check(email && EMAIL.test(email) && email.length <= 254, 'BACKFILL_NURSE_ADDRESS_INVALID');
      return email;
    });
    return { id: patient.id, agency_id: patient.agency_id, addresses: [...new Set(addresses)].sort() };
  });
  return { app_id: parsed.app_id, assignments, patients };
}

/**
 * What the run would write, decided against the store's own rows.
 *
 * `roster` is what the database answers for this deployment: one entry per
 * (base44 user id, agency) naming the membership, its role and its status.
 * Everything this function decides, it decides from that — never from the
 * export, which is the untrusted side.
 */
export function planBackfill({ app_id: appId, assignments, patients }, roster, existing) {
  const held = new Map();
  const byEmail = new Map();
  for (const entry of roster) {
    check(typeof entry.user_id === 'string' && typeof entry.agency_id === 'string'
      && typeof entry.membership_id === 'string', 'BACKFILL_ROSTER_INVALID');
    const key = `${entry.user_id}\u0000${entry.agency_id}`;
    // A person cannot hold two memberships in one agency — the store's own
    // unique key says so — but a roster that somehow carried two would make
    // the resolution ambiguous, and ambiguity resolves to dropping the row.
    held.set(key, held.has(key) ? null : entry);
    const email = normalizeEmail(entry.email);
    if (email) byEmail.set(`${email}\u0000${entry.agency_id}`, entry);
  }
  const recorded = new Set(existing.map(entry => `${entry.patient_id}\u0000${entry.membership_id}`));
  const grants = [];
  const skipped = [];
  const seen = new Set();
  const carried = new Set();
  for (const row of assignments) {
    const drop = reason => skipped.push({ patient_id: row.patient_id, agency_id: row.agency_id, reason });
    // First, because it is the decision somebody already made. A suspended or
    // revoked assignment means this person should not have the chart, and
    // carrying it would undo that silently.
    if (row.status !== CARRIED_STATUS) { drop('status_not_active'); continue; }
    const entry = held.get(`${row.user_id}\u0000${row.agency_id}`);
    if (entry === undefined) {
      // Either nobody in this deployment has that id, or the person exists and
      // holds nothing in the assignment's agency. Told apart for the report,
      // because they need different remedies.
      const anywhere = roster.some(candidate => candidate.user_id === row.user_id);
      drop(anywhere ? 'not_in_assignment_agency' : 'user_unknown');
      continue;
    }
    if (entry === null) { drop('not_in_assignment_agency'); continue; }
    if (entry.status !== 'active') { drop('membership_revoked'); continue; }
    if (!ASSIGNABLE_ROLES.includes(entry.tenant_role)) { drop('role_not_assignable'); continue; }
    const key = `${row.patient_id}\u0000${entry.membership_id}`;
    // Already in the store, in ANY status. A revoked assignment there is
    // access somebody withdrew after the export was taken.
    if (recorded.has(key)) { drop('already_recorded'); continue; }
    carried.add(`${row.patient_id}\u0000${entry.membership_id}`);
    if (seen.has(key)) continue;
    seen.add(key);
    grants.push({ app_id: appId, agency_id: row.agency_id,
      patient_id: row.patient_id, membership_id: entry.membership_id });
  }

  // Reconciliation only. An address still on a patient row with no active
  // assignment behind it is the earlier in-Base44 migration's gap — or an
  // assignment revoked since. This tool cannot tell those apart, so it names
  // the pair and grants nothing.
  const reconcile = [];
  for (const patient of patients) {
    for (const email of patient.addresses) {
      const entry = byEmail.get(`${email}\u0000${patient.agency_id}`);
      const key = entry ? `${patient.id}\u0000${entry.membership_id}` : null;
      if (key && (carried.has(key) || recorded.has(key))) continue;
      reconcile.push({ patient_id: patient.id, agency_id: patient.agency_id,
        reason: 'nurse_without_active_assignment' });
    }
  }
  grants.sort((left, right) => (left.patient_id + left.membership_id)
    .localeCompare(right.patient_id + right.membership_id));
  return { app_id: appId, grants, skipped, reconcile, digest: sha(JSON.stringify(grants)) };
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
    // Separate from `skipped` because it is a different kind of statement: a
    // skip is an assignment this run declined to carry, a reconciliation is an
    // address the EARLIER migration appears not to have carried. Counting them
    // together would read as one number of problems with one remedy.
    reconcile: plan.reconcile.length,
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
        `insert into pennsync_private.chart_assignment
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
      assignments: parsed.assignments.length,
      active: parsed.assignments.filter(row => row.status === CARRIED_STATUS).length,
      patients: parsed.patients.length,
      addresses: parsed.patients.reduce((total, patient) => total + patient.addresses.length, 0) }, null, 2));
    return 0;
  } catch (error) {
    log(JSON.stringify({ error: error?.code ?? 'BACKFILL_FAILED' }));
    return 1;
  }
}

// Direct-invocation check through pathToFileURL: a hand-built `file://`
// string never matches a Windows backslash path or a percent-encoded one,
// and the CLI then exits 0 having silently done nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main());
}
