-- Recording the supplies a visit consumed, and what running out of one costs.
--
-- HAND WRITTEN, like every contract. Two of them: `contract_visit_supply_context`
-- authorizes before the model call is paid for, and
-- `contract_visit_supply_record` does the whole of the write in ONE transaction.
-- D53's order — ask, shape, record — with a read contract in front of it
-- because the original authorizes before it prompts and so does this.
--
-- The authorization is the D21/D24 reconstruction again, in the same words
-- `predictSupplyNeeds` uses: *"Authorize against the patient (assigned nurse or
-- admin) before writing a SupplyUsageLog stamped with this patient_id and
-- decrementing shared SupplyItem inventory."* It reads `created_by`,
-- `assigned_nurses`, `account_type` and `agency_name`, and lists five thousand
-- `User` rows for the last one. The chart policies answer all of it.
--
-- **THE DEFECT THIS PORT FOUND, and what D61 then did with it.** The original
-- creates a reorder `Task` with NO `patient_id`, and then a
-- `SupplyLowStockAlert` whose `task_id` names it. When this was written, `task`
-- reached tenancy through `patient_id` and `supply_low_stock_alert` reached it
-- through `task_id`, so a task with no patient was in no tenant and the alert
-- pointing at it was in no tenant either: BOTH would have been written where
-- nobody — the assignee included — could ever read them. D45 found that shape
-- in the notification envelope and D51 found it in the ADR and incident alerts.
--
-- This port's first answer was to stamp the authorized chart on the task,
-- which worked and was too narrow. **D61 then measured the class** — thirteen
-- carried entities reached tenancy only through an OPTIONAL column — and gave
-- these two an `agency_id` of their own. So the task names no patient, exactly
-- as the original has it, and is visible because the TABLE carries the tenancy
-- rather than because this contract invented a subject for it. A reorder task
-- is about the agency's inventory, and the agency is who can now see it.
--
-- DIVERGENCES from the original, each deliberate:
--
-- 1. The chart decides. The explicit checks are for the NAMED refusals.
-- 2. The task and the alert are stamped with the agency D61 gave those tables,
--    and the task is created BEFORE the alert so the alert can carry `task_id`
--    and `reorder_task_created` at insert. That deletes the original's
--    follow-up update, which only existed because it had no transaction in
--    which to create the pair.
-- 3. **`supply_usage_claimed_by` is gone.** The original writes a claim token
--    to the visit, reads it back, and treats a mismatch as "claimed by a
--    concurrent run" — a compensation for having no transaction, and a racy
--    one: two runs that both write and then both read their own token both
--    proceed. Here the record contract locks the visit row and skips the
--    supplies already logged against it, so the second run is a no-op with no
--    token to lose. This is D46's rule: a reservation protocol becomes the
--    lock it was emulating. The carried column is left alone and unused.
-- 4. **The inventory is decremented in SQL** rather than read, computed and
--    written back. The original's `runningQuantities` map exists to stop two
--    line items in ONE run from both writing against the same frozen snapshot;
--    it does nothing about two concurrent RUNS, which lose one another's
--    decrement entirely. `greatest(0, current_quantity - qty)` under the row
--    lock is correct for both.
-- 5. `supply_item` is matched within the caller's agency. The original scans
--    the five thousand newest supplies in the DEPLOYMENT, so another agency's
--    supply can absorb this agency's usage — the same defect D57 records, and
--    here it WRITES rather than only reading.
-- 6. The duplicate-alert check sees what the caller sees. The original filters
--    every `SupplyLowStockAlert` in the deployment; the alert is chart-bound
--    here (see above), so there is no agency-wide read of it to make. A second
--    clinician on a different chart can therefore open a second active alert
--    for the same supply — which is also what the original's own
--    `assigned_to: user.email` implies, since each of them gets the reorder
--    task they were handed.
-- 7. A null field is concatenated as empty rather than as the text
--    "undefined". The original builds the task description with a template
--    literal, so a supply with no `unit` reads "Current: 3 undefined".
--
-- NOT DIVERGED. A malformed element of the model's answer is SKIPPED, not
-- refused: the original guards each one deliberately and says why in its own
-- comment, and refusing the batch would throw away the extractions that were
-- good. Two line items matching the same supply in one run both log and both
-- decrement, as they do there.
begin;

do $$
begin
  if to_regclass('pennsync_records.supply_usage_log') is null
    or to_regprocedure('pennsync_records.agency_today()') is null then
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

/*
 * The original's fuzzy match: case-insensitive containment in EITHER
 * direction, first hit in `-created_date` order. Divergence 5 is the agency.
 * `strpos` rather than `like`, because the needle is a MODEL's words and
 * `%`, `_` and `\` in them would otherwise be pattern syntax.
 */
create function "pennsync_records".supply_match(p_agency text, p_name text)
  returns text language sql stable security definer set search_path = '' as $match$
  select i."id" from "pennsync_records"."supply_item" i
  where i."source_app_id" = "pennsync_records".deployment_app()
    and i."agency_id" = p_agency and i."name" is not null
    and (pg_catalog.strpos(pg_catalog.lower(i."name"), pg_catalog.lower(p_name)) > 0
      or pg_catalog.strpos(pg_catalog.lower(p_name), pg_catalog.lower(i."name")) > 0)
  -- The list order the original's `.find()` walks, with a deterministic
  -- tiebreak the SDK's page does not promise.
  order by i."created_date" desc nulls last, i."id" limit 1
$match$;

/* The original's three-way status, with a null threshold falsy as it is there. */
create function "pennsync_records".supply_stock_status(
  p_quantity double precision, p_threshold double precision)
  returns text language sql immutable set search_path = '' as $status$
  select case when p_quantity = 0 then 'out_of_stock'
    when p_quantity <= p_threshold then 'low_stock' else 'in_stock' end
$status$;

create function "pennsync_records".contract_visit_supply_context(
  p_agency text, p_patient_id text, p_visit_id text)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_patient record;
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_VISIT_SUPPLY_AGENCY_NOT_HELD';
  end if;
  if p_patient_id is null or p_patient_id !~ '^[A-Za-z0-9_-]{1,200}$'
    or (p_visit_id is not null and p_visit_id !~ '^[A-Za-z0-9_-]{1,200}$') then
    raise exception using errcode='22023', message='PENNSYNC_VISIT_SUPPLY_SUBJECT_INVALID';
  end if;
  select p."id", p."first_name", p."last_name" into v_patient
  from "pennsync_records"."patient" p
  where p."source_app_id" = "pennsync_records".deployment_app()
    and p."id" = p_patient_id and p."agency_id" = p_agency;
  if v_patient."id" is null then
    raise exception using errcode='42501', message='PENNSYNC_VISIT_SUPPLY_PATIENT_NOT_VISIBLE';
  end if;
  -- The original's own rule: a visit is only a subject of this chart's usage.
  if p_visit_id is not null and not exists (
    select 1 from "pennsync_records"."visit" v
    where v."source_app_id" = "pennsync_records".deployment_app()
      and v."id" = p_visit_id and v."patient_id" = p_patient_id) then
    raise exception using errcode='42501', message='PENNSYNC_VISIT_SUPPLY_VISIT_NOT_FOUND';
  end if;
  return jsonb_build_object('success', true, 'patient_id', p_patient_id,
    'visit_id', p_visit_id,
    'patient_name', pg_catalog.btrim(pg_catalog.concat_ws(' ',
      v_patient."first_name", v_patient."last_name")));
end $contract$;

create function "pennsync_records".contract_visit_supply_record(
  p_agency text, p_patient_id text, p_visit_id text, p_supplies jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_now timestamptz; v_today date; v_email text; v_item jsonb;
  v_name text; v_quantity double precision; v_supply record;
  v_before double precision; v_after double precision; v_status text;
  v_severity text; v_priority text; v_task_id text; v_alert_id text; v_log_id text;
  v_logged integer := 0; v_alerts jsonb := '[]'::jsonb; v_alert_count integer := 0;
  v_seen text[] := '{}';
begin
  -- Divergence 1: the contract is its own authority, so the context contract
  -- having passed is not taken on trust.
  perform "pennsync_records".contract_visit_supply_context(p_agency, p_patient_id, p_visit_id);
  if p_supplies is null or jsonb_typeof(p_supplies) <> 'array' then
    raise exception using errcode='22023', message='PENNSYNC_VISIT_SUPPLY_INVALID';
  end if;
  if jsonb_array_length(p_supplies) > 100 then
    raise exception using errcode='22023', message='PENNSYNC_VISIT_SUPPLY_TOO_MANY';
  end if;

  v_now := clock_timestamp();
  v_today := "pennsync_records".agency_today();
  v_email := "pennsync_records".caller_email();

  -- Divergence 3: the lock the claim token was emulating. Two concurrent runs
  -- over one visit serialize here, and the second finds the first's logs.
  if p_visit_id is not null then
    perform 1 from "pennsync_records"."visit" v
    where v."source_app_id" = "pennsync_records".deployment_app()
      and v."id" = p_visit_id for update;
    select coalesce(array_agg(distinct l."supply_id"), '{}') into v_seen
    from "pennsync_records"."supply_usage_log" l
    where l."source_app_id" = "pennsync_records".deployment_app()
      and l."visit_id" = p_visit_id and l."supply_id" is not null;
  end if;

  for v_item in select value from jsonb_array_elements(p_supplies) loop
    if jsonb_typeof(v_item) <> 'object' then continue; end if;
    v_name := case when jsonb_typeof(v_item->'name') = 'string'
      then v_item->>'name' else null end;
    -- The original's own guard: "an unchecked value would throw on
    -- .toLowerCase() or write NaN into the shared SupplyItem inventory."
    v_quantity := case when jsonb_typeof(v_item->'quantity') = 'number'
      then (v_item->>'quantity')::double precision else null end;
    if v_name is null or v_name = '' or v_quantity is null or v_quantity <= 0
      or v_quantity = 'Infinity'::double precision then continue; end if;

    select i."id", i."name", i."unit", i."low_stock_threshold", i."reorder_quantity"
      into v_supply from "pennsync_records"."supply_item" i
    where i."source_app_id" = "pennsync_records".deployment_app()
      and i."id" = "pennsync_records".supply_match(p_agency, v_name)
    for update;
    if v_supply."id" is null then continue; end if;
    if v_supply."id" = any(v_seen) then continue; end if;

    v_log_id := pg_catalog.substr(pg_catalog.md5(pg_catalog.gen_random_uuid()::text), 1, 24);
    insert into "pennsync_records"."supply_usage_log"
      ("source_app_id","id","supply_id","supply_name","patient_id","visit_id",
       "quantity_used","unit","usage_date","documented_by","extracted_from_note",
       "extraction_confidence","notes","created_by","created_date","updated_date")
    values ("pennsync_records".deployment_app(), v_log_id, v_supply."id",
      v_supply."name", p_patient_id, p_visit_id, v_quantity,
      case when jsonb_typeof(v_item->'unit') = 'string' then v_item->>'unit' end,
      v_today, v_email, true, 85,
      case when jsonb_typeof(v_item->'purpose') = 'string' then v_item->>'purpose' end,
      v_email, v_now, v_now);
    v_logged := v_logged + 1;

    -- Divergence 4: the decrement is the statement, not a read-modify-write.
    update "pennsync_records"."supply_item" i
      set "current_quantity" = greatest(0, coalesce(i."current_quantity", 0) - v_quantity),
          "status" = "pennsync_records".supply_stock_status(
            greatest(0, coalesce(i."current_quantity", 0) - v_quantity),
            v_supply."low_stock_threshold"),
          "last_updated" = v_now, "updated_date" = v_now
    where i."source_app_id" = "pennsync_records".deployment_app()
      and i."id" = v_supply."id"
    returning coalesce(i."current_quantity", 0), i."status" into v_after, v_status;

    if v_after <= v_supply."low_stock_threshold" then
      v_severity := case when v_after = 0 then 'out_of_stock'
        when v_after <= v_supply."low_stock_threshold" * 0.3 then 'critical'
        else 'warning' end;
      -- Divergence 6: the alerts this caller can see, which is every alert the
      -- original could see and no more than the policies allow.
      if not exists (select 1 from "pennsync_records"."supply_low_stock_alert" a
        where a."source_app_id" = "pennsync_records".deployment_app()
          and a."supply_id" = v_supply."id" and a."status" = 'active') then
        v_priority := case when v_severity = 'warning' then 'medium' else 'high' end;
        -- Divergence 2: the agency D61 gave the table, and the task first.
        -- No `patient_id`, as the original has it: a reorder task is the
        -- agency's, not the chart's.
        v_task_id := pg_catalog.substr(pg_catalog.md5(pg_catalog.gen_random_uuid()::text), 1, 24);
        insert into "pennsync_records"."task"
          ("source_app_id","id","agency_id","title","description","status",
           "priority","assigned_to","due_date","created_by","created_date","updated_date")
        values ("pennsync_records".deployment_app(), v_task_id, p_agency,
          pg_catalog.concat('Reorder ', v_supply."name"),
          -- Divergence 7: a null renders as empty, not as "undefined".
          pg_catalog.concat(v_supply."name", ' is ',
            case when v_severity = 'out_of_stock' then 'out of stock' else 'running low' end,
            '. Current: ', v_after, ' ', v_supply."unit",
            ', recommend reordering ', v_supply."reorder_quantity", ' units.'),
          'pending', v_priority, v_email, v_today, v_email, v_now, v_now);
        v_alert_id := pg_catalog.substr(pg_catalog.md5(pg_catalog.gen_random_uuid()::text), 1, 24);
        insert into "pennsync_records"."supply_low_stock_alert"
          ("source_app_id","id","agency_id","supply_id","supply_name","current_quantity",
           "threshold_quantity","recommended_reorder","severity","status",
           "triggered_date","reorder_task_created","task_id",
           "created_by","created_date","updated_date")
        values ("pennsync_records".deployment_app(), v_alert_id, p_agency, v_supply."id",
          v_supply."name", v_after, v_supply."low_stock_threshold",
          v_supply."reorder_quantity", v_severity, 'active', v_now, true, v_task_id,
          v_email, v_now, v_now);
        v_alert_count := v_alert_count + 1;
        v_alerts := v_alerts || jsonb_build_object(
          'id', v_alert_id, 'supply_id', v_supply."id", 'supply_name', v_supply."name",
          'current_quantity', v_after, 'threshold_quantity', v_supply."low_stock_threshold",
          'recommended_reorder', v_supply."reorder_quantity", 'severity', v_severity,
          'status', 'active', 'reorder_task_created', true, 'task_id', v_task_id);
      end if;
    end if;
  end loop;

  return jsonb_build_object('success', true, 'usageLogs', v_logged,
    'alertsCreated', v_alert_count, 'alerts', v_alerts);
end $contract$;

reset role;

revoke all on function "pennsync_records".supply_match(text,text)
  from public, anon, authenticated, service_role;
revoke all on function
  "pennsync_records".supply_stock_status(double precision,double precision)
  from public, anon, authenticated, service_role;
revoke all on function
  "pennsync_records".contract_visit_supply_context(text,text,text)
  from public, anon, authenticated, service_role;
revoke all on function
  "pennsync_records".contract_visit_supply_record(text,text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function
  "pennsync_records".contract_visit_supply_context(text,text,text) to authenticated;
grant execute on function
  "pennsync_records".contract_visit_supply_record(text,text,text,jsonb) to authenticated;

create function "public"."pennsync_contract_visit_supply_context"(
  p_agency text, p_patient_id text, p_visit_id text) returns jsonb
  language sql security invoker set search_path = '' as $c$
  select "pennsync_records".contract_visit_supply_context(p_agency, p_patient_id, p_visit_id)
$c$;
create function "public"."pennsync_contract_visit_supply_record"(
  p_agency text, p_patient_id text, p_visit_id text, p_supplies jsonb) returns jsonb
  language sql security invoker set search_path = '' as $c$
  select "pennsync_records".contract_visit_supply_record(p_agency, p_patient_id, p_visit_id, p_supplies)
$c$;
revoke all on function "public"."pennsync_contract_visit_supply_context"(text,text,text)
  from public, anon, authenticated, service_role;
revoke all on function "public"."pennsync_contract_visit_supply_record"(text,text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function "public"."pennsync_contract_visit_supply_context"(text,text,text)
  to authenticated;
grant execute on function "public"."pennsync_contract_visit_supply_record"(text,text,text,jsonb)
  to authenticated;

commit;
