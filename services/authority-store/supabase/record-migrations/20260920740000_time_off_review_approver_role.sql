-- A leave request's named approver has to still hold the role, not just the address.
--
-- The sibling of `20260920730000_timesheet_review_approver_role.sql`, one
-- capability over and the same line. `contract_time_off_review` admits an
-- `agency_admin`, OR anybody whose address equals the request's stored
-- `manager_email`. The second leg re-reads NOTHING about that person, and
-- `manager_email` is a SNAPSHOT: `contract_time_off_submit` validated the
-- nominee's role authoritatively when the request was filed
-- (`20260920230000_contract_time_off.sql` — `pennsync_private.agency_colleague`
-- by address, refused `PENNSYNC_TIME_OFF_APPROVER_INVALID` unless their
-- `tenant_role` is `agency_admin` or `manager`), and nothing asks again when the
-- request is actually decided.
--
-- WHY THIS IS ITS OWN CHANGE rather than a line folded into the timesheet's. It
-- is a different capability with its own contract, its own refusal codes and its
-- own suite, and a reviewer of either should be able to see what it does without
-- reading the other. The reasoning behind it is NOT re-derived here, though: it
-- was done on the timesheet, verified there, and the point of writing this one
-- is that a defence which lives only where somebody happened to be looking is
-- not a defence. What is re-measured here rather than assumed is everything
-- specific to THIS contract, because the two are not identical and the
-- differences are in the gate itself.
--
-- WHAT IS LEFT OPEN, measured rather than inferred, because most of the obvious
-- answers are already closed and naming them as holes would overstate this
-- change. `caller_tenant_role` filters `m.status = 'active' and m.revoked_at is
-- null` and `a.status in ('active','trial')`, and the contract's FIRST check
-- refuses `PENNSYNC_TIME_OFF_AGENCY_NOT_HELD` when it answers null. So a REVOKED
-- membership, a SUSPENDED one and a deactivated agency are shut already, and a
-- revoked person has no caller identity at all (`pennsync_private.actor` admits
-- one only while `enabled and revoked_at is null`), so `caller_email()` is null
-- and the address leg cannot match either.
--
-- What is left is DEMOTION, alone: an active membership in the same agency whose
-- `tenant_role` has moved off the two the submit admits. It is reachable through
-- the product rather than only by hand — `change_role` is one of the five actions
-- `20260920200000_contract_membership.sql` serves, held by an `agency_admin` — so
-- an administrator can take somebody off the approver roles and every leave
-- request already naming them stays theirs to decide.
--
-- That is D33's shape with the piece D33 could not reach. A SUSPENDED membership
-- closes a chart with no helper change, because `caller_assigned_patients`
-- filters `status = 'active'`; a role CHANGE is not a status change, so nothing
-- filters on it and this gate asked about an address instead.
--
-- NO ESCALATION STORY, and that is worth stating because the timesheet's first
-- draft had one and it was wrong. A person cannot self-assert their way onto a
-- request: the submit resolves the nominee through `agency_colleague`, which
-- reads `pennsync_private.membership` and `identity_map`, not the carried
-- profile row — so `is_manager`, `account_type` and `agency_name` reach
-- `manager_email` on neither path. The dropdown that offered them is still wrong
-- and is fixed in this change, but as a CORRECTNESS defect: it offers people the
-- submit will refuse. That is D69's rule from the other side — read what the
-- code can REACH, not what it appears to offer.
--
-- TWO DIFFERENCES FROM THE TIMESHEET'S GATE, both in the line being changed, so
-- neither is inherited by reading the sibling. This contract's second leg already
-- guards `coalesce(v_row."manager_email", '') <> ''`, which the timesheet's does
-- not, and it lowercases BOTH sides where the timesheet's compares against an
-- already-lowercased `caller_email()`. Both are kept exactly as the original has
-- them. The empty-string guard is not made redundant by the role conjunct and is
-- not removed: `caller_email()` cannot be the empty string for a caller with an
-- identity, but that is a property of a helper rather than of this line, and the
-- original is entitled to defend itself against its own column.
--
-- THE REDUCTION, recorded rather than left to be discovered. A person named on a
-- request who no longer holds `agency_admin` or `manager` in that agency is
-- refused from here on. Every approver the submit accepted held one of those
-- roles at the time, so nobody loses a capability they were ever authorized to
-- have — what they lose is one that outlived the authorization. Whether any real
-- person is in that position is NOT measurable from this tree, because we hold no
-- credential for that store.
--
-- TIMING, which is why there is no sweep. The role is read at DECISION time, from
-- live membership, so a row already naming a demoted approver stops being
-- decidable by them the moment this lands. Nothing walks the existing rows,
-- nothing rewrites one, and rows nobody has looked at are closed on the same
-- terms as the ones we found. The row keeps its address; what changed is that the
-- address is no longer the whole question.
--
-- SCOPE: this changes the OWNED store. The Base44 function keeps its own gate
-- until the cutover, and this repository cannot deploy it — the Deno functions are
-- a hosted service with no local runner. The frontend half lands on both paths and
-- is described at its own call site.
--
-- A FORWARD MIGRATION (D88), because `20260920230000_contract_time_off.sql` has
-- been applied: `planMigration` matches on a migration's NAME and the ledger holds
-- no content hash, so editing that file would reach a new store and no store that
-- already ran it.
--
-- `create or replace` is sufficient and is the whole mechanism. The signature does
-- not move, so the function keeps its owner and its ACL, and the public wrapper
-- `pennsync_contract_time_off_review` resolves it by name and is untouched. The
-- `revoke` block in the original file therefore still holds and nothing is
-- re-granted here; a test reads the catalog and proves it rather than asserting it.
--
-- NOT RETYPED. The body below is LIFTED from the migration named above with one
-- substitution — the second leg's condition, and the comment that explains it —
-- because retyping a contract of this size to change one conjunct is the
-- transcription D12 settled against, and every line retyped is a place this could
-- drift quietly. `contract-time-off-review-approver.test.mjs` re-derives this file
-- from that one and fails unless exactly ONE contiguous region differs, so the
-- lift is checked rather than claimed. No line count is quoted here on purpose:
-- a figure in a comment that nothing derives is the shape this repository keeps
-- finding stale, and the test is what reads the body.

begin;

set local role "pennsync_records_owner";

create or replace function "pennsync_records".contract_time_off_review(
  p_agency text, p_request_id text, p_decision text, p_note text)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_row "pennsync_records"."time_off_request"; v_email text; v_role text;
begin
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_TIME_OFF_AGENCY_NOT_HELD';
  end if;
  if p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception using errcode='22023', message='PENNSYNC_TIME_OFF_SUBJECT_INVALID';
  end if;
  if p_decision is null or p_decision not in ('approved', 'denied') then
    raise exception using errcode='22023', message='PENNSYNC_TIME_OFF_DECISION_INVALID';
  end if;
  v_email := "pennsync_records".caller_email();
  select * into v_row from "pennsync_records"."time_off_request" r
  where r."source_app_id" = "pennsync_records".deployment_app()
    and r."id" = p_request_id and r."agency_id" = p_agency
  for update;
  if not found then
    raise exception using errcode='42501', message='PENNSYNC_TIME_OFF_NOT_FOUND';
  end if;
  -- An `agency_admin`, or the manager this request actually named AND who still
  -- holds that role. A `manager` who was not named does not review it — the
  -- original's `isAssignedManager` is an address match on the request, not a
  -- role — and somebody who WAS named and has since been demoted does not
  -- either, which is the whole of this forward file. The address alone was the
  -- second leg's entire question, and an address does not expire.
  if not (v_role = 'agency_admin'
      or (v_role = 'manager'
        and coalesce(v_row."manager_email", '') <> ''
        and pg_catalog.lower(v_row."manager_email") = pg_catalog.lower(v_email))) then
    raise exception using errcode='42501', message='PENNSYNC_TIME_OFF_FORBIDDEN';
  end if;
  -- Never your own, whatever your role. An administrator who could approve
  -- their own leave is the whole reason this check exists.
  if pg_catalog.lower(coalesce(v_row."employee_email", '')) = pg_catalog.lower(v_email)
    or pg_catalog.lower(coalesce(v_row."created_by", '')) = pg_catalog.lower(v_email) then
    raise exception using errcode='42501', message='PENNSYNC_TIME_OFF_SELF';
  end if;
  if v_row."status" is distinct from 'pending' then
    raise exception using errcode='22023', message='PENNSYNC_TIME_OFF_TRANSITION';
  end if;
  update "pennsync_records"."time_off_request" r set
    "status" = p_decision,
    "reviewed_by" = v_email,
    "reviewer_name" = v_email, -- divergence 5: no carried name column exists
    "reviewed_at" = clock_timestamp(),
    "review_notes" = pg_catalog.left(coalesce(p_note, ''), 2000),
    "updated_date" = clock_timestamp()
  where r."source_app_id" = v_row."source_app_id" and r."id" = v_row."id"
  returning * into v_row;
  return jsonb_build_object('success', true, 'request',
    "pennsync_records".time_off_row(v_row));
end $contract$;

reset role;

commit;
