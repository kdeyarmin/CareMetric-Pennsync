-- Vehicle maintenance: the fleet, its service log, and the reviews on it.
--
-- HAND WRITTEN, like every contract. One Base44 capability, `manageVehicleMaintenance`,
-- with eight actions — and **two of them need no SQL here at all**, which is
-- the first thing to know about this port.
--
-- `context` lists the agencies the caller may manage a fleet in; that is
-- `contract_tenant_memberships` (D34), which already answers it with
-- `tenant_role` in place of the original's `can_manage`. `staff` is the
-- assignee picker: the original lists `AgencyMembership`, re-reads every
-- lifecycle state to prove the page unambiguous, and then joins `User` for a
-- name — which is `contract_listAgencyRoster` (D22) exactly. Both are routed
-- by the handler. D34's rule generalises: **check which store already models
-- what the original reads before writing a contract for it.**
--
-- The six here are `vehicles`, `history`, `create_vehicle`, `update_vehicle`,
-- `add_entry` and `review_entry`.
--
-- **The idempotency machinery becomes real rather than emulated.** None of the
-- three entities claims uniqueness on `request_key` in its own schema, so D30
-- emits no index, and the original compensates with `createOnce`: it hashes the
-- scope into a 64-hex key, appends a `{key, token}` claim to a `*_creation_claims`
-- ARRAY on a PARENT row, re-reads, and only then creates — a reservation
-- protocol built because two service-role writers could otherwise both insert.
-- Here the parent row always exists (an agency for a vehicle, a vehicle for an
-- entry, an entry for a review), so `select … for update` on it serializes the
-- check and the insert in one transaction, which is what that protocol was
-- emulating. The `creation_claim_token` and `*_creation_claims` columns are
-- carried and this contract writes neither. That is the same category as the
-- compensations D34, D35 and D45 delete: not a narrowing, a mechanism that has
-- something better available.
--
-- **`review_history` is derived and never stored, which is D32 working.**
-- `FleetServiceReview` is one of the four entities whose own description calls
-- the ROW immutable, so it has a read and an insert policy and no update or
-- delete policy at all. The original already honours that in its own words —
-- *"Reviews are independent immutable rows. Never replace the service entry's
-- review array: concurrent administrators cannot erase each other"* — so a
-- review INSERTS a row and touches the entry not at all. The entry's stored
-- `review_history` array is legacy, still read and still projected ahead of the
-- rows, and `review_status` in the answer is the latest event rather than the
-- stored column.
--
-- DIVERGENCES from the original, each deliberate:
--
-- 1. The platform-owner branch of `context` closes with the tier (D14, D22).
-- 2. `validFleetMembership` and `validAssigneeMembership` go. They re-prove a
--    membership row's whole canonical lifecycle on every request because in
--    Base44 any service-role writer could half-write one; here
--    `pennsync_private.membership` holds it with CHECK constraints, and D34
--    already deleted the same forty-line `validateMemberships`.
-- 3. An assignee is proved through membership (D23), and their display name is
--    their verified address: the carried `user` table has no name column, as
--    D38 recorded, so `assigned_user_name` is the address rather than a
--    `full_name` that does not exist here.
-- 4. The history page is ONE statement. The original runs up to three queries
--    and re-sorts in JavaScript for an explicit reason — *"The SDK supports one
--    sort field"* — and a keyset over `(service_date, id)` is a row comparison
--    in SQL. The cursor's `v1:<agency>:<vehicle>:<day>:<id>` shape is kept
--    verbatim, because already-published clients forward it.
-- 5. `fleet_today` is the agency's wall clock, as the original's is: a service
--    logged at 9pm in New York on the 18th is not a future date because UTC
--    has reached the 19th.
-- 6. A vehicle a non-manager may see is one assigned to them and not retired —
--    the original's rule, and the contract's to keep, because the
--    `fleet_vehicle` policies are agency-wide. Tenancy is not ownership (D45).
begin;

do $$
begin
  if to_regclass('pennsync_records.fleet_vehicle') is null
    or to_regclass('pennsync_records.fleet_service_entry') is null
    or to_regclass('pennsync_records.fleet_service_review') is null then
    raise exception using errcode='42501',message='PENNSYNC_RECORD_STORE_REQUIRED';
  end if;
end $$;

/*
 * One member of the caller's agency, by Base44 user id.
 *
 * The sibling of `agency_colleague`, which resolves by address; a fleet
 * assignment names an id because the picker returns ids. SECURITY DEFINER and
 * owned by the migration administrator for the same reason: `membership` and
 * `identity_map` are not readable by a tenant role.
 */
create function pennsync_private.agency_member(p_agency text, p_user_id text)
  returns table(base44_user_id text, tenant_role text, expected_email text)
  language plpgsql stable security definer set search_path = '' as $member$
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_FLEET_AGENCY_NOT_HELD';
  end if;
  return query
    select m.base44_user_id, m.tenant_role, im.expected_email
    from pennsync_private.membership m
    join pennsync_private.agency ag on ag.app_id = m.app_id and ag.id = m.agency_id
    join pennsync_private.identity_map im
      on im.app_id = m.app_id and im.auth_user_id = m.auth_user_id
     and im.base44_user_id = m.base44_user_id
    where m.app_id = pennsync_private.deployment_app_id()
      and m.agency_id = p_agency and m.status = 'active'
      and ag.status in ('active', 'trial')
      and im.enabled and im.revoked_at is null
      and m.base44_user_id = p_user_id;
end $member$;

revoke all on function pennsync_private.agency_member(text,text)
  from public, anon, authenticated, service_role;
-- The same grant `claim_new_chart` makes. NEVER pair it with a blanket revoke
-- over this schema: every `pennsync_staging_*` wrapper is an invoker calling an
-- inner function granted to `authenticated`.
grant usage on schema pennsync_private to "pennsync_records_owner";
grant execute on function pennsync_private.agency_member(text,text)
  to "pennsync_records_owner";

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

/* Divergence 5: the agency's wall clock, as the original's `fleetToday` is. */
create function "pennsync_records".fleet_today() returns date
  language sql stable set search_path = '' as $today$
  select (clock_timestamp() at time zone 'America/New_York')::date
$today$;

/*
 * The original's `text()`: trimmed, bounded, and free of the control
 * characters it rejects — which are NOT all of them. Tab, newline and carriage
 * return are absent from its class on purpose, because a note is multi-line.
 */
create function "pennsync_records".fleet_text(
  p_value jsonb, p_max integer, p_required boolean, p_label text)
  returns text language plpgsql immutable set search_path = '' as $text$
declare v_out text;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    if p_required then
      raise exception using errcode='22023', message='PENNSYNC_FLEET_FIELD_INVALID:' || p_label;
    end if;
    return '';
  end if;
  if jsonb_typeof(p_value) <> 'string' then
    raise exception using errcode='22023', message='PENNSYNC_FLEET_FIELD_INVALID:' || p_label;
  end if;
  v_out := pg_catalog.btrim(p_value #>> '{}');
  if pg_catalog.length(v_out) > p_max or (p_required and v_out = '')
    or v_out ~ '[\u0001-\u0008\u000b\u000c\u000e-\u001f]' then
    raise exception using errcode='22023', message='PENNSYNC_FLEET_FIELD_INVALID:' || p_label;
  end if;
  return v_out;
end $text$;

/* The original's `integer()`: a safe non-negative integer inside a ceiling. */
create function "pennsync_records".fleet_integer(
  p_value jsonb, p_max double precision, p_label text)
  returns double precision language plpgsql immutable set search_path = '' as $int$
declare v_out double precision;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'number' then
    raise exception using errcode='22023', message='PENNSYNC_FLEET_FIELD_INVALID:' || p_label;
  end if;
  v_out := (p_value #>> '{}')::double precision;
  if v_out <> pg_catalog.trunc(v_out) or v_out < 0 or v_out > p_max
    or v_out > 9007199254740991 then
    raise exception using errcode='22023', message='PENNSYNC_FLEET_FIELD_INVALID:' || p_label;
  end if;
  return v_out;
end $int$;

/* The original's `date()`: a real calendar day in ISO form, not a cast. */
create function "pennsync_records".fleet_date(p_value jsonb, p_label text)
  returns date language plpgsql immutable set search_path = '' as $date$
declare v_text text; v_out date;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'string' then
    raise exception using errcode='22023', message='PENNSYNC_FLEET_FIELD_INVALID:' || p_label;
  end if;
  v_text := p_value #>> '{}';
  if v_text !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception using errcode='22023', message='PENNSYNC_FLEET_FIELD_INVALID:' || p_label;
  end if;
  begin v_out := v_text::date; exception when others then
    raise exception using errcode='22023', message='PENNSYNC_FLEET_FIELD_INVALID:' || p_label;
  end;
  if pg_catalog.to_char(v_out, 'YYYY-MM-DD') <> v_text then
    raise exception using errcode='22023', message='PENNSYNC_FLEET_FIELD_INVALID:' || p_label;
  end if;
  return v_out;
end $date$;

/* The original's `vehicleData`, field for field and check for check. */
create function "pennsync_records".fleet_vehicle_data(p_vehicle jsonb)
  returns jsonb language plpgsql stable set search_path = '' as $data$
declare v_key text; v_year double precision; v_vin text; v_status text;
begin
  if p_vehicle is null or jsonb_typeof(p_vehicle) <> 'object' then
    raise exception using errcode='22023', message='PENNSYNC_FLEET_VEHICLE_INVALID';
  end if;
  for v_key in select k from jsonb_object_keys(p_vehicle) k loop
    if v_key not in ('unit_name', 'year', 'make', 'model', 'vin', 'license_plate',
      'baseline_odometer', 'status', 'assigned_user_id', 'notes') then
      raise exception using errcode='22023', message='PENNSYNC_FLEET_FIELD_UNSUPPORTED';
    end if;
  end loop;
  v_year := "pennsync_records".fleet_integer(p_vehicle->'year',
    (extract(year from clock_timestamp()) + 2)::double precision, 'year');
  if v_year < 1900 then
    raise exception using errcode='22023', message='PENNSYNC_FLEET_FIELD_INVALID:year';
  end if;
  v_vin := pg_catalog.upper("pennsync_records".fleet_text(p_vehicle->'vin', 17, false, 'vin'));
  if v_vin <> '' and v_vin !~ '^[A-HJ-NPR-Z0-9]{17}$' then
    raise exception using errcode='22023', message='PENNSYNC_FLEET_VIN_INVALID';
  end if;
  v_status := p_vehicle->>'status';
  if v_status is null or v_status not in ('active', 'out_of_service', 'retired') then
    raise exception using errcode='22023', message='PENNSYNC_FLEET_FIELD_INVALID:status';
  end if;
  return jsonb_build_object(
    'unit_name', "pennsync_records".fleet_text(p_vehicle->'unit_name', 100, true, 'unit_name'),
    'year', v_year,
    'make', "pennsync_records".fleet_text(p_vehicle->'make', 60, true, 'make'),
    'model', "pennsync_records".fleet_text(p_vehicle->'model', 80, true, 'model'),
    'vin', v_vin,
    'license_plate', pg_catalog.upper(
      "pennsync_records".fleet_text(p_vehicle->'license_plate', 30, false, 'license_plate')),
    'baseline_odometer', "pennsync_records".fleet_integer(
      p_vehicle->'baseline_odometer', 2000000, 'baseline_odometer'),
    'status', v_status,
    'notes', "pennsync_records".fleet_text(p_vehicle->'notes', 2000, false, 'notes'));
end $data$;

/* The original's `serviceData`, including both of its ordering rules. */
create function "pennsync_records".fleet_service_data(p_entry jsonb)
  returns jsonb language plpgsql stable set search_path = '' as $data$
declare
  v_key text; v_date date; v_odometer double precision; v_next date;
  v_type text; v_out jsonb;
begin
  if p_entry is null or jsonb_typeof(p_entry) <> 'object' then
    raise exception using errcode='22023', message='PENNSYNC_FLEET_ENTRY_INVALID';
  end if;
  for v_key in select k from jsonb_object_keys(p_entry) k loop
    if v_key not in ('service_date', 'odometer', 'service_type', 'description',
      'service_provider', 'cost_cents', 'invoice_reference', 'next_due_date',
      'next_due_odometer') then
      raise exception using errcode='22023', message='PENNSYNC_FLEET_FIELD_UNSUPPORTED';
    end if;
  end loop;
  v_date := "pennsync_records".fleet_date(p_entry->'service_date', 'service_date');
  if v_date > "pennsync_records".fleet_today() then
    raise exception using errcode='22023', message='PENNSYNC_FLEET_SERVICE_DATE_FUTURE';
  end if;
  v_odometer := "pennsync_records".fleet_integer(p_entry->'odometer', 2000000, 'odometer');
  v_type := p_entry->>'service_type';
  if v_type is null or v_type not in ('oil_change', 'tires', 'brakes', 'inspection',
    'scheduled_maintenance', 'repair', 'other') then
    raise exception using errcode='22023', message='PENNSYNC_FLEET_FIELD_INVALID:service_type';
  end if;
  -- The original treats an absent, null or empty next date as "none".
  if coalesce(p_entry->>'next_due_date', '') = '' then
    v_next := null;
  else
    v_next := "pennsync_records".fleet_date(p_entry->'next_due_date', 'next_due_date');
    if v_next < v_date then
      raise exception using errcode='22023', message='PENNSYNC_FLEET_NEXT_DATE_BEFORE';
    end if;
  end if;
  v_out := jsonb_build_object(
    'service_date', v_date, 'odometer', v_odometer, 'service_type', v_type,
    'description', "pennsync_records".fleet_text(p_entry->'description', 4000, true, 'description'),
    'service_provider', "pennsync_records".fleet_text(
      p_entry->'service_provider', 200, false, 'service_provider'),
    'invoice_reference', "pennsync_records".fleet_text(
      p_entry->'invoice_reference', 100, false, 'invoice_reference'),
    'next_due_date', case when v_next is null then '' else pg_catalog.to_char(v_next, 'YYYY-MM-DD') end);
  -- Both optional, and both only present when the caller sent them.
  if p_entry ? 'cost_cents' and jsonb_typeof(p_entry->'cost_cents') <> 'null' then
    v_out := v_out || jsonb_build_object('cost_cents',
      "pennsync_records".fleet_integer(p_entry->'cost_cents', 100000000, 'cost_cents'));
  end if;
  if p_entry ? 'next_due_odometer' and jsonb_typeof(p_entry->'next_due_odometer') <> 'null' then
    if "pennsync_records".fleet_integer(
      p_entry->'next_due_odometer', 2000000, 'next_due_odometer') < v_odometer then
      raise exception using errcode='22023', message='PENNSYNC_FLEET_NEXT_ODOMETER_BEFORE';
    end if;
    v_out := v_out || jsonb_build_object('next_due_odometer',
      "pennsync_records".fleet_integer(p_entry->'next_due_odometer', 2000000, 'next_due_odometer'));
  end if;
  return v_out;
end $data$;

/* The original's `VEHICLE_FIELDS`. */
create function "pennsync_records".fleet_vehicle_row(r "pennsync_records"."fleet_vehicle")
  returns jsonb language sql stable set search_path = '' as $row$
  select jsonb_build_object(
    'id', r."id", 'agency_id', r."agency_id", 'unit_name', r."unit_name",
    'year', r."year", 'make', r."make", 'model', r."model", 'vin', r."vin",
    'license_plate', r."license_plate", 'baseline_odometer', r."baseline_odometer",
    'status', r."status", 'assigned_user_id', r."assigned_user_id",
    'assigned_user_name', r."assigned_user_name",
    'assigned_user_email', r."assigned_user_email",
    'notes', r."notes", 'version', r."version", 'updated_at', r."updated_at")
$row$;

/*
 * The original's `withReviewEvents`: the entry's legacy array first, then the
 * independent review rows in `(reviewed_at, id)` order, and `review_status`
 * taken from the last event rather than from the stored column.
 */
create function "pennsync_records".fleet_review_history(p_agency text, p_entry_id text)
  returns jsonb language sql stable set search_path = '' as $history$
  select coalesce(jsonb_agg(jsonb_build_object(
      'status', v."status", 'note', v."note",
      'reviewer_id', v."reviewer_id", 'reviewer_name', v."reviewer_name",
      'reviewed_at', v."reviewed_at") order by v."reviewed_at", v."id"), '[]'::jsonb)
  from "pennsync_records"."fleet_service_review" v
  where v."source_app_id" = "pennsync_records".deployment_app()
    and v."agency_id" = p_agency and v."entry_id" = p_entry_id
$history$;

create function "pennsync_records".fleet_entry_row(
  r "pennsync_records"."fleet_service_entry", p_history jsonb)
  returns jsonb language sql stable set search_path = '' as $row$
  select jsonb_build_object(
    'id', r."id", 'agency_id', r."agency_id", 'vehicle_id', r."vehicle_id",
    'service_date', r."service_date", 'odometer', r."odometer",
    'service_type', r."service_type", 'description', r."description",
    'service_provider', r."service_provider", 'cost_cents', r."cost_cents",
    'invoice_reference', r."invoice_reference", 'next_due_date', r."next_due_date",
    'next_due_odometer', r."next_due_odometer", 'recorded_at', r."recorded_at",
    'submitted_by_user_id', r."submitted_by_user_id",
    'submitted_by_name', r."submitted_by_name",
    'submitted_by_email', r."submitted_by_email",
    'entry_source', r."entry_source",
    'review_history', p_history,
    'review_status', case when jsonb_array_length(p_history) > 0
      then p_history -> (jsonb_array_length(p_history) - 1) ->> 'status'
      else r."review_status" end)
$row$;

/*
 * A vehicle the caller may act on. Divergence 6: the `fleet_vehicle` policies
 * are agency-wide, so the assignment narrowing is the contract's.
 */
create function "pennsync_records".fleet_vehicle_for(p_agency text, p_vehicle_id text)
  returns "pennsync_records"."fleet_vehicle"
  language plpgsql stable security definer set search_path = '' as $for$
declare v_row "pennsync_records"."fleet_vehicle";
begin
  if p_vehicle_id is null or p_vehicle_id !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception using errcode='22023', message='PENNSYNC_FLEET_SUBJECT_INVALID';
  end if;
  select * into v_row from "pennsync_records"."fleet_vehicle" v
  where v."source_app_id" = "pennsync_records".deployment_app()
    and v."id" = p_vehicle_id and v."agency_id" = p_agency;
  if not found then
    raise exception using errcode='42501', message='PENNSYNC_FLEET_VEHICLE_NOT_FOUND';
  end if;
  if "pennsync_records".caller_tenant_role(p_agency) is distinct from 'agency_admin'
    and (v_row."assigned_user_id" is distinct from "pennsync_records".caller_user_id()
      or v_row."status" = 'retired') then
    raise exception using errcode='42501', message='PENNSYNC_FLEET_VEHICLE_NOT_YOURS';
  end if;
  return v_row;
end $for$;

create function "pennsync_records".contract_fleet_vehicles(
  p_agency text, p_offset integer, p_include_retired boolean)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_manage boolean; v_offset integer; v_rows jsonb := '[]'::jsonb;
  v_row "pennsync_records"."fleet_vehicle"; v_seen integer := 0;
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_FLEET_AGENCY_NOT_HELD';
  end if;
  v_manage := "pennsync_records".caller_tenant_role(p_agency) = 'agency_admin';
  v_offset := coalesce(p_offset, 0);
  if v_offset < 0 or v_offset > 1000000 then
    raise exception using errcode='22023', message='PENNSYNC_FLEET_OFFSET_INVALID';
  end if;
  -- One more than the page, so the answer can say whether there is another —
  -- which is the original's own scan limit. A typed loop rather than a window
  -- function: `row_number()` makes the row a `record`, and a record cannot be
  -- passed to a function that takes the table's composite type.
  for v_row in
    select v.* from "pennsync_records"."fleet_vehicle" v
    where v."source_app_id" = "pennsync_records".deployment_app()
      and v."agency_id" = p_agency
      -- Divergence 6 again: a non-manager sees their own, and a retired
      -- vehicle only when a manager asks for it.
      and (v_manage or v."assigned_user_id" = "pennsync_records".caller_user_id())
      and ((v_manage and coalesce(p_include_retired, false))
        or v."status" is distinct from 'retired')
    order by v."unit_name", v."id"
    offset v_offset limit 51
  loop
    v_seen := v_seen + 1;
    if v_seen > 50 then exit; end if;
    v_rows := v_rows || "pennsync_records".fleet_vehicle_row(v_row);
  end loop;
  return jsonb_build_object('success', true, 'vehicles', v_rows,
    'can_manage', v_manage,
    'next_offset', case when v_seen > 50 then v_offset + 50 else null end);
end $contract$;

create function "pennsync_records".contract_fleet_history(
  p_agency text, p_vehicle_id text, p_cursor text)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_vehicle "pennsync_records"."fleet_vehicle"; v_parts text[];
  v_day date; v_id text; v_rows jsonb := '[]'::jsonb;
  v_entry "pennsync_records"."fleet_service_entry"; v_seen integer := 0;
  v_last_day date; v_last_id text; v_cursor text;
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_FLEET_AGENCY_NOT_HELD';
  end if;
  v_vehicle := "pennsync_records".fleet_vehicle_for(p_agency, p_vehicle_id);
  -- Divergence 4: the cursor's shape is the original's verbatim, because
  -- already-published clients forward the opaque token they were given.
  if p_cursor is not null and p_cursor <> '' and p_cursor <> '0' then
    if pg_catalog.length(p_cursor) > 650 then
      raise exception using errcode='22023', message='PENNSYNC_FLEET_CURSOR_INVALID';
    end if;
    v_parts := pg_catalog.string_to_array(p_cursor, ':');
    if array_length(v_parts, 1) is distinct from 5 or v_parts[1] <> 'v1'
      or v_parts[2] <> p_agency or v_parts[3] <> v_vehicle."id" then
      raise exception using errcode='22023', message='PENNSYNC_FLEET_CURSOR_INVALID';
    end if;
    v_day := "pennsync_records".fleet_date(to_jsonb(v_parts[4]), 'cursor');
    v_id := v_parts[5];
    if v_id !~ '^[A-Za-z0-9_-]{1,200}$' then
      raise exception using errcode='22023', message='PENNSYNC_FLEET_CURSOR_INVALID';
    end if;
  end if;

  -- Divergence 4: the whole of the original's three-query dance is this one
  -- keyset, because a row comparison sorts on two columns and the SDK could
  -- sort on one.
  for v_entry in
    select e.* from "pennsync_records"."fleet_service_entry" e
    where e."source_app_id" = "pennsync_records".deployment_app()
      and e."agency_id" = p_agency and e."vehicle_id" = v_vehicle."id"
      and (v_day is null or (e."service_date", e."id") < (v_day, v_id))
    order by e."service_date" desc, e."id" desc
    limit 51
  loop
    v_seen := v_seen + 1;
    if v_seen > 50 then exit; end if;
    v_rows := v_rows || "pennsync_records".fleet_entry_row(v_entry,
      "pennsync_records".fleet_review_history(p_agency, v_entry."id"));
    v_last_day := v_entry."service_date";
    v_last_id := v_entry."id";
  end loop;
  if v_seen > 50 then
    v_cursor := 'v1:' || p_agency || ':' || v_vehicle."id" || ':'
      || pg_catalog.to_char(v_last_day, 'YYYY-MM-DD') || ':' || v_last_id;
  end if;
  return jsonb_build_object('success', true,
    'vehicle', "pennsync_records".fleet_vehicle_row(v_vehicle),
    'entries', v_rows,
    'next_cursor', v_cursor,
    -- The original's compatibility alias, in its own words: "already-published
    -- clients forward this opaque token in their offset property".
    'next_offset', v_cursor);
end $contract$;

/* The assignee, proved through membership (divergence 3). */
create function "pennsync_records".fleet_assignee(p_agency text, p_user_id text)
  returns jsonb language plpgsql stable security definer set search_path = '' as $assignee$
declare v_email text;
begin
  if p_user_id is null or p_user_id = '' then
    return jsonb_build_object('assigned_user_id', '', 'assigned_user_name', '',
      'assigned_user_email', '');
  end if;
  if p_user_id !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception using errcode='22023', message='PENNSYNC_FLEET_SUBJECT_INVALID';
  end if;
  select m.expected_email into v_email
  from pennsync_private.agency_member(p_agency, p_user_id) m;
  if v_email is null then
    raise exception using errcode='42501', message='PENNSYNC_FLEET_ASSIGNEE_UNKNOWN';
  end if;
  -- The address IS the name: the carried `user` table has no name column, as
  -- D38 recorded, and `contract_roster` projects none either.
  return jsonb_build_object('assigned_user_id', p_user_id,
    'assigned_user_name', v_email, 'assigned_user_email', v_email);
end $assignee$;

create function "pennsync_records".contract_fleet_vehicle_create(
  p_agency text, p_request_id text, p_vehicle jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_row "pennsync_records"."fleet_vehicle"; v_data jsonb; v_who jsonb;
  v_key text; v_now timestamptz; v_id text;
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_FLEET_AGENCY_NOT_HELD';
  end if;
  if "pennsync_records".caller_tenant_role(p_agency) <> 'agency_admin' then
    raise exception using errcode='42501', message='PENNSYNC_FLEET_FORBIDDEN';
  end if;
  if p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception using errcode='22023', message='PENNSYNC_FLEET_REQUEST_INVALID';
  end if;
  v_data := "pennsync_records".fleet_vehicle_data(p_vehicle);
  v_who := "pennsync_records".fleet_assignee(p_agency, p_vehicle->>'assigned_user_id');
  v_key := p_agency || ':' || "pennsync_records".caller_user_id() || ':' || p_request_id;

  -- The reservation protocol the original emulates, made real: the agency row
  -- exists, so locking it serializes the check and the insert.
  perform 1 from "pennsync_records"."agency" a
  where a."source_app_id" = "pennsync_records".deployment_app() and a."id" = p_agency
  for update;
  select * into v_row from "pennsync_records"."fleet_vehicle" v
  where v."source_app_id" = "pennsync_records".deployment_app()
    and v."agency_id" = p_agency and v."request_key" = v_key;
  if found then
    return jsonb_build_object('success', true, 'deduplicated', true,
      'vehicle', "pennsync_records".fleet_vehicle_row(v_row));
  end if;

  v_now := clock_timestamp();
  v_id := pg_catalog.substr(pg_catalog.md5(pg_catalog.gen_random_uuid()::text), 1, 24);
  insert into "pennsync_records"."fleet_vehicle"
    ("source_app_id", "id", "agency_id", "request_key", "unit_name", "year",
     "make", "model", "vin", "license_plate", "baseline_odometer", "status",
     "assigned_user_id", "assigned_user_name", "assigned_user_email", "notes",
     "version", "created_by_user_id", "updated_by_user_id", "updated_at",
     "created_by", "created_date", "updated_date")
  values ("pennsync_records".deployment_app(), v_id, p_agency, v_key,
    v_data->>'unit_name', (v_data->>'year')::double precision,
    v_data->>'make', v_data->>'model', v_data->>'vin', v_data->>'license_plate',
    (v_data->>'baseline_odometer')::double precision, v_data->>'status',
    nullif(v_who->>'assigned_user_id', ''), nullif(v_who->>'assigned_user_name', ''),
    nullif(v_who->>'assigned_user_email', ''), v_data->>'notes',
    1, "pennsync_records".caller_user_id(), "pennsync_records".caller_user_id(), v_now,
    "pennsync_records".caller_email(), v_now, v_now)
  returning * into v_row;
  return jsonb_build_object('success', true,
    'vehicle', "pennsync_records".fleet_vehicle_row(v_row));
end $contract$;

create function "pennsync_records".contract_fleet_vehicle_update(
  p_agency text, p_vehicle_id text, p_expected_version double precision, p_vehicle jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_row "pennsync_records"."fleet_vehicle"; v_data jsonb; v_who jsonb; v_now timestamptz;
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_FLEET_AGENCY_NOT_HELD';
  end if;
  if "pennsync_records".caller_tenant_role(p_agency) <> 'agency_admin' then
    raise exception using errcode='42501', message='PENNSYNC_FLEET_FORBIDDEN';
  end if;
  if p_vehicle_id is null or p_vehicle_id !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception using errcode='22023', message='PENNSYNC_FLEET_SUBJECT_INVALID';
  end if;
  select * into v_row from "pennsync_records"."fleet_vehicle" v
  where v."source_app_id" = "pennsync_records".deployment_app()
    and v."id" = p_vehicle_id and v."agency_id" = p_agency
  for update;
  if not found then
    raise exception using errcode='42501', message='PENNSYNC_FLEET_VEHICLE_NOT_FOUND';
  end if;
  if p_expected_version is null or v_row."version" is distinct from p_expected_version then
    raise exception using errcode='40001', message='PENNSYNC_FLEET_VEHICLE_STALE';
  end if;
  v_data := "pennsync_records".fleet_vehicle_data(p_vehicle);
  v_who := "pennsync_records".fleet_assignee(p_agency, p_vehicle->>'assigned_user_id');
  v_now := clock_timestamp();
  update "pennsync_records"."fleet_vehicle" v set
    "unit_name" = v_data->>'unit_name', "year" = (v_data->>'year')::double precision,
    "make" = v_data->>'make', "model" = v_data->>'model', "vin" = v_data->>'vin',
    "license_plate" = v_data->>'license_plate',
    "baseline_odometer" = (v_data->>'baseline_odometer')::double precision,
    "status" = v_data->>'status',
    "assigned_user_id" = nullif(v_who->>'assigned_user_id', ''),
    "assigned_user_name" = nullif(v_who->>'assigned_user_name', ''),
    "assigned_user_email" = nullif(v_who->>'assigned_user_email', ''),
    "notes" = v_data->>'notes',
    "version" = v_row."version" + 1,
    "updated_by_user_id" = "pennsync_records".caller_user_id(),
    "updated_at" = v_now, "updated_date" = v_now
  where v."source_app_id" = v_row."source_app_id" and v."id" = v_row."id"
  returning * into v_row;
  return jsonb_build_object('success', true,
    'vehicle', "pennsync_records".fleet_vehicle_row(v_row));
end $contract$;

create function "pennsync_records".contract_fleet_entry_add(
  p_agency text, p_vehicle_id text, p_request_id text, p_entry jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_vehicle "pennsync_records"."fleet_vehicle"; v_row "pennsync_records"."fleet_service_entry";
  v_data jsonb; v_key text; v_now timestamptz; v_id text; v_manage boolean; v_email text;
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_FLEET_AGENCY_NOT_HELD';
  end if;
  if p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception using errcode='22023', message='PENNSYNC_FLEET_REQUEST_INVALID';
  end if;
  v_vehicle := "pennsync_records".fleet_vehicle_for(p_agency, p_vehicle_id);
  if v_vehicle."status" = 'retired' then
    raise exception using errcode='22023', message='PENNSYNC_FLEET_VEHICLE_RETIRED';
  end if;
  v_data := "pennsync_records".fleet_service_data(p_entry);
  v_manage := "pennsync_records".caller_tenant_role(p_agency) = 'agency_admin';
  v_email := "pennsync_records".caller_email();
  v_key := p_agency || ':' || "pennsync_records".caller_user_id() || ':' || p_request_id;

  -- The vehicle is the parent the original claims a slot on; locking it is
  -- what that claim was for.
  perform 1 from "pennsync_records"."fleet_vehicle" v
  where v."source_app_id" = v_vehicle."source_app_id" and v."id" = v_vehicle."id"
  for update;
  select * into v_row from "pennsync_records"."fleet_service_entry" e
  where e."source_app_id" = "pennsync_records".deployment_app()
    and e."agency_id" = p_agency and e."vehicle_id" = v_vehicle."id"
    and e."request_key" = v_key;
  if found then
    return jsonb_build_object('success', true, 'deduplicated', true,
      'entry', "pennsync_records".fleet_entry_row(v_row,
        "pennsync_records".fleet_review_history(p_agency, v_row."id")));
  end if;

  v_now := clock_timestamp();
  v_id := pg_catalog.substr(pg_catalog.md5(pg_catalog.gen_random_uuid()::text), 1, 24);
  insert into "pennsync_records"."fleet_service_entry"
    ("source_app_id", "id", "agency_id", "vehicle_id", "request_key",
     "service_date", "odometer", "service_type", "description", "service_provider",
     "cost_cents", "invoice_reference", "next_due_date", "next_due_odometer",
     "recorded_at", "submitted_by_user_id", "submitted_by_name", "submitted_by_email",
     "entry_source", "review_status", "created_by", "created_date", "updated_date")
  values ("pennsync_records".deployment_app(), v_id, p_agency, v_vehicle."id", v_key,
    (v_data->>'service_date')::date, (v_data->>'odometer')::double precision,
    v_data->>'service_type', v_data->>'description', v_data->>'service_provider',
    case when v_data ? 'cost_cents' then (v_data->>'cost_cents')::double precision end,
    v_data->>'invoice_reference', nullif(v_data->>'next_due_date', ''),
    case when v_data ? 'next_due_odometer'
      then (v_data->>'next_due_odometer')::double precision end,
    v_now, "pennsync_records".caller_user_id(), v_email, v_email,
    case when v_manage then 'admin' else 'employee' end, 'pending',
    v_email, v_now, v_now)
  returning * into v_row;
  return jsonb_build_object('success', true,
    'entry', "pennsync_records".fleet_entry_row(v_row,
      "pennsync_records".fleet_review_history(p_agency, v_row."id")));
end $contract$;

create function "pennsync_records".contract_fleet_entry_review(
  p_agency text, p_vehicle_id text, p_entry_id text, p_request_id text,
  p_expected_review_count integer, p_status text, p_note jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_vehicle "pennsync_records"."fleet_vehicle"; v_entry "pennsync_records"."fleet_service_entry";
  v_history jsonb; v_note text; v_key text; v_now timestamptz; v_id text; v_email text;
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_FLEET_AGENCY_NOT_HELD';
  end if;
  if "pennsync_records".caller_tenant_role(p_agency) <> 'agency_admin' then
    raise exception using errcode='42501', message='PENNSYNC_FLEET_FORBIDDEN';
  end if;
  if p_entry_id is null or p_entry_id !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception using errcode='22023', message='PENNSYNC_FLEET_SUBJECT_INVALID';
  end if;
  if p_status is null or p_status not in ('reviewed', 'needs_follow_up') then
    raise exception using errcode='22023', message='PENNSYNC_FLEET_REVIEW_STATUS_INVALID';
  end if;
  v_vehicle := "pennsync_records".fleet_vehicle_for(p_agency, p_vehicle_id);
  -- Locking the ENTRY is what the original's `review_creation_claims` on it
  -- was emulating; it is also what serializes two administrators reviewing at
  -- once, which its own comment says must not erase each other.
  select * into v_entry from "pennsync_records"."fleet_service_entry" e
  where e."source_app_id" = "pennsync_records".deployment_app()
    and e."id" = p_entry_id and e."agency_id" = p_agency
    and e."vehicle_id" = v_vehicle."id"
  for update;
  if not found then
    raise exception using errcode='42501', message='PENNSYNC_FLEET_ENTRY_NOT_FOUND';
  end if;
  v_history := "pennsync_records".fleet_review_history(p_agency, v_entry."id");
  if p_expected_review_count is null or p_expected_review_count < 0
    or p_expected_review_count > 5000 then
    raise exception using errcode='22023', message='PENNSYNC_FLEET_REVIEW_COUNT_INVALID';
  end if;
  -- The original refuses only a count that is AHEAD of the history, not one
  -- behind it: another administrator's annotation does not invalidate yours.
  if p_expected_review_count > jsonb_array_length(v_history) then
    raise exception using errcode='40001', message='PENNSYNC_FLEET_REVIEW_STALE';
  end if;
  if jsonb_array_length(v_history) >= 100 then
    raise exception using errcode='22023', message='PENNSYNC_FLEET_REVIEW_HISTORY_FULL';
  end if;
  v_note := "pennsync_records".fleet_text(p_note, 2000,
    p_status = 'needs_follow_up', 'note');
  v_email := "pennsync_records".caller_email();
  v_key := p_agency || ':' || v_entry."id" || ':' || "pennsync_records".caller_user_id()
    || ':' || coalesce(nullif(p_request_id, ''),
      pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
        v_entry."id" || '|' || "pennsync_records".caller_user_id() || '|'
        || p_expected_review_count::text || '|' || p_status || '|' || v_note, 'UTF8')), 'hex'));
  if pg_catalog.length(v_key) > 900 then
    raise exception using errcode='22023', message='PENNSYNC_FLEET_REQUEST_INVALID';
  end if;

  if exists (select 1 from "pennsync_records"."fleet_service_review" v
    where v."source_app_id" = "pennsync_records".deployment_app()
      and v."agency_id" = p_agency and v."request_key" = v_key) then
    return jsonb_build_object('success', true, 'deduplicated', true,
      'entry', "pennsync_records".fleet_entry_row(v_entry,
        "pennsync_records".fleet_review_history(p_agency, v_entry."id")));
  end if;
  v_now := clock_timestamp();
  v_id := pg_catalog.substr(pg_catalog.md5(pg_catalog.gen_random_uuid()::text), 1, 24);
  -- D32: an INSERT and nothing else. `fleet_service_review` has no update and
  -- no delete policy, and the entry's own `review_status` is left alone —
  -- the answer's is the latest event.
  insert into "pennsync_records"."fleet_service_review"
    ("source_app_id", "id", "agency_id", "vehicle_id", "entry_id", "request_key",
     "status", "note", "reviewer_id", "reviewer_name", "reviewed_at",
     "created_by", "created_date", "updated_date")
  values ("pennsync_records".deployment_app(), v_id, p_agency, v_vehicle."id",
    v_entry."id", v_key, p_status, v_note,
    "pennsync_records".caller_user_id(), v_email, v_now, v_email, v_now, v_now);
  return jsonb_build_object('success', true,
    'entry', "pennsync_records".fleet_entry_row(v_entry,
      "pennsync_records".fleet_review_history(p_agency, v_entry."id")));
end $contract$;

reset role;

revoke all on function
  "pennsync_records".fleet_today(),
  "pennsync_records".fleet_text(jsonb,integer,boolean,text),
  "pennsync_records".fleet_integer(jsonb,double precision,text),
  "pennsync_records".fleet_date(jsonb,text),
  "pennsync_records".fleet_vehicle_data(jsonb),
  "pennsync_records".fleet_service_data(jsonb),
  "pennsync_records".fleet_vehicle_row("pennsync_records"."fleet_vehicle"),
  "pennsync_records".fleet_review_history(text,text),
  "pennsync_records".fleet_entry_row("pennsync_records"."fleet_service_entry",jsonb),
  "pennsync_records".fleet_vehicle_for(text,text),
  "pennsync_records".fleet_assignee(text,text),
  "pennsync_records".contract_fleet_vehicles(text,integer,boolean),
  "pennsync_records".contract_fleet_history(text,text,text),
  "pennsync_records".contract_fleet_vehicle_create(text,text,jsonb),
  "pennsync_records".contract_fleet_vehicle_update(text,text,double precision,jsonb),
  "pennsync_records".contract_fleet_entry_add(text,text,text,jsonb),
  "pennsync_records".contract_fleet_entry_review(text,text,text,text,integer,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function
  "pennsync_records".contract_fleet_vehicles(text,integer,boolean),
  "pennsync_records".contract_fleet_history(text,text,text),
  "pennsync_records".contract_fleet_vehicle_create(text,text,jsonb),
  "pennsync_records".contract_fleet_vehicle_update(text,text,double precision,jsonb),
  "pennsync_records".contract_fleet_entry_add(text,text,text,jsonb),
  "pennsync_records".contract_fleet_entry_review(text,text,text,text,integer,text,jsonb)
  to authenticated;

create function "public"."pennsync_contract_fleet_vehicles"(
  p_agency text, p_offset integer, p_include_retired boolean) returns jsonb
  language sql security invoker set search_path = '' as $c$
  select "pennsync_records".contract_fleet_vehicles(p_agency, p_offset, p_include_retired)
$c$;
create function "public"."pennsync_contract_fleet_history"(
  p_agency text, p_vehicle_id text, p_cursor text) returns jsonb
  language sql security invoker set search_path = '' as $c$
  select "pennsync_records".contract_fleet_history(p_agency, p_vehicle_id, p_cursor)
$c$;
create function "public"."pennsync_contract_fleet_vehicle_create"(
  p_agency text, p_request_id text, p_vehicle jsonb) returns jsonb
  language sql security invoker set search_path = '' as $c$
  select "pennsync_records".contract_fleet_vehicle_create(p_agency, p_request_id, p_vehicle)
$c$;
create function "public"."pennsync_contract_fleet_vehicle_update"(
  p_agency text, p_vehicle_id text, p_expected_version double precision, p_vehicle jsonb)
  returns jsonb language sql security invoker set search_path = '' as $c$
  select "pennsync_records".contract_fleet_vehicle_update(
    p_agency, p_vehicle_id, p_expected_version, p_vehicle)
$c$;
create function "public"."pennsync_contract_fleet_entry_add"(
  p_agency text, p_vehicle_id text, p_request_id text, p_entry jsonb) returns jsonb
  language sql security invoker set search_path = '' as $c$
  select "pennsync_records".contract_fleet_entry_add(
    p_agency, p_vehicle_id, p_request_id, p_entry)
$c$;
create function "public"."pennsync_contract_fleet_entry_review"(
  p_agency text, p_vehicle_id text, p_entry_id text, p_request_id text,
  p_expected_review_count integer, p_status text, p_note jsonb) returns jsonb
  language sql security invoker set search_path = '' as $c$
  select "pennsync_records".contract_fleet_entry_review(p_agency, p_vehicle_id,
    p_entry_id, p_request_id, p_expected_review_count, p_status, p_note)
$c$;

revoke all on function
  "public"."pennsync_contract_fleet_vehicles"(text,integer,boolean),
  "public"."pennsync_contract_fleet_history"(text,text,text),
  "public"."pennsync_contract_fleet_vehicle_create"(text,text,jsonb),
  "public"."pennsync_contract_fleet_vehicle_update"(text,text,double precision,jsonb),
  "public"."pennsync_contract_fleet_entry_add"(text,text,text,jsonb),
  "public"."pennsync_contract_fleet_entry_review"(text,text,text,text,integer,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function
  "public"."pennsync_contract_fleet_vehicles"(text,integer,boolean),
  "public"."pennsync_contract_fleet_history"(text,text,text),
  "public"."pennsync_contract_fleet_vehicle_create"(text,text,jsonb),
  "public"."pennsync_contract_fleet_vehicle_update"(text,text,double precision,jsonb),
  "public"."pennsync_contract_fleet_entry_add"(text,text,text,jsonb),
  "public"."pennsync_contract_fleet_entry_review"(text,text,text,text,integer,text,jsonb)
  to authenticated;

commit;
