import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

/**
 * Which authority brokers bind a care-team assignment to the caller's current
 * membership, and which only check the assignment's fields are well formed.
 *
 * `validateAssignmentIntegrity` is copied into twelve functions. Eleven of the
 * twelve agree on almost everything, but they split on one condition that
 * decides how much authority an old assignment still carries:
 *
 *   binding      row.assignee_membership_id !== authority.membership.id
 *             || row.assignee_membership_version_at_enablement !== authority.membership.version
 *
 *   well-formed  exactIdentifier(row.assignee_membership_id)
 *             && Number.isSafeInteger(row.assignee_membership_version_at_enablement)
 *             && row.assignee_membership_version_at_enablement >= 1
 *
 * A binding copy refuses an assignment that was enabled against a different
 * membership row, or against an earlier version of the same one — so a role
 * change or a revoke-and-regrant invalidates the assignment until it is issued
 * again. A well-formed copy accepts it as long as the caller separately holds
 * an active membership in the agency.
 *
 * The split does not follow entity families, which is what makes it look
 * unintended rather than designed:
 *
 *   - `listAuthorizedPatients` binds; `getAuthorizedPatient` does not. Listing
 *     patients is the broader disclosure, yet it is the harder one to pass.
 *   - `saveOasisResponses` binds; `readAuthorizedOASISAssessments` does not.
 *   - All three Document brokers are well-formed only; all four Visit brokers
 *     bind.
 *
 * Reconciling this is a behavior decision, not a refactor, and it has an
 * operational edge: tightening the five well-formed copies would deny a
 * clinician whose membership version moved since the assignment was granted,
 * which in this product means losing chart access mid-visit. Loosening the
 * seven binding copies would drop a real revocation check. Either way the
 * choice belongs to a reviewer, so this test states the split rather than
 * resolving it, and fails when any copy changes side.
 */
/**
 * The copies fall into three tiers, and the two markers nest: nothing compares
 * the caller's email while skipping the membership binding. That makes this a
 * strictness ordering rather than scattered drift.
 */
const TIERS = {
  /** Binds the assignment to the caller's membership, and to their email. */
  strict: [
    'createAuthorizedVisit',
    'generateFaxCoverPage',
    'getAuthorizedVisit',
    'listAuthorizedPatients',
    'listAuthorizedVisits',
    'saveOasisResponses',
    'updateAuthorizedVisit',
  ],
  /** Checks the membership fields are well formed; still binds the email. */
  middle: [
    'createAuthorizedDocument',
    'getAuthorizedDocument',
    'listAuthorizedDocuments',
  ],
  /**
   * Neither. These bind the assignment to the caller by `user_id` alone, which
   * is the authoritative identifier, so this is defensible rather than open —
   * but it is two cross-checks fewer than the strict tier, and both of these
   * are PHI reads: the single-patient fetch and the clinical assessment read.
   */
  loosest: [
    'getAuthorizedPatient',
    'readAuthorizedOASISAssessments',
  ],
};
const BINDS_TO_MEMBERSHIP = TIERS.strict;
const WELL_FORMED_ONLY = [...TIERS.middle, ...TIERS.loosest];

function assignmentCheck(name) {
  const path = new URL(`../functions/${name}/entry.ts`, import.meta.url);
  assert.ok(existsSync(path), `${name} should exist`);
  const source = readFileSync(path, 'utf8');
  const start = source.search(/^function validateAssignmentIntegrity\s*\(/m);
  assert.ok(start >= 0, `${name} should define validateAssignmentIntegrity`);
  let i = source.indexOf('(', start), depth = 0;
  for (; i < source.length; i++) { if (source[i] === '(') depth++; else if (source[i] === ')') { depth--; if (!depth) { i++; break; } } }
  const brace = source.indexOf('{', i);
  depth = 0;
  let end = -1;
  for (let j = brace; j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}') { depth--; if (!depth) { end = j; break; } }
  }
  assert.ok(end > brace, `${name}: could not read the check body`);
  return source.slice(start, end + 1);
}

/**
 * Binding compares the row against the caller's membership, not just its shape.
 *
 * The copies do not agree on how authority reaches them: some take one
 * `authority` object, others take `agencyId`, `userId`, `normalizedEmail` and
 * `membership` as separate parameters. That difference is cosmetic, so every
 * pattern here tolerates an optional receiver.
 */
const OWNED = String.raw`(?:\w+\.)?`;
const binds = body => new RegExp(String.raw`assignee_membership_id\s*!==\s*${OWNED}membership\.id`).test(body)
  && new RegExp(String.raw`assignee_membership_version_at_enablement\s*!==\s*${OWNED}membership\.version`).test(body);

test('every broker carrying the check is classified, and none has drifted', () => {
  const classified = [...BINDS_TO_MEMBERSHIP, ...WELL_FORMED_ONLY].sort();
  assert.equal(new Set(classified).size, classified.length, 'a name is listed twice');
  assert.equal(classified.length, 12, 'the number of copies changed');
  for (const name of BINDS_TO_MEMBERSHIP) {
    assert.equal(binds(assignmentCheck(name)), true,
      `${name} stopped binding the assignment to the caller's membership`);
  }
  for (const name of WELL_FORMED_ONLY) {
    assert.equal(binds(assignmentCheck(name)), false,
      `${name} now binds to the caller's membership — if that is the reconciliation, move it to the other list`);
  }
});

test('both conventions still agree on everything the split does not touch', () => {
  // Whatever the two sides disagree about, they must not drift on the rest:
  // the row has to name this caller, this agency and this patient, and carry a
  // coherent lifecycle. A copy that quietly dropped one of these would be a
  // hole regardless of which side of the split it sits on.
  const shared = [
    String.raw`assignment_key\s*!==\s*key`,
    String.raw`agency_id\s*!==\s*${OWNED}agencyId`,
    String.raw`patient_id\s*!==\s*patientId`,
    String.raw`user_id\s*!==\s*${OWNED}userId`,
    String.raw`ASSIGNMENT_STATUSES\.has\(`,
    String.raw`ASSIGNMENT_ACTIONS\.has\(`,
    String.raw`ASSIGNMENT_SOURCES\.has\(`,
    String.raw`validInstant\(\w+\??\.?\w*\.?activated_at\)`,
    String.raw`Number\.isSafeInteger\(\w+\.version\)`,
  ].map(pattern => new RegExp(pattern));
  for (const name of [...BINDS_TO_MEMBERSHIP, ...WELL_FORMED_ONLY]) {
    const body = assignmentCheck(name);
    for (const pattern of shared) {
      assert.match(body, pattern, `${name} is missing a condition every copy shares`);
    }
    // Every copy refuses by throwing, never by returning a falsy value that a
    // caller might ignore.
    assert.match(body, /throw new PublicError\(409,/, `${name} must refuse by throwing`);
  }
});

test('the caller-email comparison tracks the membership binding, never the reverse', () => {
  // `generateFaxCoverPage` calls the field `authority.email`; the rest use
  // `normalizedEmail`. Either way it is the same comparison.
  const comparesEmail = body => new RegExp(
    String.raw`userEmail\s*!==\s*${OWNED}(?:normalizedEmail|email)`,
  ).test(body);
  for (const name of [...TIERS.strict, ...TIERS.middle]) {
    assert.equal(comparesEmail(assignmentCheck(name)), true,
      `${name} stopped comparing the assignment's email to the caller's`);
  }
  for (const name of TIERS.loosest) {
    assert.equal(comparesEmail(assignmentCheck(name)), false,
      `${name} now compares the caller's email — if that is the reconciliation, move it up a tier`);
  }
  // The ordering is what makes this tractable to reconcile: a copy that bound
  // the membership but skipped the email would be a fourth, unexplained shape.
  for (const name of TIERS.strict) {
    const body = assignmentCheck(name);
    assert.ok(binds(body) && comparesEmail(body), `${name} should be strict on both markers`);
  }
});
