-- D82's profile-write path, for a store that already exists (D88).
--
-- `20260919170000_record_store.sql` is GENERATED and was regenerated to add
-- these four objects. That reaches a fresh provision and reaches no deployment
-- that had already applied it, because the ledger keys on the migration's name
-- and holds no content hash -- so `tools-pennsync-migrate.mjs` reads the name,
-- finds it applied, and skips a file whose contents have changed underneath
-- it. The hosted staging store was missing `user_update` for exactly that
-- reason, and only the main-gated hosted comparison could see it.
--
-- This file is DERIVED, never typed: `node tools-pennsync-record-catchup.mjs
-- --write` reads the block out of the generated migration and wraps each
-- statement in its idempotent form. `record-store-catchup.test.mjs` fails if
-- the two disagree, so changing `PROFILE_SELF_WRITABLE` or the guard moves
-- both files or fails the build.
--
-- It is idempotent because a fresh provision runs the generated file first and
-- this one after, and both orders have to end in the same store: that is the
-- thing the hosted comparison measures. The bodies are byte-identical to the
-- generated ones on purpose -- the comparison reads `md5(prosrc)` and
-- `pg_get_triggerdef`, so a reformatted body would read as drift.
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
-- `pg_get_userbyid(p.proowner)`, so a catch-up that ran as the administrator
-- would close one difference and open another.
set local role "pennsync_records_owner";

create or replace function "pennsync_records"."user_self_write_guard"() returns trigger
  language plpgsql set search_path = '' as $guard$
declare v_changed text;
begin
  select string_agg(f.key, ', ' order by f.key) into v_changed
  from jsonb_each(to_jsonb(new)) as f(key, value)
  where f.key <> all (array['updated_date', 'favorited_pages', 'favorited_patients', 'preferred_language', 'notification_settings', 'fax_notification_preferences', 'two_factor_enabled', 'phone', 'phone_number', 'personal_cell_e164', 'duty_status', 'duty_on_since', 'off_duty_message', 'scheduled_off_duty_start', 'scheduled_off_duty_end', 'scheduled_off_duty_recurring', 'saved_signature'])
    and f.value is distinct from (to_jsonb(old) -> f.key);
  if v_changed is not null then
    raise exception using errcode = '42501',
      message = 'PENNSYNC_PROFILE_FIELD_NOT_SELF_WRITABLE: ' || v_changed;
  end if;
  return new;
end $guard$;

revoke all on function "pennsync_records"."user_self_write_guard"() from public;

create or replace trigger "user_self_write_guard" before update on "pennsync_records"."user" for each row execute function "pennsync_records"."user_self_write_guard"();

drop policy if exists "user_update" on "pennsync_records"."user";

create policy "user_update" on "pennsync_records"."user" for update using ("user"."source_app_id" = "pennsync_records".deployment_app() and "user"."id" = "pennsync_records".caller_user_id()) with check ("user"."source_app_id" = "pennsync_records".deployment_app() and "user"."id" = "pennsync_records".caller_user_id());

-- user: no insert or delete policy; a profile row is enrolment's to create and nobody's to remove. Cross-user writes are D82's open half.

reset role;
commit;
