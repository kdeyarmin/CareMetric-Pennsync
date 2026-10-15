-- Carry the AI model default to a store that already ran the old one (D88).
--
-- OpenAI was removed on 2026-10-15 (Track B R1). That change regenerated
-- `20260919170000_record_store.sql` and `20260920590000_column_defaults.sql`
-- so that `ai_model_configuration.model` defaults to 'claude-sonnet-5-5'
-- instead of 'gpt-4o'. Both files had already run on hosted staging, and the
-- migrate tool plans by NAME, so neither edit could reach it: every store
-- built from nothing got the new default and hosted staging kept 'gpt-4o'.
-- `hosted-store.test.mjs` measured exactly that one difference on `main`.
--
-- This is the forward migration the fingerprint pin's rule asks for. On a
-- store built from the current tree it sets the value the column already has.
-- On a store that ran the earlier text it is the change itself.
--
-- It sets a default and BACKFILLS NOTHING, as `column_defaults` does: a row
-- already stored keeps the model it holds. Measured before writing this, hosted
-- staging held no `ai_model_configuration` rows at all.
begin;

do $$
begin
  if to_regclass('pennsync_records.ai_model_configuration') is null then
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

-- As the owner, because `alter table` is the owner's to run.
set local role "pennsync_records_owner";

alter table "pennsync_records"."ai_model_configuration" alter column "model" set default 'claude-sonnet-5-5';

reset role;
commit;
