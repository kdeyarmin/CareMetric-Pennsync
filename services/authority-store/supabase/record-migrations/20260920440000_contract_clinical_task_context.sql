-- The chart a model reads to suggest clinical tasks.
--
-- HAND WRITTEN, like every contract, and a READ with nothing behind it (D64):
-- `analyzeAndGenerateClinicalTasks` suggests tasks and returns them. It creates
-- none. The name says "generate", and a reader who took that for a write would
-- go looking for a write contract that should not exist.
--
-- DIVERGENCES from the original, each deliberate:
--
-- 1. The chart decides, and `Deno.env.get('SUPER_ADMIN_EMAIL')` is gone — the
--    platform tier D14 and D22 removed, and the second capability whose only
--    brush with a secret was that comparison (D63 was the first).
-- 2. **The patient half is the `smart_note_context` projection** (D62), and
--    every other column that reaches the prompt is NAMED (D64). `visit`
--    carries far more than the four fields the original maps, and a contract
--    returning the row would hand all of it to a model.
-- 3. **Two service-role compensations are deleted.** The original fetches the
--    patient with a limit of TWO and refuses if it gets two rows or a row
--    whose id is not the one it asked for, and then re-checks that every
--    visit, alert and task it loaded really names that patient. Both exist
--    because a service-role filter is not proof; here `id` is half the primary
--    key and the predicate is the contract's own.
-- 4. The note excerpt is cut in SQL, so the other nine hundred characters of a
--    nurse's note never leave the store to be truncated in a service.
--
-- NOT DIVERGED. The original's page sizes and orders are kept for D64's
-- reason: they bound what goes into a PROMPT. Its `due_timeframe` mapping is
-- kept as it is, case-sensitivity included, and is NOT normalised the way D63
-- normalises one — D63's rule exists because a stored column and its stored
-- date could disagree, and nothing here is stored.
begin;

do $$
begin
  if to_regclass('pennsync_records.patient_alert') is null
    or to_regprocedure('pennsync_records.agency_today()') is null
    or to_regprocedure('pennsync_records.patient_exact_purpose_row('
      || 'text,pennsync_records.patient)') is null then
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

create function "pennsync_records".contract_clinical_task_context(
  p_agency text, p_patient_id text)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_role text; v_patient "pennsync_records"."patient"; v_row jsonb;
  v_visits jsonb; v_alerts jsonb; v_tasks jsonb;
begin
  -- Divergence 1: membership, then the chart, and no environment read.
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_TASK_CONTEXT_AGENCY_NOT_HELD';
  end if;
  if p_patient_id is null or p_patient_id !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception using errcode='22023', message='PENNSYNC_TASK_CONTEXT_SUBJECT_INVALID';
  end if;
  if not "pennsync_records".patient_exact_purpose_admits('smart_note_context', v_role) then
    raise exception using errcode='42501', message='PENNSYNC_TASK_CONTEXT_PURPOSE_FORBIDDEN';
  end if;
  -- Divergence 3: `id` is half the primary key, so there is no second row to
  -- disambiguate and no lookup to re-verify.
  select p.* into v_patient from "pennsync_records"."patient" p
  where p."source_app_id" = "pennsync_records".deployment_app()
    and p."id" = p_patient_id and p."agency_id" = p_agency;
  if v_patient."id" is null then
    raise exception using errcode='42501', message='PENNSYNC_TASK_CONTEXT_PATIENT_NOT_VISIBLE';
  end if;
  v_row := "pennsync_records".patient_exact_purpose_row('smart_note_context', v_patient);

  -- Divergences 2 and 4: the four fields the original maps, with the note cut
  -- to the length it cuts it to, here rather than after it has been sent.
  select coalesce(jsonb_agg(jsonb_build_object(
      'date', v."visit_date", 'type', v."visit_type",
      'notes', pg_catalog.substr(v."nurse_notes", 1, 300),
      'vitals', v."vital_signs")
    order by v."visit_date" desc nulls last, v."id"), '[]'::jsonb) into v_visits
  from (select t.* from "pennsync_records"."visit" t
    where t."source_app_id" = "pennsync_records".deployment_app()
      and t."patient_id" = p_patient_id
    order by t."visit_date" desc nulls last, t."id" limit 5) v;

  select coalesce(jsonb_agg(jsonb_build_object(
      'type', a."alert_type", 'severity', a."severity",
      'message', a."message", 'created', a."created_date")
    order by a."created_date" desc nulls last, a."id"), '[]'::jsonb) into v_alerts
  from (select t.* from "pennsync_records"."patient_alert" t
    where t."source_app_id" = "pennsync_records".deployment_app()
      and t."patient_id" = p_patient_id and t."status" = 'active'
    order by t."created_date" desc nulls last, t."id" limit 5000) a;

  select coalesce(jsonb_agg(jsonb_build_object(
      'title', t."title", 'type', t."type",
      'priority', t."priority", 'due_date', t."due_date")
    order by t."due_date" nulls last, t."id"), '[]'::jsonb) into v_tasks
  from (select k.* from "pennsync_records"."task" k
    where k."source_app_id" = "pennsync_records".deployment_app()
      and k."patient_id" = p_patient_id
      and k."status" in ('pending', 'in_progress')
    order by k."due_date" nulls last, k."id" limit 5000) t;

  return jsonb_build_object('success', true,
    'today', pg_catalog.to_char("pennsync_records".agency_today(), 'YYYY-MM-DD'),
    'patient', jsonb_build_object(
      'id', v_row -> 'id',
      'patient_name', pg_catalog.btrim(pg_catalog.concat_ws(' ',
        v_row ->> 'first_name', v_row ->> 'last_name')),
      'primary_diagnosis', v_row -> 'primary_diagnosis',
      'secondary_diagnoses', v_row -> 'secondary_diagnoses',
      'current_medications', v_row -> 'current_medications',
      'allergies', v_row -> 'allergies'),
    'visits', v_visits, 'alerts', v_alerts, 'tasks', v_tasks);
end $contract$;

reset role;

revoke all on function "pennsync_records".contract_clinical_task_context(text,text)
  from public, anon, authenticated, service_role;
grant execute on function "pennsync_records".contract_clinical_task_context(text,text)
  to authenticated;

create function "public"."pennsync_contract_clinical_task_context"(
  p_agency text, p_patient_id text) returns jsonb
  language sql security invoker set search_path = '' as $c$
  select "pennsync_records".contract_clinical_task_context(p_agency, p_patient_id)
$c$;
revoke all on function "public"."pennsync_contract_clinical_task_context"(text,text)
  from public, anon, authenticated, service_role;
grant execute on function "public"."pennsync_contract_clinical_task_context"(text,text)
  to authenticated;

commit;
