-- Saved fax cover pages: one person's own templates.
--
-- HAND WRITTEN, like every contract. Live in the hosted app today, so this
-- restores what it does and nothing more.
--
-- TENANCY IS NOT OWNERSHIP again (D36, D45), and the ownership column is a
-- SINGLE one here rather than the pair `fax_contact` needs. The entity's own
-- rls is `{ "created_by": "{{user.email}}" }` on all four operations, and its
-- comment says why that column and not another: "Base44's immutable created_by
-- field is the ownership boundary; shared tenant templates require the future
-- server-owned membership model." So the contract asks `created_by` and does
-- not invent a second check `fax_template` has no column for — the entity
-- carries no `user_email`, and adding one here would be a field nobody wrote.
--
-- READ THE PAIR'S DIFFERENCE RATHER THAN COPYING EITHER: `fax_contact` needs
-- both columns because its original asks for both, and this one needs one
-- because its original asks for one. The predicate is the original's, measured
-- per entity, not a house style.
--
-- THE DIVERGENCE THE ORIGINAL ASKED FOR, in its own words. The use counter is
-- bumped from the browser, and `FaxTemplateManager.jsx` says of it:
--
--     "this remains a client-side read-modify-write, so concurrent applies can
--      still lose an increment — a fully correct fix needs an atomic
--      server-side increment (a base44 function), which can't be added from
--      src/."
--
-- It can be added here, so it is: `use_count` is RESERVED on both writes and
-- `contract_fax_template_use` increments it in SQL. This is not a widening — it
-- is the same capability the screen already performs, with the lost update
-- removed — and it is the counter-case to D68's rule about version checks: that
-- one keeps an expectation because the CALLER supplies it, and this one deletes
-- a read-modify-write because the caller supplies nothing but the id.
--
-- OTHER DIVERGENCES, each deliberate:
--
-- 1. `agency_id` is stamped from the authorized agency. The original leaves it
--    unset on every browser write.
-- 2. An unknown key is REFUSED rather than dropped (D39).
-- 3. `document_url`, `document_name` and `cover_page_data` are carried columns
--    that this contract neither writes nor projects, and that is measured
--    rather than assumed: the manager's form holds no document field, its
--    `openEdit` reads none of the three, and nothing else in `src/` touches a
--    template's document. `document_url` is a STORAGE LOCATOR besides, which is
--    D71's reason for not projecting `pdf_url` and D77's for keying a locator
--    map on the locator rather than the row. A caller that one day needs the
--    attachment gets `resolve_file_locator` through a contract that authorizes
--    the row, not a Base44 URL projected out of this one.
-- 4. `is_default` is a plain flag and NOTHING enforces that one person has one
--    default, because nothing in the original does either: the form sets the
--    checkbox, the list renders a badge, and no code reads "the" default. Two
--    defaults is therefore a state the hosted app can already reach, and
--    collapsing them here would be a behaviour change dressed as a fix.
begin;

do $$
begin
  if to_regclass('pennsync_records.fax_template') is null
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

/*
 * What a caller may send, and what this contract decides for them.
 *
 * `use_count` is in the RESERVED list and that placement is the divergence
 * above: with it writable, the atomic increment beside it would be a second
 * answer to the same question and the browser's lost update would still be
 * reachable. The three document columns are in NEITHER list, so they refuse as
 * unsupported — a caller asking for them is asking for something nothing in
 * the product writes.
 */
create function "pennsync_records".fax_template_writable()
  returns text[] language sql immutable set search_path = '' as $fields$
  select array['name','description','recipient_name','recipient_fax_number',
    'recipient_organization','subject','notes','is_default']::text[]
$fields$;

create function "pennsync_records".fax_template_reserved()
  returns text[] language sql immutable set search_path = '' as $fields$
  select array['use_count','agency_id','created_by','id','created_date',
    'updated_date','source_app_id']::text[]
$fields$;

create function "pennsync_records".fax_template_check_payload(p_payload jsonb)
  returns void language plpgsql immutable set search_path = '' as $check$
declare v_key text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode='22023', message='PENNSYNC_FAX_TEMPLATE_INVALID';
  end if;
  if p_payload = '{}'::jsonb then
    raise exception using errcode='22023', message='PENNSYNC_FAX_TEMPLATE_EMPTY';
  end if;
  for v_key in select k from jsonb_object_keys(p_payload) k loop
    if v_key = any ("pennsync_records".fax_template_reserved()) then
      raise exception using errcode='22023', message='PENNSYNC_FAX_TEMPLATE_FIELD_RESERVED';
    end if;
    if not (v_key = any ("pennsync_records".fax_template_writable())) then
      raise exception using errcode='22023', message='PENNSYNC_FAX_TEMPLATE_FIELD_UNSUPPORTED';
    end if;
  end loop;
end $check$;

/*
 * The projection (D64), with the three document columns deliberately absent
 * and `created_by` present for the same reason `fax_contact` projects it: a
 * caller comparing the row it was handed against the person it belongs to is
 * the only way an ownership regression here is visible from outside.
 */
create function "pennsync_records".fax_template_row(p_row "pennsync_records"."fax_template")
  returns jsonb language sql immutable set search_path = '' as $row$
  select jsonb_build_object(
    'id', p_row."id",
    'name', p_row."name",
    'description', p_row."description",
    'recipient_name', p_row."recipient_name",
    'recipient_fax_number', p_row."recipient_fax_number",
    'recipient_organization', p_row."recipient_organization",
    'subject', p_row."subject",
    'notes', p_row."notes",
    'is_default', p_row."is_default",
    'use_count', p_row."use_count",
    'created_by', p_row."created_by",
    'created_date', p_row."created_date",
    'updated_date', p_row."updated_date")
$row$;

create function "pennsync_records".contract_fax_template_list(
  p_agency text, p_limit integer default 50)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_rows jsonb; v_email text; v_limit integer;
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_FAX_TEMPLATE_FORBIDDEN';
  end if;
  -- Re-applied in SQL, because a bound a caller could raise is not a bound
  -- (D71). The screen asks for 50.
  v_limit := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_email := "pennsync_records".caller_email();
  select coalesce(jsonb_agg("pennsync_records".fax_template_row(t.r) order by
      t.ordered_date desc nulls last, t.ordered_id desc), '[]'::jsonb)
    into v_rows
  from (
    select f as r, f."created_date" as ordered_date, f."id" as ordered_id
    from "pennsync_records"."fax_template" f
    where f."source_app_id" = "pennsync_records".deployment_app()
      and f."agency_id" = p_agency
      and f."created_by" = v_email
    order by f."created_date" desc nulls last, f."id" desc
    limit v_limit
  ) t;
  return jsonb_build_object('success', true, 'templates', v_rows);
end $contract$;

create function "pennsync_records".contract_fax_template_create(
  p_agency text, p_template jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_row "pennsync_records"."fax_template"; v_email text; v_now timestamptz; v_id text;
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_FAX_TEMPLATE_FORBIDDEN';
  end if;
  perform "pennsync_records".fax_template_check_payload(p_template);
  -- The entity's one required field. The original checks it in the browser
  -- ("Template name is required") and nowhere the browser cannot reach.
  if "pennsync_records".fax_text(p_template->'name', 200) is null then
    raise exception using errcode='22023', message='PENNSYNC_FAX_TEMPLATE_NAME_REQUIRED';
  end if;
  v_email := "pennsync_records".caller_email();
  if v_email is null then
    raise exception using errcode='42501', message='PENNSYNC_FAX_TEMPLATE_FORBIDDEN';
  end if;
  v_now := clock_timestamp();
  v_id := pg_catalog.substr(pg_catalog.md5(pg_catalog.gen_random_uuid()::text), 1, 24);
  insert into "pennsync_records"."fax_template"
    ("source_app_id", "id", "name", "description", "recipient_name",
     "recipient_fax_number", "recipient_organization", "subject", "notes",
     "is_default", "use_count", "agency_id", "created_by", "created_date", "updated_date")
  values ("pennsync_records".deployment_app(), v_id,
    "pennsync_records".fax_text(p_template->'name', 200),
    "pennsync_records".fax_text(p_template->'description', 1000),
    "pennsync_records".fax_text(p_template->'recipient_name', 200),
    "pennsync_records".fax_text(p_template->'recipient_fax_number', 40),
    "pennsync_records".fax_text(p_template->'recipient_organization', 200),
    "pennsync_records".fax_text(p_template->'subject', 500),
    "pennsync_records".fax_text(p_template->'notes', 5000),
    "pennsync_records".fax_flag(p_template->'is_default', false),
    -- The original sends `use_count: 0` on create and the contract reserves
    -- the field, so this is the same value arriving from the side that owns it.
    0, p_agency, v_email, v_now, v_now)
  returning * into v_row;
  return jsonb_build_object('success', true,
    'template', "pennsync_records".fax_template_row(v_row));
end $contract$;

create function "pennsync_records".contract_fax_template_update(
  p_agency text, p_id text, p_template jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_row "pennsync_records"."fax_template"; v_email text; v_now timestamptz;
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_FAX_TEMPLATE_FORBIDDEN';
  end if;
  perform "pennsync_records".fax_template_check_payload(p_template);
  if coalesce(pg_catalog.btrim(coalesce(p_id, '')), '') = '' then
    raise exception using errcode='22023', message='PENNSYNC_FAX_TEMPLATE_ID_REQUIRED';
  end if;
  v_email := "pennsync_records".caller_email();
  select * into v_row from "pennsync_records"."fax_template" f
  where f."source_app_id" = "pennsync_records".deployment_app()
    and f."agency_id" = p_agency and f."id" = p_id and f."created_by" = v_email
  for update;
  -- Not found and not mine are ONE answer, for `fax_contact`'s reason.
  if not found then
    raise exception using errcode='42501', message='PENNSYNC_FAX_TEMPLATE_NOT_FOUND';
  end if;
  v_now := clock_timestamp();
  update "pennsync_records"."fax_template" f set
    "name" = case when p_template ? 'name'
      then "pennsync_records".fax_text(p_template->'name', 200) else f."name" end,
    "description" = case when p_template ? 'description'
      then "pennsync_records".fax_text(p_template->'description', 1000) else f."description" end,
    "recipient_name" = case when p_template ? 'recipient_name'
      then "pennsync_records".fax_text(p_template->'recipient_name', 200) else f."recipient_name" end,
    "recipient_fax_number" = case when p_template ? 'recipient_fax_number'
      then "pennsync_records".fax_text(p_template->'recipient_fax_number', 40) else f."recipient_fax_number" end,
    "recipient_organization" = case when p_template ? 'recipient_organization'
      then "pennsync_records".fax_text(p_template->'recipient_organization', 200) else f."recipient_organization" end,
    "subject" = case when p_template ? 'subject'
      then "pennsync_records".fax_text(p_template->'subject', 500) else f."subject" end,
    "notes" = case when p_template ? 'notes'
      then "pennsync_records".fax_text(p_template->'notes', 5000) else f."notes" end,
    "is_default" = case when p_template ? 'is_default'
      then "pennsync_records".fax_flag(p_template->'is_default', f."is_default") else f."is_default" end,
    "updated_date" = v_now
  where f."source_app_id" = v_row."source_app_id" and f."id" = v_row."id"
  returning * into v_row;
  if v_row."name" is null then
    raise exception using errcode='22023', message='PENNSYNC_FAX_TEMPLATE_NAME_REQUIRED';
  end if;
  return jsonb_build_object('success', true,
    'template', "pennsync_records".fax_template_row(v_row));
end $contract$;

/*
 * The atomic increment the original says it needs and cannot have.
 *
 * `use_count = use_count + 1` inside the UPDATE, so two concurrent applies
 * both land: read committed re-reads the row the second statement blocks on,
 * and the arithmetic is the database's rather than a value the browser
 * computed from a row it read earlier. Nothing else about the template moves,
 * and `updated_date` deliberately does NOT move either — a template whose
 * "last edited" time changed because somebody used it would read as an edit.
 */
create function "pennsync_records".contract_fax_template_use(
  p_agency text, p_id text)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_row "pennsync_records"."fax_template"; v_email text;
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_FAX_TEMPLATE_FORBIDDEN';
  end if;
  if coalesce(pg_catalog.btrim(coalesce(p_id, '')), '') = '' then
    raise exception using errcode='22023', message='PENNSYNC_FAX_TEMPLATE_ID_REQUIRED';
  end if;
  v_email := "pennsync_records".caller_email();
  update "pennsync_records"."fax_template" f
    set "use_count" = coalesce(f."use_count", 0) + 1
  where f."source_app_id" = "pennsync_records".deployment_app()
    and f."agency_id" = p_agency and f."id" = p_id and f."created_by" = v_email
  returning * into v_row;
  if not found then
    raise exception using errcode='42501', message='PENNSYNC_FAX_TEMPLATE_NOT_FOUND';
  end if;
  return jsonb_build_object('success', true,
    'template', "pennsync_records".fax_template_row(v_row));
end $contract$;

create function "pennsync_records".contract_fax_template_delete(
  p_agency text, p_id text)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_email text; v_deleted text;
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_FAX_TEMPLATE_FORBIDDEN';
  end if;
  if coalesce(pg_catalog.btrim(coalesce(p_id, '')), '') = '' then
    raise exception using errcode='22023', message='PENNSYNC_FAX_TEMPLATE_ID_REQUIRED';
  end if;
  v_email := "pennsync_records".caller_email();
  delete from "pennsync_records"."fax_template" f
  where f."source_app_id" = "pennsync_records".deployment_app()
    and f."agency_id" = p_agency and f."id" = p_id and f."created_by" = v_email
  returning f."id" into v_deleted;
  if v_deleted is null then
    raise exception using errcode='42501', message='PENNSYNC_FAX_TEMPLATE_NOT_FOUND';
  end if;
  return jsonb_build_object('success', true, 'id', v_deleted);
end $contract$;

reset role;

revoke all on function
  "pennsync_records".fax_template_writable(),
  "pennsync_records".fax_template_reserved(),
  "pennsync_records".fax_template_check_payload(jsonb),
  "pennsync_records".fax_template_row("pennsync_records"."fax_template"),
  "pennsync_records".contract_fax_template_list(text,integer),
  "pennsync_records".contract_fax_template_create(text,jsonb),
  "pennsync_records".contract_fax_template_update(text,text,jsonb),
  "pennsync_records".contract_fax_template_use(text,text),
  "pennsync_records".contract_fax_template_delete(text,text)
  from public, anon, authenticated, service_role;
grant execute on function
  "pennsync_records".contract_fax_template_list(text,integer),
  "pennsync_records".contract_fax_template_create(text,jsonb),
  "pennsync_records".contract_fax_template_update(text,text,jsonb),
  "pennsync_records".contract_fax_template_use(text,text),
  "pennsync_records".contract_fax_template_delete(text,text)
  to authenticated;

create function "public"."pennsync_contract_fax_template_list"(
  p_agency text, p_limit integer default 50) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_fax_template_list(p_agency, p_limit)
$contract$;

create function "public"."pennsync_contract_fax_template_create"(
  p_agency text, p_template jsonb) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_fax_template_create(p_agency, p_template)
$contract$;

create function "public"."pennsync_contract_fax_template_update"(
  p_agency text, p_id text, p_template jsonb) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_fax_template_update(p_agency, p_id, p_template)
$contract$;

create function "public"."pennsync_contract_fax_template_use"(
  p_agency text, p_id text) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_fax_template_use(p_agency, p_id)
$contract$;

create function "public"."pennsync_contract_fax_template_delete"(
  p_agency text, p_id text) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_fax_template_delete(p_agency, p_id)
$contract$;

revoke all on function
  "public"."pennsync_contract_fax_template_list"(text,integer),
  "public"."pennsync_contract_fax_template_create"(text,jsonb),
  "public"."pennsync_contract_fax_template_update"(text,text,jsonb),
  "public"."pennsync_contract_fax_template_use"(text,text),
  "public"."pennsync_contract_fax_template_delete"(text,text)
  from public, anon, authenticated, service_role;
grant execute on function
  "public"."pennsync_contract_fax_template_list"(text,integer),
  "public"."pennsync_contract_fax_template_create"(text,jsonb),
  "public"."pennsync_contract_fax_template_update"(text,text,jsonb),
  "public"."pennsync_contract_fax_template_use"(text,text),
  "public"."pennsync_contract_fax_template_delete"(text,text)
  to authenticated;

commit;
