-- The cancel answer names the status it replaced.
--
-- WHY A CAPABILITY WAS MISSING A HALF WITHOUT ANYTHING FAILING.
-- `cancelTimeOffRequest`'s original notifies the manager when, and only when,
-- the request was `approved` BEFORE the cancellation — its own
-- `emailEligible` is `request.status === 'approved' && !!request.manager_email
-- && request.manager_email !== user.email`. Both halves of its notice sit
-- inside that one guard: the `Notification` row and the email. The ported
-- contract updates the row and answers with what it wrote, so the answer's
-- `status` is always `cancelled` and the first term of that condition is not
-- evaluable by any caller. The port therefore shipped with a constant
-- `delivery_paused: true` and told nobody anything, and no test could see it,
-- because every assertion the contract makes about the row it wrote is true.
--
-- WHAT THIS ADDS AND WHAT IT DELIBERATELY DOES NOT.
-- `previous_status` is a key on the ANSWER, beside `request`, and is not a
-- column and not a field of `time_off_row`. A row has no previous status; the
-- transaction that changed it does. Putting it in the projection would have
-- made every reader of a time-off row carry a field that is only ever
-- meaningful in one capability's answer, and `getApprovedTimeOff` and the
-- submit and review answers all share that projection.
--
-- IT IS THE STORE'S OWN READ, WHICH IS THE POINT.
-- The value comes from the row the contract has already locked `for update`,
-- so it is the status as the store held it at the moment of the change rather
-- than anything a caller supplied. A handler that took the prior status from
-- its own earlier read would be trusting a value that could have moved, and
-- the eligibility of a notice is exactly the kind of decision that must not
-- rest on a stale read.
--
-- WHY A FORWARD FILE AND NOT AN EDIT.
-- D88: `planMigration` matches on a migration's NAME and the ledger holds no
-- content hash, so an edited `20260920230000_contract_time_off.sql` is skipped
-- forever on every store that has already run it. Editing it would have put
-- the new behaviour in every fresh build and in no deployment, with every
-- suite green — the shape D82's `user_update` policy was found in. So the
-- original file is untouched and this replaces the one function.
--
-- WHAT IS UNCHANGED, AND THE GRANTS.
-- Every authorization line below is the original's, character for character:
-- the tenant role, the subject pattern, the ownership-or-`agency_admin` check
-- that D36 makes the contract's own because tenancy is not ownership here, and
-- the transition guard. The signature does not move, so the public wrapper,
-- `service-rpc-signatures.test.mjs`'s pinned request body and the ladder's
-- reach all stay as they are. `create or replace` keeps the existing grants on
-- this function, and the revoke and grant are restated anyway because a
-- replace is the one operation where a reader cannot tell from the file
-- whether they survived.

begin;

set local role "pennsync_records_owner";

create or replace function "pennsync_records".contract_time_off_cancel(
  p_agency text, p_request_id text)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_row "pennsync_records"."time_off_request"; v_email text; v_role text;
  v_previous text;
begin
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_TIME_OFF_AGENCY_NOT_HELD';
  end if;
  if p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception using errcode='22023', message='PENNSYNC_TIME_OFF_SUBJECT_INVALID';
  end if;
  v_email := "pennsync_records".caller_email();
  -- Read under the policies, which already scope this to the caller's agency,
  -- so the original's "re-read the employee and compare agency_name" step has
  -- nothing left to do.
  select * into v_row from "pennsync_records"."time_off_request" r
  where r."source_app_id" = "pennsync_records".deployment_app()
    and r."id" = p_request_id and r."agency_id" = p_agency
  for update;
  if not found then
    raise exception using errcode='42501', message='PENNSYNC_TIME_OFF_NOT_FOUND';
  end if;
  -- Yours, or an administrator's to cancel. Tenancy is not ownership here
  -- (D36), so the ownership half is the contract's.
  if not (pg_catalog.lower(coalesce(v_row."employee_email", '')) = pg_catalog.lower(v_email)
      or pg_catalog.lower(coalesce(v_row."created_by", '')) = pg_catalog.lower(v_email)
      or v_role = 'agency_admin') then
    raise exception using errcode='42501', message='PENNSYNC_TIME_OFF_FORBIDDEN';
  end if;
  if v_row."status" is distinct from 'pending' and v_row."status" is distinct from 'approved' then
    raise exception using errcode='22023', message='PENNSYNC_TIME_OFF_TRANSITION';
  end if;
  -- The one addition: the locked row's status, taken before the update
  -- overwrites it. The transition guard above has already narrowed it to
  -- `pending` or `approved`, so the answer can carry only those two values.
  v_previous := v_row."status";
  update "pennsync_records"."time_off_request" r
    set "status" = 'cancelled', "updated_date" = clock_timestamp()
  where r."source_app_id" = v_row."source_app_id" and r."id" = v_row."id"
  returning * into v_row;
  return jsonb_build_object('success', true, 'previous_status', v_previous,
    'request', "pennsync_records".time_off_row(v_row));
end $contract$;

reset role;

revoke all on function "pennsync_records".contract_time_off_cancel(text,text)
  from public, anon, authenticated, service_role;
grant execute on function "pennsync_records".contract_time_off_cancel(text,text)
  to authenticated;

commit;
