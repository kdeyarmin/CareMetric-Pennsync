#!/usr/bin/env node
/**
 * The authorized-patient purpose policies, lifted from the Base44 originals
 * rather than retyped.
 *
 * Two capabilities read a patient and both are purpose-bound: a caller names
 * a purpose, and the purpose decides which fields come back and which tenant
 * roles may ask at all. `listAuthorizedPatients` adds a page bound per
 * purpose; `getAuthorizedPatient` reads one row and has none. The two carry
 * DIFFERENT purposes — a list is asked for `contact` or `roster`, one chart is
 * opened for `smart_note_context` or `oasis_analysis_context` — so they are
 * two policies, not one with a shared vocabulary, and conflating them would
 * hand a list caller a purpose that exists to open a single chart.
 *
 * Each original fences its policy between `<<<BEGIN … POLICY>>>` and
 * `<<<END …>>>`, and `patientReadAuthorizationContract.test.js` already
 * asserts those markers are there — so somebody had decided these blocks are
 * the thing that must not drift, without anything yet reading them as data.
 *
 * D12 settled how to carry a block like this: extract it, do not transcribe
 * it. Retyping two hundred lines of field lists is a transcription exercise
 * with no upside and one obvious failure mode — the user-guide parity test
 * caught a single dropped trailing space in a much shorter text, and here a
 * dropped field name would silently widen or narrow a clinical disclosure.
 *
 * So this evaluates the fenced blocks themselves. Nothing is stubbed and
 * nothing is driven, because they are pure declarations; what comes out is
 * exactly what each original's own module scope holds. Two artifacts are
 * generated from it and a test re-extracts and compares both, so neither can
 * diverge from the source it came from.
 *
 * Regenerate with `node tools-patient-purpose-policy.mjs --write`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transpileTs } from './tools-transpile-ts.mjs';
import { RECORD_MIGRATION_FILE, SCHEMA, quote } from './tools-entity-schema-plan.mjs';

/** The data module the service reads, for the purposes and their page bounds. */
export const POLICY_FILE = 'services/pennsync-api/patient-purpose-policy.mjs';
/**
 * The same policies as SQL, so the projection a caller receives is decided in
 * the database rather than by the service.
 *
 * The contract beside it is hand-written, as every contract is, because its
 * authorization is its own. This file is not that: it is sixteen field lists,
 * sixteen role sets and eight page bounds, all of them data that already
 * exists in the originals. Typing them into SQL by hand is the transcription
 * D12 settled against, and a dropped field name in a `jsonb_build_object`
 * would silently narrow — or widen — a clinical disclosure. So the data is
 * generated and the authorization is written; the two live in separate files
 * so neither can be mistaken for the other.
 */
export const POLICY_SQL_FILE =
  'services/authority-store/supabase/record-migrations/20260920050000_patient_purpose_policy.sql';
export const TABLE = 'patient';

/**
 * The two policies, each named by the capability it belongs to.
 *
 * `paged` is what tells them apart beyond their purposes: a list has a bound
 * per purpose and a single read has nothing to bound.
 */
export const POLICIES = Object.freeze([
  Object.freeze({
    key: 'list',
    original: 'base44/functions/listAuthorizedPatients/entry.ts',
    marker: 'AUTHORIZED PATIENT LIST PURPOSE POLICY',
    prefix: 'patient_list_purpose',
    constant: 'PATIENT_LIST_PURPOSE',
    paged: true,
  }),
  Object.freeze({
    key: 'exact',
    original: 'base44/functions/getAuthorizedPatient/entry.ts',
    marker: 'AUTHORIZED PATIENT EXACT PURPOSE POLICY',
    prefix: 'patient_exact_purpose',
    constant: 'PATIENT_EXACT_PURPOSE',
    paged: false,
  }),
]);
export const POLICY_KEYS = Object.freeze(POLICIES.map(policy => policy.key));
export const begin = policy => `// <<<BEGIN ${policy.marker}>>>`;
export const end = policy => `// <<<END ${policy.marker}>>>`;
/**
 * The declarations a block is required to carry. Named so a block that
 * silently stopped declaring one is a failure rather than an empty policy —
 * an empty `PURPOSE_ROLES` would admit nobody, which reads like a safe default
 * and is actually a broken capability.
 */
export const declarations = policy => (policy.paged
  ? ['PURPOSE_FIELDS', 'PURPOSE_ROLES', 'PURPOSE_MAX_PAGE_SIZE']
  : ['PURPOSE_FIELDS', 'PURPOSE_ROLES']);
/**
 * The tenant roles the record store can answer for. `caller_tenant_role`
 * returns one of these or null, and nothing else exists.
 */
export const TENANT_ROLES = Object.freeze([
  'agency_admin', 'manager', 'clinician', 'office_staff', 'social_worker', 'spiritual_care',
]);
/**
 * A role the originals admit that the record store has no equivalent for, so
 * the emitted SQL drops it. This is the port's one authorization divergence
 * here and it is a narrowing: D14 and D22 removed the platform tier, there is
 * no membership that can carry this role, and emitting it would be a branch
 * nothing could ever take — which reads like a tier that exists.
 *
 * Named rather than filtered silently, and checked below: every purpose must
 * still admit somebody after the removal, or the port would have quietly
 * turned a capability off.
 */
export const UNSUPPORTED_ROLES = Object.freeze(['platform_owner']);

export class PolicyError extends Error {
  constructor(code) { super(code); this.name = 'PolicyError'; this.code = code; }
}
const check = (value, code) => { if (!value) throw new PolicyError(code); };

/** The fenced text, exactly as the original carries it. */
export function policyBlock(source, policy) {
  const first = source.indexOf(begin(policy));
  const last = source.indexOf(end(policy));
  check(first >= 0 && last > first, 'POLICY_MARKERS_MISSING');
  return source.slice(first + begin(policy).length, last).trim();
}

/**
 * Evaluate the block and read the declarations out of it.
 *
 * The block is TypeScript (`Record<string, ...>` annotations), so it is
 * transpiled the same way every other Base44 source in this repo is, and then
 * evaluated in a function scope rather than imported — it declares consts, not
 * exports, and rewriting it into a module would be the transcription this
 * file exists to avoid.
 */
export function readPolicy(source, policy) {
  const block = policyBlock(source, policy);
  const names = declarations(policy);
  for (const name of names) {
    check(new RegExp(`const\\s+${name}\\b`).test(block), `POLICY_MISSING_${name}`);
  }
  // The block alone, then the return appended AFTER transpiling. A top-level
  // `return` makes esbuild treat the input as CommonJS and wrap it in a module
  // factory, so the declarations never reach the caller.
  const js = transpileTs(block).outputText;
  // The input is a fenced block of this repository's own source, read from
  // disk at build time by a developer tool — not a request, not a fixture, and
  // never reached by the service. The alternative is retyping it.
  const values = new Function(`${js}\nreturn { ${names.join(', ')} };`)();
  const purposes = Object.keys(values.PURPOSE_FIELDS).sort();
  check(purposes.length > 0, 'POLICY_EMPTY');
  const extracted = {};
  for (const purpose of purposes) {
    const fields = values.PURPOSE_FIELDS[purpose];
    const roles = values.PURPOSE_ROLES[purpose];
    // Every purpose must carry each of them. One that names fields but no
    // roles would return a projection to nobody; a paged one with no page size
    // would have no bound at all.
    check(Array.isArray(fields) && fields.length > 0, `POLICY_FIELDS_INVALID:${purpose}`);
    check(roles instanceof Set && roles.size > 0, `POLICY_ROLES_INVALID:${purpose}`);
    // `id` is what a caller pages on and what every other capability joins to,
    // so a projection without it answers rows nothing can follow up.
    check(fields.includes('id'), `POLICY_FIELDS_WITHOUT_ID:${purpose}`);
    extracted[purpose] = {
      // Field order is the original's, not sorted: it is the order the
      // projection is written in and the order a reader compares against.
      fields: [...fields],
      roles: [...roles].sort(),
    };
    if (!policy.paged) continue;
    const pageSize = values.PURPOSE_MAX_PAGE_SIZE[purpose];
    check(Number.isSafeInteger(pageSize) && pageSize > 0, `POLICY_PAGE_SIZE_INVALID:${purpose}`);
    extracted[purpose].page_size = pageSize;
  }
  return extracted;
}

/** Both policies, keyed the way the artifacts below name them. */
export function extract(repository) {
  return Object.fromEntries(POLICIES.map(policy =>
    [policy.key, readPolicy(readFileSync(join(repository, policy.original), 'utf8'), policy)]));
}

export function render(policies) {
  const section = (policy) => {
    const extracted = policies[policy.key];
    const purposes = Object.keys(extracted);
    return `export const ${policy.constant}S = Object.freeze(${JSON.stringify(purposes)});
export const ${policy.constant}_POLICY = Object.freeze({
${purposes.map(purpose => `  ${purpose}: Object.freeze({
    fields: Object.freeze(${JSON.stringify(extracted[purpose].fields)}),
    roles: Object.freeze(${JSON.stringify(extracted[purpose].roles)}),${policy.paged
  ? `\n    page_size: ${extracted[purpose].page_size},` : ''}
  }),`).join('\n')}
});`;
  };
  return `// GENERATED by \`node tools-patient-purpose-policy.mjs --write\`. Do not edit.
//
// The authorized-patient purpose policies, extracted from the two originals
// rather than retyped. Each purpose decides which fields are disclosed and
// which tenant roles may ask; a list purpose also decides how large a page may
// be. A test re-extracts and compares, so this cannot drift from the source it
// came from.
//
// The two vocabularies are deliberately separate. A list is asked for
// \`contact\` or \`roster\`; one chart is opened for \`smart_note_context\`. A
// purpose from one is not a purpose in the other.
${POLICIES.map(policy => `//
// From \`${policy.original}\`:
${section(policy)}`).join('\n')}
`;
}

/**
 * The columns the record store's `patient` table actually has.
 *
 * Read from the emitted migration rather than from the entity definition,
 * because the migration is what will exist: a field a policy names and the
 * table lacks would emit SQL that fails at apply time, and finding that out in
 * CI hours later is worse than finding it out here.
 */
export function tableColumns(repository, file = RECORD_MIGRATION_FILE, table = TABLE) {
  const sql = readFileSync(join(repository, file), 'utf8');
  const head = `create table ${quote(SCHEMA)}.${quote(table)} (`;
  const first = sql.indexOf(head);
  check(first >= 0, 'POLICY_TABLE_MISSING');
  const last = sql.indexOf('\n);', first);
  check(last > first, 'POLICY_TABLE_UNREADABLE');
  const columns = [...sql.slice(first + head.length, last).matchAll(/^\s*"((?:[^"]|"")+)"\s+\S/gm)]
    .map(match => match[1].replace(/""/g, '"'));
  check(columns.length > 0, 'POLICY_TABLE_UNREADABLE');
  return columns;
}

/** `case p_purpose when '…' then … end`, one arm per purpose, in one place. */
const purposeCase = (purposes, arm, fallback) =>
  `  select case p_purpose\n${purposes.map(arm).join('\n')}\n    else ${fallback} end`;

/**
 * Each policy as pure functions and no authorization at all.
 *
 * `<prefix>_known` is the purpose-exists check, kept separate from the page
 * bound so that "no such purpose" and "no bound for this one" cannot be
 * confused — the single-read policy has no bounds at all and still has to
 * answer the first question.
 */
export function renderSql(policies, columns) {
  const known = new Set(columns);
  const vocabulary = new Set([...TENANT_ROLES, ...UNSUPPORTED_ROLES]);
  const signatures = [];
  const bodies = [];
  let dropped = 0;
  let total = 0;
  for (const policy of POLICIES) {
    const extracted = policies[policy.key];
    const purposes = Object.keys(extracted);
    const served = {};
    for (const purpose of purposes) {
      for (const field of extracted[purpose].fields) {
        check(known.has(field), `POLICY_FIELD_NOT_A_COLUMN:${policy.key}.${purpose}.${field}`);
      }
      for (const role of extracted[purpose].roles) {
        check(vocabulary.has(role), `POLICY_ROLE_UNKNOWN:${policy.key}.${purpose}.${role}`);
      }
      const roles = extracted[purpose].roles.filter(role => !UNSUPPORTED_ROLES.includes(role));
      // Dropping the platform tier must never be what closes a purpose. If it
      // is, the port has turned a capability off by accident, and that is a
      // decision rather than a rendering detail.
      check(roles.length > 0, `POLICY_PURPOSE_ADMITS_NOBODY:${policy.key}.${purpose}`);
      served[purpose] = roles;
      total += 1;
      if (roles.length !== extracted[purpose].roles.length) dropped += 1;
    }
    const name = suffix => `${quote(SCHEMA)}.${quote(`${policy.prefix}_${suffix}`)}`;
    bodies.push(`-- From \`${policy.original}\`: ${purposes.length} purposes.
create function ${name('known')}(p_purpose text) returns boolean
  language sql immutable set search_path = '' as $policy$
${purposeCase(purposes, purpose => `    when '${purpose}' then true`, 'false')}
$policy$;

create function ${name('admits')}(p_purpose text, p_role text) returns boolean
  language sql immutable set search_path = '' as $policy$
${purposeCase(purposes, purpose => `    when '${purpose}' then p_role in (${served[purpose].map(role => `'${role}'`).join(', ')})`, 'false')}
$policy$;
${policy.paged ? `
create function ${name('page_size')}(p_purpose text) returns integer
  language sql immutable set search_path = '' as $policy$
${purposeCase(purposes, purpose => `    when '${purpose}' then ${extracted[purpose].page_size}`, 'null')}
$policy$;
` : ''}
-- Stable rather than immutable: a date or timestamp reaches JSON through the
-- session's DateStyle and TimeZone, so this is not constant-foldable.
create function ${name('row')}(
  p_purpose text, p ${quote(SCHEMA)}.${quote(TABLE)}) returns jsonb
  language sql stable set search_path = '' as $policy$
${purposeCase(purposes, purpose => `    when '${purpose}' then jsonb_build_object(\n${
  extracted[purpose].fields.map(field => `      '${field}', p.${quote(field)}`).join(',\n')})`, 'null')}
$policy$;`);
    signatures.push(`${name('known')}(text)`, `${name('admits')}(text,text)`);
    if (policy.paged) signatures.push(`${name('page_size')}(text)`);
    signatures.push(`${name('row')}(text,${quote(SCHEMA)}.${quote(TABLE)})`);
  }
  return `-- GENERATED by \`node tools-patient-purpose-policy.mjs --write\`. Do not edit.
--
-- The authorized-patient purpose policies, as SQL.
--
-- Reading a patient is purpose-bound: a caller names a purpose, and the
-- purpose decides which fields are disclosed and which tenant roles may ask at
-- all. Those blocks are the authorization contract, and they are ${total} purposes
-- long between them — so they are extracted from the two originals rather than
-- retyped, and re-extracted by a test on every run. A dropped field name here
-- would widen or narrow a clinical disclosure with nothing to notice it.
--
-- Two vocabularies, deliberately not merged: a list is asked for \`contact\` or
-- \`roster\`, one chart is opened for \`smart_note_context\`. A purpose from one
-- is not a purpose in the other, and \`<prefix>_known\` is how each contract
-- says so.
--
-- Every function here is pure, and none of them has any authorization: they
-- answer what a policy says, never who is asking. The contracts beside them
-- are hand-written and decide that, because a capability's authorization is
-- its own.
--
-- One divergence from the originals, and it is a narrowing: ${UNSUPPORTED_ROLES.join(', ')} is
-- admitted by ${dropped} of the ${total} purposes there and by none here. D14 and D22
-- removed the platform tier, \`caller_tenant_role\` can only answer one of
-- ${TENANT_ROLES.slice(0, 3).join(', ')},
-- ${TENANT_ROLES.slice(3).join(', ')}, and emitting a branch nothing
-- can take would read like a tier that still exists. Every purpose still
-- admits somebody without it; the generator refuses to render if one would
-- not.
begin;

do $$
begin
  if to_regclass('${SCHEMA}.${TABLE}') is null
    or to_regprocedure('${SCHEMA}.caller_tenant_role(text)') is null then
    raise exception using errcode='42501',message='PENNSYNC_RECORD_STORE_REQUIRED';
  end if;
end $$;

do $$
declare v_admin text := current_user;
begin
  if exists (select 1 from pg_catalog.pg_roles
    where rolname = 'pennsync_records_owner' and (rolsuper or rolbypassrls)) then
    raise exception using errcode='42501',message='PENNSYNC_RECORD_OWNER_MUST_NOT_BYPASS_RLS';
  end if;
  begin
    execute format('grant %I to current_user with set true', 'pennsync_records_owner');
  exception
    when syntax_error then execute format('grant %I to current_user', 'pennsync_records_owner');
    when others then null; -- already held, or not ours to grant; proven below
  end;
  begin
    execute format('set role %I', 'pennsync_records_owner');
    execute format('set role %I', v_admin);
  exception when others then
    raise exception using errcode='42501',message='PENNSYNC_RECORD_OWNER_NOT_ASSUMABLE';
  end;
end $$;

-- Owned by the record owner, like everything the contracts call, so a caller
-- cannot reach them and the contracts can.
set local role "pennsync_records_owner";

${bodies.join('\n\n')}

reset role;

-- No caller role may ask a policy anything. The contracts are the only way in.
revoke all on function ${signatures.join(',\n  ')}
  from public, anon, authenticated, service_role;

commit;
`;
}

export function main(args = process.argv.slice(2), {
  repository = resolve(dirname(fileURLToPath(import.meta.url))), log = console.log, write = writeFileSync,
} = {}) {
  if (args.some(argument => !['--write', '--json'].includes(argument))) {
    log(JSON.stringify({ error: 'POLICY_INVALID_ARGUMENTS' }));
    return 2;
  }
  let policies;
  let artifacts;
  try {
    policies = extract(repository);
    artifacts = [
      [POLICY_FILE, render(policies)],
      [POLICY_SQL_FILE, renderSql(policies, tableColumns(repository))],
    ];
  } catch (error) { log(JSON.stringify({ error: error?.code ?? 'POLICY_FAILED' })); return 1; }
  if (args.includes('--json')) { log(JSON.stringify(policies, null, 2)); return 0; }
  const counted = POLICIES
    .map(policy => `${policy.key}=${Object.keys(policies[policy.key]).length}`).join(' ');
  if (args.includes('--write')) {
    for (const [file, rendered] of artifacts) write(join(repository, file), rendered);
    log(JSON.stringify({ updated: artifacts.map(([file]) => file), purposes: counted }, null, 2));
    return 0;
  }
  const drifted = artifacts.filter(([file, rendered]) => {
    let committed = null;
    try { committed = readFileSync(join(repository, file), 'utf8'); } catch { /* not written yet */ }
    return committed !== rendered;
  });
  if (drifted.length === 0) {
    log(`patient purpose policies unchanged: ${counted}`);
    return 0;
  }
  log(`patient purpose policies CHANGED in ${drifted.map(([file]) => file).join(', ')}. `
    + 'Re-run `node tools-patient-purpose-policy.mjs --write`.');
  return 1;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
