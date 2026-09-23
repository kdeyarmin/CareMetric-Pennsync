#!/usr/bin/env node
/**
 * The authorized-read purpose policies, lifted from the Base44 originals
 * rather than retyped.
 *
 * Six capabilities read a clinical row — a patient, a visit or a document —
 * and every one of them is purpose-bound: a caller names a purpose, and the
 * purpose decides which fields come back and which tenant roles may ask at
 * all. A list capability may also bound its page per purpose; a single read
 * has nothing to bound.
 *
 * Each of the six carries its OWN purposes. A patient list is asked for
 * `contact` or `roster`; one chart is opened for `smart_note_context`; a visit
 * list is asked for `schedule` or `vitals_trend`. They are six policies, not
 * one shared vocabulary, and merging any two would hand a caller a projection
 * that exists for a different question.
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
 * Regenerate with `node tools-read-purpose-policy.mjs --write`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transpileTs } from './tools-transpile-ts.mjs';
import { RECORD_MIGRATION_FILE, SCHEMA, literal, quote } from './tools-entity-schema-plan.mjs';

/** The data module the service reads, for the purposes and their page bounds. */
export const POLICY_FILE = 'services/pennsync-api/read-purpose-policy.mjs';
/**
 * Where a domain's generated SQL goes. One file each, because one contract
 * family reads each.
 *
 * A domain would be absent here if its policies were extracted but not yet
 * emitted — the state `document` was in for exactly as long as it took D27 to
 * decide how a document reaches its tenancy, because policy functions nothing
 * can call are dead SQL in a migration.
 */
export const POLICY_SQL_FILES = Object.freeze({
  patient: 'services/authority-store/supabase/record-migrations/20260920050000_patient_purpose_policy.sql',
  visit: 'services/authority-store/supabase/record-migrations/20260920070000_visit_purpose_policy.sql',
  document: 'services/authority-store/supabase/record-migrations/20260920090000_document_purpose_policy.sql',
});
/**
 * The same policies as SQL, so the projection a caller receives is decided in
 * the database rather than by the service.
 *
 * The contracts beside them are hand-written, as every contract is, because
 * their authorization is their own. These files are not that: they are
 * thirty-eight field lists, thirty-eight role sets and twenty-one page bounds,
 * all of them data that already exists in the originals. Typing them into SQL
 * by hand is the transcription D12 settled against, and a dropped field name
 * in a `jsonb_build_object` would silently narrow — or widen — a clinical
 * disclosure. So the data is generated and the authorization is written; the
 * two live in separate files so neither can be mistaken for the other.
 */
/**
 * Every fenced policy, each named by the capability it belongs to.
 *
 * Six of them across three domains, and the pairing is the same each time: a
 * list capability and a single-read capability, each with its OWN purposes. A
 * visit list is asked for `schedule`; one visit is opened for
 * `documentation_context`. Nothing in the originals says the vocabularies are
 * separate — they are separate because each module declares its own — so each
 * gets its own `_known` function and a purpose from one is refused in the
 * other.
 *
 * `paged` says whether the block carries a bound PER PURPOSE. Two list
 * policies do not: `listAuthorizedDocuments` bounds every purpose at one
 * number declared outside the fence, which is the contract's to state rather
 * than this tool's to read.
 */
export const POLICIES = Object.freeze([
  Object.freeze({
    key: 'patient_list', domain: 'patient', table: 'patient',
    original: 'base44/functions/listAuthorizedPatients/entry.ts',
    marker: 'AUTHORIZED PATIENT LIST PURPOSE POLICY',
    prefix: 'patient_list_purpose', constant: 'PATIENT_LIST_PURPOSE', paged: true,
  }),
  Object.freeze({
    key: 'patient_exact', domain: 'patient', table: 'patient',
    original: 'base44/functions/getAuthorizedPatient/entry.ts',
    marker: 'AUTHORIZED PATIENT EXACT PURPOSE POLICY',
    prefix: 'patient_exact_purpose', constant: 'PATIENT_EXACT_PURPOSE', paged: false,
  }),
  Object.freeze({
    key: 'visit_list', domain: 'visit', table: 'visit',
    original: 'base44/functions/listAuthorizedVisits/entry.ts',
    marker: 'AUTHORIZED VISIT LIST PURPOSE POLICY',
    prefix: 'visit_list_purpose', constant: 'VISIT_LIST_PURPOSE', paged: true,
  }),
  Object.freeze({
    key: 'visit_exact', domain: 'visit', table: 'visit',
    original: 'base44/functions/getAuthorizedVisit/entry.ts',
    marker: 'AUTHORIZED VISIT EXACT PURPOSE POLICY',
    prefix: 'visit_exact_purpose', constant: 'VISIT_EXACT_PURPOSE', paged: false,
  }),
  Object.freeze({
    key: 'document_list', domain: 'document', table: 'document',
    original: 'base44/functions/listAuthorizedDocuments/entry.ts',
    marker: 'AUTHORIZED DOCUMENT LIST PURPOSE POLICY',
    prefix: 'document_list_purpose', constant: 'DOCUMENT_LIST_PURPOSE', paged: false,
  }),
  Object.freeze({
    key: 'document_exact', domain: 'document', table: 'document',
    original: 'base44/functions/getAuthorizedDocument/entry.ts',
    marker: 'AUTHORIZED DOCUMENT EXACT PURPOSE POLICY',
    prefix: 'document_exact_purpose', constant: 'DOCUMENT_EXACT_PURPOSE', paged: false,
  }),
]);
/** The domains whose SQL is emitted. A policy outside it is data only. */
export const DOMAINS = Object.freeze(Object.keys(POLICY_SQL_FILES));
export const EXTRACTED_ONLY = Object.freeze([...new Set(POLICIES
  .map(policy => policy.domain).filter(domain => !DOMAINS.includes(domain)))]);
export const POLICY_KEYS = Object.freeze(POLICIES.map(policy => policy.key));
/**
 * The writable field sets, for the capabilities that CREATE a row.
 *
 * The same argument as the purpose policies and a different shape. A create
 * capability declares which fields a client may supply — 46 of them for a
 * patient — and the comment above that declaration in the original says what
 * is deliberately absent: tenancy, provenance, assignment, lifecycle, derived
 * metrics and automation claims. Retyping the list is the transcription D12
 * settled against, and here a field added by hand would let a caller write a
 * column the original never let them near.
 *
 * Not fenced, because the originals do not fence it. That is not a weaker
 * guarantee: extraction is by NAME, so a declaration that was renamed or
 * removed fails the run rather than silently producing less.
 *
 * `reserved` names the fields the declaration carries that the CONTRACT
 * decides rather than the caller — the agency it stamps, the idempotency key
 * it keys on, the status a new row must have. They are listed here so the
 * emitted SQL refuses them explicitly instead of a reader having to notice
 * they are missing.
 */
export const WRITE_POLICIES = Object.freeze([
  Object.freeze({
    key: 'patient_create', domain: 'patient', table: 'patient',
    original: 'base44/functions/createAuthorizedPatient/entry.ts',
    declaration: 'CLIENT_PATIENT_FIELDS',
    prefix: 'patient_create', constant: 'PATIENT_CREATE',
    reserved: Object.freeze(['agency_id', 'client_request_id', 'status']),
  }),
  Object.freeze({
    key: 'visit_create', domain: 'visit', table: 'visit',
    original: 'base44/functions/createAuthorizedVisit/entry.ts',
    declaration: 'CLIENT_VISIT_FIELDS',
    prefix: 'visit_create', constant: 'VISIT_CREATE',
    // Four of the nine. `patient_id` joins the usual three because a visit
    // names the chart it belongs to, and the chart is what the contract is
    // authorized against — so it is a parameter rather than a payload field,
    // and a payload naming it is refused like the other three.
    reserved: Object.freeze(['agency_id', 'client_request_id', 'patient_id', 'status']),
  }),
]);
/**
 * The action policies, for the capabilities that MUTATE a row.
 *
 * A third shape and the same argument. A mutation capability does not take a
 * patch; it takes a named workflow action, and the action decides both which
 * fields it may touch and which tenant roles may perform it. Six actions over
 * twenty-nine fields for a patient — two declarations the original fences for
 * exactly the reason the purpose blocks are fenced.
 *
 * `fields` and `roles` name the two declarations inside the fence.
 * `protect` names the list of columns the original never accepts from a
 * caller. It is read as a CHECK and never emitted: the contract accepts only
 * the fields an action declares, so a protected one cannot reach it, and a
 * policy function nothing can call is dead SQL. What it catches is drift — an
 * action that grew `agency_id` fails the run here rather than shipping.
 */
export const ACTION_POLICIES = Object.freeze([
  Object.freeze({
    key: 'patient_action', domain: 'patient', table: 'patient',
    original: 'base44/functions/updateAuthorizedPatient/entry.ts',
    marker: 'PATIENT MUTATION ACTION POLICY',
    fields: 'ACTION_FIELD_NAMES', roles: 'ACTION_ROLE_NAMES',
    protect: 'PROTECTED_PATIENT_FIELDS',
    prefix: 'patient_action', constant: 'PATIENT_ACTION',
  }),
]);
/**
 * The action INPUT policies, for a mutation capability whose actions are not
 * a batch and whose roles are code.
 *
 * A second shape, and the differences from `ACTION_POLICIES` are all real
 * rather than cosmetic — which is why this is a separate list with a reader
 * of its own instead of four flags on the first one:
 *
 * - **The fields are INPUTS, not columns.** `advance_handoff` accepts
 *   `next_status` and writes `emr_handoff_status` and `emr_handoff_history`;
 *   `set_review_ack` accepts `expected_note_hash` and writes none of it. So
 *   what is emitted is `_accepts`, never `_writes`, and which columns move is
 *   the contract's to decide from the action's own logic.
 * - **The sets are allowed to overlap.** Disjointness matters when a batch of
 *   actions becomes one write. This capability takes ONE action per call, and
 *   `save_documentation` and `set_ai_tags` both accept `ai_tags`.
 * - **The roles are not data.** The original decides them in
 *   `requireActionPolicy`, in code, with one rule per action group. A
 *   generator that invented a data shape for them would be transcribing a
 *   decision rather than carrying one, so the contract states them and this
 *   emits none.
 * - **Not every action is ported, and each one that is not says why.** An
 *   action neither served nor explained fails the run, which is the check
 *   that keeps `served` honest as the port advances.
 */
export const ACTION_INPUT_POLICIES = Object.freeze([
  Object.freeze({
    key: 'visit_action', domain: 'visit', table: 'visit',
    original: 'base44/functions/updateAuthorizedVisit/entry.ts',
    // Read by NAME rather than from a fence, because the original writes its
    // action map in terms of another declaration instead of inside a marker
    // pair. Both are named so the first is evaluated before the second.
    declarations: Object.freeze(['SAVE_DOCUMENTATION_FIELDS', 'ACTION_FIELDS']),
    prefix: 'visit_action', constant: 'VISIT_ACTION',
    // The four this port carries. The rest are named below with a reason.
    served: Object.freeze([
      'save_documentation', 'reschedule', 'advance_handoff', 'set_review_ack',
    ]),
    // An accepted field that is not a column of the table, and is therefore an
    // INPUT the action interprets. Enumerated so a mistyped column name is
    // still caught: anything not here must be a column.
    inputs: Object.freeze([
      'next_status', 'acknowledged', 'nurse_edited', 'expected_note_hash',
    ]),
    unported: Object.freeze({
      set_ai_tags: 'D14 and D22 removed the platform tier, and the original admits '
        + 'nobody else: `requireActionPolicy` requires `user.role === \'admin\'` AND the '
        + 'configured SUPER_ADMIN_EMAIL. Dropping that tier closes the action outright, '
        + 'so who may set an AI tag is a decision rather than a rendering detail.',
      read_ai_processing_source: 'Server-to-server only, behind INTERNAL_FN_SECRET. '
        + 'Its one caller is `processCompletedVisit`, which is not ported, and the record '
        + 'store has no concept of a service identity yet.',
      claim_ai_processing: 'Server-to-server only, behind INTERNAL_FN_SECRET.',
      publish_ai_processing: 'Server-to-server only, behind INTERNAL_FN_SECRET.',
      legacy_recovery: 'Paused at source. The original answers 503 before reading '
        + 'anything, deliberately, until an owner-approved recovery protocol exists; '
        + 'porting it would be re-enabling it.',
    }),
  }),
]);
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

/**
 * Read one named `Set` or array declaration out of a module.
 *
 * Evaluated the same way a fenced block is — transpiled and run in a function
 * scope — because the alternative is retyping it. The declaration is located
 * by name and its own statement is sliced out, so nothing else in the module
 * is evaluated: these originals import a Base44 client and call `Deno.serve`
 * at the top level, and running either would be a side effect a generator has
 * no business having.
 */
export function declarationStatement(source, declaration) {
  const start = source.search(new RegExp(`^const\\s+${declaration}\\s*[:=]`, 'm'));
  check(start >= 0, `WRITE_DECLARATION_MISSING:${declaration}`);
  // Three shapes and three closers: `new Set([…]);`, a bare array `[…];`, and
  // an object literal `{…};`. Take whichever comes first so one reader serves
  // all three; scanning past it would swallow the next declaration whole. They
  // do not collide, because an entry INSIDE any of them ends with a comma
  // rather than a semicolon.
  const closers = [']);', '];', '};']
    .map(closer => ({ closer, at: source.indexOf(closer, start) }))
    .filter(candidate => candidate.at >= start)
    .sort((left, right) => left.at - right.at);
  check(closers.length > 0, `WRITE_DECLARATION_UNREADABLE:${declaration}`);
  const [{ closer, at }] = closers;
  return source.slice(start, at + closer.length);
}

/**
 * Evaluate one or more named declarations and return the LAST one's value.
 *
 * More than one because a declaration can be written in terms of another —
 * `ACTION_FIELDS` names `SAVE_DOCUMENTATION_FIELDS` rather than repeating its
 * thirteen fields — and evaluating the second without the first would fail
 * rather than silently produce less.
 */
export function readDeclarations(source, names) {
  const statements = names.map(name => declarationStatement(source, name));
  const js = transpileTs(statements.join('\n')).outputText;
  return new Function(`${js}\nreturn ${names.at(-1)};`)();
}

export function readDeclaration(source, policy) {
  const { declaration } = policy;
  const value = readDeclarations(source, [declaration]);
  const fields = value instanceof Set ? [...value] : value;
  check(Array.isArray(fields) && fields.length > 0, `WRITE_DECLARATION_EMPTY:${declaration}`);
  for (const field of policy.reserved ?? []) {
    // A reserved field the declaration does not carry is a list that moved on
    // without this one, which is the drift the extraction exists to catch.
    check(fields.includes(field), `WRITE_RESERVED_ABSENT:${policy.key}.${field}`);
  }
  const reserved = policy.reserved ?? [];
  const writable = fields.filter(field => !reserved.includes(field));
  check(writable.length > 0, `WRITE_DECLARATION_ALL_RESERVED:${policy.key}`);
  return { declared: [...fields], writable, reserved: [...reserved] };
}

/** Every purpose policy, keyed the way the artifacts below name them. */
export function extract(repository) {
  return Object.fromEntries(POLICIES.map(policy =>
    [policy.key, readPolicy(readFileSync(join(repository, policy.original), 'utf8'), policy)]));
}

/** The writable field sets, keyed the same way. */
export function extractWrites(repository) {
  return Object.fromEntries(WRITE_POLICIES.map(policy =>
    [policy.key, readDeclaration(readFileSync(join(repository, policy.original), 'utf8'), policy)]));
}

/**
 * Evaluate a fenced action block and read its two declarations out of it.
 *
 * The same machinery the purpose blocks use, and three checks they do not
 * need. An action's fields must be DISJOINT from every other action's,
 * because the original merges a batch of actions into one write and throws if
 * two of them assign the same field — a property it asserts at runtime and
 * nothing proved beforehand. An action must name at least one role, or it is a
 * workflow nobody can perform. And no action may name a protected column.
 *
 * Unlike a read projection, an action's field list must NOT carry `id`: a
 * caller names the row, never re-writes its identity.
 */
export function readActionPolicy(source, policy) {
  const block = policyBlock(source, policy);
  const names = [policy.fields, policy.roles];
  for (const name of names) {
    check(new RegExp(`const\\s+${name}\\b`).test(block), `ACTION_MISSING_${name}`);
  }
  const js = transpileTs(block).outputText;
  // Same reasoning as `readPolicy`: this repository's own source, read from
  // disk by a developer tool, never reached by the service.
  const values = new Function(`${js}\nreturn { ${names.join(', ')} };`)();
  const declaredFields = values[policy.fields];
  const declaredRoles = values[policy.roles];
  // Declaration order, NOT sorted, unlike a purpose vocabulary: the original
  // names this order `ACTION_CANONICAL_ORDER` and sorts a submitted batch into
  // it, so it is part of what is being carried rather than an artifact of how
  // the object was written.
  const actions = Object.keys(declaredFields);
  check(actions.length > 0, 'ACTION_POLICY_EMPTY');
  const protectedFields = readDeclaration(source, { ...policy, declaration: policy.protect });
  const guarded = new Set(protectedFields.declared);
  const seen = new Map();
  const extracted = {};
  for (const action of actions) {
    const fields = declaredFields[action];
    const roles = declaredRoles?.[action];
    check(Array.isArray(fields) && fields.length > 0, `ACTION_FIELDS_INVALID:${action}`);
    check(Array.isArray(roles) && roles.length > 0, `ACTION_ROLES_INVALID:${action}`);
    for (const field of fields) {
      check(!guarded.has(field), `ACTION_FIELD_PROTECTED:${action}.${field}`);
      check(field !== 'id', `ACTION_FIELD_IS_IDENTITY:${action}`);
      const owner = seen.get(field);
      check(owner === undefined, `ACTION_FIELD_SHARED:${field}:${owner}+${action}`);
      seen.set(field, action);
    }
    extracted[action] = {
      // The original's order, like a projection's: it is the order a reader
      // compares this against the fence.
      fields: [...fields],
      roles: [...roles].sort(),
    };
  }
  // An action the roles declaration names and the fields declaration does not
  // is a role grant for a workflow that no longer exists.
  for (const action of Object.keys(declaredRoles ?? {})) {
    check(extracted[action] !== undefined, `ACTION_ROLES_ORPHANED:${action}`);
  }
  return extracted;
}

/**
 * Read an action map that is a named declaration rather than a fenced block.
 *
 * Four checks, and the last is the one that keeps a partial port honest: every
 * action the original declares must be either served here or explained, so an
 * action added upstream cannot be silently unreachable.
 */
export function readActionInputs(source, policy) {
  const declared = readDeclarations(source, policy.declarations);
  check(declared && typeof declared === 'object', `ACTION_INPUTS_INVALID:${policy.key}`);
  const actions = Object.keys(declared);
  check(actions.length > 0, 'ACTION_INPUTS_EMPTY');
  const extracted = {};
  for (const action of actions) {
    const raw = declared[action];
    const fields = raw instanceof Set ? [...raw] : raw;
    check(Array.isArray(fields), `ACTION_INPUTS_INVALID:${action}`);
    extracted[action] = {
      fields,
      served: policy.served.includes(action),
      because: policy.unported[action] ?? null,
    };
    // Served or explained, never neither. An action that is both is a list
    // that moved on without the other half.
    check(extracted[action].served !== (extracted[action].because !== null),
      `ACTION_DISPOSITION_MISSING:${action}`);
    // A served action with no inputs at all would be a call with no argument
    // and no effect; the original has two such actions and both are unported.
    if (extracted[action].served) {
      check(fields.length > 0, `ACTION_INPUTS_EMPTY:${action}`);
    }
  }
  for (const action of policy.served) {
    check(extracted[action] !== undefined, `ACTION_SERVED_UNDECLARED:${action}`);
  }
  for (const action of Object.keys(policy.unported)) {
    check(extracted[action] !== undefined, `ACTION_UNPORTED_UNDECLARED:${action}`);
  }
  return extracted;
}

/** The action input policies, keyed the way the artifacts below name them. */
export function extractActionInputs(repository) {
  return Object.fromEntries(ACTION_INPUT_POLICIES.map(policy =>
    [policy.key, readActionInputs(readFileSync(join(repository, policy.original), 'utf8'), policy)]));
}

/** The action policies, keyed the way the artifacts below name them. */
export function extractActions(repository) {
  return Object.fromEntries(ACTION_POLICIES.map(policy =>
    [policy.key, readActionPolicy(readFileSync(join(repository, policy.original), 'utf8'), policy)]));
}

export function render(policies, writes, actions, inputs) {
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
  return `// GENERATED by \`node tools-read-purpose-policy.mjs --write\`. Do not edit.
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
${WRITE_POLICIES.map(policy => `//
// The fields a client may supply to \`${policy.original.split('/').at(-2)}\`, and the
// ones the contract decides instead. Extracted from \`${policy.declaration}\`.
export const ${policy.constant}_WRITABLE = Object.freeze(${JSON.stringify(writes[policy.key].writable)});
export const ${policy.constant}_RESERVED = Object.freeze(${JSON.stringify(writes[policy.key].reserved)});`).join('\n')}
${ACTION_POLICIES.map(policy => `//
// The workflow actions \`${policy.original.split('/').at(-2)}\` accepts, from its own
// \`${policy.fields}\` and \`${policy.roles}\`. An action decides which fields it
// may touch and which tenant roles may perform it; the field sets are
// disjoint, so a batch of actions is one write.
export const ${policy.constant}S = Object.freeze(${JSON.stringify(Object.keys(actions[policy.key]))});
export const ${policy.constant}_POLICY = Object.freeze({
${Object.entries(actions[policy.key]).map(([action, entry]) => `  ${action}: Object.freeze({
    fields: Object.freeze(${JSON.stringify(entry.fields)}),
    roles: Object.freeze(${JSON.stringify(entry.roles)}),
  }),`).join('\n')}
});`).join('\n')}
${ACTION_INPUT_POLICIES.map(policy => `//
// The actions \`${policy.original.split('/').at(-2)}\` declares, from its own
// \`${policy.declarations.at(-1)}\`, and the INPUTS each one accepts — inputs rather
// than columns, because an action interprets them. \`served\` says whether this
// port carries the action; one that does not says why, and an action that is
// neither served nor explained fails the extraction.
export const ${policy.constant}S = Object.freeze(${JSON.stringify(Object.keys(inputs[policy.key]))});
export const ${policy.constant}S_SERVED = Object.freeze(${JSON.stringify(
  Object.entries(inputs[policy.key]).filter(([, entry]) => entry.served).map(([action]) => action))});
export const ${policy.constant}_POLICY = Object.freeze({
${Object.entries(inputs[policy.key]).map(([action, entry]) => `  ${action}: Object.freeze({
    fields: Object.freeze(${JSON.stringify(entry.fields)}),
    served: ${entry.served},
    because: ${entry.because === null ? 'null' : JSON.stringify(entry.because)},
  }),`).join('\n')}
});`).join('\n')}
`;
}

/**
 * The columns a record-store table actually has.
 *
 * Read from the emitted migration rather than from the entity definition,
 * because the migration is what will exist: a field a policy names and the
 * table lacks would emit SQL that fails at apply time, and finding that out in
 * CI hours later is worse than finding it out here.
 */
export function tableColumns(repository, table, file = RECORD_MIGRATION_FILE) {
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
export function renderSql(policies, domain, columnsFor, writes = {}, actions = {}, inputs = {}) {
  const vocabulary = new Set([...TENANT_ROLES, ...UNSUPPORTED_ROLES]);
  const signatures = [];
  const bodies = [];
  const tables = new Set();
  let dropped = 0;
  let total = 0;
  let actionDropped = 0;
  let actionTotal = 0;
  let inputTotal = 0;
  let inputServed = 0;
  const served = {};
  const mine = POLICIES.filter(policy => policy.domain === domain);
  check(mine.length > 0, `POLICY_DOMAIN_UNKNOWN:${domain}`);
  const writesHere = WRITE_POLICIES.filter(policy => policy.domain === domain);
  const actionsHere = ACTION_POLICIES.filter(policy => policy.domain === domain);
  const inputsHere = ACTION_INPUT_POLICIES.filter(policy => policy.domain === domain);
  for (const policy of mine) {
    const extracted = policies[policy.key];
    const known = new Set(columnsFor(policy.table));
    tables.add(policy.table);
    const purposes = Object.keys(extracted);
    const admitted = {};
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
      admitted[purpose] = roles;
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
${purposeCase(purposes, purpose => `    when '${purpose}' then p_role in (${admitted[purpose].map(role => `'${role}'`).join(', ')})`, 'false')}
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
  p_purpose text, p ${quote(SCHEMA)}.${quote(policy.table)}) returns jsonb
  language sql stable set search_path = '' as $policy$
${purposeCase(purposes, purpose => `    when '${purpose}' then jsonb_build_object(\n${
  extracted[purpose].fields.map(field => `      '${field}', p.${quote(field)}`).join(',\n')})`, 'null')}
$policy$;`);
    signatures.push(`${name('known')}(text)`, `${name('admits')}(text,text)`);
    if (policy.paged) signatures.push(`${name('page_size')}(text)`);
    signatures.push(`${name('row')}(text,${quote(SCHEMA)}.${quote(policy.table)})`);
  }
  for (const policy of writesHere) {
    const entry = writes[policy.key];
    check(entry !== undefined, `WRITE_POLICY_NOT_EXTRACTED:${policy.key}`);
    const known = new Set(columnsFor(policy.table));
    for (const field of entry.declared) {
      check(known.has(field), `WRITE_FIELD_NOT_A_COLUMN:${policy.key}.${field}`);
    }
    tables.add(policy.table);
    const name = suffix => `${quote(SCHEMA)}.${quote(`${policy.prefix}_${suffix}`)}`;
    bodies.push(`-- The fields a client may supply to \`${policy.original.split('/').at(-2)}\`
-- (${entry.writable.length} of the ${entry.declared.length} its \`${policy.declaration}\` declares; the other
-- ${entry.reserved.length} are the contract's to decide, and it refuses a payload naming one).
create function ${name('writable')}(p_field text) returns boolean
  language sql immutable set search_path = '' as $write$
  select p_field in (${entry.writable.map(field => `'${field}'`).join(', ')})
$write$;

create function ${name('reserved')}(p_field text) returns boolean
  language sql immutable set search_path = '' as $write$
  select p_field in (${entry.reserved.map(field => `'${field}'`).join(', ')})
$write$;`);
    signatures.push(`${name('writable')}(text)`, `${name('reserved')}(text)`);
  }
  for (const policy of actionsHere) {
    const entry = actions[policy.key];
    check(entry !== undefined, `ACTION_POLICY_NOT_EXTRACTED:${policy.key}`);
    const known = new Set(columnsFor(policy.table));
    const names = Object.keys(entry);
    for (const action of names) {
      for (const field of entry[action].fields) {
        check(known.has(field), `ACTION_FIELD_NOT_A_COLUMN:${policy.key}.${action}.${field}`);
      }
      for (const role of entry[action].roles) {
        check(vocabulary.has(role), `ACTION_ROLE_UNKNOWN:${policy.key}.${action}.${role}`);
      }
      const roles = entry[action].roles.filter(role => !UNSUPPORTED_ROLES.includes(role));
      // Same rule the purposes get: dropping the platform tier must never be
      // what turns a workflow off.
      check(roles.length > 0, `ACTION_ADMITS_NOBODY:${policy.key}.${action}`);
      served[policy.key] ??= {};
      served[policy.key][action] = roles;
      actionTotal += 1;
      if (roles.length !== entry[action].roles.length) actionDropped += 1;
    }
    tables.add(policy.table);
    const name = suffix => `${quote(SCHEMA)}.${quote(`${policy.prefix}_${suffix}`)}`;
    const actionCase = (arm, fallback) =>
      `  select case p_action\n${names.map(arm).join('\n')}\n    else ${fallback} end`;
    bodies.push(`-- The workflow actions \`${policy.original.split('/').at(-2)}\` accepts
-- (${names.length} of them over ${new Set(names.flatMap(action => entry[action].fields)).size} fields, from its own \`${policy.fields}\`
-- and \`${policy.roles}\`). The field sets are disjoint and the generator
-- refuses to render if they stop being, because the original merges a batch
-- of actions into ONE write and two actions assigning one field would make
-- the answer depend on their order.
create function ${name('known')}(p_action text) returns boolean
  language sql immutable set search_path = '' as $action$
${actionCase(action => `    when '${action}' then true`, 'false')}
$action$;

create function ${name('admits')}(p_action text, p_role text) returns boolean
  language sql immutable set search_path = '' as $action$
${actionCase(action => `    when '${action}' then p_role in (${served[policy.key][action].map(role => `'${role}'`).join(', ')})`, 'false')}
$action$;

create function ${name('writes')}(p_action text, p_field text) returns boolean
  language sql immutable set search_path = '' as $action$
${actionCase(action => `    when '${action}' then p_field in (${entry[action].fields.map(field => `'${field}'`).join(', ')})`, 'false')}
$action$;

-- The original's \`ACTION_CANONICAL_ORDER\`: the order the declaration is
-- written in, which it sorts a submitted batch into so that the answer does
-- not depend on the order a caller happened to send.
create function ${name('rank')}(p_action text) returns integer
  language sql immutable set search_path = '' as $action$
${actionCase((action, index) => `    when '${action}' then ${index + 1}`, 'null')}
$action$;`);
    signatures.push(`${name('known')}(text)`, `${name('admits')}(text,text)`,
      `${name('writes')}(text,text)`, `${name('rank')}(text)`);
  }
  for (const policy of inputsHere) {
    const entry = inputs[policy.key];
    check(entry !== undefined, `ACTION_INPUTS_NOT_EXTRACTED:${policy.key}`);
    const known = new Set(columnsFor(policy.table));
    const names = Object.keys(entry);
    const served = names.filter(action => entry[action].served);
    for (const action of served) {
      for (const field of entry[action].fields) {
        // A column, or a named input the action interprets. Anything else is
        // a mistyped column name, which is the drift this catches.
        check(known.has(field) || policy.inputs.includes(field),
          `ACTION_INPUT_UNKNOWN:${policy.key}.${action}.${field}`);
      }
    }
    check(served.length > 0, `ACTION_INPUTS_NONE_SERVED:${policy.key}`);
    tables.add(policy.table);
    inputTotal += names.length;
    inputServed += served.length;
    const name = suffix => `${quote(SCHEMA)}.${quote(`${policy.prefix}_${suffix}`)}`;
    const inputCase = (arm, fallback) =>
      `  select case p_action\n${names.map(arm).join('\n')}\n    else ${fallback} end`;
    bodies.push(`-- The actions \`${policy.original.split('/').at(-2)}\` declares (${names.length}), and the
-- ${served.length} this port serves. An action it does not serve is KNOWN and refused with
-- the reason below, which is not the same answer as an action that does not
-- exist — and the generator refuses to render if one is neither.
create function ${name('known')}(p_action text) returns boolean
  language sql immutable set search_path = '' as $action$
${inputCase(action => `    when '${action}' then true`, 'false')}
$action$;

create function ${name('served')}(p_action text) returns boolean
  language sql immutable set search_path = '' as $action$
${inputCase(action => `    when '${action}' then ${entry[action].served}`, 'false')}
$action$;

-- Why an action is not served. A reason rather than a flag, because "not
-- ported" and "not allowed" are different things to be told.
create function ${name('unported')}(p_action text) returns text
  language sql immutable set search_path = '' as $action$
${inputCase(action => `    when '${action}' then ${entry[action].because === null
  ? 'null::text' : literal(entry[action].because)}`, 'null::text')}
$action$;

-- The inputs a served action accepts. Inputs, not columns: \`advance_handoff\`
-- accepts \`next_status\` and writes \`emr_handoff_status\` and its history, and
-- which columns move is the contract's to decide from the action's own logic.
create function ${name('accepts')}(p_action text, p_field text) returns boolean
  language sql immutable set search_path = '' as $action$
${inputCase(action => `    when '${action}' then ${entry[action].served
  ? `p_field in (${entry[action].fields.map(field => `'${field}'`).join(', ')})` : 'false'}`, 'false')}
$action$;

-- Declaration order, so an answer does not depend on how a caller spelled it.
create function ${name('rank')}(p_action text) returns integer
  language sql immutable set search_path = '' as $action$
${inputCase((action, index) => `    when '${action}' then ${index + 1}`, 'null')}
$action$;`);
    signatures.push(`${name('known')}(text)`, `${name('served')}(text)`,
      `${name('unported')}(text)`, `${name('accepts')}(text,text)`, `${name('rank')}(text)`);
  }
  return `-- GENERATED by \`node tools-read-purpose-policy.mjs --write\`. Do not edit.
--
-- The authorized-${domain} purpose policies, as SQL.
--
-- Reading a ${domain} is purpose-bound: a caller names a purpose, and the
-- purpose decides which fields are disclosed and which tenant roles may ask at
-- all. Those blocks are the authorization contract, and they are ${total} purposes
-- long between them — so they are extracted from
${mine.map(policy => `-- \`${policy.original}\``).join(' and\n')}
-- rather than retyped, and re-extracted by a test on every run. A dropped
-- field name here would widen or narrow a clinical disclosure with nothing to
-- notice it.
--
-- Two vocabularies, deliberately not merged: the list capability and the
-- single-read capability each declare their own purposes, so a purpose from
-- one is not a purpose in the other and \`<prefix>_known\` is how each contract
-- says so.
--
-- Every function here is pure, and none of them has any authorization: they
-- answer what a policy says, never who is asking. The contracts beside them
-- are hand-written and decide that, because a capability's authorization is
-- its own.
${inputTotal === 0 ? '' : `--
-- The action policies here belong to a capability that takes ONE named action
-- per call rather than a batch: ${inputTotal} actions, of which this port serves
-- ${inputServed}. What they carry is each action's INPUTS, because an action interprets
-- them rather than writing them; which columns move is the contract's. The
-- roles are the contract's too — the original decides them in code, and
-- inventing a data shape for a decision is not carrying it.
`}${actionTotal === 0 ? '' : `--
-- The action policies here are the same kind of thing for a capability that
-- MUTATES a ${domain}: ${actionTotal} named workflow actions, each deciding which fields
-- it may touch and which roles may perform it. Their field sets are disjoint,
-- so a batch of actions is one write and its result does not depend on the
-- order they arrived in.
`}--
-- One divergence from the originals, and it is a narrowing: ${UNSUPPORTED_ROLES.join(', ')} is
-- admitted by ${dropped + actionDropped} of the ${total + actionTotal} purposes and actions there and by none
-- here. D14 and D22 removed the platform tier, \`caller_tenant_role\` can only
-- answer one of ${TENANT_ROLES.slice(0, 3).join(', ')},
-- ${TENANT_ROLES.slice(3).join(', ')}, and emitting a branch nothing
-- can take would read like a tier that still exists. Every purpose and every
-- action still admits somebody without it; the generator refuses to render if
-- one would not.
begin;

do $$
begin
  if ${[...tables].map(table => `to_regclass('${SCHEMA}.${table}') is null`).join('\n    or ')}
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
    const writes = extractWrites(repository);
    const actions = extractActions(repository);
    const inputs = extractActionInputs(repository);
    // Read each table once: six policies over three tables, and the migration
    // is 6,000 lines.
    const columns = new Map();
    const columnsFor = (table) => {
      if (!columns.has(table)) columns.set(table, tableColumns(repository, table));
      return columns.get(table);
    };
    artifacts = [
      [POLICY_FILE, render(policies, writes, actions, inputs)],
      ...DOMAINS.map(domain =>
        [POLICY_SQL_FILES[domain],
          renderSql(policies, domain, columnsFor, writes, actions, inputs)]),
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
    log(`read purpose policies unchanged: ${counted}`);
    return 0;
  }
  log(`read purpose policies CHANGED in ${drifted.map(([file]) => file).join(', ')}. `
    + 'Re-run `node tools-read-purpose-policy.mjs --write`.');
  return 1;
}

// Direct-invocation check through pathToFileURL: a hand-built `file://`
// string never matches a Windows backslash path or a percent-encoded one,
// and the CLI then exits 0 having silently done nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
