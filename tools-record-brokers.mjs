#!/usr/bin/env node
/**
 * The tenant-scoped broker family: how a caller reaches a record at all.
 *
 * The record store grants no caller role anything — not a table, not a helper,
 * not even USAGE on its schema. That is deliberate and it is also a dead end
 * until something bridges it, because an RLS policy expression is evaluated
 * with the privileges of the role running the query: granting a caller the
 * table would also mean granting it the helpers that decide who it is.
 *
 * The bridge is a SECURITY DEFINER function owned by `pennsync_records_owner`.
 * Inside one, `current_user` becomes the owner — so the helpers are callable
 * and the policies bind, the owner holding neither SUPERUSER nor BYPASSRLS —
 * while the `role` setting still reads `authenticated`, so
 * `pennsync_private.actor()` still recognises the caller.
 * `record-store-migration.test.mjs` measured both halves before this existed.
 *
 * What this file settles is the question that one left open: WHICH brokers, and
 * whether a broker stamps a caller's agency onto a write or requires it.
 *
 * **One family, not one per entity.** D2 caps the `broker` disposition at "no
 * PHI and no authority decision" precisely so that a single reviewed family may
 * serve those entities generically, and D16 checked all 31 of them against
 * their schemas rather than their names. So the family is five functions over
 * an allowlist, not 155 functions over a naming convention: one review surface,
 * and an entity is reachable only by being in the generated allowlist below.
 * `brokerPlan` refuses to generate while any brokered entity fails that
 * ceiling, so the safety argument is enforced here rather than remembered.
 *
 * **A broker stamps; it never reads tenancy from the payload.** `agency_id`,
 * `source_app_id`, `id`, the platform timestamps, `created_by` and a `self`
 * table's subject are all set by the broker from the caller's verified
 * identity. A payload naming one of them is REFUSED rather than silently
 * stripped, because a caller that believes it set a field it did not is how a
 * row ends up owned by the wrong agency in someone's mental model even when the
 * database is right.
 *
 * The agency is still a parameter, and it is still checked: a caller may hold
 * memberships in several agencies, so "stamp whatever they have" is not
 * well-defined. The broker takes the agency the request names, verifies it
 * against `caller_agencies()` — the membership roster, not the request — and
 * stamps that. RLS remains the backstop underneath, and the isolation tests
 * prove it denies on its own.
 *
 * **The broker never re-implements a policy.** It narrows a read to the one
 * agency the request named, and it refuses to write a read-only table; every
 * other question of who may see what is left to the policies. A broker that
 * restated them would be a second copy to keep in agreement with the first.
 *
 * Regenerate with `node tools-record-brokers.mjs --write`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OWNER_ROLE, SCHEMA, TENANT_PATH_FILE, buildPlan, quote } from './tools-entity-schema-plan.mjs';
import { brokerWritable, checkDecisions, schemaAuthority } from './tools-tenant-decision.mjs';
import { readEntity } from './tools-tenant-path.mjs';

export const BROKER_MIGRATION_FILE =
  'services/authority-store/supabase/record-migrations/20260919180000_record_brokers.sql';

/**
 * PostgREST serves the schemas a Supabase project is configured to expose, and
 * changing that set is an operator action rather than a migration. The
 * authority store already answered this by keeping SECURITY INVOKER wrappers in
 * `public` in front of its private functions; the record store follows it, so a
 * deployment needs no project setting for the brokers to be reachable and
 * nothing but these five names is exposed.
 */
export const WRAPPER_SCHEMA = 'public';
export const WRAPPER_PREFIX = 'pennsync_records_';
export const OPERATIONS = Object.freeze(['list', 'get', 'insert', 'update', 'delete']);
export const MODES = Object.freeze(['tenant', 'self', 'global', 'readonly']);
/**
 * A `global` table carries a read policy and no write policy at all — and so,
 * now, does any entity whose own schema does not plainly permit every write.
 * `readonly` is that second case: the rows are tenant-scoped and readable, but
 * the schema conditions who may create, update or delete them, and a generic
 * family cannot evaluate a condition it never saw.
 */
export const READ_ONLY_MODES = Object.freeze(['global', 'readonly']);
/**
 * Modes whose table carries `agency_id`, and which the family therefore
 * narrows to the one agency a request names.
 *
 * Spelled as a set rather than as `= 'tenant'`, which is what it was: adding
 * `readonly` renamed the mode of three tenant-scoped entities and silently
 * stopped the narrowing firing for them, so a caller holding two agencies saw
 * both agencies' rows. The two-membership case caught it the same run.
 */
export const TENANT_SCOPED_MODES = Object.freeze(['tenant', 'readonly']);
const tenantScoped = column => `${column} = any(array[${TENANT_SCOPED_MODES.map(literal).join(', ')}])`;
export const SELF_BINDING = Object.freeze({ user_id: 'caller_user_id', user_email: 'caller_email' });
/**
 * Columns the broker sets and a payload may not. `agency_id` and a `self`
 * table's subject are added per mode, because a `global` table has neither.
 */
export const STAMPED_COLUMNS = Object.freeze(['source_app_id', 'id', 'created_date', 'updated_date', 'created_by']);
/**
 * Every refusal the family can raise, named once.
 *
 * The SQL below interpolates these rather than spelling them, and the client
 * module this tool emits exports the same list, so the two cannot drift into
 * disagreeing about what a refusal is called — which is how a caller ends up
 * treating "you may not write that column" as "the service is down".
 */
export const BROKER_CODES = Object.freeze({
  agencyRequired: 'PENNSYNC_BROKER_AGENCY_REQUIRED',
  agencyNotHeld: 'PENNSYNC_BROKER_AGENCY_NOT_HELD',
  entityNotBrokered: 'PENNSYNC_BROKER_ENTITY_NOT_BROKERED',
  entityReadOnly: 'PENNSYNC_BROKER_ENTITY_READ_ONLY',
  idRequired: 'PENNSYNC_BROKER_ID_REQUIRED',
  recordRequired: 'PENNSYNC_BROKER_RECORD_REQUIRED',
  columnNotWritable: 'PENNSYNC_BROKER_COLUMN_NOT_WRITABLE',
  columnUnknown: 'PENNSYNC_BROKER_COLUMN_UNKNOWN',
});
/** Where the client's copy of the allowlist and the vocabulary is committed. */
export const BROKERED_ENTITIES_FILE = 'services/pennsync-api/brokered-entities.mjs';

export const TENANT_COLUMN = 'agency_id';
export const ID_COLUMN = 'id';
/**
 * `ALL_ROWS` in `src/lib/queryLimits.js` is the frontend's ceiling for a read
 * treated as a complete set, and 50 is what the Base44 server picked when a
 * caller passed nothing. Both are kept so a migrated caller sees neither a
 * surprise truncation nor an unbounded scan.
 */
export const DEFAULT_PAGE = 50;
export const MAX_PAGE = 5000;

const byEntity = (a, b) => (a.entity < b.entity ? -1 : a.entity > b.entity ? 1 : 0);
const literal = value => `'${String(value).replace(/'/g, "''")}'`;

/**
 * Every entity the family serves, with the tenancy shape that decides how.
 *
 * Each rejection below is a case where emitting a broker would have produced
 * something whose authorization nobody reviewed, so it throws rather than
 * skipping: an entity silently missing from this list is indistinguishable
 * from one deliberately withheld.
 */
export function brokerPlan(repository) {
  const ceiling = checkDecisions(repository);
  if (ceiling.problems.length) {
    // D16's ceiling is the whole safety argument for serving these generically.
    // A family generated while it is unsettled would be that argument's first
    // counterexample.
    throw new Error(`BROKER_CEILING_UNSETTLED:${ceiling.problems.length}`);
  }
  const plan = buildPlan(repository);
  const paths = new Map(JSON.parse(readFileSync(join(repository, TENANT_PATH_FILE), 'utf8'))
    .entities.map(entry => [entry.entity, entry]));
  const entries = [];
  for (const entity of plan.entities) {
    if (entity.disposition !== 'broker') continue;
    if (paths.get(entity.entity)?.kind === 'profile_claim') {
      // Forced RLS with no policy: the table is deliberately unreachable, and a
      // broker in front of it would return nothing while looking like a surface.
      throw new Error(`BROKER_ENTITY_HAS_NO_POLICY:${entity.entity}`);
    }
    if (entity.tenant_decision === 'shared') {
      // A shared table's write policy also has to refuse SETTING the platform
      // flag, which publishes a row to every other agency. This family does not
      // model that, and treating it as an ordinary tenant table would drop the
      // protection silently.
      throw new Error(`BROKER_SHARED_UNSUPPORTED:${entity.entity}`);
    }
    let mode = null;
    let subject = null;
    if (entity.tenant_decision === 'global') mode = 'global';
    else if (entity.tenant_decision === 'self') {
      mode = 'self';
      subject = entity.self_subject;
      if (!Object.hasOwn(SELF_BINDING, subject)) {
        throw new Error(`BROKER_SELF_SUBJECT_UNSUPPORTED:${entity.entity}:${subject}`);
      }
    } else if (entity.tenant_key === TENANT_COLUMN) mode = 'tenant';
    else throw new Error(`BROKER_TENANCY_UNRESOLVED:${entity.entity}`);
    // The schema's own authorization decides writability, not the tenancy
    // shape. An entity that conditions who may write is served read-only
    // rather than not at all, because the read itself was plainly permitted.
    const schema = readEntity(repository, entity.entity);
    if (mode === 'tenant' && !brokerWritable(schema)) mode = 'readonly';
    if (mode === 'self' && !brokerWritable(schema)) {
      // A `self` table served read-only would be indistinguishable from one
      // nobody may write, and nothing needs that today. Refuse rather than
      // quietly narrowing a shape the family does not model.
      throw new Error(`BROKER_SELF_NOT_WRITABLE:${entity.entity}`);
    }
    entries.push({ entity: entity.entity, table: entity.table, mode, subject,
      authority: schemaAuthority(schema) });
  }
  entries.sort(byEntity);
  const counts = Object.fromEntries(MODES.map(mode => [mode, entries.filter(e => e.mode === mode).length]));
  return { entries, counts, operations: OPERATIONS.length };
}

const q = name => quote(name);
const fn = name => `${q(SCHEMA)}.${q(name)}`;
const wrapper = operation => `${q(WRAPPER_SCHEMA)}.${q(`${WRAPPER_PREFIX}${operation}`)}`;

/** Signatures, written once: every revoke and grant below has to name them exactly. */
export const BROKER_SIGNATURES = Object.freeze({
  list: 'text,text,integer,text',
  get: 'text,text,text',
  insert: 'text,text,jsonb',
  update: 'text,text,text,jsonb',
  delete: 'text,text,text',
});
const INTERNAL_SIGNATURES = Object.freeze({
  brokered: 'text',
  broker_scope: 'text,text',
  broker_reserved: 'text,text',
  broker_check_payload: 'text,jsonb,text[]',
});

const signatureList = (names, signatures, render) =>
  names.map(name => `${render(name)}(${signatures[name]})`).join(', ');

export function renderAllowlist(entries) {
  const rows = entries.map(({ entity, table, mode, subject }, index) => {
    const cast = index === 0 ? '::text' : '';
    return `    (${literal(entity)}${cast}, ${literal(table)}${cast}, ${literal(mode)}${cast}, `
      + `${subject ? literal(subject) : 'null'}${index === 0 ? '::text' : ''})`;
  });
  return `-- The allowlist. An entity absent from it is not reachable through this
-- family at all, whatever its table looks like: ${entries.length} of the store's tables, every
-- one of them checked against D2's ceiling by \`check:tenant-decisions\` before
-- this file could be generated.
create function ${fn('brokered')}(p_entity text)
  returns table(tbl text, mode text, subject text)
  language sql immutable set search_path = '' as $broker$
  select t.tbl, t.mode, t.subject from (values
${rows.join(',\n')}
  ) as t(entity, tbl, mode, subject)
  where t.entity = p_entity
$broker$;`;
}

export function renderBrokerMigration(repository) {
  const plan = brokerPlan(repository);
  const brokerNames = OPERATIONS.map(operation => `entity_${operation}`);
  const brokerList = signatureList(OPERATIONS, BROKER_SIGNATURES, op => fn(`entity_${op}`));
  const wrapperList = signatureList(OPERATIONS, BROKER_SIGNATURES, wrapper);
  const internalList = signatureList(Object.keys(INTERNAL_SIGNATURES), INTERNAL_SIGNATURES, fn);

  const statements = [
    `-- The tenant-scoped broker family: ${OPERATIONS.length} operations over ${plan.entries.length} brokered entities.
--
-- GENERATED by \`node tools-record-brokers.mjs --write\`. Do not edit by hand: a
-- test regenerates this file and fails if it differs. Change the dispositions,
-- the tenant decisions or the generator instead.
--
-- The record store grants no caller role a table, a helper, or even USAGE on
-- its schema, because an RLS policy is evaluated with the privileges of the
-- role running the query: a caller holding the table would also need the
-- helpers that decide who it is. This migration is the only bridge across that,
-- and it grants a caller role USAGE on the schema and EXECUTE on these five
-- functions — nothing else, and never a table.
begin;`,
    `-- The store this brokers has to exist, and the owner has to be one row level
-- security still binds. A pre-existing owner carrying BYPASSRLS would make
-- every broker below a way around all 596 policies rather than through them.
do $$
begin
  if to_regnamespace('${SCHEMA}') is null then
    raise exception using errcode='42501',message='PENNSYNC_RECORD_STORE_REQUIRED';
  end if;
end $$;`,
    `do $$
declare v_admin text := current_user;
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = '${OWNER_ROLE}') then
    raise exception using errcode='42501',message='PENNSYNC_RECORD_OWNER_REQUIRED';
  end if;
  if exists (select 1 from pg_catalog.pg_roles
    where rolname = '${OWNER_ROLE}' and (rolsuper or rolbypassrls)) then
    raise exception using errcode='42501',message='PENNSYNC_RECORD_OWNER_MUST_NOT_BYPASS_RLS';
  end if;
  -- Same PostgreSQL 16 CREATEROLE problem the store's own migration hit: a role
  -- you created is not a role you may act as. Ask for SET explicitly, then prove
  -- it by doing it, because the privilege names differ across versions.
  begin
    execute format('grant %I to current_user with set true', '${OWNER_ROLE}');
  exception
    when syntax_error then execute format('grant %I to current_user', '${OWNER_ROLE}');
    when others then null; -- already held, or not ours to grant; proven below
  end;
  begin
    execute format('set role %I', '${OWNER_ROLE}');
    execute format('set role %I', v_admin);
  exception when others then
    raise exception using errcode='42501',message='PENNSYNC_RECORD_OWNER_NOT_ASSUMABLE';
  end;
end $$;`,
    `-- Everything below belongs to the owner, so SECURITY DEFINER puts a broker
-- inside the owner's privileges — which \`force row level security\` binds —
-- rather than outside them.
set local role ${q(OWNER_ROLE)};`,
    renderAllowlist(plan.entries),
    `-- The gate every operation runs first: a named agency the caller actually
-- holds, and an entity this family serves. Deliberately not granted to any
-- caller role, so it cannot be called on its own to probe either answer.
create function ${fn('broker_scope')}(p_agency text, p_entity text)
  returns table(tbl text, mode text, subject text)
  language plpgsql stable set search_path = '' as $broker$
declare v_found record;
begin
  if p_agency is null or p_agency = '' then
    raise exception using errcode='22023', message='${BROKER_CODES.agencyRequired}';
  end if;
  -- Against the membership roster, never against the request.
  if not exists (select 1 from ${fn('caller_agencies')}() as held(agency) where held.agency = p_agency) then
    raise exception using errcode='42501', message='${BROKER_CODES.agencyNotHeld}';
  end if;
  select b.tbl, b.mode, b.subject into v_found from ${fn('brokered')}(p_entity) b;
  if v_found.tbl is null then
    raise exception using errcode='42501', message='${BROKER_CODES.entityNotBrokered}';
  end if;
  return query select v_found.tbl, v_found.mode, v_found.subject;
end $broker$;`,
    `-- What the broker sets and a payload may not.
create function ${fn('broker_reserved')}(p_mode text, p_subject text)
  returns text[] language sql immutable set search_path = '' as $broker$
  select case
    when ${tenantScoped('p_mode')} then array[${STAMPED_COLUMNS.map(literal).join(', ')}, ${literal(TENANT_COLUMN)}]
    when p_mode = 'self' then array[${STAMPED_COLUMNS.map(literal).join(', ')}] || p_subject
    else array[${STAMPED_COLUMNS.map(literal).join(', ')}]
  end
$broker$;`,
    `-- A payload key that is stamped, or that is not a column at all, is REFUSED
-- rather than dropped. Dropping it leaves a caller believing it wrote a field
-- it did not, which is the same defect whether the field was tenancy or a typo.
create function ${fn('broker_check_payload')}(p_table text, p_payload jsonb, p_reserved text[])
  returns void language plpgsql stable set search_path = '' as $broker$
declare v_key text; v_columns text[];
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode='22023', message='${BROKER_CODES.recordRequired}';
  end if;
  select array_agg(a.attname::text) into v_columns
  from pg_catalog.pg_attribute a
  where a.attrelid = format('%I.%I', ${literal(SCHEMA)}, p_table)::regclass
    and a.attnum > 0 and not a.attisdropped;
  for v_key in select k from jsonb_object_keys(p_payload) k loop
    if v_key = any(p_reserved) then
      raise exception using errcode='42501', message='${BROKER_CODES.columnNotWritable}', detail = v_key;
    end if;
    if not (v_key = any(v_columns)) then
      raise exception using errcode='42703', message='${BROKER_CODES.columnUnknown}', detail = v_key;
    end if;
  end loop;
end $broker$;`,
    `-- Keyset pagination on the primary key, so a page is stable while rows are
-- being written and no offset is scanned to reach it.
create function ${fn('entity_list')}(p_agency text, p_entity text,
  p_limit integer default ${DEFAULT_PAGE}, p_after text default null)
  returns setof jsonb language plpgsql stable security definer set search_path = '' as $broker$
declare v_scope record; v_limit integer;
begin
  select * into v_scope from ${fn('broker_scope')}(p_agency, p_entity);
  v_limit := least(greatest(coalesce(p_limit, ${DEFAULT_PAGE}), 1), ${MAX_PAGE});
  -- The only narrowing this family does: one agency out of the several a caller
  -- may hold. Everything else about who sees what is left to the policies.
  if ${tenantScoped('v_scope.mode')} then
    return query execute format(
      'select to_jsonb(t) from %I.%I t where t.%I = $2 and ($1 is null or t.%I > $1) order by t.%I limit %L::integer',
      ${literal(SCHEMA)}, v_scope.tbl, ${literal(TENANT_COLUMN)}, ${literal(ID_COLUMN)}, ${literal(ID_COLUMN)}, v_limit)
      using p_after, p_agency;
  else
    return query execute format(
      'select to_jsonb(t) from %I.%I t where ($1 is null or t.%I > $1) order by t.%I limit %L::integer',
      ${literal(SCHEMA)}, v_scope.tbl, ${literal(ID_COLUMN)}, ${literal(ID_COLUMN)}, v_limit)
      using p_after;
  end if;
end $broker$;`,
    `-- Absent and invisible answer the same way on purpose: telling them apart
-- reports whether an id exists in another agency.
create function ${fn('entity_get')}(p_agency text, p_entity text, p_id text)
  returns jsonb language plpgsql stable security definer set search_path = '' as $broker$
declare v_scope record; v_row jsonb;
begin
  select * into v_scope from ${fn('broker_scope')}(p_agency, p_entity);
  if p_id is null or p_id = '' then
    raise exception using errcode='22023', message='${BROKER_CODES.idRequired}';
  end if;
  if ${tenantScoped('v_scope.mode')} then
    execute format('select to_jsonb(t) from %I.%I t where t.%I = $1 and t.%I = $2',
      ${literal(SCHEMA)}, v_scope.tbl, ${literal(ID_COLUMN)}, ${literal(TENANT_COLUMN)}) into v_row using p_id, p_agency;
  else
    execute format('select to_jsonb(t) from %I.%I t where t.%I = $1',
      ${literal(SCHEMA)}, v_scope.tbl, ${literal(ID_COLUMN)}) into v_row using p_id;
  end if;
  return v_row;
end $broker$;`,
    `-- The id is generated here rather than accepted. A caller choosing one could
-- collide with a row it is allowed to see inside its own agency, and an id is
-- not a field anyone needs to choose.
create function ${fn('entity_insert')}(p_agency text, p_entity text, p_record jsonb)
  returns jsonb language plpgsql volatile security definer set search_path = '' as $broker$
declare v_scope record; v_row jsonb; v_stamped jsonb; v_now timestamptz := now();
begin
  select * into v_scope from ${fn('broker_scope')}(p_agency, p_entity);
  if v_scope.mode = any(array[${READ_ONLY_MODES.map(literal).join(', ')}]) then
    raise exception using errcode='42501', message='${BROKER_CODES.entityReadOnly}';
  end if;
  perform ${fn('broker_check_payload')}(v_scope.tbl, p_record,
    ${fn('broker_reserved')}(v_scope.mode, v_scope.subject));
  v_stamped := jsonb_build_object(
    'source_app_id', ${fn('deployment_app')}(),
    'id', replace(gen_random_uuid()::text, '-', ''),
    'created_date', to_jsonb(v_now),
    'updated_date', to_jsonb(v_now),
    'created_by', to_jsonb(${fn('caller_email')}()));
  if ${tenantScoped('v_scope.mode')} then
    v_stamped := v_stamped || jsonb_build_object(${literal(TENANT_COLUMN)}, p_agency);
  elsif v_scope.mode = 'self' then
    v_stamped := v_stamped || jsonb_build_object(v_scope.subject, case v_scope.subject
${Object.entries(SELF_BINDING).map(([subject, binding]) =>
      `      when ${literal(subject)} then ${fn(binding)}()`).join('\n')}
    end);
  end if;
  execute format('insert into %I.%I as t select r.* from jsonb_populate_record(null::%I.%I, $1) r returning to_jsonb(t)',
    ${literal(SCHEMA)}, v_scope.tbl, ${literal(SCHEMA)}, v_scope.tbl) into v_row using (p_record || v_stamped);
  return v_row;
end $broker$;`,
    `-- A patch, not a replacement: absent keys keep their stored value, and a key
-- holding JSON null clears its column, which is what an explicit null means.
create function ${fn('entity_update')}(p_agency text, p_entity text, p_id text, p_patch jsonb)
  returns jsonb language plpgsql volatile security definer set search_path = '' as $broker$
declare v_scope record; v_row jsonb; v_key text; v_sets text[] := array[]::text[]; v_sql text;
begin
  select * into v_scope from ${fn('broker_scope')}(p_agency, p_entity);
  if v_scope.mode = any(array[${READ_ONLY_MODES.map(literal).join(', ')}]) then
    raise exception using errcode='42501', message='${BROKER_CODES.entityReadOnly}';
  end if;
  if p_id is null or p_id = '' then
    raise exception using errcode='22023', message='${BROKER_CODES.idRequired}';
  end if;
  perform ${fn('broker_check_payload')}(v_scope.tbl, p_patch,
    ${fn('broker_reserved')}(v_scope.mode, v_scope.subject));
  for v_key in select k from jsonb_object_keys(p_patch) k loop
    v_sets := v_sets || format('%I = (jsonb_populate_record(null::%I.%I, $1)).%I',
      v_key, ${literal(SCHEMA)}, v_scope.tbl, v_key);
  end loop;
  v_sets := v_sets || format('%I = now()', 'updated_date');
  v_sql := format('update %I.%I as t set %s where t.%I = $2',
    ${literal(SCHEMA)}, v_scope.tbl, array_to_string(v_sets, ', '), ${literal(ID_COLUMN)});
  if ${tenantScoped('v_scope.mode')} then
    v_sql := v_sql || format(' and t.%I = $3', ${literal(TENANT_COLUMN)});
    execute v_sql || ' returning to_jsonb(t)' into v_row using p_patch, p_id, p_agency;
  else
    execute v_sql || ' returning to_jsonb(t)' into v_row using p_patch, p_id;
  end if;
  return v_row;
end $broker$;`,
    `-- False for a row that was not there and for one that was not this caller's
-- to remove, for the same reason \`entity_get\` answers null to both.
create function ${fn('entity_delete')}(p_agency text, p_entity text, p_id text)
  returns boolean language plpgsql volatile security definer set search_path = '' as $broker$
declare v_scope record; v_removed boolean;
begin
  select * into v_scope from ${fn('broker_scope')}(p_agency, p_entity);
  if v_scope.mode = any(array[${READ_ONLY_MODES.map(literal).join(', ')}]) then
    raise exception using errcode='42501', message='${BROKER_CODES.entityReadOnly}';
  end if;
  if p_id is null or p_id = '' then
    raise exception using errcode='22023', message='${BROKER_CODES.idRequired}';
  end if;
  if ${tenantScoped('v_scope.mode')} then
    execute format('with gone as (delete from %I.%I as t where t.%I = $1 and t.%I = $2 returning 1) select count(*) > 0 from gone',
      ${literal(SCHEMA)}, v_scope.tbl, ${literal(ID_COLUMN)}, ${literal(TENANT_COLUMN)}) into v_removed using p_id, p_agency;
  else
    execute format('with gone as (delete from %I.%I as t where t.%I = $1 returning 1) select count(*) > 0 from gone',
      ${literal(SCHEMA)}, v_scope.tbl, ${literal(ID_COLUMN)}) into v_removed using p_id;
  end if;
  return v_removed;
end $broker$;`,
    `reset role;`,
    `-- EXECUTE on a function is granted to PUBLIC by default, so every one of
-- these has to be revoked before anything is granted back. The four internals
-- are never granted: only the five operations are reachable.
revoke all on function ${internalList}, ${brokerList} from public, anon, authenticated, service_role;`,
    `grant usage on schema ${q(SCHEMA)} to authenticated;

grant execute on function ${brokerList} to authenticated;`,
    `-- SECURITY INVOKER wrappers in an exposed schema, so PostgREST can reach the
-- family without the project exposing \`${SCHEMA}\` itself. They run as the
-- caller and add nothing: the authority store's own RPC surface has the same
-- shape, for the same reason.
${OPERATIONS.map(operation => {
  const parameters = {
    list: `p_agency text, p_entity text, p_limit integer default ${DEFAULT_PAGE}, p_after text default null`,
    get: 'p_agency text, p_entity text, p_id text',
    insert: 'p_agency text, p_entity text, p_record jsonb',
    update: 'p_agency text, p_entity text, p_id text, p_patch jsonb',
    delete: 'p_agency text, p_entity text, p_id text',
  }[operation];
  const call = {
    list: 'p_agency, p_entity, p_limit, p_after',
    get: 'p_agency, p_entity, p_id',
    insert: 'p_agency, p_entity, p_record',
    update: 'p_agency, p_entity, p_id, p_patch',
    delete: 'p_agency, p_entity, p_id',
  }[operation];
  // `list` aggregates rather than returning a set: PostgREST's shape for a
  // set-returning SCALAR function has differed across versions, and an API that
  // has to guess whether it received `[{...}]` or `[{"fn":{...}}]` is one
  // upgrade away from returning the wrong thing. One jsonb array is one shape.
  // The ordering is restated on the aggregate because `entity_list`'s ORDER BY
  // does not bind an aggregate reading from it.
  const returns = operation === 'delete' ? 'boolean' : 'jsonb';
  const body = operation === 'list'
    ? `  select coalesce(jsonb_agg(page.row order by page.row->>${literal(ID_COLUMN)}), '[]'::jsonb)\n`
      + `  from (select * from ${fn('entity_list')}(${call}) as row) page`
    : `  select ${fn(`entity_${operation}`)}(${call})`;
  return `create function ${wrapper(operation)}(${parameters}) returns ${returns}
  language sql security invoker set search_path = '' as $broker$
${body}
$broker$;`;
}).join('\n\n')}`,
    `revoke all on function ${wrapperList} from public, anon, authenticated, service_role;

grant execute on function ${wrapperList} to authenticated;`,
    `-- Still no grant to anon or service_role anywhere above, and still no grant on
-- any table to anyone. A service credential cannot read past the caller it is
-- acting for, because there is nothing for it to read past the caller with.
commit;`,
  ];
  return { plan, sql: statements.join('\n\n') + '\n' };
}

/**
 * The client's copy: the same allowlist and the same refusal vocabulary, so a
 * handler asking for an entity this family does not serve is refused before a
 * request leaves the service rather than by the database afterwards.
 */
export function renderEntityModule({ entries }) {
  const rows = entries.map(({ entity, mode }) => `  ${entity}: ${JSON.stringify(mode)},`).join('\n');
  const codes = Object.entries(BROKER_CODES)
    .map(([name, code]) => `  ${name}: ${JSON.stringify(code)},`).join('\n');
  return `// GENERATED by \`node tools-record-brokers.mjs --write\`. Do not edit by hand.
//
// The entities the tenant-scoped broker family serves, and what shape of
// tenancy each one has. Generated from the same plan as the family's SQL, so
// the two cannot disagree about which entities exist or what a refusal is
// called. \`record-brokers.test.mjs\` regenerates both and fails on a
// difference.
//
// \`global\` is reference data: readable by any member of the deployment, and
// writable through no operation here.
export const BROKERED_ENTITIES = Object.freeze({
${rows}
});

export const BROKER_CODES = Object.freeze({
${codes}
});

export const BROKER_REFUSALS = Object.freeze(Object.values(BROKER_CODES));

/** Modes the family serves for reads only. A caller must not try to write one. */
export const READ_ONLY_MODES = Object.freeze(${JSON.stringify([...READ_ONLY_MODES])});

export const READ_ONLY_ENTITIES = Object.freeze(
  Object.keys(BROKERED_ENTITIES).filter(entity => READ_ONLY_MODES.includes(BROKERED_ENTITIES[entity])));
`;
}

export function main(args = process.argv.slice(2),
  { repository = resolve(dirname(fileURLToPath(import.meta.url))), log = console.log, write = writeFileSync } = {}) {
  if (args.some(argument => !['--sql', '--write', '--summary'].includes(argument))) {
    log(JSON.stringify({ error: 'INVALID_ARGUMENTS' }));
    return 2;
  }
  let plan; let sql;
  try { ({ plan, sql } = renderBrokerMigration(repository)); }
  catch (error) { log(JSON.stringify({ error: error?.message || 'BROKERS_UNAVAILABLE' })); return 2; }
  if (args.includes('--sql')) { log(sql); return 0; }
  const module = renderEntityModule(plan);
  if (args.includes('--write')) {
    write(join(repository, BROKER_MIGRATION_FILE), sql);
    write(join(repository, BROKERED_ENTITIES_FILE), module);
    log(JSON.stringify({ updated: [BROKER_MIGRATION_FILE, BROKERED_ENTITIES_FILE],
      entities: plan.entries.length, bytes: sql.length }));
    return 0;
  }
  let committed; let committedModule;
  try {
    committed = readFileSync(join(repository, BROKER_MIGRATION_FILE), 'utf8');
    committedModule = readFileSync(join(repository, BROKERED_ENTITIES_FILE), 'utf8');
  } catch { log(JSON.stringify({ error: 'BROKER_MIGRATION_MISSING' })); return 2; }
  const matches = committed === sql && committedModule === module;
  const counts = Object.entries(plan.counts).map(([mode, count]) => `${mode}=${count}`).join(' ');
  log(`record brokers ${matches ? 'unchanged' : 'CHANGED'}: ${OPERATIONS.length} operations over `
    + `${plan.entries.length} entities (${counts})`);
  return matches ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main();
}
