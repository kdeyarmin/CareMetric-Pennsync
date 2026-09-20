import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACTION_INPUT_POLICIES, ACTION_POLICIES, DOMAINS, EXTRACTED_ONLY, POLICIES, POLICY_FILE,
  POLICY_SQL_FILES, TENANT_ROLES, UNSUPPORTED_ROLES, WRITE_POLICIES, begin, declarations, end,
  extract, extractActionInputs, extractActions, extractWrites, main, policyBlock, readActionInputs,
  readActionPolicy, readDeclaration, readDeclarations, readPolicy, render, renderSql, tableColumns,
} from './tools-read-purpose-policy.mjs';
import * as committed from './services/pennsync-api/read-purpose-policy.mjs';

/**
 * What this holds honest is that the committed policies ARE the originals'.
 *
 * Six capabilities read a clinical row and each decides, per purpose, which
 * fields are disclosed and to which tenant roles. A field added to a committed
 * copy and not the original widens a clinical disclosure; one dropped narrows
 * it silently. Neither is visible by reading either file alone, which is the
 * whole argument for extracting rather than retyping — and for this test.
 */
const repository = resolve(dirname(fileURLToPath(import.meta.url)));
const purposesOf = policy => committed[`${policy.constant}S`];
const policyOf = policy => committed[`${policy.constant}_POLICY`];
const byKey = Object.fromEntries(POLICIES.map(policy => [policy.key, policy]));
const columns = new Map();
const columnsFor = (table) => {
  if (!columns.has(table)) columns.set(table, tableColumns(repository, table));
  return columns.get(table);
};

test('the committed policies are exactly what the originals declare', () => {
  const extracted = extract(repository);
  assert.equal(POLICIES.length, 6, 'three domains, a list and a single read each');
  for (const policy of POLICIES) {
    const declared = policyOf(policy);
    assert.deepEqual(Object.keys(extracted[policy.key]).sort(), [...purposesOf(policy)],
      `${policy.key} purposes have drifted`);
    for (const purpose of purposesOf(policy)) {
      assert.deepEqual(declared[purpose].fields, extracted[policy.key][purpose].fields,
        `${policy.key}.${purpose} fields have drifted from the original`);
      assert.deepEqual(declared[purpose].roles, extracted[policy.key][purpose].roles,
        `${policy.key}.${purpose} roles have drifted from the original`);
      assert.equal(declared[purpose].page_size, extracted[policy.key][purpose].page_size);
      // A bound exists only where the original declares one per purpose.
      assert.equal(Object.hasOwn(declared[purpose], 'page_size'), policy.paged,
        `${policy.key}.${purpose} page bound`);
    }
  }
  // And every committed FILE matches what the generator renders, so an edit to
  // an artifact is caught as well as an edit to a policy.
  const writes = extractWrites(repository);
  const actions = extractActions(repository);
  const inputs = extractActionInputs(repository);
  assert.equal(readFileSync(resolve(repository, POLICY_FILE), 'utf8'),
    render(extracted, writes, actions, inputs));
  for (const domain of DOMAINS) {
    assert.equal(readFileSync(resolve(repository, POLICY_SQL_FILES[domain]), 'utf8'),
      renderSql(extracted, domain, columnsFor, writes, actions, inputs), `${domain} SQL has drifted`);
  }
  assert.equal(main(['--write'], { repository, log: () => {}, write: () => {} }), 0);
  assert.equal(main([], { repository, log: () => {} }), 0, 'the committed copies are current');
});

test('a purpose name shared by a list and a single read is never wider on the list', () => {
  // The patient and document pairs share no purpose at all: a patient list is
  // asked for `contact`, one chart is opened for `smart_note_context`.
  for (const [left, right] of [['patient_list', 'patient_exact'], ['document_list', 'document_exact']]) {
    assert.deepEqual(purposesOf(byKey[left]).filter(p => purposesOf(byKey[right]).includes(p)), [],
      `${left} and ${right} share a purpose`);
  }
  // The VISIT pair does, and what it means is the thing to hold: `schedule`,
  // `documentation` and `compliance_review` are each a purpose on both, and
  // the single read discloses MORE under the same word — `compliance_review`
  // is 8 fields on a list and 14 on one visit, because a list returns many
  // rows and a single read returns the one the caller already named.
  //
  // So the direction is the property, not the overlap. Merging the two
  // vocabularies, or letting either contract answer the other's `_known`,
  // would widen the list by six fields per row under a name that already
  // exists. Each contract asks its own, and this fails if a shared purpose
  // ever discloses something on a list that the single read does not.
  const shared = purposesOf(byKey.visit_list).filter(p => purposesOf(byKey.visit_exact).includes(p));
  assert.deepEqual(shared.sort(), ['compliance_review', 'documentation', 'schedule']);
  // The two projections were curated independently, so the list is not quite a
  // subset — `compliance_review` on a list carries `grounding_pending`, a
  // boolean saying an offline note has not had its AI fact-check pass yet, and
  // the single read does not. It is a pending-verification flag rather than
  // chart content, which is why a compliance WORKLIST wants it and one visit
  // does not. Named here so it stays the only exception: anything else the
  // list adds under a shared name fails this.
  const LIST_ONLY = ['grounding_pending'];
  for (const purpose of shared) {
    const list = policyOf(byKey.visit_list)[purpose];
    const exact = policyOf(byKey.visit_exact)[purpose];
    assert.deepEqual(
      list.fields.filter(field => !exact.fields.includes(field) && !LIST_ONLY.includes(field)), [],
      `visit_list.${purpose} discloses a field visit_exact does not`);
    assert.deepEqual(list.roles, exact.roles, `visit ${purpose} admits different roles`);
    assert.ok(exact.fields.length >= list.fields.length, `visit_exact.${purpose} is the wider read`);
  }
  // And the size of the gap, because it is the reason the two exist: one visit
  // under `compliance_review` discloses six more fields than a row of a list.
  assert.equal(policyOf(byKey.visit_exact).compliance_review.fields.length, 14);
  assert.equal(policyOf(byKey.visit_list).compliance_review.fields.length, 8);
});

test('each policy is read from its own fenced block, not from the module around it', () => {
  // The markers are the contract: the Base44 authorization contract tests
  // already assert the originals carry them, and this is what reads them.
  for (const policy of POLICIES) {
    const source = readFileSync(resolve(repository, policy.original), 'utf8');
    assert.ok(source.includes(begin(policy)) && source.includes(end(policy)), policy.key);
    const block = policyBlock(source, policy);
    for (const name of declarations(policy)) assert.match(block, new RegExp(`const\\s+${name}\\b`));
    // Nothing outside the fence is read: a constant declared after the END
    // marker is not part of the policy and must not become part of it.
    assert.ok(!block.includes('AUTHORITY_FIELDS'), 'the block must stop at the END marker');
    assert.throws(() => policyBlock('no markers here', policy),
      error => error?.code === 'POLICY_MARKERS_MISSING');
    assert.throws(() => policyBlock(`${end(policy)}\n${begin(policy)}`, policy),
      error => error?.code === 'POLICY_MARKERS_MISSING');
  }
  // And one policy's markers do not find another's block.
  const listSource = readFileSync(resolve(repository, byKey.patient_list.original), 'utf8');
  assert.throws(() => policyBlock(listSource, byKey.patient_exact),
    error => error?.code === 'POLICY_MARKERS_MISSING');
  assert.throws(() => policyBlock(listSource, byKey.visit_list),
    error => error?.code === 'POLICY_MARKERS_MISSING');
});

test('a policy that would disclose to nobody, or without a bound, is refused', () => {
  // An empty role set reads like a safe default and is a broken capability;
  // an absent page size where the original declares one is no bound at all.
  const paged = byKey.patient_list;
  const single = byKey.patient_exact;
  const block = (body, policy) => `${begin(policy)}\n${body}\n${end(policy)}`;
  const complete = `const PURPOSE_FIELDS = { roster: ['id', 'last_name'] };
    const PURPOSE_ROLES = { roster: new Set(['manager']) };
    const PURPOSE_MAX_PAGE_SIZE = { roster: 25 };`;
  assert.deepEqual(readPolicy(block(complete, paged), paged),
    { roster: { fields: ['id', 'last_name'], roles: ['manager'], page_size: 25 } });
  const refuses = (body, code, policy = paged) => assert.throws(
    () => readPolicy(block(body, policy), policy), error => error?.code === code, code);
  refuses(complete.replace("new Set(['manager'])", 'new Set([])'), 'POLICY_ROLES_INVALID:roster');
  refuses(complete.replace("roster: ['id', 'last_name']", 'roster: []'), 'POLICY_FIELDS_INVALID:roster');
  refuses(complete.replace('roster: 25', 'roster: 0'), 'POLICY_PAGE_SIZE_INVALID:roster');
  // A projection with no `id` answers rows nothing can page on or follow up.
  refuses(complete.replace("['id', 'last_name']", "['last_name']"), 'POLICY_FIELDS_WITHOUT_ID:roster');
  // A block that stopped declaring one of them is a failure, not an empty
  // policy: an absent `PURPOSE_ROLES` would admit nobody.
  for (const name of declarations(paged)) {
    refuses(complete.replace(`const ${name}`, `const unused_${name}`), `POLICY_MISSING_${name}`);
  }
  // A single-read policy needs no page size and is not asked for one.
  const noBound = complete.split('\n').slice(0, 2).join('\n');
  assert.deepEqual(readPolicy(block(noBound, single), single),
    { roster: { fields: ['id', 'last_name'], roles: ['manager'] } });
});

test('the emitted SQL refuses a field the table lacks and a role nothing can hold', () => {
  const extracted = extract(repository);
  assert.ok(columnsFor('patient').includes('date_of_birth'));
  assert.ok(columnsFor('visit').includes('id') && columnsFor('document').includes('id'));
  const writes = extractWrites(repository);
  const refuses = (domain, mutate, code) => {
    const broken = structuredClone(extracted);
    mutate(broken);
    assert.throws(() => renderSql(broken, domain, columnsFor, writes),
      error => error?.code === code, code);
  };
  // A field the record store has no column for would emit SQL that fails at
  // apply time; finding that out in CI hours later is worse than here.
  refuses('patient', policies => policies.patient_list.roster.fields.push('social_security_number'),
    'POLICY_FIELD_NOT_A_COLUMN:patient_list.roster.social_security_number');
  refuses('visit', policies => policies.visit_list.schedule.roles.push('superuser'),
    'POLICY_ROLE_UNKNOWN:visit_list.schedule.superuser');
  // Dropping the platform tier must never be what closes a purpose: that
  // would turn a capability off by accident.
  refuses('document', policies => { policies.document_exact.download.roles = [...UNSUPPORTED_ROLES]; },
    'POLICY_PURPOSE_ADMITS_NOBODY:document_exact.download');
  // A domain nobody declared renders nothing rather than an empty migration.
  assert.throws(() => renderSql(extracted, 'referral', columnsFor, writes),
    error => error?.code === 'POLICY_DOMAIN_UNKNOWN:referral');
});

test('the emitted SQL is the policy, and the platform tier is the one thing it drops', () => {
  for (const domain of DOMAINS) {
    const sql = readFileSync(resolve(repository, POLICY_SQL_FILES[domain]), 'utf8');
    // The divergence is recorded in the file a reviewer reads, not only here.
    assert.match(sql, /narrowing: platform_owner is/, domain);
    for (const role of UNSUPPORTED_ROLES) {
      assert.ok(!new RegExp(`'${role}'`).test(sql), `${role} must not reach ${domain}`);
    }
    // Every role that does reach it is one `caller_tenant_role` can answer.
    for (const match of sql.matchAll(/p_role in \(([^)]*)\)/g)) {
      for (const role of match[1].split(',').map(part => part.trim().replace(/'/g, ''))) {
        assert.ok(TENANT_ROLES.includes(role), `${role} is not a tenant role`);
      }
    }
    // No caller role may ask a policy anything; the contracts are the way in.
    assert.match(sql, /revoke all on function[\s\S]*from public, anon, authenticated, service_role;/);
    assert.ok(!/grant execute/.test(sql), `${domain} grants nothing to anybody`);
  }
  // Each emitted policy carries its own existence check, and only a paged one
  // a bound.
  for (const policy of POLICIES.filter(entry => DOMAINS.includes(entry.domain))) {
    const sql = readFileSync(resolve(repository, POLICY_SQL_FILES[policy.domain]), 'utf8');
    for (const suffix of ['known', 'admits', 'row']) {
      assert.ok(sql.includes(`"${policy.prefix}_${suffix}"`), `${policy.prefix}_${suffix}`);
    }
    assert.equal(sql.includes(`"${policy.prefix}_page_size"`), policy.paged, policy.key);
  }
  // A domain that is extracted but not emitted would have no SQL anywhere, so
  // nothing could call a policy no contract reads. `document` was the one, for
  // exactly as long as it took D27 to decide how a document reaches its
  // tenancy; every domain is emitted now, and this holds the rule rather than
  // the exception.
  assert.deepEqual([...EXTRACTED_ONLY], []);
  for (const policy of POLICIES.filter(entry => EXTRACTED_ONLY.includes(entry.domain))) {
    assert.ok(!Object.hasOwn(POLICY_SQL_FILES, policy.domain));
    for (const domain of DOMAINS) {
      assert.ok(!readFileSync(resolve(repository, POLICY_SQL_FILES[domain]), 'utf8')
        .includes(policy.prefix), `${policy.prefix} must not be emitted anywhere`);
    }
  }
  // A document purpose discloses no file locator, on either capability. That
  // is the property that lets this family port before the file layer, and it
  // belongs beside the extraction because it is a fact about the originals
  // rather than about the contract.
  for (const key of ['document_list', 'document_exact']) {
    for (const purpose of purposesOf(byKey[key])) {
      for (const field of ['file_url', 'file_uri']) {
        assert.ok(!policyOf(byKey[key])[purpose].fields.includes(field), `${key}.${purpose}`);
      }
    }
  }
});

test('the extracted policies are real clinical disclosure contracts, not stubs', () => {
  const counts = Object.fromEntries(POLICIES.map(policy => [policy.key, purposesOf(policy).length]));
  // Pinned so a future extraction that silently produced less is visible.
  assert.deepEqual(counts, { patient_list: 8, patient_exact: 8, visit_list: 13, visit_exact: 3,
    document_list: 2, document_exact: 4 });
  for (const policy of POLICIES) {
    for (const purpose of purposesOf(policy)) {
      assert.ok(policyOf(policy)[purpose].fields.includes('id'));
      assert.ok(policyOf(policy)[purpose].roles.length > 0);
    }
  }
  // The narrowest and the widest, named, because they are the ones a reviewer
  // should look at first: who may read contact details, who may read a
  // patient's identity for matching, and who may download a document.
  assert.deepEqual(committed.PATIENT_LIST_PURPOSE_POLICY.identity_match.roles,
    ['agency_admin', 'manager', 'platform_owner']);
  assert.ok(committed.PATIENT_LIST_PURPOSE_POLICY.identity_match.fields.includes('date_of_birth'));
  assert.ok(!committed.PATIENT_LIST_PURPOSE_POLICY.roster.fields.includes('date_of_birth'),
    'the roster purpose must not disclose a date of birth');
  assert.ok(!committed.PATIENT_LIST_PURPOSE_POLICY.roster.fields.includes('address'));
  assert.deepEqual(committed.PATIENT_EXACT_PURPOSE_POLICY.display.fields,
    ['id', 'first_name', 'middle_name', 'last_name']);
});

test('the command line refuses an argument nobody declared', () => {
  const lines = [];
  assert.equal(main(['--nope'], { repository, log: line => lines.push(line) }), 2);
  assert.match(lines.at(-1), /POLICY_INVALID_ARGUMENTS/);
  assert.equal(main(['--json'], { repository, log: () => {} }), 0);
});

test('the writable field set is extracted too, and the contract keeps what it decides', () => {
  // A create capability declares which fields a client may supply, and the
  // comment above that declaration in the original names what is deliberately
  // absent: tenancy, provenance, assignment, lifecycle, derived metrics and
  // automation claims. Retyping the list would let a field added by hand
  // reach a column the original never let a caller near.
  const writes = extractWrites(repository);
  assert.deepEqual(Object.keys(writes), WRITE_POLICIES.map(policy => policy.key));
  const create = writes.patient_create;
  assert.equal(create.declared.length, 46);
  assert.equal(create.writable.length, 43);
  assert.deepEqual(create.reserved, ['agency_id', 'client_request_id', 'status']);
  assert.deepEqual(create.declared, [...create.writable, ...create.reserved].sort(
    (left, right) => create.declared.indexOf(left) - create.declared.indexOf(right)));
  // The columns the original calls out as absent stay absent.
  for (const field of ['created_by_user_id', 'created_by_user_email_normalized',
    'patient_creation_key', 'is_sample', 'is_archived', 'assigned_nurses',
    'data_completeness_score', 'merged_into_id', 'risk_predict_claimed_by']) {
    assert.ok(!create.declared.includes(field), `${field} is not a client field`);
  }
  // And what is committed is what the originals declare.
  assert.deepEqual([...committed.PATIENT_CREATE_WRITABLE], create.writable);
  assert.deepEqual([...committed.PATIENT_CREATE_RESERVED], create.reserved);
});

test('a declaration that moved, emptied or lost a reserved field refuses to render', () => {
  // Extraction is by NAME rather than by fence, and that is not the weaker
  // guarantee it looks like: a declaration that was renamed or removed fails
  // the run instead of silently producing less.
  const [policy] = WRITE_POLICIES;
  const refuses = (source, code) => assert.throws(() => readDeclaration(source, policy),
    error => error?.code === code, code);
  const good = `const ${policy.declaration} = new Set([\n'agency_id',\n'client_request_id',\n'status',\n'first_name',\n]);`;
  assert.deepEqual(readDeclaration(good, policy).writable, ['first_name']);
  refuses('const SOMETHING_ELSE = new Set([]);', `WRITE_DECLARATION_MISSING:${policy.declaration}`);
  refuses(`const ${policy.declaration} = new Set([]);`, `WRITE_DECLARATION_EMPTY:${policy.declaration}`);
  // A reserved field the declaration no longer carries means the list moved on
  // without this one, which is exactly the drift extraction exists to catch.
  refuses(`const ${policy.declaration} = new Set(['first_name','client_request_id','status',]);`,
    `WRITE_RESERVED_ABSENT:${policy.key}.agency_id`);
  // And a declaration that is nothing BUT reserved fields leaves a caller
  // unable to supply anything, which is a broken capability rather than a
  // strict one.
  refuses(`const ${policy.declaration} = new Set(['agency_id','client_request_id','status',]);`,
    `WRITE_DECLARATION_ALL_RESERVED:${policy.key}`);
});

test('the emitted writable check is the extracted list, and nothing else', () => {
  const sql = readFileSync(resolve(repository, POLICY_SQL_FILES.patient), 'utf8');
  const create = extractWrites(repository).patient_create;
  // Sliced by name rather than matched with a regex over the whole file: the
  // first version of this escaped its parentheses wrong and matched nothing,
  // which a test asserting a list is equal to itself would not have caught.
  const clause = (name) => {
    const start = sql.indexOf(`"${name}"(p_field text)`);
    assert.ok(start > 0, name);
    const body = sql.slice(start, sql.indexOf('$write$;', start));
    return [...body.matchAll(/'([a-z_]+)'/g)].map(match => match[1]);
  };
  assert.deepEqual(clause('patient_create_writable'), create.writable);
  assert.deepEqual(clause('patient_create_reserved'), create.reserved);
  // The two sets never overlap, or a field would be both refusable and
  // writable and which one won would depend on the order of two checks.
  assert.deepEqual(create.writable.filter(field => create.reserved.includes(field)), []);
});

test('the committed action policy is exactly what the original declares', () => {
  // A mutation capability declares its workflow actions the same way a read
  // declares its purposes, and the stakes are the mirror image: a field added
  // to an action by hand lets a caller WRITE a column the original never let
  // them near, and a role added lets somebody perform a workflow they were
  // never admitted to.
  const actions = extractActions(repository);
  assert.deepEqual(Object.keys(actions), ACTION_POLICIES.map(policy => policy.key));
  const patient = actions.patient_action;
  assert.deepEqual(Object.keys(patient), [...committed.PATIENT_ACTIONS]);
  // Declaration order, not sorted: the original names this order
  // `ACTION_CANONICAL_ORDER` and sorts a submitted batch into it.
  assert.deepEqual(Object.keys(patient), ['edit_demographics', 'edit_clinical_profile',
    'edit_care_episode', 'edit_insurance', 'set_primary_diagnosis', 'change_status']);
  for (const [action, entry] of Object.entries(patient)) {
    assert.deepEqual([...committed.PATIENT_ACTION_POLICY[action].fields], entry.fields, action);
    assert.deepEqual([...committed.PATIENT_ACTION_POLICY[action].roles], entry.roles, action);
    assert.ok(entry.fields.length > 0 && entry.roles.length > 0, action);
  }
  // Disjoint, which is what lets a batch of actions be ONE write whose result
  // does not depend on the order it arrived in. The original asserts this at
  // runtime and throws; nothing proved it beforehand until this did.
  const fields = Object.values(patient).flatMap(entry => entry.fields);
  assert.equal(fields.length, 29);
  assert.equal(new Set(fields).size, 29, 'no field belongs to two actions');
  // And every action field is a column the record store actually has, or the
  // emitted SQL would fail at apply time.
  const known = new Set(columnsFor('patient'));
  for (const field of fields) assert.ok(known.has(field), field);
  // The roles are the store's vocabulary. `platform_owner` never appears in
  // this block at all, so nothing is dropped from it.
  for (const entry of Object.values(patient)) {
    for (const role of entry.roles) assert.ok(TENANT_ROLES.includes(role), role);
  }
});

test('an action block that shares a field, admits nobody or names a column nobody may send is refused', () => {
  const [policy] = ACTION_POLICIES;
  const source = (fields, roles, guarded = "['agency_id',\n'assigned_nurses',\n]") => [
    `const ${policy.protect} = [\n${guarded.slice(1, -1)}\n];`,
    begin(policy),
    `const ${policy.fields} = ${fields};`,
    `const ${policy.roles} = ${roles};`,
    end(policy),
  ].join('\n');
  const good = source("{ a: ['first_name'], b: ['last_name'] }",
    "{ a: ['manager'], b: ['clinician'] }");
  assert.deepEqual(readActionPolicy(good, policy),
    { a: { fields: ['first_name'], roles: ['manager'] },
      b: { fields: ['last_name'], roles: ['clinician'] } });
  const refuses = (text, code) => assert.throws(() => readActionPolicy(text, policy),
    error => error?.code === code, code);
  // Two actions assigning one field would make a batch's result depend on the
  // order the caller sent it in.
  refuses(source("{ a: ['first_name'], b: ['first_name'] }",
    "{ a: ['manager'], b: ['clinician'] }"), 'ACTION_FIELD_SHARED:first_name:a+b');
  // A column the original never accepts from a caller.
  refuses(source("{ a: ['agency_id'] }", "{ a: ['manager'] }"),
    'ACTION_FIELD_PROTECTED:a.agency_id');
  // A caller names the row; it never re-writes its identity.
  refuses(source("{ a: ['id'] }", "{ a: ['manager'] }"), 'ACTION_FIELD_IS_IDENTITY:a');
  // An action nobody may perform reads like a strict rule and is a workflow
  // that has been turned off by accident.
  refuses(source("{ a: ['first_name'] }", "{ a: [] }"), 'ACTION_ROLES_INVALID:a');
  refuses(source("{ a: ['first_name'] }", '{ }'), 'ACTION_ROLES_INVALID:a');
  refuses(source('{ }', '{ }'), 'ACTION_POLICY_EMPTY');
  // And a role grant for a workflow the fields declaration no longer has.
  refuses(source("{ a: ['first_name'] }", "{ a: ['manager'], gone: ['manager'] }"),
    'ACTION_ROLES_ORPHANED:gone');
  // Extraction is by name inside the fence, so a renamed declaration fails
  // the run rather than producing an empty policy.
  refuses(source("{ a: ['first_name'] }", "{ a: ['manager'] }").replace(policy.roles, 'RENAMED'),
    `ACTION_MISSING_${policy.roles}`);
});

test('the emitted action SQL is the policy, and a caller cannot ask it anything', () => {
  const sql = readFileSync(resolve(repository, POLICY_SQL_FILES.patient), 'utf8');
  const patient = extractActions(repository).patient_action;
  const arms = (name, pattern) => {
    const start = sql.indexOf(`"${name}"(`);
    assert.ok(start > 0, name);
    const body = sql.slice(start, sql.indexOf('$action$;', start));
    return Object.fromEntries([...body.matchAll(pattern)]
      .map(match => [match[1], [...match[2].matchAll(/'([a-z_]+)'/g)].map(item => item[1])]));
  };
  const writes = arms('patient_action_writes', /when '([a-z_]+)' then p_field in \(([^)]*)\)/g);
  const admits = arms('patient_action_admits', /when '([a-z_]+)' then p_role in \(([^)]*)\)/g);
  for (const [action, entry] of Object.entries(patient)) {
    assert.deepEqual(writes[action], entry.fields, `${action} writes`);
    assert.deepEqual(admits[action], entry.roles, `${action} admits`);
  }
  assert.deepEqual(Object.keys(writes).sort(), Object.keys(patient).sort());
  // The canonical order is emitted as a rank, because the contract sorts a
  // submitted batch by it and a batch's answer should not depend on arrival
  // order.
  const rank = sql.slice(sql.indexOf('"patient_action_rank"('));
  assert.deepEqual([...rank.slice(0, rank.indexOf('$action$;')).matchAll(/when '([a-z_]+)' then (\d+)/g)]
    .map(match => [match[1], Number(match[2])]),
  Object.keys(patient).map((action, index) => [action, index + 1]));
  // `PROTECTED_PATIENT_FIELDS` is read as a check and never emitted: the
  // contract accepts only the fields an action declares, so a policy function
  // for the protected list would be SQL nothing can call.
  assert.equal(sql.includes('patient_action_protected'), false);
  // And no caller role may ask any of them. The contract is the only way in.
  const revoked = sql.slice(sql.lastIndexOf('revoke all on function'));
  for (const suffix of ['known', 'admits', 'writes', 'rank']) {
    assert.ok(revoked.includes(`"patient_action_${suffix}"`), suffix);
  }
  assert.match(revoked, /from public, anon, authenticated, service_role;/);
});

test('an action map read by name carries every action, served or explained', () => {
  // The second action shape: one action per call, roles decided in code, and
  // not every action ported. The check that matters is the last one — an
  // action added upstream is either served or explained, never silently
  // unreachable.
  const [policy] = ACTION_INPUT_POLICIES;
  const inputs = extractActionInputs(repository).visit_action;
  assert.deepEqual(Object.keys(inputs), [...committed.VISIT_ACTIONS]);
  assert.equal(Object.keys(inputs).length, 9);
  const served = Object.entries(inputs).filter(([, entry]) => entry.served).map(([name]) => name);
  assert.deepEqual(served, [...committed.VISIT_ACTIONS_SERVED]);
  assert.deepEqual(served.sort(),
    ['advance_handoff', 'reschedule', 'save_documentation', 'set_review_ack']);
  for (const [action, entry] of Object.entries(inputs)) {
    assert.deepEqual([...committed.VISIT_ACTION_POLICY[action].fields], entry.fields, action);
    assert.equal(committed.VISIT_ACTION_POLICY[action].served, entry.served, action);
    // Served or explained, never neither and never both.
    assert.equal(entry.served, entry.because === null, action);
    if (entry.served) assert.ok(entry.fields.length > 0, action);
    else assert.ok(entry.because.length > 40, `${action} says why`);
  }
  // The field sets are allowed to OVERLAP here, unlike a batched action
  // policy's: `save_documentation` and `set_ai_tags` both accept `ai_tags`,
  // and one action per call makes that harmless.
  assert.ok(inputs.save_documentation.fields.includes('ai_tags'));
  assert.ok(inputs.set_ai_tags.fields.includes('ai_tags'));
  // `save_documentation` carries the long list, which is the whole reason this
  // is extracted rather than retyped.
  assert.equal(inputs.save_documentation.fields.length, 13);
  // Every served input is a column of the table or a named input the action
  // interprets; nothing else, so a mistyped column name fails the run.
  const known = new Set(columnsFor('visit'));
  for (const action of served) {
    for (const field of inputs[action].fields) {
      assert.ok(known.has(field) || policy.inputs.includes(field), `${action}.${field}`);
    }
  }
  assert.deepEqual([...policy.inputs].sort(),
    ['acknowledged', 'expected_note_hash', 'next_status', 'nurse_edited']);
});

test('an action map that is silent about an action refuses to render', () => {
  const [policy] = ACTION_INPUT_POLICIES;
  const source = map => `const ${policy.declarations[0]} = new Set(['nurse_notes',]);\n`
    + `const ${policy.declarations.at(-1)}: Record<string, Set<string>> = ${map};`;
  const refuses = (text, code, entry = policy) => assert.throws(
    () => readActionInputs(text, entry), error => error?.code === code, code);
  const good = readActionInputs(
    source("{ save_documentation: SAVE_DOCUMENTATION_FIELDS, legacy_recovery: new Set() }"),
    { ...policy, served: ['save_documentation'], unported: { legacy_recovery: 'paused' } });
  assert.deepEqual(good.save_documentation, { fields: ['nurse_notes'], served: true, because: null });
  assert.deepEqual(good.legacy_recovery, { fields: [], served: false, because: 'paused' });
  // An action the map declares and the port neither serves nor explains. This
  // is the one that keeps a partial port honest as the original grows.
  refuses(source("{ save_documentation: SAVE_DOCUMENTATION_FIELDS, added_upstream: new Set(['x']) }"),
    'ACTION_DISPOSITION_MISSING:added_upstream',
    { ...policy, served: ['save_documentation'], unported: {} });
  // Both served and explained is a list that moved on without its other half.
  refuses(source("{ save_documentation: SAVE_DOCUMENTATION_FIELDS }"),
    'ACTION_DISPOSITION_MISSING:save_documentation',
    { ...policy, served: ['save_documentation'], unported: { save_documentation: 'why' } });
  // A served action with no inputs would be a call with no argument and no
  // effect; the original has two such actions and both are unported.
  refuses(source("{ save_documentation: new Set() }"), 'ACTION_INPUTS_EMPTY:save_documentation',
    { ...policy, served: ['save_documentation'], unported: {} });
  // Served or explained names that the map does not declare at all. Both
  // lists keep the declared action dispositioned, or the per-action check
  // above would fire first and say something less useful.
  refuses(source("{ save_documentation: SAVE_DOCUMENTATION_FIELDS }"),
    'ACTION_SERVED_UNDECLARED:gone',
    { ...policy, served: ['save_documentation', 'gone'], unported: {} });
  refuses(source("{ save_documentation: SAVE_DOCUMENTATION_FIELDS }"),
    'ACTION_UNPORTED_UNDECLARED:gone',
    { ...policy, served: ['save_documentation'], unported: { gone: 'why' } });
  // The declarations are read by NAME, and one is written in terms of the
  // other, so evaluating the second without the first fails the run.
  assert.throws(() => readDeclarations(source('{ }').replace(policy.declarations[0], 'RENAMED'),
    policy.declarations), error => /^WRITE_DECLARATION_MISSING:/.test(error.message));
});

test('the emitted visit action SQL says which actions are served and why the rest are not', () => {
  const sql = readFileSync(resolve(repository, POLICY_SQL_FILES.visit), 'utf8');
  const inputs = extractActionInputs(repository).visit_action;
  const body = (name) => {
    const start = sql.indexOf(`"${name}"(`);
    assert.ok(start > 0, name);
    return sql.slice(start, sql.indexOf('$action$;', start));
  };
  const served = body('visit_action_served');
  for (const [action, entry] of Object.entries(inputs)) {
    assert.ok(served.includes(`when '${action}' then ${entry.served}`), `${action} served`);
  }
  // Every unported action carries its reason into the SQL, so a caller is told
  // which of the five it is rather than being left to guess.
  const unported = body('visit_action_unported');
  for (const [action, entry] of Object.entries(inputs)) {
    if (entry.because === null) {
      assert.ok(unported.includes(`when '${action}' then null::text`), action);
    } else {
      assert.ok(unported.includes(entry.because.replace(/'/g, "''")), `${action} reason`);
    }
  }
  // `_accepts` answers only for a served action: an unserved one's inputs are
  // not a surface, and emitting them would read like a capability.
  const accepts = body('visit_action_accepts');
  assert.ok(accepts.includes("when 'set_ai_tags' then false"));
  assert.ok(accepts.includes("when 'save_documentation' then p_field in ('patient_id'"));
  // And no caller role may ask any of them.
  const revoked = sql.slice(sql.lastIndexOf('revoke all on function'));
  for (const suffix of ['known', 'served', 'unported', 'accepts', 'rank']) {
    assert.ok(revoked.includes(`"visit_action_${suffix}"`), suffix);
  }
});
