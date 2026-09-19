-- An append-only record of every operator enrollment run.
--
-- D6 moves identity by re-enrollment, never by credential copy: an operator
-- verifies a person out of band, that person accepts a Supabase Auth
-- invitation, and the operator then writes the identity-map row binding the two.
-- `identity_map` already carries the per-person evidence digest and the moment
-- it was verified. What it does not carry is the run: which plan was applied,
-- what that plan produced, into which database, by which role. Without that, an
-- auditor can see that a person was enrolled but not on whose authority or
-- alongside whom.
--
-- Nothing reads this table at runtime. It exists to be read afterwards, so it is
-- append-only: a row cannot be edited, removed or truncated, and a second run of
-- the same plan collides on the primary key rather than silently re-applying.
begin;
do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles
    where rolname = current_user and (rolsuper or rolbypassrls)) then
    raise exception using errcode='42501',message='PENNSYNC_BYPASSRLS_MIGRATION_OWNER_REQUIRED';
  end if;
end $$;

create table pennsync_private.enrollment_receipt (
  app_id pennsync_private.deployment_app not null,
  plan_sha256 text not null check (plan_sha256 ~ '^[a-f0-9]{64}$'),
  -- A digest of what the run actually wrote, not of what the plan asked for, so
  -- a later audit can tell the two apart.
  projection_sha256 text not null check (projection_sha256 ~ '^[a-f0-9]{64}$'),
  identity_count integer not null check (identity_count between 1 and 200),
  agency_count integer not null check (agency_count between 0 and 50),
  membership_count integer not null check (membership_count between 0 and 400),
  database_name text not null check (length(database_name) between 1 and 63),
  operator_role text not null check (length(operator_role) between 1 and 63),
  created_at timestamptz not null default clock_timestamp(),
  primary key (app_id, plan_sha256)
);

create function pennsync_private.protect_enrollment_receipt() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  raise exception using errcode='23514',message='PENNSYNC_APPEND_ONLY_ENROLLMENT_RECEIPT';
end $$;
create trigger enrollment_receipt_append_only before update or delete on pennsync_private.enrollment_receipt
for each row execute function pennsync_private.protect_enrollment_receipt();
create trigger enrollment_receipt_untruncatable before truncate on pennsync_private.enrollment_receipt
for each statement execute function pennsync_private.protect_enrollment_receipt();

alter table pennsync_private.enrollment_receipt enable row level security;
alter table pennsync_private.enrollment_receipt force row level security;
revoke all on pennsync_private.enrollment_receipt from public,anon,authenticated,service_role;
commit;
