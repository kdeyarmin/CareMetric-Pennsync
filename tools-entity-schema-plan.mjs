#!/usr/bin/env node
/**
 * Candidate PostgreSQL schema for the entities being carried off Base44.
 *
 * Phase 2 of the exit needs an independent home for the entity types marked
 * `port` or `broker` in `tools-transition-disposition.json`. This derives that
 * schema from the committed JSONC definitions so the shape follows the source
 * of truth rather than a hand transcription of 250 files.
 *
 * What it produces is a **candidate**, not an approved schema. It is
 * deliberately permissive about existing data and strict about access:
 *
 * - Columns are nullable even where the entity marks them required, because a
 *   legacy row that predates a requirement must still migrate and be
 *   reconciled rather than rejected at load time.
 * - Enum values become CHECK constraints, so a row carrying a retired value
 *   fails loudly and is quarantined instead of being silently accepted.
 * - The primary key is (source_app_id, id). The two source apps have
 *   independent identity spaces with colliding ids, so a single-column key
 *   would merge unrelated records.
 * - Every table forces row level security with no policy and no grant, matching
 *   the authority store: reads go through reviewed brokers, never direct CRUD.
 *
 * Indexes, foreign keys, partitioning and retention are deliberately absent:
 * each needs a per-entity decision this tool cannot make. It is offline and
 * writes nothing to any database.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSON5 from 'json5';

export const FORMAT = 'pennsync-entity-schema-plan';
export const FORMAT_VERSION = 1;
export const EXPECTATIONS_FILE = 'tools-entity-schema-plan-expectations.json';
export const DISPOSITION_FILE = 'tools-transition-disposition.json';
export const ENTITY_DIRECTORY = 'base44/entities';
/** A separate namespace from the authority store's `pennsync_private`. */
export const SCHEMA = 'pennsync_records';
/** Only these dispositions get a table here. */
export const CARRIED = Object.freeze(['port', 'broker']);
export const MAX_IDENTIFIER = 63;

/**
 * Columns every carried row has, independent of its entity definition.
 *
 * `identity` columns form the primary key and cannot be redefined: an entity
 * declaring one is a conflict a person must resolve, not something to merge.
 * The rest are platform metadata that several entities also declare
 * explicitly, usually to document the creator's email. Those merge onto the
 * one column rather than being dropped, which would silently lose the field.
 */
export const SYSTEM_COLUMNS = Object.freeze([
  { name: 'source_app_id', type: 'text', notNull: true, identity: true },
  { name: 'id', type: 'text', notNull: true, identity: true },
  { name: 'created_date', type: 'timestamptz' },
  { name: 'updated_date', type: 'timestamptz' },
  { name: 'created_by', type: 'text' },
]);
const SYSTEM_BY_NAME = new Map(SYSTEM_COLUMNS.map(column => [column.name, column]));

/** Where the tenant decisions are recorded; read as data to avoid an import cycle. */
export const TENANT_DECISION_FILE = 'tools-tenant-decision.json';
/** The column that names an owning agency. */
export const TENANT_COLUMN = 'agency_id';
/**
 * Decision kinds whose tables carry a tenant key. `agency_id` is added here,
 * before any row is loaded, rather than backfilled afterwards: a row that
 * arrives without an owner cannot be given one later without guessing, and a
 * guess in this column is a cross-tenant disclosure.
 */
export const STAMPED_KINDS = Object.freeze(['agency', 'shared']);

export function snakeCase(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
}

/** Quote every identifier: many property names are reserved words. */
export const quote = value => `"${String(value).replace(/"/g, '""')}"`;
const literal = value => `'${String(value).replace(/'/g, "''")}'`;

export function columnType(property) {
  const type = Array.isArray(property?.type) ? property.type[0] : property?.type;
  if (type === 'string') {
    if (property.format === 'date') return 'date';
    if (property.format === 'date-time') return 'timestamptz';
    return 'text';
  }
  if (type === 'integer') return 'bigint';
  if (type === 'number') return 'double precision';
  if (type === 'boolean') return 'boolean';
  // Arrays and nested objects keep their exact shape rather than being
  // flattened into columns this tool would have to invent.
  if (type === 'array' || type === 'object') return 'jsonb';
  return 'text';
}

/** A finite, non-empty list of plain scalars is the only enum worth constraining. */
export function enumValues(property) {
  const values = property?.enum;
  if (!Array.isArray(values) || values.length === 0 || values.length > 200) return null;
  if (!values.every(value => typeof value === 'string' && value.length <= 200)) return null;
  if (new Set(values).size !== values.length) return null;
  return values;
}

/**
 * The column naming the chart a row belongs to, by the column's name (D24).
 *
 * Derived rather than listed, which is the property that makes it a safety
 * rule: an entity that grows a `patient_id` is narrowed by the next
 * regeneration whether or not anybody remembered. A list would have to be
 * remembered, and 58 carried entities name a patient.
 *
 * The three spellings are the ones the carried schemas actually use. A column
 * naming some OTHER clinical subject — `visit_id`, `document_id` — is not here
 * on purpose: those rows reach a chart through the entity they reference, and
 * the reference predicate narrows with it. Adding a second key would mean a
 * second set to enumerate and a second thing to keep in agreement.
 */
export const CHART_SUBJECTS = Object.freeze(['patient_id', 'target_patient_id', 'related_patient_id']);
/** `Patient` is its own chart, so its subject is the row's identity. */
export const CHART_ROOT = 'Patient';
/** What `chartSubject` answers for the root: its subject is its own identity. */
export const CHART_ROOT_SUBJECT = 'id';

/**
 * Which column narrows this entity to a chart, or null when nothing does.
 *
 * Null covers two very different cases and both are correct: a row with no
 * clinical subject at all, and a row that borrows its tenancy by reference —
 * the latter is narrowed by the entity it points at, so restating it here
 * would be a second copy of a predicate that is already right.
 *
 * Recorded on the plan (and therefore compared against the accepted one) so a
 * table that stops being narrowed is a visible change rather than a quiet one.
 */
export function chartSubject(entity, tenantKey, columns) {
  if (entity === CHART_ROOT) return CHART_ROOT_SUBJECT;
  // Only where the row's own predicate can name both an agency and a patient.
  if (!tenantKey) return null;
  const names = new Set(columns.map(column => column.name));
  return CHART_SUBJECTS.find(column => names.has(column)) ?? null;
}

export function planEntity(name, raw, disposition, decision = null) {
  const schema = JSON5.parse(raw);
  const table = snakeCase(name);
  const columns = [];
  const checks = [];
  const skipped = [];
  const merged = [];
  for (const [property, definition] of Object.entries(schema.properties || {})) {
    const column = snakeCase(property);
    if (!column || column.length > MAX_IDENTIFIER) { skipped.push({ property, reason: 'INVALID_COLUMN_NAME' }); continue; }
    const system = SYSTEM_BY_NAME.get(column);
    if (system?.identity) throw new Error(`IDENTITY_COLUMN_REDEFINED:${name}.${property}`);
    const type = columnType(definition);
    if (system) {
      // The entity documents the same platform field. Keep the one column and
      // require the declared type to agree, so a mismatch is reviewed.
      if (type !== system.type) throw new Error(`SYSTEM_COLUMN_TYPE_CONFLICT:${name}.${property}:${type}`);
      merged.push({ property, column });
      continue;
    }
    if (columns.some(existing => existing.name === column)) { skipped.push({ property, reason: 'DUPLICATE_AFTER_NORMALIZATION' }); continue; }
    columns.push({ name: column, property, type });
    const values = type === 'text' ? enumValues(definition) : null;
    if (values) checks.push({ column, values });
  }
  // A decided tenant key is added as a real column so the table cannot be
  // loaded without an owner. Appended after the declared columns, so the
  // output stays byte-deterministic.
  const declaredTenant = columns.some(column => column.name === TENANT_COLUMN);
  const stamped = !declaredTenant && STAMPED_KINDS.includes(decision?.kind);
  if (stamped) columns.push({ name: TENANT_COLUMN, property: null, type: 'text', notNull: true, stamped: true });
  return {
    entity: name,
    disposition,
    table,
    tenant_key: declaredTenant || stamped ? TENANT_COLUMN : null,
    chart_subject: chartSubject(name, declaredTenant || stamped ? TENANT_COLUMN : null, columns),
    tenant_decision: decision?.kind ?? null,
    self_subject: decision?.kind === 'self' ? snakeCase(decision.subject) : null,
    platform_flag: decision?.kind === 'shared' ? snakeCase(decision.platform_flag) : null,
    columns: columns.length,
    constrained: checks.length,
    merged_system_columns: merged.length,
    skipped,
    definition: { columns, checks },
  };
}

/** PostgreSQL truncates a long identifier, which can merge two constraints into one. */
export function constraintName(table, column) {
  return `${table}_${column}_allowed`.slice(0, MAX_IDENTIFIER);
}

export function renderEntity(plan) {
  const qualified = `${quote(SCHEMA)}.${quote(plan.table)}`;
  const names = plan.definition.checks.map(check => constraintName(plan.table, check.column));
  if (new Set(names).size !== names.length) {
    // Two constraints sharing a name would silently become one. Fail instead.
    throw new Error(`CONSTRAINT_NAME_COLLISION:${plan.entity}`);
  }
  // A global table is read by every agency, so the platform's own `created_by`
  // would hand each of them an account identifier from whichever agency
  // authored the row. Reference data has no author worth carrying, so the
  // column is not emitted there at all rather than being filtered later.
  if (plan.tenant_decision === 'global' && plan.merged_system_columns > 0) {
    // It declares a platform column of its own, which would be dropped rather
    // than merged once the platform one is withheld. Silently losing a field
    // is the defect this generator already had once.
    throw new Error(`GLOBAL_ENTITY_DECLARES_SYSTEM_COLUMN:${plan.entity}`);
  }
  const systemColumns = plan.tenant_decision === 'global'
    ? SYSTEM_COLUMNS.filter(column => column.name !== 'created_by') : SYSTEM_COLUMNS;
  const lines = [
    ...systemColumns.map(column => `  ${quote(column.name)} ${column.type}${column.notNull ? ' not null' : ''}`),
    ...plan.definition.columns.map(column => `  ${quote(column.name)} ${column.type}${column.notNull ? ' not null' : ''}`),
    `  constraint ${quote(`${plan.table}_pkey`)} primary key (${quote('source_app_id')}, ${quote('id')})`,
    ...plan.definition.checks.map(check =>
      `  constraint ${quote(constraintName(plan.table, check.column))} `
      + `check (${quote(check.column)} is null or ${quote(check.column)} in (${check.values.map(literal).join(', ')}))`),
  ];
  return [
    `create table ${qualified} (`,
    lines.join(',\n'),
    ');',
    `alter table ${qualified} enable row level security;`,
    `alter table ${qualified} force row level security;`,
    `revoke all on ${qualified} from public;`,
  ].join('\n');
}

/** Plan every carried entity exactly once; both callers below reuse the result. */
function planAll(repository) {
  const dispositions = JSON.parse(readFileSync(join(repository, DISPOSITION_FILE), 'utf8')).entities;
  const decisions = JSON.parse(readFileSync(join(repository, TENANT_DECISION_FILE), 'utf8')).entities ?? {};
  const directory = join(repository, ENTITY_DIRECTORY);
  const files = readdirSync(directory).filter(file => /\.jsonc?$/.test(file)).sort();
  const plans = [];
  const excluded = [];
  for (const file of files) {
    const name = file.replace(/\.jsonc?$/, '');
    const disposition = dispositions[name];
    if (!CARRIED.includes(disposition)) { excluded.push({ entity: name, disposition: disposition ?? 'missing' }); continue; }
    plans.push(planEntity(name, readFileSync(join(directory, file), 'utf8'), disposition, decisions[name] ?? null));
  }
  return { plans, excluded };
}

export function buildPlan(repository, prepared = null) {
  const { plans, excluded } = prepared ?? planAll(repository);
  const tables = plans.map(plan => plan.table);
  const collisions = tables.filter((table, index) => tables.indexOf(table) !== index);
  if (collisions.length) throw new Error(`TABLE_NAME_COLLISION:${[...new Set(collisions)].sort().join(',')}`);
  const oversized = plans.filter(plan => plan.table.length > MAX_IDENTIFIER).map(plan => plan.entity);
  if (oversized.length) throw new Error(`TABLE_NAME_TOO_LONG:${oversized.join(',')}`);
  return {
    format: FORMAT,
    schema_version: FORMAT_VERSION,
    target_schema: SCHEMA,
    totals: {
      carried: plans.length,
      excluded: excluded.length,
      columns: plans.reduce((sum, plan) => sum + plan.columns, 0),
      constrained_columns: plans.reduce((sum, plan) => sum + plan.constrained, 0),
      tenant_scoped: plans.filter(plan => plan.tenant_key).length,
      skipped_properties: plans.reduce((sum, plan) => sum + plan.skipped.length, 0),
      merged_system_columns: plans.reduce((sum, plan) => sum + plan.merged_system_columns, 0),
    },
    entities: plans.map(({ definition, ...rest }) => rest),
    // Everything this schema deliberately does not decide.
    indexes_planned: false,
    foreign_keys_planned: false,
    retention_planned: false,
    reviewed: false,
    applied_anywhere: false,
  };
}

/**
 * The caller-binding functions every policy below asks.
 *
 * SECURITY DEFINER because `pennsync_private` is not readable by a tenant
 * role: the answer has to be computed by something that can see the
 * membership roster without handing the caller access to it. STABLE because a
 * policy calls these once per row and the answer cannot change inside a
 * statement.
 *
 * A boundary these policies CANNOT enforce, stated because assuming otherwise
 * is how they get trusted too far: a SUPERUSER or BYPASSRLS role bypasses row
 * level security even where it is forced. The authority migration requires
 * exactly such a role to own its objects
 * (`PENNSYNC_BYPASSRLS_MIGRATION_OWNER_REQUIRED`), so a broker running as the
 * migration owner is not bound by anything below. Brokers must therefore run
 * as a role with neither attribute. `record-tenant-isolation.test.mjs`
 * demonstrates the bypass rather than describing it, so the requirement is
 * visible instead of implied.
 *
 * An active membership requires BOTH `status = 'active'` AND `revoked_at is
 * null`. The thirteen hand-copied `validateMembershipRows` variants disagreed
 * on exactly this, some accepting a row whose `revoked_at` is set while its
 * status still says active. Reading the store settles it: `membership_check`
 * already makes that row unrepresentable, so the argument was about a state
 * the database will not hold. Both markers are asked anyway, because a
 * predicate that leans on a constraint in another schema is one migration
 * away from being wrong, and a test pins the constraint so the redundancy
 * cannot quietly become the only thing holding.
 */
export const POLICY_HELPERS = [
  // The single gate, reused rather than reimplemented. `actor()` checks the
  // authenticated role, the JWT's expiry, a live session row, an active
  // non-banned native user, and an enabled identity whose email still matches.
  // An earlier version of this helper asked only `auth.uid()` plus an active
  // membership, which let a still-valid token from a signed-out or banned
  // account keep reading. A policy has to filter rather than raise, so the
  // gate's refusal becomes "no identity" here.
  `create function ${quote(SCHEMA)}.caller_identity() returns pennsync_private.identity_map
  language plpgsql stable security definer set search_path = '' as $$
  declare v_identity pennsync_private.identity_map;
  begin
    begin
      v_identity := pennsync_private.actor(pennsync_private.deployment_app_id(), false);
    exception when others then return null;
    end;
    return v_identity;
  end $$;`,
  `create function ${quote(SCHEMA)}.caller_identified() returns boolean
  language sql stable security definer set search_path = '' as $$
  select (${quote(SCHEMA)}.caller_identity()).auth_user_id is not null
$$;`,
  // A suspended agency keeps its membership rows, so the agency's own status
  // is checked here the way `context_value` checks it.
  `create function ${quote(SCHEMA)}.caller_agencies() returns setof text
  language sql stable security definer set search_path = '' as $$
  select m.agency_id::text
  from ${quote(SCHEMA)}.caller_identity() i
  join pennsync_private.membership m
    on m.app_id = i.app_id and m.auth_user_id = i.auth_user_id
   and m.base44_user_id = i.base44_user_id
  join pennsync_private.agency a on a.app_id = m.app_id and a.id = m.agency_id
  where i.auth_user_id is not null
    and m.status = 'active' and m.revoked_at is null
    and a.status in ('active','trial')
$$;`,
  // Which role the caller holds IN ONE AGENCY, for a contract that has an
  // authorization decision to make rather than a row set to filter.
  //
  // No policy asks this and none should: a policy decides whether a row is the
  // caller's, and every one of them is written in terms of `caller_agencies()`.
  // What needs it is a per-capability contract — `listPolicyLibrary` returns
  // draft and archived policies only to an administrator, which is a decision
  // about the caller rather than about a row. Putting that decision in the
  // database keeps it where the rest of this design puts authorization, instead
  // of in a service that could be wrong about it.
  //
  // Scalar rather than `setof`, because `membership` is unique on
  // (app_id, agency_id, auth_user_id) — so there is exactly one row to find, or
  // none. None returns null, and a contract reading null refuses.
  `create function ${quote(SCHEMA)}.caller_tenant_role(p_agency text) returns text
  language sql stable security definer set search_path = '' as $$
  select m.tenant_role::text
  from ${quote(SCHEMA)}.caller_identity() i
  join pennsync_private.membership m
    on m.app_id = i.app_id and m.auth_user_id = i.auth_user_id
   and m.base44_user_id = i.base44_user_id
  join pennsync_private.agency a on a.app_id = m.app_id and a.id = m.agency_id
  where i.auth_user_id is not null
    and m.agency_id::text = p_agency
    and m.status = 'active' and m.revoked_at is null
    and a.status in ('active','trial')
$$;`,
  `create function ${quote(SCHEMA)}.caller_user_id() returns text
  language sql stable security definer set search_path = '' as $$
  select (${quote(SCHEMA)}.caller_identity()).base44_user_id
$$;`,
  `create function ${quote(SCHEMA)}.caller_email() returns text
  language sql stable security definer set search_path = '' as $$
  select (${quote(SCHEMA)}.caller_identity()).expected_email
$$;`,
  // Nothing may call these directly; they exist to be asked by a policy.
  // `source_app_id` is plain text on these tables, so nothing stops a row of
  // another source app existing here — and ids collide across the two apps,
  // which is why the primary key is composite. Without this, a caller whose
  // agency key matches would read the other app's row. Every predicate below
  // asks it.
  // Who the caller shares an agency with, as the authority store sees it.
  //
  // This is the whole of D23 in one function. The carried `user` table's own
  // `agency_id`, `agency_name` and `account_type` are self-editable labels —
  // the entity schema says so in each field's own description — so no
  // predicate written against that row can decide who may read it. The
  // authority store already models the roster, it is not editable by its
  // subject, and `pennsync_private.context` authorizes against it today.
  //
  // It answers base44 user ids, because that is what `user.id` holds. A caller
  // holding two agencies sees the union, exactly as `caller_agencies()` means
  // it, and a caller holding none sees nobody — including themselves, because
  // a person with no active membership is not on anyone's roster.
  `create function ${quote(SCHEMA)}.caller_roster_ids() returns setof text
  language sql stable security definer set search_path = '' as $$
  select distinct peer.base44_user_id
  from ${quote(SCHEMA)}.caller_identity() i
  join pennsync_private.membership mine
    on mine.app_id = i.app_id and mine.auth_user_id = i.auth_user_id
   and mine.base44_user_id = i.base44_user_id
  join pennsync_private.agency a on a.app_id = mine.app_id and a.id = mine.agency_id
  join pennsync_private.membership peer
    on peer.app_id = mine.app_id and peer.agency_id = mine.agency_id
  where i.auth_user_id is not null
    and mine.status = 'active' and mine.revoked_at is null
    and a.status in ('active','trial')
    and peer.status = 'active' and peer.revoked_at is null
$$;`,
  // The roster itself, for a contract that has to ANSWER with it rather than
  // filter by it. `caller_roster_ids()` decides which carried profile rows a
  // caller may see; this carries the authority store's own columns — the
  // agency, its name, the tenant role, whether the membership is live — which
  // exist nowhere in the record store and are the very fields the carried row
  // holds an editable imitation of.
  //
  // Scoped to `caller_agencies()` and not to the argument alone, so a contract
  // that forgot to check the caller's membership still cannot read another
  // agency's roster through it.
  `create function ${quote(SCHEMA)}.caller_roster(p_agency text) returns table(
    user_id text, email text, agency_id text, agency_name text, tenant_role text, is_active boolean)
  language sql stable security definer set search_path = '' as $$
  select peer.base44_user_id, peers.expected_email, m.agency_id::text, a.name,
         peer.tenant_role::text, peers.enabled
  from ${quote(SCHEMA)}.caller_identity() i
  join pennsync_private.membership m
    on m.app_id = i.app_id and m.auth_user_id = i.auth_user_id
   and m.base44_user_id = i.base44_user_id
  join pennsync_private.agency a on a.app_id = m.app_id and a.id = m.agency_id
  join pennsync_private.membership peer on peer.app_id = m.app_id and peer.agency_id = m.agency_id
  join pennsync_private.identity_map peers
    on peers.app_id = peer.app_id and peers.auth_user_id = peer.auth_user_id
   and peers.base44_user_id = peer.base44_user_id
  where i.auth_user_id is not null
    and m.agency_id::text = p_agency
    and m.status = 'active' and m.revoked_at is null
    and a.status in ('active','trial')
    -- The same criterion caller_roster_ids() uses, so the two cannot disagree.
    -- If this listed revoked colleagues while that policy hid their profile
    -- row, they would appear on the roster with every profile field empty — a
    -- phantom that looks like a colleague who never filled anything in. The
    -- is_active column above is the identity's own flag, which is a different
    -- fact: whether that person's login is disabled while their membership
    -- stands.
    and peer.status = 'active' and peer.revoked_at is null
$$;`,
  // D24. Who may open a chart, in two parts, because the answer is not one
  // set: an administrator sees every chart in their agency and that set lives
  // in the RECORD store (which this cannot read), while a clinician sees an
  // enumerable set of assignments that lives in the authority store.
  //
  // So a boolean for the first and a set for the second, and a policy asks
  // both. `pennsync_private.visible_patient` already answers the same question
  // the same way for the synthetic staging surface; this is that decision
  // written where the record store's policies can reach it.
  `create function ${quote(SCHEMA)}.caller_opens_every_chart(p_agency text) returns boolean
  language sql stable security definer set search_path = '' as $$
  select coalesce(${quote(SCHEMA)}.caller_tenant_role(p_agency) in ('agency_admin','manager'), false)
$$;`,
  // A clinician, a social worker and a spiritual care worker see the charts
  // they are assigned to. Office staff see none: the entity schema says that
  // role "sees only non-clinical functions", and D21 recorded the asymmetry
  // that decides the tie — too narrow is a support ticket, too broad is a
  // disclosure.
  //
  // Per agency rather than across all of them, because a caller holding two
  // agencies must not have an assignment in one widen a chart in the other.
  `create function ${quote(SCHEMA)}.caller_assigned_patients(p_agency text) returns setof text
  language sql stable security definer set search_path = '' as $$
  select a.patient_id::text
  from ${quote(SCHEMA)}.caller_identity() i
  join pennsync_private.membership m
    on m.app_id = i.app_id and m.auth_user_id = i.auth_user_id
   and m.base44_user_id = i.base44_user_id
  join pennsync_private.agency ag on ag.app_id = m.app_id and ag.id = m.agency_id
  join pennsync_private.chart_assignment a
    on a.app_id = m.app_id and a.agency_id = m.agency_id and a.membership_id = m.id
  where i.auth_user_id is not null
    and m.agency_id::text = p_agency
    and m.status = 'active' and m.revoked_at is null
    and ag.status in ('active','trial')
    and m.tenant_role in ('clinician','social_worker','spiritual_care')
    and a.status = 'active'
$$;`,
  `create function ${quote(SCHEMA)}.deployment_app() returns text
  language sql stable security definer set search_path = '' as $$
  select pennsync_private.deployment_app_id()
$$;`,
  `revoke all on function ${quote(SCHEMA)}.caller_identity(), ${quote(SCHEMA)}.caller_identified(),
  ${quote(SCHEMA)}.caller_agencies(), ${quote(SCHEMA)}.caller_tenant_role(text),
  ${quote(SCHEMA)}.caller_user_id(), ${quote(SCHEMA)}.caller_roster_ids(), ${quote(SCHEMA)}.caller_roster(text),
  ${quote(SCHEMA)}.caller_opens_every_chart(text), ${quote(SCHEMA)}.caller_assigned_patients(text),
  ${quote(SCHEMA)}.caller_email(), ${quote(SCHEMA)}.deployment_app() from public, anon, authenticated, service_role;`,
];

/** Where the resolved tenant paths are recorded; read as data to avoid an import cycle. */
export const TENANT_PATH_FILE = 'tools-tenant-path-expectations.json';

/**
 * The predicate proving a row of `entity` belongs to an agency the caller is
 * in, as SQL against `alias`.
 *
 * A `reference` entity does not carry a key: it reaches one through another
 * entity, so its predicate is an EXISTS over that entity carrying the same
 * question one hop further in. The resolver caps a path at three hops and
 * resolves only through `root`, `direct` and `reference`, so this terminates;
 * `depth` is threaded through anyway so a cycle introduced later fails loudly
 * instead of recursing forever.
 */
/**
 * D24. The chart narrowing for one entity, as SQL against `alias`, or null when
 * the entity is not a chart and does not name one.
 *
 * Shared by `renderPolicies` and `tenantPredicate`, and that sharing is the
 * whole of the guarantee. Belonging to the caller's agency is not the same as
 * being a chart the caller may open, and until this the store said it was.
 *
 * It has to travel with the RECURSION, which a first version did not do and
 * which is easy to miss: a reference predicate inlines the target's TENANT
 * check, so `document_read` reached `patient` and asked only whether the
 * patient was in the caller's agency. Fifty-four tables looked narrowed and
 * were not — every document, alert, medication and note of a patient the
 * caller was never assigned to.
 *
 * A null subject stays agency-scoped, deliberately: a referral taken before a
 * patient exists is intake data and not yet anybody's chart, and hiding it
 * from every clinician would break intake to protect a chart that is not
 * there. `Patient` has no such case, its subject being the primary key, so the
 * null branch is left off where it could only ever be false.
 */
export function chartPredicate(plan, alias) {
  const subject = plan?.chart_subject ?? null;
  if (subject === null) return null;
  const absent = subject === 'id' ? '' : `${alias}.${quote(subject)} is null or `;
  return `(${absent}${quote(SCHEMA)}.caller_opens_every_chart(${alias}.${quote(TENANT_COLUMN)})`
    + ` or ${alias}.${quote(subject)} in`
    + ` (select ${quote(SCHEMA)}.caller_assigned_patients(${alias}.${quote(TENANT_COLUMN)})))`;
}

export function tenantPredicate(entity, alias, index, { paths, tables, plans }, depth = 0) {
  if (depth > 4) throw new Error(`TENANT_PATH_TOO_DEEP:${entity}`);
  const path = paths.get(entity);
  const agencies = `${quote(SCHEMA)}.caller_agencies()`;
  if (!path) throw new Error(`TENANT_PATH_MISSING:${entity}`);
  // `Agency` is not in a tenant, it is one.
  if (path.kind === 'root') return `${alias}.${quote('id')} in (select ${agencies})`;
  if (path.kind === 'direct') return `${alias}.${quote(TENANT_COLUMN)} in (select ${agencies})`;
  if (path.kind === 'reference') {
    const next = `t${index + 1}`;
    const target = tables.get(path.target);
    if (!target) throw new Error(`TENANT_PATH_TARGET_UNKNOWN:${entity}:${path.target}`);
    const inner = tenantPredicate(path.target, next, index + 1, { paths, tables, plans }, depth + 1);
    // The referenced row's own chart narrowing, carried in with its tenancy.
    // Without this a borrowed predicate borrows only half the answer.
    const chart = chartPredicate(plans?.get(path.target), next);
    // Joined on the whole primary key: an id is only unique within its source
    // app, so matching on id alone would reach across the two source apps.
    return `exists (select 1 from ${quote(SCHEMA)}.${quote(target)} ${next}`
      + ` where ${next}.${quote('source_app_id')} = ${alias}.${quote('source_app_id')}`
      + ` and ${next}.${quote('id')} = ${alias}.${quote(snakeCase(path.via))}`
      + ` and ${inner}${chart === null ? '' : ` and ${chart}`})`;
  }
  if (path.kind === 'binding') {
    // The mirror image of a reference: the row holds no key, so the predicate
    // looks for a row in the BINDING table that names this one. `Document` is
    // the case (D27) — the binding is what says which agency a document is in,
    // and following `document.patient_id` instead makes a document bound to an
    // agency and no patient belong to nobody.
    //
    // Two properties follow from the direction and are worth stating. The
    // binding's own chart narrowing is carried in, exactly as a reference
    // carries its target's, so a clinician reaches a document through the
    // binding's patient rather than the document's copy of it. And a row with
    // no binding at all is visible to nobody, which is the same answer the
    // originals give: every document they serve is joined to one.
    const next = `t${index + 1}`;
    const source = tables.get(path.target);
    if (!source) throw new Error(`TENANT_PATH_TARGET_UNKNOWN:${entity}:${path.target}`);
    const inner = tenantPredicate(path.target, next, index + 1, { paths, tables, plans }, depth + 1);
    const chart = chartPredicate(plans?.get(path.target), next);
    return `exists (select 1 from ${quote(SCHEMA)}.${quote(source)} ${next}`
      + ` where ${next}.${quote('source_app_id')} = ${alias}.${quote('source_app_id')}`
      + ` and ${next}.${quote(snakeCase(path.via))} = ${alias}.${quote('id')}`
      + ` and ${inner}${chart === null ? '' : ` and ${chart}`})`;
  }
  // A self-editable profile claim is excluded from authorization by
  // construction — it is the defect that paused `analyzeClinicalData`. Falling
  // through to the agency predicate here would authorize `User` reads through
  // the very column the account can rewrite about itself, so this refuses to
  // generate anything rather than generating something wrong.
  if (path.kind === 'profile_claim') throw new Error(`TENANT_PATH_IS_PROFILE_CLAIM:${entity}`);
  if (path.kind !== 'actor' && path.kind !== 'unresolved') throw new Error(`TENANT_PATH_UNHANDLED:${entity}:${path.kind}`);
  // Anything still blocking here was decided, and a decision stamps the key on.
  return `${alias}.${quote(TENANT_COLUMN)} in (select ${agencies})`;
}

/** The subject column a `self` table matches against, by the column's name. */
const SELF_BINDING = Object.freeze({ user_id: 'caller_user_id', user_email: 'caller_email' });

/**
 * Policies are `to public` rather than `to authenticated` on purpose. These
 * tables carry no grant, so no role reaches them directly; access runs through
 * SECURITY DEFINER brokers, and `force row level security` subjects the table
 * owner — and therefore the broker — to these policies too. Naming a role here
 * would exempt the broker from the predicate it exists to enforce.
 */
export function renderPolicies(plan, resolution) {
  const qualified = `${quote(SCHEMA)}.${quote(plan.table)}`;
  const name = suffix => quote(`${plan.table}_${suffix}`.slice(0, MAX_IDENTIFIER));
  const self = quote(plan.table);
  // The deployment serves one app; a row belonging to the other is not this
  // deployment's to show or touch, however its agency key reads.
  const thisApp = `${self}.${quote('source_app_id')} = ${quote(SCHEMA)}.deployment_app()`;
  const kind = plan.tenant_decision;

  // `User` carries only a claim it can edit about itself, so no predicate
  // written against its own row can be trusted. Forced RLS with NO policy was
  // the honest answer while nothing had decided how it may be read.
  //
  // D23 decides it, and the shape of the answer is why `roster` is a kind of
  // its own rather than a variant of `agency`: the predicate does not read the
  // row's tenant column at all. It asks the authority store who the caller
  // shares an agency with, and admits the row if it names one of those people.
  // The untrusted column is not narrowed — it is not consulted.
  if (kind === 'roster') {
    // Read only, and by the same absence that makes the audit trail
    // append-only: with no insert, update or delete policy, forced RLS refuses
    // every write to this table from everyone, the record owner included. D23
    // leaves the profile-write path open deliberately, and this is what keeps
    // "open" from quietly meaning "allowed".
    return [`create policy ${name('read')} on ${qualified} for select `
      + `using (${thisApp} and ${self}.${quote('id')} in (select ${quote(SCHEMA)}.caller_roster_ids()));`];
  }
  if (resolution.paths.get(plan.entity)?.kind === 'profile_claim') {
    return [`-- ${plan.table}: excluded from authorization (self-editable profile claim); forced RLS, no policy.`];
  }
  const tenant = `${thisApp} and ${tenantPredicate(plan.entity, self, 0, resolution)}`;
  // D24, ANDed onto both the read and the write. Writing into a chart you
  // cannot open is the same disclosure in the other direction — a note
  // appended to a stranger's record — so nothing here distinguishes them.
  // `chartPredicate` has the rest of the reasoning.
  const chart = chartPredicate(plan, self);
  const scoped = predicate => (chart === null ? predicate : `${predicate} and ${chart}`);
  /**
   * The one place the chart narrowing does not belong: inserting the chart
   * ROOT.
   *
   * Everywhere else an insert names a chart that already exists, and writing
   * into a chart you cannot open is the same disclosure in the other
   * direction, so the narrowing is exactly right — a clinician may not file a
   * document or a note against a stranger's record. `Patient` is different:
   * its subject IS its identity, so the row being inserted is the chart, and
   * `caller_assigned_patients` can never contain an id that does not exist
   * yet. Applied there, the predicate does not narrow anything; it makes
   * creating a patient impossible for every role that does not already open
   * every chart in the agency.
   *
   * Measured rather than reasoned about: an `agency_admin` could insert and a
   * `clinician` could not, while the Base44 original admits `agency_admin`,
   * `manager` AND `clinician` to `PATIENT_CREATE_ROLES`. Tenancy still applies
   * — the new row must name an agency the caller holds — and the read, update
   * and delete policies keep the narrowing, so a clinician who creates a
   * patient still cannot open it until an assignment says so. That gap is
   * real and is not this predicate's to close; see D28.
   */
  const rootInsert = plan.chart_subject === CHART_ROOT_SUBJECT;

  if (kind === 'global') {
    // Platform reference: every caller reads it and no tenant surface writes
    // it. Forced RLS with no write policy is what refuses the writes. Still
    // scoped to the deployment's own app, because global means every agency
    // here, not every app.
    // `using (true)` let any role that reached the table read every row with no
    // session at all. Global means every *identified* caller in this
    // deployment, so the identity check is in the predicate rather than left
    // for each future broker to remember.
    return [`create policy ${name('read')} on ${qualified} for select `
      + `using (${thisApp} and ${quote(SCHEMA)}.caller_identified());`];
  }
  let read = tenant;
  if (kind === 'self') {
    const binding = SELF_BINDING[plan.self_subject];
    if (!binding) throw new Error(`SELF_SUBJECT_UNSUPPORTED:${plan.entity}:${plan.self_subject}`);
    read = `${thisApp} and ${self}.${quote(plan.self_subject)} = ${quote(SCHEMA)}.${binding}()`;
  } else if (kind === 'shared') {
    read = `(${tenant}) or (${thisApp} and ${self}.${quote(plan.platform_flag)} is true)`;
  }
  // A shared table's write must also refuse to SET the platform flag. Without
  // that an agency writes its own row — which the tenant predicate allows —
  // marks it platform, and the read policy above then shows it to every other
  // agency. Restricting the row's agency is not enough; the flag is the thing
  // that publishes it.
  const write = kind === 'self' ? read
    : kind === 'shared' ? `${tenant} and ${self}.${quote(plan.platform_flag)} is not true`
      : tenant;
  read = scoped(read);
  const guarded = scoped(write);
  return [
    `create policy ${name('read')} on ${qualified} for select using (${read});`,
    `create policy ${name('insert')} on ${qualified} for insert with check (${rootInsert ? write : guarded});`,
    `create policy ${name('update')} on ${qualified} for update using (${guarded}) with check (${guarded});`,
    `create policy ${name('delete')} on ${qualified} for delete using (${guarded});`,
  ];
}

export function renderDdl(repository) {
  const prepared = planAll(repository);
  const plan = buildPlan(repository, prepared);
  const recorded = JSON.parse(readFileSync(join(repository, TENANT_PATH_FILE), 'utf8')).entities;
  const resolution = {
    paths: new Map(recorded.map(entry => [entry.entity, entry])),
    tables: new Map(prepared.plans.map(entity => [entity.entity, entity.table])),
    // Needed by the chart narrowing, which asks a REFERENCED entity for its
    // subject column rather than only its table name.
    plans: new Map(prepared.plans.map(entity => [entity.entity, entity])),
  };
  // Every table before any policy: a reference path names the table it reaches
  // through, and that table is not always created first in name order.
  const statements = [
    `create schema ${quote(SCHEMA)};`,
    ...POLICY_HELPERS,
    ...prepared.plans.map(renderEntity),
    ...prepared.plans.flatMap(plan => renderPolicies(plan, resolution)),
  ];
  return { plan, sql: statements.join('\n\n') + '\n' };
}

/**
 * The role that owns the record tables, and why the store needs one of its own.
 *
 * `force row level security` binds a table's owner to its own policies — but
 * not a `SUPERUSER` or `BYPASSRLS` role, which bypasses RLS however it is
 * declared. The authority store's migrations require exactly such an
 * administrator (`PENNSYNC_BYPASSRLS_MIGRATION_OWNER_REQUIRED`), so leaving
 * these tables owned by the migration role would leave all 596 policies
 * decorative: anything running as that role reads every agency's rows.
 *
 * So the migration creates a role with neither attribute, and the tables are
 * created while acting as it. Measured rather than assumed: with `force` and a
 * non-bypass owner, the owner's own `select` returns the policy-filtered rows.
 *
 * The caller helpers are deliberately NOT owned by this role. They read
 * `pennsync_private`, whose tables carry forced RLS with no allowing policy,
 * so only the migration administrator can reach them. They stay
 * administrator-owned and are granted to the record owner alone.
 */
export const OWNER_ROLE = 'pennsync_records_owner';
/**
 * Where the generated migration is committed.
 *
 * Deliberately NOT beside the authority store's own migrations. That directory
 * is applied wholesale by every authority harness — the disposable Supabase
 * stack three acceptance jobs bring up, and the restore rehearsal, whose
 * hand-reviewed fixture enumerates every table it expects to find. Putting 156
 * generated tables there makes each of those build and inventory a store none
 * of them exercises, and turns a reviewable fixture into 2,404 columns nobody
 * can read. They are also two stores rather than one: different schemas,
 * different owners, created at different times.
 *
 * So the record store gets its own directory, applied by the provisioner after
 * the authority store and by `record-store-migration.test.mjs`, both of which
 * name it rather than discovering it.
 */
export const RECORD_MIGRATION_FILE =
  'services/authority-store/supabase/record-migrations/20260919170000_record_store.sql';

/**
 * The record store as a migration a real deployment can apply.
 *
 * `renderDdl` produces the schema; this wraps it in the ownership boundary
 * that makes its policies enforceable, and grants nothing to any caller role.
 *
 * That last part is the substantive choice. RLS policy expressions are
 * evaluated with the privileges of the role running the query, so a caller
 * granted direct table access would also need `execute` on the caller helpers
 * — the very functions the generated DDL revokes from `authenticated`, since
 * they answer "who is asking" and must not be callable by the asker. Granting
 * both back would hand every caller the table and the gate.
 *
 * Instead no caller role is granted anything here. The intended surface is a
 * broker owned by the record owner: inside a `SECURITY DEFINER` function,
 * `current_user` becomes the owner (so the policies bind and the helpers are
 * callable) while the `role` setting still reads `authenticated` (so
 * `pennsync_private.actor()` still recognises the caller). Both halves were
 * measured before this was written.
 */
export function renderMigration(repository) {
  const { plan, sql } = renderDdl(repository);
  const created = `create schema ${quote(SCHEMA)};`;
  if (!sql.startsWith(created)) throw new Error('RECORD_SCHEMA_STATEMENT_NOT_FIRST');
  // Split the generated body: helpers stay administrator-owned, the rest is
  // created while acting as the non-bypass owner.
  const body = sql.slice(created.length);
  const marker = POLICY_HELPERS[POLICY_HELPERS.length - 1];
  const cut = body.indexOf(marker);
  if (cut < 0) throw new Error('RECORD_HELPER_REVOKE_NOT_FOUND');
  const helpers = body.slice(0, cut + marker.length).trim();
  const tables = body.slice(cut + marker.length).trim();
  // Everything the owner must be able to CALL. A policy expression runs with
  // the privileges of the role running the query, and inside a broker that
  // role is this owner — so a helper a policy asks and this list omits denies
  // the read outright. `user_read` asks `caller_roster_ids()`, which is how
  // that came up.
  const helperList = `${quote(SCHEMA)}.caller_identity(), ${quote(SCHEMA)}.caller_identified(), `
    + `${quote(SCHEMA)}.caller_agencies(), ${quote(SCHEMA)}.caller_tenant_role(text), `
    + `${quote(SCHEMA)}.caller_user_id(), ${quote(SCHEMA)}.caller_roster_ids(), `
    + `${quote(SCHEMA)}.caller_roster(text), `
    + `${quote(SCHEMA)}.caller_opens_every_chart(text), ${quote(SCHEMA)}.caller_assigned_patients(text), `
    + `${quote(SCHEMA)}.caller_email(), ${quote(SCHEMA)}.deployment_app()`;
  const statements = [
    `-- The record store: ${plan.totals.carried} carried entities, ${plan.totals.columns} columns,
-- under an owner that row level security actually binds.
--
-- GENERATED by \`node tools-entity-schema-plan.mjs --write-migration\`. Do not edit
-- by hand: a test regenerates this file and fails if it differs. Change the
-- entity definitions, the tenant decisions or the generator instead.
begin;`,
    `-- Same administrator contract as the rest of the store: creating a table with
-- forced RLS and no allowing policy requires a role RLS does not apply to.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles
    where rolname = current_user and (rolsuper or rolbypassrls)) then
    raise exception using errcode='42501',message='PENNSYNC_BYPASSRLS_MIGRATION_OWNER_REQUIRED';
  end if;
end $$;`,
    `-- The record store is meaningless without the authority store it asks about,
-- and the deployment pin decides which app's rows may live here at all.
do $$
begin
  if to_regprocedure('pennsync_private.deployment_app_id()') is null then
    raise exception using errcode='42501',message='PENNSYNC_AUTHORITY_STORE_REQUIRED';
  end if;
end $$;`,
    `-- The owner: created if absent, and verified either way. A pre-existing role
-- carrying BYPASSRLS would silently void every policy below, so that case is
-- refused rather than adopted.
do $$
declare v_admin text := current_user;
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = '${OWNER_ROLE}') then
    begin
      create role ${quote(OWNER_ROLE)} nologin nosuperuser nobypassrls nocreatedb nocreaterole;
    exception when insufficient_privilege then
      -- BYPASSRLS does not carry CREATEROLE, so an administrator who can apply
      -- every other migration here can still fail at this one line. Say which
      -- role is missing rather than leaving a bare permission error.
      raise exception using errcode='42501',message='PENNSYNC_RECORD_OWNER_NOT_CREATABLE';
    end;
  end if;
  if exists (select 1 from pg_catalog.pg_roles
    where rolname = '${OWNER_ROLE}' and (rolsuper or rolbypassrls)) then
    raise exception using errcode='42501',message='PENNSYNC_RECORD_OWNER_MUST_NOT_BYPASS_RLS';
  end if;
  if exists (select 1 from pg_catalog.pg_roles where rolname = '${OWNER_ROLE}' and rolcanlogin) then
    raise exception using errcode='42501',message='PENNSYNC_RECORD_OWNER_MUST_NOT_LOGIN';
  end if;
  -- Creating the role is not the same as being able to act as it. Since
  -- PostgreSQL 16 a CREATEROLE administrator that creates a role receives
  -- ADMIN OPTION but neither INHERIT nor SET, so \`create schema …
  -- authorization\` refuses with "must be able to SET ROLE". Ask for SET
  -- explicitly; on a server too old for that spelling the plain grant carries
  -- it, and a superuser needs neither.
  begin
    execute format('grant %I to current_user with set true', '${OWNER_ROLE}');
  exception
    when syntax_error then execute format('grant %I to current_user', '${OWNER_ROLE}');
    when others then null; -- already held, or not ours to grant; proven below
  end;
  -- Proven by doing it rather than by asking a catalog, because the privilege
  -- names differ across versions while this does not.
  begin
    execute format('set role %I', '${OWNER_ROLE}');
    -- Back to whoever was acting, which \`reset role\` would not do: that returns
    -- to the session user, and the rest of this migration must keep running as
    -- the administrator that started it.
    execute format('set role %I', v_admin);
  exception when others then
    raise exception using errcode='42501',message='PENNSYNC_RECORD_OWNER_NOT_ASSUMABLE';
  end;
end $$;`,
    `create schema ${quote(SCHEMA)} authorization ${quote(OWNER_ROLE)};`,
    `revoke all on schema ${quote(SCHEMA)} from public, anon, authenticated, service_role;`,
    `-- The helpers stay administrator-owned: they read \`pennsync_private\`, which
-- carries forced RLS with no allowing policy, so the record owner cannot.`,
    helpers,
    `-- The owner may ask who is calling. No caller role may.`,
    `grant execute on function ${helperList} to ${quote(OWNER_ROLE)};`,
    `-- Everything below is created while acting as the owner, so the owner is what
-- \`force row level security\` binds.
set local role ${quote(OWNER_ROLE)};`,
    tables,
    `reset role;`,
    `-- Deliberately no grant to anon, authenticated or service_role, on any table or
-- helper, and no USAGE on this schema either. A caller reaches these rows only
-- through a broker owned by ${OWNER_ROLE}, which the policies bind exactly as
-- they bind the owner. The migration that adds those brokers is what grants a
-- caller role USAGE on this schema and EXECUTE on the brokers themselves —
-- nothing else, and never a table.
commit;`,
  ];
  return { plan, sql: statements.join('\n\n') + '\n' };
}

export function comparePlan(plan, expectations) {
  const current = new Map(plan.entities.map(entity => [entity.entity, entity]));
  const recorded = new Map(expectations.entities.map(entity => [entity.entity, entity]));
  const added = [...current.keys()].filter(name => !recorded.has(name)).sort();
  const removed = [...recorded.keys()].filter(name => !current.has(name)).sort();
  // Every field the emitted policies are derived from. Comparing only the
  // table's shape let an authorization change pass as `unchanged`: swapping a
  // shared table's platform flag for another existing boolean, or changing a
  // self subject, rewrites the predicate while leaving columns and the tenant
  // key identical. The decision gate checks a new value is admissible; this is
  // what checks it matches the one that was accepted.
  //
  // `disposition` is here for a second reason: it decides whether the generic
  // broker family serves the entity at all, and it was NOT compared. D22 moved
  // 28 entities out of that family and the recorded plan went on saying
  // `broker` for 42 of them, unnoticed, because nothing asked. A checked-in
  // artefact that disagrees with the manifest is worse than no artefact.
  const COMPARED = ['table', 'columns', 'constrained', 'tenant_key',
    'tenant_decision', 'self_subject', 'platform_flag', 'disposition', 'chart_subject'];
  const changed = [...current.entries()]
    .filter(([name, entity]) => recorded.has(name)
      && COMPARED.some(field => recorded.get(name)[field] !== entity[field]))
    .map(([name]) => name).sort();
  return { added, removed, changed, matches_expectations: !added.length && !removed.length && !changed.length };
}

export function parseExpectations(raw) {
  let expectations;
  try { expectations = JSON.parse(raw); } catch { throw new Error('PLAN_INVALID_JSON'); }
  if (!expectations || typeof expectations !== 'object' || Array.isArray(expectations)) throw new Error('PLAN_INVALID_SHAPE');
  if (expectations.format !== FORMAT || expectations.schema_version !== FORMAT_VERSION) throw new Error('PLAN_UNSUPPORTED_FORMAT');
  if (!Array.isArray(expectations.entities)) throw new Error('PLAN_INVALID_ENTITIES');
  for (const entity of expectations.entities) {
    if (typeof entity?.entity !== 'string' || typeof entity?.table !== 'string'
      || !Number.isSafeInteger(entity?.columns)) throw new Error('PLAN_INVALID_ENTITIES');
  }
  return expectations;
}

export function main(args = process.argv.slice(2), { repository = resolve(dirname(fileURLToPath(import.meta.url))), log = console.log, write = writeFileSync } = {}) {
  if (args.some(argument => !['--json', '--summary', '--sql', '--update', '--migration', '--write-migration'].includes(argument))) {
    log(JSON.stringify({ error: 'INVALID_ARGUMENTS' }));
    return 2;
  }
  let plan; let sql;
  try { ({ plan, sql } = renderDdl(repository)); }
  catch (error) { log(JSON.stringify({ error: error?.message || 'ENTITY_SCHEMAS_UNAVAILABLE' })); return 2; }
  if (args.includes('--sql')) { log(sql); return 0; }
  if (args.includes('--migration') || args.includes('--write-migration')) {
    let migration;
    try { ({ sql: migration } = renderMigration(repository)); }
    catch (error) { log(JSON.stringify({ error: error?.message || 'MIGRATION_UNAVAILABLE' })); return 2; }
    if (args.includes('--migration')) { log(migration); return 0; }
    write(join(repository, RECORD_MIGRATION_FILE), migration);
    log(JSON.stringify({ updated: RECORD_MIGRATION_FILE, bytes: migration.length }, null, 2));
    return 0;
  }
  const expectationsPath = join(repository, EXPECTATIONS_FILE);
  if (args.includes('--update')) {
    write(expectationsPath, JSON.stringify(plan, null, 2) + '\n');
    log(JSON.stringify({ updated: EXPECTATIONS_FILE, totals: plan.totals }, null, 2));
    return 0;
  }
  let expectations;
  try { expectations = parseExpectations(readFileSync(expectationsPath, 'utf8')); }
  catch (error) { log(JSON.stringify({ error: error?.message || 'PLAN_UNAVAILABLE' })); return 2; }
  const report = comparePlan(plan, expectations);
  if (args.includes('--summary')) {
    log(`entity schema plan ${report.matches_expectations ? 'unchanged' : 'CHANGED'}: `
      + `${plan.totals.carried} tables, ${plan.totals.columns} columns, `
      + `${plan.totals.constrained_columns} constrained, ${plan.totals.tenant_scoped} tenant-scoped; `
      + `added=${report.added.length} removed=${report.removed.length} changed=${report.changed.length}`);
  } else {
    log(JSON.stringify({ ...report, totals: plan.totals }, null, 2));
  }
  return report.matches_expectations ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main();
}
