-- The care-team assignment lifecycle, and the production grant path the
-- chart_assignment migration deliberately left unbuilt.
--
-- **Why this is being built now, and what it re-enables.**
-- `managePatientCareTeamAssignment` is paused at source: a module-level
-- `CARE_TEAM_ASSIGNMENT_MUTATIONS_ENABLED = false` refuses `grant`, `activate`,
-- `suspend` and `revoke` with a 503 before the handler reads anything. Its own
-- comment states the conditions:
--
--   "…no create-if-absent/unique constraint for assignment_key and no
--    multi-entity transaction spanning membership, Agency, Patient, and
--    assignment authority. Keep every assignment mutation unavailable until
--    those hosted guarantees and the authenticated concurrency matrix are
--    proved."
--
-- Those are Base44's limits, not the product's, and the owned store does not
-- have them. A unique constraint is a unique index here. The membership, the
-- agency, the chart and the assignment are four tables in ONE database, so the
-- transaction spanning them is an ordinary one. And "the authenticated
-- concurrency matrix" is a thing to prove rather than assert:
-- `record-contract-postgres.test.mjs` drives two real connections through every
-- transition pair and shows one winner and one stale-version refusal.
--
-- So this is not switching a paused capability back on against the pause. It is
-- meeting the conditions the pause was waiting for, and it is a decision worth
-- reverting as one commit if that reading is wrong: nothing else in the port
-- depends on it, and `claim_new_chart` keeps working without it.
--
-- **What changes about the table.** Three statuses instead of two, because the
-- original's lifecycle suspends before it revokes and a suspension is not a
-- revocation — `caller_assigned_patients` already admits only `active`, so a
-- suspended assignment closes the chart without destroying the record that the
-- person was once on it. And a transition trail: which action, why, when, and
-- the request key that makes a retry idempotent.
--
-- The provenance trigger is untouched and still refuses to let any of
-- `id, app_id, agency_id, patient_id, membership_id` change and refuses every
-- delete. Which person and which chart are still immutable; only the lifecycle
-- moves.
begin;

do $$
begin
  if to_regclass('pennsync_private.chart_assignment') is null then
    raise exception using errcode='42501',message='PENNSYNC_AUTHORITY_STORE_REQUIRED';
  end if;
end $$;

alter table pennsync_private.chart_assignment
  drop constraint chart_assignment_status_check;
alter table pennsync_private.chart_assignment
  add constraint chart_assignment_status_check
  check (status in ('active','suspended','revoked'));

-- `grant` is the truth for every row that exists before this migration: both
-- writers — `claim_new_chart` and the operator backfill — create an active
-- assignment and nothing has ever transitioned one.
alter table pennsync_private.chart_assignment
  add column last_action text not null default 'grant'
    check (last_action in ('grant','activate','suspend','revoke')),
  add column last_reason text,
  add column last_request_key text,
  add column granted_at timestamptz,
  add column suspended_at timestamptz,
  add column revoked_at timestamptz;
update pennsync_private.chart_assignment set granted_at = changed_at where granted_at is null;
-- Both defaults are load-bearing rather than tidy. `chart_assignment` has two
-- writers that predate this migration — `claim_new_chart` and the operator
-- backfill — and NEITHER names these columns; they insert an active row and
-- let the table fill the rest. Without the defaults the coherence check below
-- refuses every grant they make, which is not a theoretical reading: with
-- `granted_at` merely nullable, the shared test fixtures failed on their first
-- insert. The backfill above runs first so an assignment that already existed
-- keeps the moment it was actually made instead of the moment this applied.
alter table pennsync_private.chart_assignment
  alter column granted_at set default clock_timestamp(),
  alter column granted_at set not null;

-- The lifecycle, as a constraint rather than as a comment. The version parity
-- carries it the way the Base44 original's does: a grant is version 1, each
-- suspension is even, each reactivation is odd and at least 3, and a revocation
-- is terminal at any version above 1.
alter table pennsync_private.chart_assignment
  add constraint chart_assignment_lifecycle_coherent check (
    (last_action = 'grant' and status = 'active' and version = 1
      and granted_at is not null and suspended_at is null and revoked_at is null)
    or (last_action = 'suspend' and status = 'suspended' and version >= 2
      and version % 2 = 0 and suspended_at is not null and revoked_at is null)
    or (last_action = 'activate' and status = 'active' and version >= 3
      and version % 2 = 1 and suspended_at is not null and revoked_at is null)
    or (last_action = 'revoke' and status = 'revoked' and version >= 2
      and revoked_at is not null and last_reason is not null));

-- The idempotency the original says it does not have. The key already carries
-- the agency, the chart and the person, so one caller's request id can never
-- collide with another's, and a retry of the same transition finds the row it
-- already wrote rather than applying it twice.
create unique index chart_assignment_request_key
  on pennsync_private.chart_assignment (app_id, last_request_key)
  where last_request_key is not null;

commit;
