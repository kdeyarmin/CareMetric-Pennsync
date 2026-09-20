import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  POLICIES, POLICY_FILE, POLICY_SQL_FILE, TENANT_ROLES, UNSUPPORTED_ROLES,
  begin, declarations, end, extract, main, policyBlock, readPolicy, render, renderSql, tableColumns,
} from './tools-patient-purpose-policy.mjs';
import {
  PATIENT_EXACT_PURPOSES, PATIENT_EXACT_PURPOSE_POLICY,
  PATIENT_LIST_PURPOSES, PATIENT_LIST_PURPOSE_POLICY,
} from './services/pennsync-api/patient-purpose-policy.mjs';

/**
 * What this holds honest is that the committed policies ARE the originals'.
 *
 * `listAuthorizedPatients` and `getAuthorizedPatient` decide, per purpose,
 * which patient fields are disclosed and to which tenant roles. A field added
 * to a committed copy and not the original widens a clinical disclosure; one
 * dropped narrows it silently. Neither is visible by reading either file
 * alone, which is the whole argument for extracting rather than retyping —
 * and for this test.
 */
const repository = resolve(dirname(fileURLToPath(import.meta.url)));
const committed = {
  list: { purposes: PATIENT_LIST_PURPOSES, policy: PATIENT_LIST_PURPOSE_POLICY },
  exact: { purposes: PATIENT_EXACT_PURPOSES, policy: PATIENT_EXACT_PURPOSE_POLICY },
};
const [LIST, EXACT] = POLICIES;

test('the committed policies are exactly what the originals declare', () => {
  const extracted = extract(repository);
  for (const policy of POLICIES) {
    const { purposes, policy: declared } = committed[policy.key];
    assert.deepEqual(Object.keys(extracted[policy.key]).sort(), [...purposes],
      `${policy.key} purposes have drifted`);
    for (const purpose of purposes) {
      assert.deepEqual(declared[purpose].fields, extracted[policy.key][purpose].fields,
        `${policy.key}.${purpose} fields have drifted from the original`);
      assert.deepEqual(declared[purpose].roles, extracted[policy.key][purpose].roles,
        `${policy.key}.${purpose} roles have drifted from the original`);
      assert.equal(declared[purpose].page_size, extracted[policy.key][purpose].page_size);
    }
  }
  // A single read has no page to bound, and inventing one would be a bound
  // nobody wrote.
  assert.ok(POLICIES.find(policy => policy.key === 'exact').paged === false);
  for (const purpose of PATIENT_EXACT_PURPOSES) {
    assert.ok(!Object.hasOwn(PATIENT_EXACT_PURPOSE_POLICY[purpose], 'page_size'));
  }
  // And both committed FILES match what the generator renders, so an edit to
  // either artifact is caught as well as an edit to a policy.
  assert.equal(readFileSync(resolve(repository, POLICY_FILE), 'utf8'), render(extracted));
  assert.equal(readFileSync(resolve(repository, POLICY_SQL_FILE), 'utf8'),
    renderSql(extracted, tableColumns(repository)));
  assert.equal(main(['--write'], { repository, log: () => {}, write: () => {} }), 0);
  assert.equal(main([], { repository, log: () => {} }), 0, 'the committed copies are current');
});

test('the two vocabularies are separate, and nothing merges them', () => {
  // A list is asked for `contact` or `roster`; one chart is opened for
  // `smart_note_context`. If these ever overlapped, a list caller could reach
  // a single-chart projection by naming its purpose.
  const shared = PATIENT_LIST_PURPOSES.filter(purpose => PATIENT_EXACT_PURPOSES.includes(purpose));
  assert.deepEqual(shared, [], 'a purpose in both would be a projection nobody chose');
  assert.ok(PATIENT_LIST_PURPOSES.includes('roster') && PATIENT_EXACT_PURPOSES.includes('display'));
});

test('each policy is read from its own fenced block, not from the module around it', () => {
  // The markers are the contract: `patientReadAuthorizationContract.test.js`
  // already asserts the originals carry them, and this is what reads them.
  for (const policy of POLICIES) {
    const source = readFileSync(resolve(repository, policy.original), 'utf8');
    assert.ok(source.includes(begin(policy)) && source.includes(end(policy)));
    const block = policyBlock(source, policy);
    for (const name of declarations(policy)) assert.match(block, new RegExp(`const\\s+${name}\\b`));
    // Nothing outside the fence is read: a constant declared after the END
    // marker is not part of the policy and must not become part of it.
    assert.ok(!block.includes('MEMBERSHIP_AUTHORITY_FIELDS'), 'the block must stop at the END marker');
    assert.throws(() => policyBlock('no markers here', policy),
      error => error?.code === 'POLICY_MARKERS_MISSING');
    assert.throws(() => policyBlock(`${end(policy)}\n${begin(policy)}`, policy),
      error => error?.code === 'POLICY_MARKERS_MISSING');
  }
  // And one policy's markers do not find the other's block.
  const listSource = readFileSync(resolve(repository, LIST.original), 'utf8');
  assert.throws(() => policyBlock(listSource, EXACT), error => error?.code === 'POLICY_MARKERS_MISSING');
});

test('a policy that would disclose to nobody, or without a bound, is refused', () => {
  // An empty role set reads like a safe default and is a broken capability;
  // an absent page size is no bound at all. Both fail rather than extract.
  const block = (body, policy = LIST) => `${begin(policy)}\n${body}\n${end(policy)}`;
  const complete = `const PURPOSE_FIELDS = { roster: ['id', 'last_name'] };
    const PURPOSE_ROLES = { roster: new Set(['manager']) };
    const PURPOSE_MAX_PAGE_SIZE = { roster: 25 };`;
  assert.deepEqual(readPolicy(block(complete), LIST),
    { roster: { fields: ['id', 'last_name'], roles: ['manager'], page_size: 25 } });
  const refuses = (body, code, policy = LIST) => assert.throws(
    () => readPolicy(block(body, policy), policy), error => error?.code === code, code);
  refuses(complete.replace("new Set(['manager'])", 'new Set([])'), 'POLICY_ROLES_INVALID:roster');
  refuses(complete.replace("roster: ['id', 'last_name']", 'roster: []'), 'POLICY_FIELDS_INVALID:roster');
  refuses(complete.replace('roster: 25', 'roster: 0'), 'POLICY_PAGE_SIZE_INVALID:roster');
  // A projection with no `id` answers rows nothing can page on or follow up.
  refuses(complete.replace("['id', 'last_name']", "['last_name']"), 'POLICY_FIELDS_WITHOUT_ID:roster');
  // A block that stopped declaring one of them is a failure, not an empty
  // policy: an absent `PURPOSE_ROLES` would admit nobody.
  for (const name of declarations(LIST)) {
    refuses(complete.replace(`const ${name}`, `const unused_${name}`), `POLICY_MISSING_${name}`);
  }
  // The single-read policy needs no page size and is not asked for one.
  const noBound = complete.split('\n').slice(0, 2).join('\n');
  assert.deepEqual(readPolicy(block(noBound, EXACT), EXACT),
    { roster: { fields: ['id', 'last_name'], roles: ['manager'] } });
});

test('the emitted SQL refuses a field the table lacks and a role nothing can hold', () => {
  const extracted = extract(repository);
  const columns = tableColumns(repository);
  assert.ok(columns.includes('date_of_birth') && columns.includes('id'));
  const refuses = (mutate, code) => {
    const broken = structuredClone(extracted);
    mutate(broken);
    assert.throws(() => renderSql(broken, columns), error => error?.code === code, code);
  };
  // A field the record store has no column for would emit SQL that fails at
  // apply time; finding that out in CI hours later is worse than here.
  refuses(policy => policy.list.roster.fields.push('social_security_number'),
    'POLICY_FIELD_NOT_A_COLUMN:list.roster.social_security_number');
  refuses(policy => policy.exact.display.roles.push('superuser'),
    'POLICY_ROLE_UNKNOWN:exact.display.superuser');
  // Dropping the platform tier must never be what closes a purpose: that
  // would turn a capability off by accident.
  refuses(policy => { policy.list.roster.roles = [...UNSUPPORTED_ROLES]; },
    'POLICY_PURPOSE_ADMITS_NOBODY:list.roster');
});

test('the emitted SQL is the policy, and the platform tier is the one thing it drops', () => {
  const sql = readFileSync(resolve(repository, POLICY_SQL_FILE), 'utf8');
  // The divergence is recorded in the file a reviewer reads, not only here.
  assert.match(sql, /narrowing: platform_owner is/);
  for (const role of UNSUPPORTED_ROLES) {
    assert.ok(!new RegExp(`'${role}'`).test(sql), `${role} must not reach the emitted SQL`);
  }
  // Every role that does reach it is one `caller_tenant_role` can answer.
  for (const match of sql.matchAll(/p_role in \(([^)]*)\)/g)) {
    for (const role of match[1].split(',').map(part => part.trim().replace(/'/g, ''))) {
      assert.ok(TENANT_ROLES.includes(role), `${role} is not a tenant role`);
    }
  }
  // Both vocabularies are emitted, each with its own existence check, and only
  // the paged one has a bound.
  for (const policy of POLICIES) {
    for (const suffix of ['known', 'admits', 'row']) {
      assert.ok(sql.includes(`"${policy.prefix}_${suffix}"`), `${policy.prefix}_${suffix}`);
    }
    assert.equal(sql.includes(`"${policy.prefix}_page_size"`), policy.paged);
  }
  // No caller role may ask a policy anything; the contracts are the way in.
  assert.match(sql, /revoke all on function[\s\S]*from public, anon, authenticated, service_role;/);
  assert.ok(!/grant execute/.test(sql), 'the policy grants nothing to anybody');
});

test('the extracted policies are real clinical disclosure contracts, not stubs', () => {
  assert.equal(PATIENT_LIST_PURPOSES.length, 8);
  assert.equal(PATIENT_EXACT_PURPOSES.length, 8);
  for (const { purposes, policy } of Object.values(committed)) {
    for (const purpose of purposes) {
      assert.ok(policy[purpose].fields.includes('id'));
      assert.ok(policy[purpose].roles.length > 0);
    }
  }
  // The narrowest and the widest, named, because they are the two a reviewer
  // should look at first: who may read contact details, and who may read a
  // patient's identity for matching.
  assert.deepEqual(PATIENT_LIST_PURPOSE_POLICY.identity_match.roles,
    ['agency_admin', 'manager', 'platform_owner']);
  assert.ok(PATIENT_LIST_PURPOSE_POLICY.identity_match.fields.includes('date_of_birth'));
  assert.ok(!PATIENT_LIST_PURPOSE_POLICY.roster.fields.includes('date_of_birth'),
    'the roster purpose must not disclose a date of birth');
  assert.ok(!PATIENT_LIST_PURPOSE_POLICY.roster.fields.includes('address'));
  // And the single-read side: `display` carries a name and nothing else.
  assert.deepEqual(PATIENT_EXACT_PURPOSE_POLICY.display.fields,
    ['id', 'first_name', 'middle_name', 'last_name']);
});

test('the command line refuses an argument nobody declared', () => {
  const lines = [];
  assert.equal(main(['--nope'], { repository, log: line => lines.push(line) }), 2);
  assert.match(lines.at(-1), /POLICY_INVALID_ARGUMENTS/);
  assert.equal(main(['--json'], { repository, log: () => {} }), 0);
});
