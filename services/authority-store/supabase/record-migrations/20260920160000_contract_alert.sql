-- Patient alerts: the read and the four transitions, in one contract family.
--
-- HAND WRITTEN, like every contract. Nothing here is extracted, because
-- neither original declares anything to extract: the read returns the whole
-- alert row and the write builds each transition's fields in code.
--
-- **The authorization these two originals share is the one D21 and D24 threw
-- out.** Both call `patientBelongsToCaller`, which is true when the caller's
-- address is the patient's `created_by` or appears in `Patient.assigned_nurses`
-- — the representation `listAuthorizedPatients` says in its own header is not
-- authority, and the one the D24 backfill refuses to read because an address
-- stays on the patient row after the assignment naming it was suspended.
-- Reading it again would resurrect access somebody revoked.
--
-- So the ported authorization is D24's, and it is not written here at all:
-- `patient_alert` reaches its tenancy through the chart it names, so its
-- policies already carry the tenant check AND the care-team narrowing. An
-- `agency_admin` or `manager` sees every chart's alerts in their agency, a
-- `clinician`, `social_worker` or `spiritual_care` worker sees the ones they
-- are assigned, and `office_staff` sees none.
--
-- DIVERGENCES from the originals, each a narrowing, each deliberate:
--
-- 1. The protected platform super-administrator is not admitted. In these two
--    it is an EXTRA grant on top of the patient check rather than the only
--    performer, so removing the tier D14 and D22 removed closes nothing.
-- 2. An alert on a chart the caller cannot open is absent rather than
--    forbidden. The original answers 403 for a chart that exists and is not
--    theirs and 404 for one that does not, which tells a caller the chart is
--    there; the read contracts beside this one already make those two
--    indistinguishable and so does this.
-- 3. A list is scoped to ONE agency — the one the caller is acting in — where
--    the original spans everything the caller could reach. Every contract in
--    the ported API takes the current agency, and a cross-tenant page is not
--    something a caller asked for.
-- 4. `acknowledged_by` is the normalized address from `caller_email()`. The
--    original stores `user.email` verbatim beside a normalized copy it just
--    computed, which is a difference nothing reads and a trap for anything
--    that later compares them.
begin;

do $$
begin
  if to_regclass('pennsync_records.patient_alert') is null
    or to_regprocedure('pennsync_records.caller_tenant_role(text)') is null then
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

set local role "pennsync_records_owner";

-- Every business column, named. The originals answer the whole row, and an
-- alert carries no locator and no free-text chart copy — but `source_app_id`
-- is the deployment's and is not a caller's to see, which is the one thing a
-- `select *` would have handed over.
create function "pennsync_records".alert_row(p "pennsync_records"."patient_alert")
  returns jsonb language sql stable set search_path = '' as $projection$
  select jsonb_build_object(
    'id', p."id",
    'created_date', p."created_date",
    'updated_date', p."updated_date",
    'created_by', p."created_by",
    'patient_id', p."patient_id",
    'alert_type', p."alert_type",
    'severity', p."severity",
    'title', p."title",
    'message', p."message",
    'description', p."description",
    'contributing_factors', p."contributing_factors",
    'recommended_actions', p."recommended_actions",
    'risk_score', p."risk_score",
    'data_sources', p."data_sources",
    'triggered_data', p."triggered_data",
    'triggered_by_rule_id', p."triggered_by_rule_id",
    'detected_date', p."detected_date",
    'status', p."status",
    'flagged_urgent', p."flagged_urgent" is true,
    'assigned_to', p."assigned_to",
    'acknowledged_by', p."acknowledged_by",
    'acknowledged_at', p."acknowledged_at",
    'resolution_notes', p."resolution_notes",
    'resolved_at', p."resolved_at",
    'expires_at', p."expires_at")
$projection$;

create function "pennsync_records".contract_alert_list(
  p_agency text, p_patient_id text, p_status text, p_severity text[], p_limit integer)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_role text; v_limit integer;
begin
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_ALERT_AGENCY_NOT_HELD';
  end if;
  if p_patient_id is not null and p_patient_id !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception using errcode='22023', message='PENNSYNC_ALERT_PATIENT_INVALID';
  end if;
  if p_status is not null and (p_status = '' or pg_catalog.length(p_status) > 100) then
    raise exception using errcode='22023', message='PENNSYNC_ALERT_STATUS_INVALID';
  end if;
  -- The original's MAX_SEVERITY_FILTERS, and its rule that an entry must be a
  -- usable string rather than being dropped.
  if p_severity is not null and (pg_catalog.array_length(p_severity, 1) > 20
    or exists (select 1 from pg_catalog.unnest(p_severity) s
      where s is null or s = '' or pg_catalog.length(s) > 100)) then
    raise exception using errcode='22023', message='PENNSYNC_ALERT_SEVERITY_INVALID';
  end if;
  -- The original's `parseLimit`: anything unusable becomes the default, and
  -- the ceiling is the ceiling.
  v_limit := case when p_limit is null or p_limit <= 0 then 100
    else least(p_limit, 500) end;

  -- Joined to the chart rather than filtered on an agency column, because an
  -- alert has none: `patient_alert` reaches its tenancy through `patient_id`,
  -- which is also what carries D24's narrowing into its policies.
  return jsonb_build_object('alerts', coalesce((
    select jsonb_agg("pennsync_records".alert_row(a) order by
      a."created_date" desc nulls last, a."id" desc)
    from (
      select a.* from "pennsync_records"."patient_alert" a
      join "pennsync_records"."patient" p
        on p."source_app_id" = a."source_app_id" and p."id" = a."patient_id"
      where a."source_app_id" = "pennsync_records".deployment_app()
        and p."agency_id" = p_agency
        and (p_patient_id is null or a."patient_id" = p_patient_id)
        and (p_status is null or a."status" = p_status)
        and (p_severity is null or pg_catalog.array_length(p_severity, 1) is null
          or a."severity" = any(p_severity))
      order by a."created_date" desc nulls last, a."id" desc
      limit v_limit) a), '[]'::jsonb));
end $contract$;

create function "pennsync_records".contract_alert_update(
  p_agency text, p_alert_id text, p_action text, p_resolution_notes text)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_role text; v_email text; v_alert "pennsync_records"."patient_alert";
  v_now timestamptz; v_written bigint;
begin
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_ALERT_AGENCY_NOT_HELD';
  end if;
  if p_alert_id is null or p_alert_id !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception using errcode='22023', message='PENNSYNC_ALERT_ID_INVALID';
  end if;
  if p_action is null
    or p_action not in ('acknowledge', 'resolve', 'dismiss', 'toggle_flagged_urgent') then
    raise exception using errcode='22023', message='PENNSYNC_ALERT_ACTION_INVALID';
  end if;
  -- The original accepts a note only on `resolve` and ignores it elsewhere.
  -- Refused rather than ignored, so a caller who sent one learns it did not
  -- take effect.
  if p_resolution_notes is not null then
    if p_action <> 'resolve' then
      raise exception using errcode='22023', message='PENNSYNC_ALERT_NOTES_UNEXPECTED';
    end if;
    if pg_catalog.length(p_resolution_notes) > 20000 then
      raise exception using errcode='22023', message='PENNSYNC_ALERT_NOTES_INVALID';
    end if;
  end if;

  v_email := "pennsync_records".caller_email();
  if v_email is null then
    raise exception using errcode='42501', message='PENNSYNC_ALERT_AGENCY_NOT_HELD';
  end if;

  -- Locked, and joined to the chart so the agency is the one the caller is
  -- acting in. D24 decides the chart through the policies; nothing here asks.
  select a.* into v_alert from "pennsync_records"."patient_alert" a
  where a."source_app_id" = "pennsync_records".deployment_app() and a."id" = p_alert_id
    and exists (select 1 from "pennsync_records"."patient" p
      where p."source_app_id" = a."source_app_id" and p."id" = a."patient_id"
        and p."agency_id" = p_agency)
  for update;
  if not found then
    raise exception using errcode='42501', message='PENNSYNC_ALERT_NOT_VISIBLE';
  end if;

  v_now := clock_timestamp();
  -- Each transition's fields are built here and never taken from the request,
  -- which is the original's own rule: this is a privileged write and a caller
  -- cannot pass `patient_id` or `severity` through it.
  if p_action = 'acknowledge' then
    update "pennsync_records"."patient_alert" a
      set "status" = 'acknowledged', "acknowledged_by" = v_email, "acknowledged_at" = v_now,
        "updated_date" = v_now
    where a."source_app_id" = v_alert."source_app_id" and a."id" = p_alert_id;
  elsif p_action = 'resolve' then
    update "pennsync_records"."patient_alert" a
      set "status" = 'resolved', "resolved_at" = v_now,
        -- An absent note keeps the one already there rather than clearing it.
        "resolution_notes" = coalesce(p_resolution_notes, a."resolution_notes", ''),
        "updated_date" = v_now
    where a."source_app_id" = v_alert."source_app_id" and a."id" = p_alert_id;
  elsif p_action = 'dismiss' then
    update "pennsync_records"."patient_alert" a
      set "status" = 'dismissed', "updated_date" = v_now
    where a."source_app_id" = v_alert."source_app_id" and a."id" = p_alert_id;
  else
    update "pennsync_records"."patient_alert" a
      set "flagged_urgent" = not (a."flagged_urgent" is true), "updated_date" = v_now
    where a."source_app_id" = v_alert."source_app_id" and a."id" = p_alert_id;
  end if;
  get diagnostics v_written = row_count;
  -- The row was locked above, so writing none of it means the UPDATE policy
  -- refused the result rather than that the row went away.
  if v_written <> 1 then
    raise exception using errcode='42501', message='PENNSYNC_ALERT_NOT_VISIBLE';
  end if;

  select a.* into v_alert from "pennsync_records"."patient_alert" a
  where a."source_app_id" = "pennsync_records".deployment_app() and a."id" = p_alert_id;
  return jsonb_build_object('alert', "pennsync_records".alert_row(v_alert));
end $contract$;

reset role;

revoke all on function
  "pennsync_records".alert_row("pennsync_records"."patient_alert"),
  "pennsync_records".contract_alert_list(text,text,text,text[],integer),
  "pennsync_records".contract_alert_update(text,text,text,text)
  from public, anon, authenticated, service_role;

grant execute on function
  "pennsync_records".contract_alert_list(text,text,text,text[],integer),
  "pennsync_records".contract_alert_update(text,text,text,text) to authenticated;

create function "public"."pennsync_contract_alert_list"(
  p_agency text, p_patient_id text, p_status text, p_severity text[], p_limit integer)
  returns jsonb language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_alert_list(
    p_agency, p_patient_id, p_status, p_severity, p_limit)
$contract$;

create function "public"."pennsync_contract_alert_update"(
  p_agency text, p_alert_id text, p_action text, p_resolution_notes text)
  returns jsonb language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_alert_update(p_agency, p_alert_id, p_action, p_resolution_notes)
$contract$;

revoke all on function
  "public"."pennsync_contract_alert_list"(text,text,text,text[],integer),
  "public"."pennsync_contract_alert_update"(text,text,text,text)
  from public, anon, authenticated, service_role;
grant execute on function
  "public"."pennsync_contract_alert_list"(text,text,text,text[],integer),
  "public"."pennsync_contract_alert_update"(text,text,text,text) to authenticated;

commit;
