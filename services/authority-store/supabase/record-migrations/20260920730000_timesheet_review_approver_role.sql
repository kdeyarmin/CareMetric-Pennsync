-- A timesheet's named approver has to still hold the role, not just the address.
--
-- `contract_timesheet_review` admits an `agency_admin`, OR anybody whose address
-- equals the sheet's stored `manager_email`. The second leg re-reads NOTHING
-- about that person, and `manager_email` is a SNAPSHOT: the submit validated the
-- nominee's role authoritatively at the time the sheet was sent
-- (`20260920360000_contract_timesheet.sql`, Divergence 4 — `agency_roster(p_agency)`
-- by address, refused unless `tenant_role in ('agency_admin','manager')`), and
-- nothing asks again when the sheet is actually reviewed.
--
-- WHAT IS LEFT OPEN BY THAT, measured rather than inferred, because most of the
-- obvious answers are already closed and naming them as holes would overstate
-- this change. `caller_tenant_role` filters `m.status = 'active' and
-- m.revoked_at is null` and `a.status in ('active','trial')`, and the contract's
-- FIRST check refuses `PENNSYNC_TIMESHEET_AGENCY_NOT_HELD` when it answers null.
-- So a REVOKED membership, a SUSPENDED one and a deactivated agency are all shut
-- already, and a revoked person has no caller identity at all
-- (`pennsync_private.actor` admits one only while `enabled and revoked_at is
-- null`), so `caller_email()` is null and the address leg cannot match either.
--
-- What is left is DEMOTION, alone: an active membership in the same agency whose
-- `tenant_role` has moved off the two the submit admits. It is reachable through
-- the product rather than only by hand — `change_role` is one of the five actions
-- `20260920200000_contract_membership.sql` serves, held by an `agency_admin` — so
-- an administrator can take somebody off the approver roles and every timesheet
-- already naming them stays theirs to approve.
--
-- That is D33's shape with the piece D33 could not reach. A SUSPENDED membership
-- closes a chart with no helper change, because `caller_assigned_patients`
-- filters `status = 'active'`; a role CHANGE is not a status change, so nothing
-- filters on it, and this gate asks about an address instead. A store where a
-- suspension closes a chart and a demotion leaves payroll approvable is not
-- consistent with itself.
--
-- THE ORIGINAL ARGUMENT FOR THIS CHANGE WAS WRONG, and the record of that is
-- part of the change. It claimed a live privilege-escalation path: that a person
-- could self-assert `is_manager` or `account_type` on their own profile, appear
-- in a colleague's "Send to approver" dropdown, and be admitted here with no role
-- check in between. The load-bearing step does not exist. BOTH submits validate
-- the NOMINEE authoritatively — the owned store through
-- `agency_roster(p_agency).tenant_role`, and the Base44 original by applying
-- `withTrustedClaims` to the candidate row it matched — so a self-asserted label
-- never reaches `manager_email` at all. The dropdown is still wrong, and is fixed
-- in this change, but as a CORRECTNESS defect: it offers people the submit will
-- refuse.
--
-- How that was got wrong is worth more than the conclusion. The review gate was
-- read, the dropdown was read, and the two were joined — without reading the
-- capability that WRITES the field they share. D45 is usually stated about tests:
-- a capability that writes a row another capability reads is not proved by either
-- suite alone. It is not a rule about tests. Reading the reader and the writer
-- separately and joining them is the same mistake as testing them separately and
-- declaring the pair sound.
--
-- THE REDUCTION, recorded rather than left to be discovered, and smaller than the
-- first version of this header claimed. A person named on a sheet who no longer
-- holds `agency_admin` or `manager` in that agency is refused from here on. Every
-- approver the submit accepted held one of those roles at the time, so nobody
-- loses a capability they were ever authorized to have — what they lose is a
-- capability that outlived the authorization. Whether any real person is in that
-- position is NOT measurable from this tree, because we hold no credential for
-- that store.
--
-- TIMING, which is why there is no sweep. The role is read at REVIEW time, from
-- live membership, so a row already naming a demoted approver stops being
-- reviewable by them the moment this lands. Nothing walks the existing rows,
-- nothing rewrites one, and rows nobody has looked at are closed on the same
-- terms as the ones we found. The row keeps its address; what changed is that the
-- address is no longer the whole question.
--
-- SCOPE: this changes the OWNED store. The Base44 function keeps its own gate
-- until the cutover, and this repository cannot deploy it — the Deno functions are
-- a hosted service with no local runner. The frontend half lands on both paths and
-- is described at its own call site.
--
-- D88: a FORWARD migration, because `20260920360000_contract_timesheet.sql` has
-- been applied and an edit to it would reach no store that ran it.
--
-- `create or replace` rather than drop-and-create, because the signature does not
-- move: the function keeps its owner and its ACL, and
-- `public.pennsync_contract_timesheet_review` resolves it by name, so the wrapper
-- and its grant are untouched.
--
-- NOT RETYPED. The body below is LIFTED from the migration named above with one
-- substitution — the three-line gate for the longer one — because retyping a
-- seventy-line contract to change one condition is the transcription D12 settled
-- against, and every line retyped is a place this could drift quietly.
-- `contract-timesheet-review-approver.test.mjs` re-derives this file from that one
-- and fails if they stop agreeing, so the lift is checked rather than claimed.

begin;

set local role "pennsync_records_owner";

create or replace function "pennsync_records".contract_timesheet_review(
  p_agency text, p_timesheet_id text, p_decision text, p_note text)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_row "pennsync_records"."timesheet"; v_role text; v_email text; v_now timestamptz;
  v_owner record; v_note text; v_id text;
begin
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_TIMESHEET_AGENCY_NOT_HELD';
  end if;
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception using errcode='22023', message='PENNSYNC_TIMESHEET_DECISION_INVALID';
  end if;
  if p_timesheet_id is null or p_timesheet_id !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception using errcode='22023', message='PENNSYNC_TIMESHEET_SUBJECT_INVALID';
  end if;
  v_email := "pennsync_records".caller_email();

  select * into v_row from "pennsync_records"."timesheet" t
  where t."source_app_id" = "pennsync_records".deployment_app()
    and t."id" = p_timesheet_id and t."agency_id" = p_agency for update;
  if not found then
    raise exception using errcode='42501', message='PENNSYNC_TIMESHEET_NOT_FOUND';
  end if;
  -- Divergence 5, NARROWED. An administrator of THIS agency, or the sheet's own
  -- assigned approver PROVIDED they hold an authoritative manager role in it.
  --
  -- `v_role` is `caller_tenant_role(p_agency)` and the sheet above was loaded
  -- with `agency_id = p_agency`, so the role is read in the agency the SHEET
  -- belongs to rather than anywhere the caller happens to hold one. That is the
  -- distinction a one-conjunct fix drops: a caller holding `manager` in a second
  -- agency is not this sheet's approver, and reading the role without the agency
  -- would make them one.
  --
  -- A named `agency_admin` is admitted by the first conjunct, which is why the
  -- second names only `manager`. The pair is therefore exactly the role set the
  -- submit validated the nominee against, re-asked at review time — which is the
  -- whole of this change.
  --
  -- `v_email is not null` CANNOT fire today, and is kept deliberately. The
  -- condition is INVERTED — `if not (...)` — so a null makes it null and
  -- `if not (null)` does not raise, which would admit rather than refuse. What
  -- makes it unreachable is two steps away from this file: `v_role` is non-null
  -- only when `caller_identity()` resolved to an `identity_map` row, and that
  -- table's `expected_email` is `not null`, so `caller_email()` is non-null
  -- wherever `v_role` is. Sabotaging this conjunct therefore fails NO test, and
  -- the suite pins the REASON instead — the column's nullability — so that if the
  -- premise ever moves, somebody is told rather than the guard quietly becoming
  -- the only thing holding.
  if not (v_role = 'agency_admin'
    or (v_role = 'manager' and v_email is not null
      and pg_catalog.lower(coalesce(v_row."manager_email", '')) = v_email)) then
    raise exception using errcode='42501', message='PENNSYNC_TIMESHEET_REVIEW_FORBIDDEN';
  end if;
  -- Never your own, even as an administrator. Both originals refuse this.
  if pg_catalog.lower(coalesce(v_row."employee_email", '')) = v_email
    or pg_catalog.lower(coalesce(v_row."created_by", '')) = v_email then
    raise exception using errcode='42501', message='PENNSYNC_TIMESHEET_REVIEW_SELF';
  end if;
  if v_row."status" is distinct from 'submitted' then
    raise exception using errcode='22023', message='PENNSYNC_TIMESHEET_NOT_AWAITING_REVIEW';
  end if;

  v_now := clock_timestamp();
  v_note := pg_catalog.left(coalesce(p_note, ''), 2000);
  update "pennsync_records"."timesheet" t set
    "status" = p_decision, "reviewed_by" = v_email, "reviewer_name" = v_email,
    "reviewed_at" = v_now, "review_notes" = v_note, "updated_date" = v_now
  where t."source_app_id" = v_row."source_app_id" and t."id" = v_row."id"
  returning * into v_row;

  -- The employee is told the outcome, through the facility (D48).
  select r.base44_user_id, r.expected_email, r.membership_id, r.membership_version
  into v_owner from pennsync_private.agency_roster(p_agency) r
  where r.expected_email = pg_catalog.lower(coalesce(v_row."employee_email", ''));
  if v_owner.base44_user_id is not null then
    v_id := "pennsync_records".notification_mint(
      p_agency, v_owner.base44_user_id, v_owner.expected_email,
      v_owner.membership_id, v_owner.membership_version,
      case when p_decision = 'approved' then 'Timesheet approved'
        else 'Timesheet needs changes' end,
      'Your timesheet for ' || pg_catalog.to_char(v_row."pay_period_start", 'YYYY-MM-DD')
        || ' → ' || pg_catalog.to_char(v_row."pay_period_end", 'YYYY-MM-DD')
        || ' was ' || p_decision
        || case when pg_catalog.btrim(v_note) <> '' then ': ' || v_note else '.' end,
      case when p_decision = 'approved' then 'info' else 'compliance_alert' end,
      'medium', '/Timesheets', 'View timesheet',
      jsonb_build_object('timesheet_id', v_row."id", 'reviewed_by', v_email),
      'timesheet-review:' || v_row."id" || ':'
        || pg_catalog.to_char(v_now, 'YYYY-MM-DD"T"HH24:MI:SS.US'));
  end if;

  return jsonb_build_object('success', true, 'decision', p_decision,
    'timesheet', "pennsync_records".timesheet_row(v_row),
    'notification_id', v_id, 'notified', case when v_id is null then 0 else 1 end,
    'delivery_paused', true);
end $contract$;

reset role;

commit;
