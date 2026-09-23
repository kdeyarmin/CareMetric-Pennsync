-- D89's distribution key, for a store that already exists (D88).
--
-- `20260919170000_record_store.sql` is GENERATED and was regenerated to add
-- this index when `CONTRACT_UNIQUE` gained `PolicyAcknowledgment.distribution`.
-- That reaches a fresh provision and reaches no deployment that had already
-- applied it, so the change lives in both places and this is the second.
--
-- DERIVED, never typed: `node tools-pennsync-record-catchup.mjs --write` reads
-- the statement out of the generated migration and adds `if not exists`.
-- The emitter builds both the column list and the non-empty predicate from the
-- declaration, so a retyped copy could drift into a DIFFERENT index wearing
-- the same name -- and `contract_policy_distribute` catches
-- `unique_violation` on that name and re-raises everything else, so the name
-- agreeing while the predicate does not is worse than no index at all.
--
-- `if not exists` rather than a drop and recreate: on a store that already has
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

create unique index if not exists "policy_acknowledgment_distribution_unique" on "pennsync_records"."policy_acknowledgment" ("source_app_id", "agency_id", "policy_id", "policy_version", "user_id") where "agency_id" is not null and "agency_id" <> '' and "policy_id" is not null and "policy_id" <> '' and "policy_version" is not null and "policy_version" <> '' and "user_id" is not null and "user_id" <> '';
reset role;
commit;
