#!/usr/bin/env node
/**
 * The forward migration that carries a change to the GENERATED record store
 * into a deployment that already applied it (D88).
 *
 * `20260919170000_record_store.sql` is generated: AGENTS.md says to change the
 * entity definitions and re-run `--write-migration`, and a test fails if the
 * committed SQL and the generator disagree. That is right for a store being
 * built and wrong the moment one exists, because the ledger keys on the
 * migration's NAME and holds no content hash — `planMigration` reads
 * `ledgerName` and asks `have.has(name)`. So a regenerated file reaches a
 * FRESH provision and never reaches a deployment that has already run it, and
 * nothing on the way in says so: `check:entity-schema-plan` compares the file
 * with the generator, both agree, and the hosted store quietly lacks whatever
 * was added.
 *
 * That is what happened to D82. The profile-write path went into the generated
 * file, main went green, and the hosted comparison — which runs on `main`
 * only — reported `missing from hosted: pennsync_records.user.user_update`.
 *
 * So the change lives in BOTH places and this derives the second from the
 * first. Not a second copy: the block is READ out of the generated migration
 * and wrapped, so a change to `PROFILE_SELF_WRITABLE` or to
 * `renderProfileGuard` moves both files or fails the test that compares them.
 * Retyping it is the transcription D12 settled against, and it would drift in
 * exactly the direction nothing measures.
 *
 * Three wrappers, and each is the idempotent form of the statement beside it,
 * because a fresh provision applies the generated file and then this one:
 *
 *   - `create function`  -> `create or replace function`
 *   - `create trigger`   -> `create or replace trigger`
 *   - `create policy`    -> `drop policy if exists` + `create policy`
 *
 * The bodies are otherwise untouched, which is the property that matters: the
 * hosted comparison reads `md5(prosrc)` for a function and
 * `pg_get_triggerdef` for a trigger, so a wrapper that reformatted anything
 * would show up as drift rather than fix it.
 *
 * It derives ONE CATCH-UP PER REGENERATION, each named and each reading its own
 * statements out of the generated file: D82's profile-write objects, and D89's
 * `policy_acknowledgment_distribution_unique`. It is not a general "make the
 * store match" tool and must not become one: what a given deployment is
 * missing is a fact about that deployment, and the only thing that reads it is
 * the hosted comparison. Each entry here says what ONE change added, which is
 * a fact about the repository and knowable without a database.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const SOURCE_MIGRATION =
  'services/authority-store/supabase/record-migrations/20260919170000_record_store.sql';
export const CATCHUP_MIGRATION =
  'services/authority-store/supabase/record-migrations/20260920530000_profile_self_write.sql';

/** Where the D82 block starts and stops inside the generated migration. */
const BLOCK_OPENS = 'create function "pennsync_records"."user_self_write_guard"() returns trigger';
const BLOCK_CLOSES = '\n\n-- user: no insert or delete policy';

/**
 * The D82 statements, exactly as the generator emitted them.
 *
 * Both anchors are asserted rather than searched past: an absent one means the
 * generator no longer emits this shape, and the honest answer then is a
 * refusal rather than an empty block that would make the catch-up a no-op
 * while every test still passed.
 */
export function readProfileBlock(repository = here) {
  const sql = readFileSync(resolve(repository, SOURCE_MIGRATION), 'utf8');
  const start = sql.indexOf(BLOCK_OPENS);
  if (start < 0) throw new Error('CATCHUP_BLOCK_START_MISSING');
  const end = sql.indexOf(BLOCK_CLOSES, start);
  if (end < 0) throw new Error('CATCHUP_BLOCK_END_MISSING');
  return sql.slice(start, end);
}

/** The block's statements, in the idempotent form a second application needs. */
export function idempotent(block) {
  const rewritten = block
    .replace('create function "pennsync_records"."user_self_write_guard"()',
      'create or replace function "pennsync_records"."user_self_write_guard"()')
    .replace('create trigger "user_self_write_guard" before update',
      'create or replace trigger "user_self_write_guard" before update')
    .replace('create policy "user_update" on "pennsync_records"."user"',
      'drop policy if exists "user_update" on "pennsync_records"."user";\n\n'
      + 'create policy "user_update" on "pennsync_records"."user"');
  // Each rewrite is checked rather than assumed: `String.replace` with a
  // literal that does not match returns the string unchanged and says nothing,
  // so a generator that renamed the trigger would emit a `create trigger` into
  // a database that already has one and fail on the real target instead of
  // here.
  for (const [name, needle] of [
    ['function', 'create or replace function "pennsync_records"."user_self_write_guard"()'],
    ['trigger', 'create or replace trigger "user_self_write_guard"'],
    ['policy', 'drop policy if exists "user_update"'],
  ]) {
    if (!rewritten.includes(needle)) throw new Error(`CATCHUP_REWRITE_MISSED: ${name}`);
  }
  return rewritten;
}

const HEADER = `-- D82's profile-write path, for a store that already exists (D88).
--
-- \`20260919170000_record_store.sql\` is GENERATED and was regenerated to add
-- these four objects. That reaches a fresh provision and reaches no deployment
-- that had already applied it, because the ledger keys on the migration's name
-- and holds no content hash -- so \`tools-pennsync-migrate.mjs\` reads the name,
-- finds it applied, and skips a file whose contents have changed underneath
-- it. The hosted staging store was missing \`user_update\` for exactly that
-- reason, and only the main-gated hosted comparison could see it.
--
-- This file is DERIVED, never typed: \`node tools-pennsync-record-catchup.mjs
-- --write\` reads the block out of the generated migration and wraps each
-- statement in its idempotent form. \`record-store-catchup.test.mjs\` fails if
-- the two disagree, so changing \`PROFILE_SELF_WRITABLE\` or the guard moves
-- both files or fails the build.
--
-- It is idempotent because a fresh provision runs the generated file first and
-- this one after, and both orders have to end in the same store: that is the
-- thing the hosted comparison measures. The bodies are byte-identical to the
-- generated ones on purpose -- the comparison reads \`md5(prosrc)\` and
-- \`pg_get_triggerdef\`, so a reformatted body would read as drift.
--
-- The rule it stands for: a migration that a deployment has already applied is
-- not editable in place. Regenerating one is a change to what a NEW store
-- gets; an existing store needs a forward migration in the same change.
begin;

do $$
begin
  if to_regclass('pennsync_records.user') is null then
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

-- As the owner, so the function and the trigger come out owned by the role the
-- generated migration would have given them. The hosted comparison reads
-- \`pg_get_userbyid(p.proowner)\`, so a catch-up that ran as the administrator
-- would close one difference and open another.
set local role "pennsync_records_owner";

`;

const FOOTER = `

-- user: no insert or delete policy; a profile row is enrolment's to create and nobody's to remove. Cross-user writes are D82's open half.

reset role;
commit;
`;

/** The whole file, header and all. */
export function renderCatchup(repository = here) {
  return HEADER + idempotent(readProfileBlock(repository)) + FOOTER;
}

export const INDEX_CATCHUP_MIGRATION =
  'services/authority-store/supabase/record-migrations/20260920545000_policy_distribution_index.sql';

/** The index D89 declared, exactly as the generator emitted it. */
export const DISTRIBUTION_INDEX = 'policy_acknowledgment_distribution_unique';

/**
 * The one `create unique index` statement for D89's composite key.
 *
 * Read rather than retyped for the same reason the D82 block is: the emitter
 * builds the column list AND the non-empty predicate from `CONTRACT_UNIQUE`,
 * so a column added to the declaration has to move this file too. A retyped
 * predicate that drifted would be a DIFFERENT index with the same name, which
 * is the one thing worse than a missing one — `contract_policy_distribute`
 * catches `unique_violation` on this name and re-raises anything else.
 */
export function readDistributionIndex(repository = here) {
  const sql = readFileSync(resolve(repository, SOURCE_MIGRATION), 'utf8');
  const opens = `create unique index "${DISTRIBUTION_INDEX}" on `;
  const start = sql.indexOf(opens);
  if (start < 0) throw new Error('CATCHUP_INDEX_MISSING');
  const end = sql.indexOf(';\n', start);
  if (end < 0) throw new Error('CATCHUP_INDEX_UNTERMINATED');
  // A second occurrence would mean the generator emitted the name twice, and
  // taking the first would silently pick one of two different predicates.
  if (sql.indexOf(opens, start + 1) >= 0) throw new Error('CATCHUP_INDEX_DUPLICATED');
  return sql.slice(start, end + 1);
}

/** The statement in the form a store that already has the table can apply. */
export function idempotentIndex(statement) {
  const rewritten = statement.replace('create unique index "', 'create unique index if not exists "');
  if (!rewritten.startsWith('create unique index if not exists "')) {
    throw new Error('CATCHUP_INDEX_REWRITE_MISSED');
  }
  return rewritten;
}

const INDEX_HEADER = `-- D89's distribution key, for a store that already exists (D88).
--
-- \`20260919170000_record_store.sql\` is GENERATED and was regenerated to add
-- this index when \`CONTRACT_UNIQUE\` gained \`PolicyAcknowledgment.distribution\`.
-- That reaches a fresh provision and reaches no deployment that had already
-- applied it, so the change lives in both places and this is the second.
--
-- DERIVED, never typed: \`node tools-pennsync-record-catchup.mjs --write\` reads
-- the statement out of the generated migration and adds \`if not exists\`.
-- The emitter builds both the column list and the non-empty predicate from the
-- declaration, so a retyped copy could drift into a DIFFERENT index wearing
-- the same name -- and \`contract_policy_distribute\` catches
-- \`unique_violation\` on that name and re-raises everything else, so the name
-- agreeing while the predicate does not is worse than no index at all.
--
-- \`if not exists\` rather than a drop and recreate: on a store that already has
-- it this must be a no-op, and dropping a unique index even briefly inside a
-- transaction that might roll back is a window where two distributions can
-- both insert.
begin;

do $$
begin
  if to_regclass('pennsync_records.policy_acknowledgment') is null then
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

-- As the owner, because an index is created by the table's owner and the
-- hosted comparison reads who owns what.
set local role "pennsync_records_owner";

`;

const INDEX_FOOTER = `
reset role;
commit;
`;

/** The index catch-up, header and all. */
export function renderIndexCatchup(repository = here) {
  return INDEX_HEADER + idempotentIndex(readDistributionIndex(repository)) + INDEX_FOOTER;
}

export const DEFAULTS_CATCHUP_MIGRATION =
  'services/authority-store/supabase/record-migrations/20260920590000_column_defaults.sql';

/** `  "column" type default <literal>,` exactly as the generator emits it. */
const DEFAULT_LINE = /^ {2}"([a-z_0-9]+)" [a-z ]+ default (.+?),$/;
const TABLE_OPENS = /^create table "pennsync_records"\."([a-z_0-9]+)" \($/;

/**
 * Every column default in the generated store, as (table, column, literal).
 *
 * Read out of the emitted SQL rather than re-planned from the schemas, for the
 * reason the two readers above are: a second derivation is a second answer to
 * the same question, and it drifts where nothing measures. Reading the file
 * also keeps this tool free of `tools-entity-schema-plan.mjs`, which pulls in
 * `json5` -- the isolated authority job installs no root packages, so a suite
 * there importing this would die at load rather than on an assertion.
 *
 * It REFUSES a line inside a table that carries ` default ` and does not match
 * the shape, instead of skipping it. A skipped column is a default that exists
 * on a fresh store and on no existing one, with both files agreeing and
 * nothing able to see the difference -- which is D88 all over again, one
 * column at a time.
 *
 * It SKIPS the schema-only tables, and the reason is the whole of why this
 * exclusion exists rather than being a tidy-up. This catch-up file has already
 * been applied, and an applied migration is frozen: `planMigration` matches on
 * the NAME and holds no content hash, so re-emitting this file with eight new
 * tables' defaults in it would have shipped an edit that reaches no store that
 * ran it, while every local suite stayed green — exactly the defect D88 names,
 * arriving inside the tool written to prevent it. It was caught because the
 * fingerprint pin reported the file CHANGED rather than added.
 *
 * Those defaults are not lost. They arrive inline in each table's own
 * `create table`, carried by `TABLES_CATCHUP_MIGRATION`, and
 * `assertSkippedDefaultsAreCarried` proves it statement by statement rather
 * than asserting it here — because "they are in the other file" is the kind of
 * claim that stays true until somebody narrows the other file.
 */
export function readColumnDefaults(repository = here) {
  const sql = readFileSync(resolve(repository, SOURCE_MIGRATION), 'utf8');
  const rows = [];
  let table = null;
  for (const line of sql.split('\n')) {
    const opens = TABLE_OPENS.exec(line);
    if (opens) { [, table] = opens; continue; }
    if (table === null) continue;
    // The closer is read BEFORE the skip, so a skipped table still ends. With
    // the two the other way round `table` stayed set past the block and every
    // line after it was scanned as though it were inside one.
    if (line === ');') { table = null; continue; }
    if (SCHEMA_ONLY_TABLES.includes(table)) continue;
    const match = DEFAULT_LINE.exec(line);
    if (match) { rows.push({ table, column: match[1], literal: match[2] }); continue; }
    if (line.includes(' default ')) throw new Error(`CATCHUP_DEFAULT_LINE_UNREADABLE: ${line}`);
  }
  if (rows.length === 0) throw new Error('CATCHUP_DEFAULTS_MISSING');
  return rows;
}

/**
 * `alter column ... set default` per row, which is already idempotent: setting
 * the default a column already has is a no-op, so a fresh provision may run
 * the generated file and then this one.
 *
 * Nothing here BACKFILLS. A default decides what a row gets when an INSERT
 * omits the column, and every row already stored keeps the null it has. That
 * is deliberate: writing today's default into rows that were created without
 * one would assert a value nobody observed, which is the rule D94 states about
 * the ledger's own untouchable rows.
 */
export function renderDefaultStatements(rows) {
  return rows.map(({ table, column, literal: value }) =>
    `alter table "pennsync_records".${JSON.stringify(table)} `
    + `alter column ${JSON.stringify(column)} set default ${value};`).join('\n');
}

const DEFAULTS_HEADER = `-- The entity schemas' column defaults, for a store that already exists (D88).
--
-- \`planEntity\` never read a property's \`default\`, so the generated store
-- emitted none of the 425 the carried schemas declare. That is not cosmetic:
-- where a contract's INSERT omits such a column the row stored a null, while
-- the Base44 original stored the schema's value. Sixteen columns across six
-- contracts are in that state -- among them \`incident.state_reportable\`,
-- whose STORED value D44's resolve gate reads, and \`physician.referral_count\`,
-- which a null makes increment to null.
--
-- Sixteen, and not the thirty-one first measured: an INSERT column list is NOT
-- what the row holds at commit. The timesheet submit inserts a skeleton of
-- seven columns and then UPDATEs \`status\` and all ten payroll numerics in the
-- same transaction, so the row never exists with a null in any of them. The
-- instrument read insert lists and called an omitted column a divergence.
--
-- DERIVED, never typed: \`node tools-pennsync-record-catchup.mjs --write\` reads
-- every emitted \`default\` out of the generated migration. Four hundred and
-- twenty-five retyped literals is exactly the transcription D12 settled
-- against, and a drifted one would be a plausible wrong value rather than an
-- error.
--
-- It sets defaults and BACKFILLS NOTHING. Every row already in the store keeps
-- the null it holds; only inserts that omit the column change. Filling those
-- rows would assert a value nobody observed.
begin;

do $$
begin
  if to_regclass('pennsync_records.patient') is null then
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

-- As the owner, because \`alter table\` is the owner's to run.
set local role "pennsync_records_owner";

`;

const DEFAULTS_FOOTER = `

reset role;
commit;
`;

/** The defaults catch-up, header and all. */
export function renderDefaultsCatchup(repository = here) {
  return DEFAULTS_HEADER + renderDefaultStatements(readColumnDefaults(repository)) + DEFAULTS_FOOTER;
}


export const TABLES_CATCHUP_MIGRATION =
  'services/authority-store/supabase/record-migrations/20260920750000_oasis_schema_tables.sql';

/**
 * The eight tables D7's schema clause added, as the generator names them.
 *
 * Spelled out rather than imported from `SCHEMA_ONLY`, for the reason the
 * defaults reader gives: importing `tools-entity-schema-plan.mjs` pulls in
 * `json5`, and the isolated authority job installs no root packages, so a
 * suite there importing this file would die at load rather than on an
 * assertion. The cost of a second copy is paid in the root suite instead,
 * where `record-store-catchup` asserts this list is exactly `snakeCase` of
 * `SCHEMA_ONLY`'s keys — so adding a ninth entity without extending this
 * fails rather than shipping a catch-up that silently carries eight.
 */
export const SCHEMA_ONLY_TABLES = Object.freeze([
  'oasis_action_item', 'oasis_assessment', 'oasis_audit', 'oasis_automation_rule',
  'oasis_feedback', 'oasis_scenario', 'oasis_upload', 'oasis_workflow_execution',
]);

/**
 * One table's whole DDL block, from `create table` through the revoke.
 *
 * Both ends are anchored and asserted. A missing opener means the generator no
 * longer emits this table, and a missing closer means the block's shape
 * changed — either way the honest answer is a refusal, because a block read to
 * the wrong end would apply a table with its row level security left off.
 * That is the one failure mode here worth refusing loudly for: a record table
 * without forced RLS is readable by every tenant.
 */
export function readTableBlock(repository, table) {
  const sql = readFileSync(resolve(repository, SOURCE_MIGRATION), 'utf8');
  const opens = `create table "pennsync_records"."${table}" (\n`;
  const closes = `revoke all on "pennsync_records"."${table}" from public;\n`;
  const start = sql.indexOf(opens);
  if (start < 0) throw new Error(`CATCHUP_TABLE_MISSING:${table}`);
  if (sql.indexOf(opens, start + 1) >= 0) throw new Error(`CATCHUP_TABLE_DUPLICATED:${table}`);
  const end = sql.indexOf(closes, start);
  if (end < 0) throw new Error(`CATCHUP_TABLE_UNTERMINATED:${table}`);
  const block = sql.slice(start, end + closes.length);
  // Asserted rather than assumed: a table whose RLS lines moved out of this
  // block would come across unprotected and nothing else here would notice.
  for (const needed of ['enable row level security', 'force row level security']) {
    if (!block.includes(needed)) throw new Error(`CATCHUP_TABLE_UNPROTECTED:${table}:${needed}`);
  }
  return block;
}

/** One table's policies, in the order the generator emitted them. */
export function readTablePolicies(repository, table) {
  const sql = readFileSync(resolve(repository, SOURCE_MIGRATION), 'utf8');
  const statements = [];
  const pattern = new RegExp(`^create policy "([^"]+)" on "pennsync_records"\\."${table}" .*;$`, 'gm');
  for (const match of sql.matchAll(pattern)) statements.push({ name: match[1], sql: match[0] });
  // A table with no policy at all is representable in this store and is not
  // what these eight are: with none, a definer contract reads nothing and the
  // catch-up would look like it worked. D32's four append-only entities have
  // two policies rather than four, so the count is not asserted — only that
  // there is at least one, and that a read exists.
  if (!statements.length) throw new Error(`CATCHUP_TABLE_NO_POLICY:${table}`);
  if (!statements.some(entry => entry.name === `${table}_read`)) {
    throw new Error(`CATCHUP_TABLE_NO_READ_POLICY:${table}`);
  }
  const names = statements.map(entry => entry.name);
  if (new Set(names).size !== names.length) throw new Error(`CATCHUP_TABLE_POLICY_DUPLICATED:${table}`);
  return statements;
}

/**
 * The eight blocks in the form a store that already ran the generated file can
 * apply.
 *
 * `create table if not exists` is the only idempotent form a table has, and it
 * is weaker than the `create or replace` the other catch-ups use: on a store
 * that somehow holds a table of this name with different columns it is a
 * silent no-op. That is accepted here and named rather than hidden, because
 * these eight names are new to the store — nothing has ever created one — and
 * the hosted comparison is what would catch a mismatch, column by column, if
 * the premise were ever wrong.
 */
export function idempotentTables(repository, tables = SCHEMA_ONLY_TABLES) {
  const parts = [];
  for (const table of tables) {
    const block = readTableBlock(repository, table)
      .replace(`create table "pennsync_records"."${table}" (`,
        `create table if not exists "pennsync_records"."${table}" (`);
    if (!block.startsWith('create table if not exists ')) {
      throw new Error(`CATCHUP_TABLE_REWRITE_MISSED:${table}`);
    }
    const policies = readTablePolicies(repository, table).map(entry =>
      `drop policy if exists "${entry.name}" on "pennsync_records"."${table}";\n${entry.sql}`);
    parts.push([block, ...policies].join('\n'));
  }
  return parts.join('\n\n');
}

const TABLES_HEADER = `-- D7's schema clause, for a store that already exists (D88).
--
-- D7 carries the paused domains as \`preserved_paused\` and says of them: "Their
-- schemas and data still migrate; only their execution stays off." The schema
-- planner could not express that until \`SCHEMA_ONLY\` named these eight
-- entities one at a time, and regenerating
-- \`20260919170000_record_store.sql\` reaches a fresh provision and no
-- deployment that has already applied it -- so the change lives in both places
-- and this is the second.
--
-- DERIVED, never typed: \`node tools-pennsync-record-catchup.mjs --write\` reads
-- each table's whole block and each of its policies out of the generated
-- migration. A hand-kept copy of 164 columns and 32 policies would drift in
-- the one direction nothing measures.
--
-- WHAT THIS DOES NOT DO. A table is not an access path. Every OASIS capability
-- stays \`preserved_paused\`; the generic broker family serves \`broker\` alone
-- and D22's ceiling refuses all eight on its own account; so after this applies
-- the only way to one of these rows is a hand-written contract, and there is
-- none yet. The frontend census reports these call sites as
-- \`no_access_contract\` rather than as served, for exactly that reason.
begin;

do $$
begin
  if to_regclass('pennsync_records.patient') is null then
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

-- As the owner, so these tables come out owned by the role the generated
-- migration would have given them. The hosted comparison reads
-- \`pg_get_userbyid(c.relowner)\`, so a catch-up that ran as the administrator
-- would close one difference and open another.
set local role "pennsync_records_owner";

`;

const TABLES_FOOTER = `

reset role;
commit;
`;

/** The schema-only tables catch-up, header and all. */
export function renderTablesCatchup(repository = here) {
  return TABLES_HEADER + idempotentTables(repository) + TABLES_FOOTER;
}

/**
 * Every default `readColumnDefaults` skips is carried by this file instead.
 *
 * The defaults catch-up stops at the schema-only tables because it is already
 * applied and cannot be edited. That is only safe if the defaults it stops
 * reading arrive somewhere, so this reads them out of the generated migration a
 * second time — deliberately, since the point is to check the first reader's
 * exclusion rather than to reuse it — and asserts each one appears inside the
 * emitted table block. A default that existed on a fresh store and on no
 * existing one is D88 one column at a time, which is the failure the exclusion
 * could otherwise introduce while every suite stayed green.
 */
export function assertSkippedDefaultsAreCarried(repository = here) {
  const sql = readFileSync(resolve(repository, SOURCE_MIGRATION), 'utf8');
  const carried = renderTablesCatchup(repository);
  const skipped = [];
  let table = null;
  for (const line of sql.split('\n')) {
    const opens = TABLE_OPENS.exec(line);
    if (opens) { [, table] = opens; continue; }
    if (table === null) continue;
    if (line === ');') { table = null; continue; }
    if (!SCHEMA_ONLY_TABLES.includes(table)) continue;
    const match = DEFAULT_LINE.exec(line);
    if (match) skipped.push({ table, column: match[1], literal: match[2] });
    else if (line.includes(' default ')) throw new Error(`CATCHUP_DEFAULT_LINE_UNREADABLE: ${line}`);
  }
  // Zero would mean the exclusion is pointless OR that the shape changed and
  // nothing is being read at all; the second is the one worth refusing for.
  if (!skipped.length) throw new Error('CATCHUP_SKIPPED_DEFAULTS_MISSING');
  for (const row of skipped) {
    if (!carried.includes(`"${row.column}" `) || !carried.includes(`default ${row.literal}`)) {
      throw new Error(`CATCHUP_SKIPPED_DEFAULT_NOT_CARRIED:${row.table}.${row.column}`);
    }
  }
  return skipped;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const derived = [
    [CATCHUP_MIGRATION, renderCatchup()],
    [INDEX_CATCHUP_MIGRATION, renderIndexCatchup()],
    [DEFAULTS_CATCHUP_MIGRATION, renderDefaultsCatchup()],
    [TABLES_CATCHUP_MIGRATION, renderTablesCatchup()],
  ];
  let stale = false;
  for (const [file, sql] of derived) {
    const target = resolve(here, file);
    if (process.argv.includes('--write')) {
      writeFileSync(target, sql);
      process.stdout.write(`wrote ${file}\n`);
      continue;
    }
    // Every entry is reported, not just the first: a run that stopped at the
    // first stale file would send somebody back for a second round over a
    // difference this one already knew about.
    if (readFileSync(target, 'utf8') !== sql) {
      process.stderr.write(`CATCHUP_MIGRATION_STALE: ${file} -- re-run with --write\n`);
      stale = true;
    }
  }
  if (stale) process.exit(1);
  if (!process.argv.includes('--write')) {
    process.stdout.write(`${derived.length} catch-up migrations match the generated record store\n`);
  }
}
