-- An assignment may name a patient this store does not hold (D24).
--
-- D24 makes `pennsync_private.assignment` the authority on who may open a
-- chart. It could not be, and the reason was three constraints deep:
--
--   1. `assignment` has a foreign key to `pennsync_private.patient`;
--   2. that table's `display_name` must be `like 'Synthetic %'`;
--   3. its `synthetic` column carries `check (synthetic)`, so it can never be
--      false.
--
-- Together those mean an assignment can only ever name a SYNTHETIC patient.
-- The patients of record live in `pennsync_records.patient`, so the backfill
-- D24 requires could not have written a single row, and the first person to
-- notice would have been whoever ran it at cutover.
--
-- The foreign key is what goes, and the reasoning is already written down in
-- this store — the disclosure-audit tables beside it carry it verbatim:
-- "Deliberately no patient FK: immutable disclosure provenance must survive
-- source lifecycle changes and must not create a cascading patient-delete
-- path." An assignment IS disclosure provenance. It records that a person was
-- given access to a chart, and that record must outlive the chart.
--
-- Two further reasons this is the right direction rather than the convenient
-- one:
--
-- - **The stores are separately owned.** `pennsync_records` belongs to
--   `pennsync_records_owner`, a role the authority store's administrator is
--   deliberately not. A foreign key across that boundary would give the record
--   owner a referential hold on authority rows, which is the coupling the two
--   schemas exist to avoid.
-- - **The failure mode inverts safely.** Without the key, an assignment may
--   name an identifier no patient has. That grants access to nothing: the
--   record store's narrowing is a FILTER, so an assignment matching no row
--   admits no row. An assignment that cannot be written, by contrast, denies a
--   clinician their own patients.
--
-- What does NOT change: the staging mutation path. `pennsync_private.mutate`
-- already looks the patient up itself and raises `PENNSYNC_PATIENT_DENIED`
-- when it is absent, so every grant made through `change_assignment` still
-- requires a patient this store holds. The key was a second copy of a check
-- that was already there, and only the copy could not tell a real patient from
-- a synthetic one.
begin;

do $$
begin
  if to_regclass('pennsync_private.assignment') is null then
    raise exception using errcode='42501',message='PENNSYNC_AUTHORITY_STORE_REQUIRED';
  end if;
end $$;

alter table pennsync_private.assignment
  drop constraint if exists assignment_app_id_agency_id_patient_id_fkey;

-- The membership key stays. A membership is this store's own row, in this
-- store's own schema, and an assignment naming a membership that does not
-- exist would name nobody — which is a different failure from naming a patient
-- held elsewhere.
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'pennsync_private.assignment'::regclass and contype = 'f'
      and conname = 'assignment_app_id_agency_id_membership_id_fkey') then
    raise exception using errcode='23514',message='PENNSYNC_ASSIGNMENT_MEMBERSHIP_KEY_REQUIRED';
  end if;
  if exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'pennsync_private.assignment'::regclass and contype = 'f'
      and confrelid = 'pennsync_private.patient'::regclass) then
    raise exception using errcode='23514',message='PENNSYNC_ASSIGNMENT_PATIENT_KEY_PRESENT';
  end if;
end $$;

commit;
