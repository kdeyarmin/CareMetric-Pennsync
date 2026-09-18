-- Local synthetic patient import provenance, separate from authenticated RPC receipts.
-- No source export, Auth enrollment, membership grant, or production import path.
begin;
do $$ begin
  if not exists(select 1 from pg_catalog.pg_roles where rolname=current_user
    and (rolsuper or rolbypassrls)) then
    raise exception using errcode='42501',message='PENNSYNC_BYPASSRLS_MIGRATION_OWNER_REQUIRED';
  end if;
end $$;
create table pennsync_private.archive_patient_import_receipt (
  app_id pennsync_private.staging_app not null,
  plan_sha256 text not null check(plan_sha256 ~ '^[a-f0-9]{64}$'),
  owner_sha256 text not null check(owner_sha256 ~ '^[a-f0-9]{64}$'),
  projection_sha256 text not null check(projection_sha256 ~ '^[a-f0-9]{64}$'),
  patient_count integer not null check(patient_count between 1 and 100),
  patient_ids text[] not null check(array_ndims(patient_ids)=1 and array_lower(patient_ids,1)=1
    and cardinality(patient_ids)=patient_count and array_position(patient_ids,null) is null
    and array_to_string(patient_ids,',') ~ '^[a-f0-9]{24}(,[a-f0-9]{24})*$'),
  state text not null check(state in ('applied','rolled_back')),
  database_name name not null default current_database(),
  operator_role name not null default current_user,
  created_at timestamptz not null default clock_timestamp(),
  rolled_back_at timestamptz,
  primary key(app_id,plan_sha256),
  check((state='applied' and rolled_back_at is null)
    or (state='rolled_back' and rolled_back_at is not null))
);
alter table pennsync_private.archive_patient_import_receipt enable row level security;
alter table pennsync_private.archive_patient_import_receipt force row level security;
revoke all on pennsync_private.archive_patient_import_receipt from public,anon,authenticated,service_role;
comment on table pennsync_private.archive_patient_import_receipt is
  'Operator-owned synthetic archive imports only; not an authenticated user API mutation or source completeness proof.';
commit;
