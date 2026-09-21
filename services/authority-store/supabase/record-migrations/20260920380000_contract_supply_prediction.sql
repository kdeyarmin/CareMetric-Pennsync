-- Predicting a patient's supply needs from their usage log.
--
-- HAND WRITTEN, like every contract. Almost all of this capability is
-- arithmetic, and the arithmetic is ported term for term; what changes is the
-- authorization around it, which is the D21/D24 reconstruction again.
--
-- **The original's own comment says what it is doing and why it thinks it has
-- to:** *"Authorize against the patient (assigned nurse or admin) before
-- reading their supply usage and writing a SupplyPrediction. The 404 above only
-- covers global non-existence, not access. RLS-independent code check."* It then
-- reads `created_by`, `assigned_nurses`, `account_type` and `agency_name`, and
-- lists five thousand `User` rows to decide whether the patient is in the
-- caller's agency. Every one of those is a label D21, D23 and D24 threw out,
-- and the chart policies answer the whole question — including "which usage
-- logs", because `supply_usage_log` has no `agency_id` and reaches tenancy
-- through `patient_id` exactly as the chart does.
--
-- ONE THING TO READ BEFORE CHANGING THE FLOOR. The original's comment says
-- "Need at least 2 data points" and its code says `usageData.length < 2`, which
-- counts USAGE LOG ROWS — while the `data_points` it then reports is
-- `quantities.length`, the number of distinct MONTHS. Two logs in one month
-- therefore produce a prediction whose `data_points` is 1, whose variance is
-- zero and whose confidence is the 95 ceiling. That is what the capability
-- does, so that is what this ports: D36's rule is that a comment is not a
-- permission, and it cuts both ways — the comment is not the behaviour either.
-- Tightening the floor to two months would silently stop producing predictions
-- the product produces today.
--
-- DIVERGENCES from the original, each deliberate:
--
-- 1. The chart decides, through the policies. The explicit visibility check is
--    for the NAMED refusal; a policy failure is a raw RLS error the HTTP
--    boundary cannot classify.
-- 2. **Every date is a stored date or the store's own day, never the server
--    process's zone.** The original buckets by `new Date('2026-09-30')`, which
--    parses as UTC midnight, and then reads `getFullYear()` and `getMonth()`,
--    which are LOCAL — so in any zone behind UTC the last day of a month is
--    counted in the previous one. It then builds the reorder date by LOCAL
--    `setDate()` arithmetic and serialises it with a UTC `toISOString()`.
--    `to_char(usage_date, 'YYYY-MM')` and `agency_today()` have no such seam.
-- 3. A prediction with no reorder date sorts LAST, and ties break on
--    `supply_id`. The original sorts on `a.days - b.days` with nulls in the
--    array, which is `NaN` for every comparison involving one, so a null's
--    position is whatever the sort happens to do with it.
-- 4. `supply_item` is agency-scoped and the join says so. The original reads
--    the five thousand newest supplies in the DEPLOYMENT and matches by id, so
--    another agency's supply could name the inventory figures a prediction is
--    built from — and, past five thousand supplies, this agency's own supply
--    could fall off the page and silently produce no prediction at all.
-- 5. The six-month window is six months. The original's
--    `setMonth(getMonth() - 6)` overflows on a month end — from the 31st it
--    lands on the 3rd of the following month — so its window is sometimes five
--    months and twenty-eight days. This one is WIDER than the original's by up
--    to three days on those dates; it is a data window and not a permission,
--    and the rows it admits are rows the caller may already read.
-- 6. A log row with no `quantity_used` counts as zero. The entity requires the
--    field, so this is unreachable through the API, but the carried column is
--    nullable and the original's arithmetic on `undefined` is `NaN` — which
--    serialises to `null` for every number in that supply's prediction and
--    writes the row anyway.
--
-- ONE DIVERGENCE DELIBERATELY NOT MADE. Every run writes a new row per supply,
-- so predictions accumulate. That is the original's behaviour and
-- `SupplyPrediction` claims no uniqueness in its own schema, so deciding
-- whether a re-run replaces or appends is an entity decision (D30), not this
-- contract's.
begin;

do $$
begin
  if to_regclass('pennsync_records.supply_prediction') is null
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
 * `Math.round(x * 10) / 10`, and not `round(x::numeric, 1)`.
 *
 * The original rounds a DOUBLE: `2.05 * 10` is 20.499999999999996 in binary
 * floating point, so its answer is 2 where exact decimal rounding says 2.1.
 * Multiplying in double and rounding the result reproduces it exactly. The
 * quantities are never negative, so JavaScript's round-half-toward-positive
 * and PostgreSQL's round-half-away-from-zero cannot disagree here.
 */
create function "pennsync_records".supply_round(p_value double precision,
  p_places integer) returns double precision
  language sql immutable set search_path = '' as $round$
  select case when p_value is null then null else
    (pg_catalog.round((p_value * pg_catalog.power(10, p_places))::numeric)
      / pg_catalog.power(10, p_places)::numeric)::double precision end
$round$;

create function "pennsync_records".contract_supply_prediction_generate(
  p_agency text, p_patient_id text)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_now timestamptz; v_today date; v_since date; v_supply record;
  v_rows jsonb := '[]'::jsonb; v_count integer := 0; v_id text;
  v_avg double precision; v_recent double precision; v_trend text;
  v_std double precision; v_coeff double precision; v_confidence double precision;
  v_predicted double precision; v_daily double precision; v_days double precision;
  v_next date; v_recommended double precision; v_analysis jsonb; v_row jsonb;
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_SUPPLY_AGENCY_NOT_HELD';
  end if;
  if p_patient_id is null or p_patient_id !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception using errcode='22023', message='PENNSYNC_SUPPLY_SUBJECT_INVALID';
  end if;
  -- Divergence 1: the chart, not `assigned_nurses`.
  if not exists (select 1 from "pennsync_records"."patient" p
    where p."source_app_id" = "pennsync_records".deployment_app()
      and p."id" = p_patient_id and p."agency_id" = p_agency) then
    raise exception using errcode='42501', message='PENNSYNC_SUPPLY_PATIENT_NOT_VISIBLE';
  end if;

  v_now := clock_timestamp();
  v_today := "pennsync_records".agency_today();
  v_since := v_today - interval '6 months'; -- Divergence 5.

  for v_supply in
    with monthly as (
      -- Divergence 2: the stored date's month, with no zone to get wrong.
      select l."supply_id" as supply_id,
        pg_catalog.to_char(l."usage_date", 'YYYY-MM') as month,
        -- Divergence 6.
        sum(coalesce(l."quantity_used", 0)) as quantity,
        count(*)::integer as entries
      from "pennsync_records"."supply_usage_log" l
      where l."source_app_id" = "pennsync_records".deployment_app()
        and l."patient_id" = p_patient_id
        and l."usage_date" is not null and l."usage_date" >= v_since
        and l."supply_id" is not null
      group by l."supply_id", pg_catalog.to_char(l."usage_date", 'YYYY-MM')
    ), shaped as (
      select m.supply_id,
        array_agg(m.quantity order by m.month) as quantities,
        array_agg(m.month order by m.month) as months,
        jsonb_object_agg(m.month, m.quantity) as breakdown,
        count(*)::integer as points,
        sum(m.entries)::integer as entries
      from monthly m group by m.supply_id
    )
    select s.supply_id, s.quantities, s.months, s.breakdown, s.points,
      i."name" as supply_name,
      coalesce(i."current_quantity", 0) as current_quantity,
      coalesce(i."low_stock_threshold", 0) as low_stock_threshold
    from shaped s
    -- Divergence 4: this agency's inventory. The original matches against the
    -- five thousand newest supplies in the deployment.
    join "pennsync_records"."supply_item" i
      on i."source_app_id" = "pennsync_records".deployment_app()
     and i."id" = s.supply_id and i."agency_id" = p_agency
    -- The original's floor, counted as the original counts it: LOG ROWS.
    where s.entries >= 2
    order by s.supply_id
  loop
    select avg(q) into v_avg from unnest(v_supply.quantities) q;
    -- The last three months, over `min(3, months)` as the original divides.
    select coalesce(sum(q), 0) / least(3, v_supply.points) into v_recent
    from unnest(v_supply.quantities[greatest(1, v_supply.points - 2):v_supply.points]) q;
    v_trend := case
      when v_recent > v_avg * 1.2 then 'increasing'
      when v_recent < v_avg * 0.8 then 'decreasing'
      else 'stable' end;
    -- Population variance, summed term by term as the original sums it.
    select pg_catalog.sqrt(sum(pg_catalog.power(q - v_avg, 2)) / v_supply.points)
      into v_std from unnest(v_supply.quantities) q;
    v_coeff := case when v_avg > 0 then (v_std / v_avg) * 100 else 0 end;
    v_confidence := greatest(50, least(95, 100 - (v_coeff / 2)));
    v_predicted := case v_trend
      when 'increasing' then v_recent
      when 'decreasing' then greatest(v_avg * 0.8, v_recent)
      else v_avg end;
    v_daily := v_predicted / 30;
    -- The original's guard, in its own words: dividing by a zero predicted
    -- usage "yields Infinity, and setDate(+Infinity) makes an Invalid Date
    -- whose toISOString() throws — 500-ing an otherwise valid request."
    v_days := case when v_daily > 0
      then pg_catalog.ceil((v_supply.current_quantity - v_supply.low_stock_threshold) / v_daily)
      else null end;
    v_next := case when v_days is not null then v_today + v_days::integer else null end;
    v_recommended := pg_catalog.ceil(v_predicted * 3);
    v_analysis := jsonb_build_object(
      'monthly_breakdown', v_supply.breakdown,
      'data_points', v_supply.points,
      'months_analyzed', to_jsonb(v_supply.months),
      'trend_analysis', jsonb_build_object(
        'avg_usage', "pennsync_records".supply_round(v_avg, 1),
        'recent_avg', "pennsync_records".supply_round(v_recent, 1),
        'std_deviation', "pennsync_records".supply_round(v_std, 1)));

    v_id := pg_catalog.substr(pg_catalog.md5(pg_catalog.gen_random_uuid()::text), 1, 24);
    insert into "pennsync_records"."supply_prediction"
      ("source_app_id", "id", "patient_id", "supply_id", "supply_name",
       "predicted_monthly_usage", "confidence_score", "usage_trend",
       "predicted_next_order_date", "recommended_quantity", "current_inventory",
       "estimated_days_until_reorder_needed", "analysis_data", "generated_date",
       "created_by", "created_date", "updated_date")
    values ("pennsync_records".deployment_app(), v_id, p_patient_id,
      v_supply.supply_id, v_supply.supply_name,
      "pennsync_records".supply_round(v_predicted, 1),
      "pennsync_records".supply_round(v_confidence, 0),
      v_trend, v_next, v_recommended, v_supply.current_quantity, v_days,
      v_analysis, v_now, "pennsync_records".caller_email(), v_now, v_now);

    v_count := v_count + 1;
    -- The original's response object, field for field: the record it pushes is
    -- the payload it created, so it carries no id and no created_by.
    v_row := jsonb_build_object(
      'patient_id', p_patient_id, 'supply_id', v_supply.supply_id,
      'supply_name', v_supply.supply_name,
      'predicted_monthly_usage', "pennsync_records".supply_round(v_predicted, 1),
      'confidence_score', "pennsync_records".supply_round(v_confidence, 0),
      'usage_trend', v_trend,
      'predicted_next_order_date', v_next,
      'recommended_quantity', v_recommended,
      'current_inventory', v_supply.current_quantity,
      'estimated_days_until_reorder_needed', v_days,
      'analysis_data', v_analysis,
      'generated_date', v_now);
    v_rows := v_rows || v_row;
  end loop;

  return jsonb_build_object('success', true, 'patient_id', p_patient_id,
    'predictions_generated', v_count,
    -- Divergence 3: a prediction with no reorder date sorts LAST rather than
    -- wherever a NaN comparison happens to put it.
    'predictions', coalesce((select jsonb_agg(p order by
        (p->>'estimated_days_until_reorder_needed') is null,
        (p->>'estimated_days_until_reorder_needed')::double precision,
        p->>'supply_id')
      from jsonb_array_elements(v_rows) p), '[]'::jsonb));
end $contract$;

reset role;

revoke all on function "pennsync_records".supply_round(double precision,integer)
  from public, anon, authenticated, service_role;
revoke all on function
  "pennsync_records".contract_supply_prediction_generate(text,text)
  from public, anon, authenticated, service_role;
grant execute on function
  "pennsync_records".contract_supply_prediction_generate(text,text) to authenticated;

create function "public"."pennsync_contract_supply_prediction_generate"(
  p_agency text, p_patient_id text) returns jsonb
  language sql security invoker set search_path = '' as $c$
  select "pennsync_records".contract_supply_prediction_generate(p_agency, p_patient_id)
$c$;
revoke all on function "public"."pennsync_contract_supply_prediction_generate"(text,text)
  from public, anon, authenticated, service_role;
grant execute on function "public"."pennsync_contract_supply_prediction_generate"(text,text)
  to authenticated;

commit;
