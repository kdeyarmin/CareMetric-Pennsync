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
 * It derives one catch-up, for the objects D82 added. It is not a general
 * "make the store match" tool and must not become one: what a given deployment
 * is missing is a fact about that deployment, and the only thing that reads it
 * is the hosted comparison.
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

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const sql = renderCatchup();
  const target = resolve(here, CATCHUP_MIGRATION);
  if (process.argv.includes('--write')) {
    writeFileSync(target, sql);
    process.stdout.write(`wrote ${CATCHUP_MIGRATION}\n`);
  } else {
    const committed = readFileSync(target, 'utf8');
    if (committed !== sql) {
      process.stderr.write('CATCHUP_MIGRATION_STALE: re-run with --write\n');
      process.exit(1);
    }
    process.stdout.write('catch-up migration matches the generated record store\n');
  }
}
