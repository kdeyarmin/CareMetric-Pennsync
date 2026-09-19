import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

/**
 * Every broker binds a care-team assignment to the caller's current membership.
 * They disagree only about where that binding is written.
 *
 * `validateAssignmentIntegrity` is copied into twelve functions. Reading the
 * predicate alone suggests a strictness split: seven copies compare the row
 * against `membership.id` and `membership.version` inside the guard, and five
 * do not. That reading is wrong. The other five perform exactly the same
 * comparison in the caller, on the line after the predicate returns:
 *
 *     const assignment = await loadExactAssignment(...);
 *     if (
 *       !authority.membership
 *       || assignment.user_email_normalized !== authority.normalizedEmail
 *       || assignment.assignee_membership_id !== authority.membership.id
 *       || assignment.assignee_membership_version_at_enablement !== authority.membership.version
 *     ) throw new PublicError(409, 'Care-team assignment binding is invalid');
 *
 * So all twelve enforce the same authorization. What differs is placement, and
 * placement is a real hazard for the port even though it is not a hole: a
 * reviewer who reads only the predicate concludes that five PHI paths are
 * weaker than they are, and anyone porting the predicate without its caller
 * would carry the weaker half into the new service and drop the binding.
 *
 * That is what this pins. The safety property is that every copy binds
 * *somewhere*; the bookkeeping is which half of the pair holds it. A copy that
 * loses the binding from both places fails here, and so does one that quietly
 * changes sides, which is the signal that the reconciliation happened.
 */

/** Binds inside `validateAssignmentIntegrity` itself. */
const BINDS_IN_PREDICATE = [
  'createAuthorizedVisit',
  'generateFaxCoverPage',
  'getAuthorizedVisit',
  'listAuthorizedPatients',
  'listAuthorizedVisits',
  'saveOasisResponses',
  'updateAuthorizedVisit',
];
/** Binds in the caller, immediately after the predicate returns. */
const BINDS_AT_CALL_SITE = [
  'createAuthorizedDocument',
  'getAuthorizedDocument',
  'getAuthorizedPatient',
  'listAuthorizedDocuments',
  'readAuthorizedOASISAssessments',
];
const ALL = [...BINDS_IN_PREDICATE, ...BINDS_AT_CALL_SITE];

/** Some copies take one `authority` object, others take flat parameters. */
const OWNED = String.raw`(?:\w+\.)?`;
const BINDS_ID = new RegExp(String.raw`assignee_membership_id\s*!==\s*${OWNED}membership\.id`);
const BINDS_VERSION = new RegExp(
  String.raw`assignee_membership_version_at_enablement\s*!==\s*${OWNED}membership\.version`,
);
/** `generateFaxCoverPage` calls the same field `authority.email`. */
const COMPARES_EMAIL = new RegExp(
  String.raw`(?:userEmail|user_email_normalized)\s*!==\s*${OWNED}(?:normalizedEmail|email)`,
);

function source(name) {
  const path = new URL(`../functions/${name}/entry.ts`, import.meta.url);
  assert.ok(existsSync(path), `${name} should exist`);
  return readFileSync(path, 'utf8');
}

function predicate(name) {
  const text = source(name);
  const start = text.search(/^function validateAssignmentIntegrity\s*\(/m);
  assert.ok(start >= 0, `${name} should define validateAssignmentIntegrity`);
  let i = text.indexOf('(', start), depth = 0;
  for (; i < text.length; i++) { if (text[i] === '(') depth++; else if (text[i] === ')') { depth--; if (!depth) { i++; break; } } }
  const brace = text.indexOf('{', i);
  depth = 0;
  let end = -1;
  for (let j = brace; j < text.length; j++) {
    if (text[j] === '{') depth++;
    else if (text[j] === '}') { depth--; if (!depth) { end = j; break; } }
  }
  assert.ok(end > brace, `${name}: could not read the predicate body`);
  return text.slice(start, end + 1);
}

test('every copy binds the assignment to the caller, somewhere', () => {
  // The safety property, stated without reference to placement. If this fails,
  // a PHI path stopped checking that the assignment belongs to this caller's
  // current membership.
  assert.equal(new Set(ALL).size, ALL.length, 'a name is listed twice');
  assert.equal(ALL.length, 12, 'the number of copies changed');
  for (const name of ALL) {
    const text = source(name);
    assert.match(text, BINDS_ID, `${name} no longer binds the assignment to a membership id`);
    assert.match(text, BINDS_VERSION, `${name} no longer binds the assignment to a membership version`);
    assert.match(text, COMPARES_EMAIL, `${name} no longer compares the assignment's email to the caller's`);
  }
});

test('the binding is never dereferenced without a membership to bind to', () => {
  // `authority.membership` is null for a protected platform owner, so every
  // binding must be guarded or it throws a TypeError instead of a 409.
  for (const name of ALL) {
    const text = source(name);
    const guarded = /!\w+\.membership\b/.test(text) || /!\bmembership\b/.test(text)
      // Flat-parameter copies receive a membership that the caller already
      // proved is active, so there is nothing nullable to guard.
      || /membership: Record<string, unknown>/.test(text)
      || /membership\.tenant_role/.test(text);
    assert.ok(guarded, `${name} dereferences membership without establishing it exists`);
  }
});

test('placement is pinned, because porting the predicate alone would drop half of it', () => {
  for (const name of BINDS_IN_PREDICATE) {
    const body = predicate(name);
    assert.match(body, BINDS_ID, `${name} moved its binding out of the predicate`);
    assert.match(body, BINDS_VERSION, `${name} moved its binding out of the predicate`);
  }
  for (const name of BINDS_AT_CALL_SITE) {
    const body = predicate(name);
    assert.doesNotMatch(body, BINDS_ID,
      `${name} moved its binding into the predicate — if that is the reconciliation, move it to the other list`);
  }
});

test('all twelve agree on the conditions neither half of the pair moved', () => {
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
  for (const name of ALL) {
    const body = predicate(name);
    for (const pattern of shared) {
      assert.match(body, pattern, `${name} is missing a condition every copy shares`);
    }
    assert.match(body, /throw new PublicError\(409,/, `${name} must refuse by throwing`);
  }
});
