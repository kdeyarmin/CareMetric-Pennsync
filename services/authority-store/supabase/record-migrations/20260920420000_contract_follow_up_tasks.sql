-- Recording the follow-up tasks a finalized note implies.
--
-- HAND WRITTEN, like every contract, and the same three-part shape D58 and D62
-- use: a read contract that authorizes the chart and hands back only what a
-- read purpose discloses, a brokered model call, and a write contract that
-- does the whole of the write in ONE transaction.
--
-- **It is also the second capability D61 unblocked.** These tasks are `Task`
-- rows, and until the table carried its own `agency_id` its tenancy was its
-- OPTIONAL `patient_id`. This capability always names one, so its rows were
-- reachable; the reorder task D58 found was not.
--
-- DIVERGENCES from the original, each deliberate:
--
-- 1. The chart decides. The original reads `created_by` and `assigned_nurses`
--    off the patient row (D21, D24), and admits a `SUPER_ADMIN_EMAIL` read
--    from the environment on top — the platform tier D14 and D22 removed, and
--    the only reason this capability was ever counted against a secret.
-- 2. **The patient context is the `smart_note_context` projection**, as D62
--    settled: a prompt may carry what a read purpose discloses and nothing
--    else, and the purpose's own role gate is the gate.
-- 3. **`followup_tasks_claimed_by` is gone.** The original writes a claim token
--    to the visit, reads it back, and treats a mismatch as a concurrent run —
--    a compensation for having no transaction, and a racy one. The write
--    contract locks the visit row and refuses if an `ai_generated` task
--    already names it, so the second run is a no-op with no token to lose
--    (D46, D58).
-- 4. **A value the MODEL supplies is checked against the column's own enum**
--    and an unrecognised one falls back to the same default an absent one
--    takes (D54). `task` constrains `type`, `priority` and `due_timeframe`;
--    the original writes the model's words straight through, so one plausible
--    but unlisted answer raises a check violation inside a `Promise.all` and
--    loses every task in the batch. The due date follows the STORED value
--    rather than the raw one, so a task marked `TODAY` is due today instead of
--    being stored as an invalid `TODAY` due in three days.
-- 5. A task with no title is skipped and counted rather than written as a row
--    nothing can act on, and the batch is bounded. The prompt asks for two to
--    five; the original bounds nothing.
--
-- NOT DIVERGED. The due date is the original's map with its `?? 3` default,
-- measured from the store's own day; the description falls back to the
-- reason and then to empty; the assignee is the caller; and every task carries
-- `source = 'ai_generated'`, which is what the dedupe looks for.
begin;

do $$
begin
  if to_regclass('pennsync_records.task') is null
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

/* The original's `calculateDueDate`, including its `?? 3` fallback. */
create function "pennsync_records".follow_up_due_date(p_timeframe text)
  returns date language sql stable set search_path = '' as $due$
  select "pennsync_records".agency_today() + (case p_timeframe
    when 'today' then 0 when '24_hours' then 1 when '48_hours' then 2
    when 'this_week' then 7 when 'next_visit' then 3 else 3 end)
$due$;

/* Divergence 4: the column's own enum decides, and anything else is absent. */
create function "pennsync_records".follow_up_enum(
  p_value text, p_allowed text[], p_default text)
  returns text language sql immutable set search_path = '' as $enum$
  select coalesce((select a from pg_catalog.unnest(p_allowed) a
    where pg_catalog.lower(a) = pg_catalog.lower(pg_catalog.btrim(coalesce(p_value, '')))),
    p_default)
$enum$;

create function "pennsync_records".contract_follow_up_context(
  p_agency text, p_patient_id text, p_visit_id text)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_patient "pennsync_records"."patient"; v_row jsonb; v_role text;
begin
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_FOLLOW_UP_AGENCY_NOT_HELD';
  end if;
  if p_patient_id is null or p_patient_id !~ '^[A-Za-z0-9_-]{1,200}$'
    or (p_visit_id is not null and p_visit_id !~ '^[A-Za-z0-9_-]{1,200}$') then
    raise exception using errcode='22023', message='PENNSYNC_FOLLOW_UP_SUBJECT_INVALID';
  end if;
  -- Divergence 2: the purpose's own gate before its own projection.
  if not "pennsync_records".patient_exact_purpose_admits('smart_note_context', v_role) then
    raise exception using errcode='42501', message='PENNSYNC_FOLLOW_UP_PURPOSE_FORBIDDEN';
  end if;
  -- Divergence 1: the chart, not `assigned_nurses` and not an environment read.
  select p.* into v_patient from "pennsync_records"."patient" p
  where p."source_app_id" = "pennsync_records".deployment_app()
    and p."id" = p_patient_id and p."agency_id" = p_agency;
  if v_patient."id" is null then
    raise exception using errcode='42501', message='PENNSYNC_FOLLOW_UP_PATIENT_NOT_VISIBLE';
  end if;
  -- The original's own rule: a named visit must be this patient's.
  if p_visit_id is not null and not exists (
    select 1 from "pennsync_records"."visit" v
    where v."source_app_id" = "pennsync_records".deployment_app()
      and v."id" = p_visit_id and v."patient_id" = p_patient_id) then
    raise exception using errcode='42501', message='PENNSYNC_FOLLOW_UP_VISIT_NOT_FOUND';
  end if;
  v_row := "pennsync_records".patient_exact_purpose_row('smart_note_context', v_patient);
  return jsonb_build_object('success', true, 'patient_id', p_patient_id,
    'visit_id', p_visit_id,
    'patient_name', pg_catalog.btrim(pg_catalog.concat_ws(' ',
      v_row ->> 'first_name', v_row ->> 'last_name')),
    'primary_diagnosis', v_row -> 'primary_diagnosis',
    'secondary_diagnoses', v_row -> 'secondary_diagnoses');
end $contract$;

create function "pennsync_records".contract_follow_up_record(
  p_agency text, p_patient_id text, p_visit_id text, p_tasks jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_now timestamptz; v_email text; v_task jsonb; v_title text; v_id text;
  v_created jsonb := '[]'::jsonb; v_count integer := 0; v_skipped integer := 0;
  v_type text; v_priority text; v_timeframe text; v_due date; v_description text;
begin
  perform "pennsync_records".contract_follow_up_context(p_agency, p_patient_id, p_visit_id);
  if p_tasks is null or jsonb_typeof(p_tasks) <> 'array' then
    raise exception using errcode='22023', message='PENNSYNC_FOLLOW_UP_INVALID';
  end if;
  -- Divergence 5: the prompt asks for two to five.
  if jsonb_array_length(p_tasks) > 50 then
    raise exception using errcode='22023', message='PENNSYNC_FOLLOW_UP_TOO_MANY';
  end if;

  v_now := clock_timestamp();
  v_email := "pennsync_records".caller_email();

  -- Divergence 3: the lock the claim token was emulating, and the original's
  -- own dedupe, which is what it actually relies on.
  if p_visit_id is not null then
    perform 1 from "pennsync_records"."visit" v
    where v."source_app_id" = "pennsync_records".deployment_app()
      and v."id" = p_visit_id for update;
    if exists (select 1 from "pennsync_records"."task" t
      where t."source_app_id" = "pennsync_records".deployment_app()
        and t."related_visit_id" = p_visit_id and t."source" = 'ai_generated') then
      return jsonb_build_object('success', true, 'already_processed', true,
        'tasks_created', 0, 'tasks', '[]'::jsonb, 'tasks_skipped', 0,
        'skipped', 'ai follow-up tasks already exist for visit');
    end if;
  end if;

  for v_task in select value from jsonb_array_elements(p_tasks) loop
    if jsonb_typeof(v_task) <> 'object' then v_skipped := v_skipped + 1; continue; end if;
    v_title := case when jsonb_typeof(v_task->'title') = 'string'
      then pg_catalog.btrim(v_task->>'title') else null end;
    -- Divergence 5: a task with no title is not a task.
    if v_title is null or v_title = '' then v_skipped := v_skipped + 1; continue; end if;
    -- Divergence 4: the column's own enum, or the original's default.
    v_type := "pennsync_records".follow_up_enum(v_task->>'type',
      array['call','notify','schedule','order','coordinate','document','safety','followup','other'],
      'followup');
    v_priority := "pennsync_records".follow_up_enum(v_task->>'priority',
      array['critical','high','medium','low'], 'medium');
    v_timeframe := "pennsync_records".follow_up_enum(v_task->>'due_timeframe',
      array['today','24_hours','48_hours','this_week','next_visit'], 'next_visit');
    -- The original's `description || ai_reason || ''`, in that order.
    v_description := coalesce(
      nullif(case when jsonb_typeof(v_task->'description') = 'string'
        then v_task->>'description' else null end, ''),
      nullif(case when jsonb_typeof(v_task->'ai_reason') = 'string'
        then v_task->>'ai_reason' else null end, ''), '');
    -- The due date is computed from the timeframe that is STORED, so a row
    -- cannot say `today` and mean three days from now. The original looks the
    -- raw answer up in a case-sensitive map and falls to `?? 3`, so it writes
    -- `TODAY` — a value this store's check constraint refuses — and dates it
    -- three days out. An unrecognised answer still lands on 3, because
    -- `next_visit` is the substituted default and the map gives it 3.
    v_due := "pennsync_records".follow_up_due_date(v_timeframe);

    v_id := pg_catalog.substr(pg_catalog.md5(pg_catalog.gen_random_uuid()::text), 1, 24);
    insert into "pennsync_records"."task"
      ("source_app_id","id","agency_id","patient_id","related_visit_id","title",
       "description","type","priority","due_date","due_timeframe","status","source",
       "ai_reason","assigned_to","created_by","created_date","updated_date")
    values ("pennsync_records".deployment_app(), v_id, p_agency, p_patient_id,
      p_visit_id, v_title, v_description, v_type, v_priority, v_due, v_timeframe,
      'pending', 'ai_generated',
      coalesce(case when jsonb_typeof(v_task->'ai_reason') = 'string'
        then v_task->>'ai_reason' else null end, ''),
      v_email, v_email, v_now, v_now);
    v_count := v_count + 1;
    v_created := v_created || jsonb_build_object(
      'id', v_id, 'title', v_title, 'description', v_description, 'type', v_type,
      'priority', v_priority, 'due_date', v_due, 'due_timeframe', v_timeframe,
      'status', 'pending', 'source', 'ai_generated',
      'patient_id', p_patient_id, 'related_visit_id', p_visit_id,
      'assigned_to', v_email);
  end loop;

  return jsonb_build_object('success', true, 'already_processed', false,
    'tasks_created', v_count, 'tasks_skipped', v_skipped, 'tasks', v_created);
end $contract$;

reset role;

revoke all on function "pennsync_records".follow_up_due_date(text)
  from public, anon, authenticated, service_role;
revoke all on function "pennsync_records".follow_up_enum(text,text[],text)
  from public, anon, authenticated, service_role;
revoke all on function "pennsync_records".contract_follow_up_context(text,text,text)
  from public, anon, authenticated, service_role;
revoke all on function "pennsync_records".contract_follow_up_record(text,text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function "pennsync_records".contract_follow_up_context(text,text,text)
  to authenticated;
grant execute on function "pennsync_records".contract_follow_up_record(text,text,text,jsonb)
  to authenticated;

create function "public"."pennsync_contract_follow_up_context"(
  p_agency text, p_patient_id text, p_visit_id text) returns jsonb
  language sql security invoker set search_path = '' as $c$
  select "pennsync_records".contract_follow_up_context(p_agency, p_patient_id, p_visit_id)
$c$;
create function "public"."pennsync_contract_follow_up_record"(
  p_agency text, p_patient_id text, p_visit_id text, p_tasks jsonb) returns jsonb
  language sql security invoker set search_path = '' as $c$
  select "pennsync_records".contract_follow_up_record(p_agency, p_patient_id, p_visit_id, p_tasks)
$c$;
revoke all on function "public"."pennsync_contract_follow_up_context"(text,text,text)
  from public, anon, authenticated, service_role;
revoke all on function "public"."pennsync_contract_follow_up_record"(text,text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function "public"."pennsync_contract_follow_up_context"(text,text,text)
  to authenticated;
grant execute on function "public"."pennsync_contract_follow_up_record"(text,text,text,jsonb)
  to authenticated;

commit;
