-- Where a production care team lives (D24).
--
-- D24 makes the authority store's assignment model the authority on who may
-- open a chart. The obvious reading was that `pennsync_private.assignment` is
-- that table. It is not, and the reason is worth writing down because a first
-- attempt got it wrong in a way every unit test passed:
--
--   * `assignment` keys to `pennsync_private.patient`, whose `display_name`
--     must be `like 'Synthetic %'` and whose `synthetic` column carries
--     `check (synthetic)`. That table holds STAGING patients and can hold
--     nothing else, so an assignment over it can only ever name a synthetic
--     patient.
--   * The patients of record live in `pennsync_records.patient`.
--
-- So the first attempt dropped `assignment`'s patient key to let it name a
-- real patient. That key has a second job: it is one of four RESTRICT keys
-- that make rolling back an imported patient REFUSE while something clinical
-- still references it, which `tools-pennsync-archive-import.mjs` checks by
-- name and which its postgres suite proves ("dependent clinical assignment
-- prevents deletion"). Dropping it removed a deletion guard. The key stays.
--
-- One table cannot key to two patient populations, so production gets its own.
-- `assignment` keeps serving the staging surface — `pennsync_private.mutate`
-- grants it, `visible_patient` reads it, the import tool guards it — and this
-- is the same model for the patients the record store holds.
--
-- It carries no patient foreign key, and here that is the honest answer rather
-- than a concession: `pennsync_records` belongs to `pennsync_records_owner`, a
-- role this store's administrator deliberately is not, and a key across that
-- boundary would give the record owner a referential hold on authority rows.
-- The failure mode inverts safely — the record store's narrowing is a FILTER,
-- so an assignment naming a patient that does not exist admits no row.
--
-- The membership key stays, because a membership is this store's own row and
-- an assignment naming one that does not exist would name nobody.
begin;

do $$
begin
  if to_regclass('pennsync_private.membership') is null then
    raise exception using errcode='42501',message='PENNSYNC_AUTHORITY_STORE_REQUIRED';
  end if;
end $$;

-- The shape its sibling has TODAY, not the shape the first migration created:
-- `staging_app` was renamed `deployment_app` when the deployment pin replaced
-- the app-id literals, and `id` was added later for the visit-documentation
-- surface. The provenance trigger below reads `new.id`, so a table missing it
-- would fail on the first update rather than at creation.
create table pennsync_private.chart_assignment (
  app_id pennsync_private.deployment_app not null,
  id uuid not null default gen_random_uuid(),
  agency_id pennsync_private.identifier not null,
  -- A patient of record. Deliberately unkeyed: see the note above.
  patient_id pennsync_private.identifier not null,
  membership_id pennsync_private.identifier not null,
  status text not null check (status in ('active','revoked')),
  version pennsync_private.revision not null default 1,
  changed_by uuid not null,
  changed_at timestamptz not null default clock_timestamp(),
  primary key (app_id,patient_id,membership_id),
  unique (app_id,id),
  foreign key (app_id,agency_id,membership_id) references pennsync_private.membership(app_id,agency_id,id)
);

-- Same provenance rule as its sibling, and for the same reason: an assignment
-- records that a person was given access to a chart, so which person and which
-- chart can never be rewritten, and the row can never be deleted. Access is
-- withdrawn by setting `status`, which leaves the record of the grant intact.
create trigger provenance_immutable before update or delete on pennsync_private.chart_assignment
  for each row execute function pennsync_private.assignment_provenance_immutable();

alter table pennsync_private.chart_assignment enable row level security;
alter table pennsync_private.chart_assignment force row level security;
revoke all on pennsync_private.chart_assignment from public, anon, authenticated, service_role;

-- Forced RLS with no policy: nothing reaches this table directly. The record
-- store's `caller_assigned_patients()` reads it through a SECURITY DEFINER
-- helper owned by the migration administrator, exactly as it reads
-- `membership`, and the operator backfill writes it as that administrator.
-- A production grant path is not built here; the staging surface's own
-- `change_assignment` continues to serve `assignment` and is untouched.

commit;

