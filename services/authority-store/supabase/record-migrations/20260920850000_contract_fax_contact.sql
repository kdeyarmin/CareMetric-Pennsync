-- The fax address book: one person's own contacts.
--
-- HAND WRITTEN, like every contract. The capability is live in the hosted app
-- today — the address book is reachable from the Fax hub and from the send
-- screen's recipient field — so this restores what it does and nothing more.
--
-- TENANCY IS NOT OWNERSHIP, for the third time in this store (D36, D45). The
-- generated policies on `fax_contact` are agency-WIDE, because the entity
-- declares `agency_id` and nothing narrower is derivable from a schema; the
-- ENTITY's own rls is per-person and is an `$and` of two fields:
--
--     "read": { "$and": [ { "created_by": "{{user.email}}" },
--                         { "data.user_email": "{{user.email}}" } ] }
--
-- so a port that leaned on the policies would hand every member of an agency
-- every colleague's address book. D45's rule decides the shape of the
-- substitute: a row carrying one of each belongs to NEITHER person, so the
-- contract's predicate is BOTH columns and not either.
--
-- `is_shared` is accepted, stored and projected, and it CHANGES NOTHING here —
-- which is the faithful reading rather than a gap. The entity's own comment
-- says why: "Agency-shared contacts remain unavailable until tenant membership
-- is server-owned. For now every browser operation is pinned to the
-- authenticated owner's email." Membership IS server-owned in this store, so
-- honouring the flag is now BUILDABLE — and building it would publish one
-- person's address book to their agency, which is more than the hosted app
-- does and is therefore not this migration's to decide. The flag keeps its
-- column so the screen's toggle still round-trips and so the decision, when it
-- is taken, is a predicate change and not a data migration.
--
-- DIVERGENCES from the original, each deliberate:
--
-- 1. `user_email` is RESERVED: the contract writes `caller_email()` and
--    refuses a payload naming it. The original takes it from the browser
--    (`user_email: currentUser?.email`) and its rls then re-checks it, which is
--    two places agreeing about something only one of them can know.
-- 2. `agency_id` is stamped from the authorized agency, never read from the
--    payload. The original leaves it unset on every browser write, which is
--    how a contact ends up in no tenant.
-- 3. An unknown key is REFUSED rather than dropped. D39's reason: a silent
--    filter is what keeps a reserved field out of a caller's reach AND what
--    loses a misspelled one without telling anybody.
-- 4. The CSV import is one transaction with a named ceiling. The original
--    calls `bulkCreate` with whatever the file held, and a partial failure
--    leaves half a spreadsheet imported with no way to tell which half.
begin;

do $$
begin
  if to_regclass('pennsync_records.fax_contact') is null
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
 * The caller-supplied fields, as data rather than as five copies of a list.
 *
 * `user_email` and `agency_id` are absent BY DESIGN and that absence is the
 * control: with them here, divergences 1 and 2 would be comments rather than
 * behaviour. `reserved` names them anyway so the refusal can say WHICH kind of
 * refusal it is — D39's distinction between a field nobody has heard of and a
 * field the contract decides.
 */
create function "pennsync_records".fax_contact_writable()
  returns text[] language sql immutable set search_path = '' as $fields$
  select array['name','fax_number','company','organization','department',
    'notes','is_shared','is_favorite']::text[]
$fields$;

create function "pennsync_records".fax_contact_reserved()
  returns text[] language sql immutable set search_path = '' as $fields$
  select array['user_email','agency_id','created_by','id','created_date',
    'updated_date','source_app_id']::text[]
$fields$;

/*
 * One payload checked against both lists, with the two refusals kept apart.
 *
 * Raises rather than returning a verdict, because every caller of it wants to
 * stop. The empty-object case is refused too: an update with nothing in it
 * would otherwise touch `updated_date` and report success, which reads to the
 * screen exactly like a save that happened.
 */
create function "pennsync_records".fax_contact_check_payload(p_payload jsonb)
  returns void language plpgsql immutable set search_path = '' as $check$
declare v_key text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode='22023', message='PENNSYNC_FAX_CONTACT_INVALID';
  end if;
  if p_payload = '{}'::jsonb then
    raise exception using errcode='22023', message='PENNSYNC_FAX_CONTACT_EMPTY';
  end if;
  for v_key in select k from jsonb_object_keys(p_payload) k loop
    if v_key = any ("pennsync_records".fax_contact_reserved()) then
      raise exception using errcode='22023', message='PENNSYNC_FAX_CONTACT_FIELD_RESERVED';
    end if;
    if not (v_key = any ("pennsync_records".fax_contact_writable())) then
      raise exception using errcode='22023', message='PENNSYNC_FAX_CONTACT_FIELD_UNSUPPORTED';
    end if;
  end loop;
end $check$;

/*
 * The text shaping the original does in the browser, and ONLY that.
 *
 * SHARED BY THE FAX FAMILY rather than per contract, and named `fax_` for that
 * reason: `contract_fax_template` and `contract_fax_retry_config` shape the
 * same way, and three copies of a trim-and-cap would be three places for one
 * of them to drift. What is NOT shared is any authorization — these decide the
 * SHAPE of a stored value and nothing about who may store it, which is the line
 * D69 draws when one contract delegates to another.
 *
 * D67's split: text arithmetic over caller-supplied input belongs in the
 * service, every decision about what may be STORED belongs here. These two are
 * neither — they are the shape of a stored value, so the store owns them. The
 * ceiling is this contract's own and is recorded as a narrowing: the original
 * stores whatever the field held, and a 100 kB company name in an address book
 * is a cost rather than a feature.
 */
create function "pennsync_records".fax_text(p_value jsonb, p_limit integer)
  returns text language sql immutable set search_path = '' as $text$
  select case
    when p_value is null or jsonb_typeof(p_value) = 'null' then null
    when jsonb_typeof(p_value) <> 'string' then null
    else nullif(pg_catalog.left(pg_catalog.btrim(p_value #>> '{}'), p_limit), '') end
$text$;

create function "pennsync_records".fax_flag(p_value jsonb, p_default boolean)
  returns boolean language sql immutable set search_path = '' as $flag$
  select case
    when p_value is null or jsonb_typeof(p_value) <> 'boolean' then p_default
    else (p_value #>> '{}')::boolean end
$flag$;

/*
 * The projection, named column by column (D64).
 *
 * `created_by` and `user_email` are the OWNERSHIP columns and are projected
 * deliberately: the screen shows neither, and a reader comparing a row it was
 * handed against the person it belongs to is the only way a predicate
 * regression here is visible from outside the database.
 */
create function "pennsync_records".fax_contact_row(p_row "pennsync_records"."fax_contact")
  returns jsonb language sql immutable set search_path = '' as $row$
  select jsonb_build_object(
    'id', p_row."id",
    'name', p_row."name",
    'fax_number', p_row."fax_number",
    'company', p_row."company",
    'organization', p_row."organization",
    'department', p_row."department",
    'notes', p_row."notes",
    'is_shared', p_row."is_shared",
    'is_favorite', p_row."is_favorite",
    'user_email', p_row."user_email",
    'created_by', p_row."created_by",
    'created_date', p_row."created_date",
    'updated_date', p_row."updated_date")
$row$;

/*
 * The one predicate every operation here asks, written once.
 *
 * Both columns, per D45. A row with `created_by` mine and `user_email`
 * somebody else's is not mine, and the original's `$and` says so.
 */
create function "pennsync_records".contract_fax_contact_list(
  p_agency text, p_limit integer default 100)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_rows jsonb; v_email text; v_limit integer;
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_FAX_CONTACT_FORBIDDEN';
  end if;
  -- The ceiling is re-applied HERE and not only taken from the caller, which
  -- is D71's distinction: a bound a caller could raise is not a bound.
  v_limit := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_email := "pennsync_records".caller_email();
  -- The row travels as a WHOLE `f`, not as `select *`. A `select *` subquery
  -- is an untyped `record` to the planner and cannot be passed to a function
  -- taking this table's composite type — the same trap D46 recorded about
  -- `row_number() over (…)`, reached by a different route.
  select coalesce(jsonb_agg("pennsync_records".fax_contact_row(c.r) order by
      c.ordered_date desc nulls last, c.ordered_id desc), '[]'::jsonb)
    into v_rows
  from (
    select f as r, f."created_date" as ordered_date, f."id" as ordered_id
    from "pennsync_records"."fax_contact" f
    where f."source_app_id" = "pennsync_records".deployment_app()
      and f."agency_id" = p_agency
      and f."created_by" = v_email
      and f."user_email" = v_email
    -- `id` breaks the tie, because `created_date` is not distinct by
    -- construction and a bulk import writes a whole CSV at one timestamp.
    -- D25's rule: an ordered read without a tiebreaker is a coin flip, and a
    -- paged read over one would lose rows rather than merely reorder them.
    order by f."created_date" desc nulls last, f."id" desc
    limit v_limit
  ) c;
  return jsonb_build_object('success', true, 'entries', v_rows);
end $contract$;

create function "pennsync_records".contract_fax_contact_create(
  p_agency text, p_contact jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_row "pennsync_records"."fax_contact"; v_email text; v_now timestamptz; v_id text;
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_FAX_CONTACT_FORBIDDEN';
  end if;
  perform "pennsync_records".fax_contact_check_payload(p_contact);
  -- The entity's two required fields, refused by name so the screen can say
  -- which one is missing. The original relies on the browser form for this and
  -- stores a nameless contact when something else calls it.
  if "pennsync_records".fax_text(p_contact->'name', 200) is null then
    raise exception using errcode='22023', message='PENNSYNC_FAX_CONTACT_NAME_REQUIRED';
  end if;
  if "pennsync_records".fax_text(p_contact->'fax_number', 40) is null then
    raise exception using errcode='22023', message='PENNSYNC_FAX_CONTACT_NUMBER_REQUIRED';
  end if;
  v_email := "pennsync_records".caller_email();
  -- Divergences 1 and 2: both of these are the contract's, and a payload that
  -- named either was refused above.
  if v_email is null then
    raise exception using errcode='42501', message='PENNSYNC_FAX_CONTACT_FORBIDDEN';
  end if;
  v_now := clock_timestamp();
  v_id := pg_catalog.substr(pg_catalog.md5(pg_catalog.gen_random_uuid()::text), 1, 24);
  insert into "pennsync_records"."fax_contact"
    ("source_app_id", "id", "name", "fax_number", "company", "organization",
     "department", "notes", "user_email", "agency_id", "is_shared", "is_favorite",
     "created_by", "created_date", "updated_date")
  values ("pennsync_records".deployment_app(), v_id,
    "pennsync_records".fax_text(p_contact->'name', 200),
    "pennsync_records".fax_text(p_contact->'fax_number', 40),
    "pennsync_records".fax_text(p_contact->'company', 200),
    "pennsync_records".fax_text(p_contact->'organization', 200),
    "pennsync_records".fax_text(p_contact->'department', 200),
    "pennsync_records".fax_text(p_contact->'notes', 2000),
    v_email, p_agency,
    "pennsync_records".fax_flag(p_contact->'is_shared', false),
    "pennsync_records".fax_flag(p_contact->'is_favorite', false),
    v_email, v_now, v_now)
  returning * into v_row;
  return jsonb_build_object('success', true,
    'contact', "pennsync_records".fax_contact_row(v_row));
end $contract$;

/*
 * The CSV import, as one transaction.
 *
 * Divergence 4. The ceiling is NAMED and refuses rather than truncating (D25's
 * rule about an audit entry, which holds for an address book too: a silently
 * shortened import is worse than a refused one, because the operator believes
 * the file went in). It is a bound CHOSEN rather than measured — `limit 500` is
 * what the screen's own list asks for, so an address book larger than its own
 * page is not a thing the capability can show anyway.
 */
create function "pennsync_records".contract_fax_contact_bulk_create(
  p_agency text, p_contacts jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_entry jsonb; v_created jsonb := '[]'::jsonb; v_one jsonb; v_count integer;
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_FAX_CONTACT_FORBIDDEN';
  end if;
  if p_contacts is null or jsonb_typeof(p_contacts) <> 'array' then
    raise exception using errcode='22023', message='PENNSYNC_FAX_CONTACT_INVALID';
  end if;
  v_count := jsonb_array_length(p_contacts);
  if v_count = 0 then
    raise exception using errcode='22023', message='PENNSYNC_FAX_CONTACT_BATCH_EMPTY';
  end if;
  if v_count > 500 then
    raise exception using errcode='22023', message='PENNSYNC_FAX_CONTACT_BATCH_TOO_LARGE';
  end if;
  -- Every row through the SAME create, so a field the single path reserves
  -- cannot be reachable through the batch one. That is the defect this shape
  -- is written to prevent rather than a tidiness: a batch importer with its own
  -- insert is a second answer to "what may a caller write".
  for v_entry in select e from jsonb_array_elements(p_contacts) e loop
    v_one := "pennsync_records".contract_fax_contact_create(p_agency, v_entry);
    v_created := v_created || jsonb_build_array(v_one->'contact');
  end loop;
  return jsonb_build_object('success', true, 'created', jsonb_array_length(v_created),
    'contacts', v_created);
end $contract$;

/*
 * The update.
 *
 * The SET list is built from the keys the caller SUPPLIED (D29's rule from
 * `contract_patient_update`): a hand-kept column list here would let a field
 * added to `fax_contact_writable` validate and then silently not be written.
 * `jsonb` is the vehicle for that — the row is read, merged in `jsonb`, and
 * written back as a whole — which is also why the merge cannot reach a
 * reserved column: the payload was refused above if it named one.
 */
create function "pennsync_records".contract_fax_contact_update(
  p_agency text, p_id text, p_contact jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_row "pennsync_records"."fax_contact"; v_email text; v_now timestamptz;
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_FAX_CONTACT_FORBIDDEN';
  end if;
  perform "pennsync_records".fax_contact_check_payload(p_contact);
  if coalesce(pg_catalog.btrim(coalesce(p_id, '')), '') = '' then
    raise exception using errcode='22023', message='PENNSYNC_FAX_CONTACT_ID_REQUIRED';
  end if;
  v_email := "pennsync_records".caller_email();
  select * into v_row from "pennsync_records"."fax_contact" f
  where f."source_app_id" = "pennsync_records".deployment_app()
    and f."agency_id" = p_agency
    and f."id" = p_id
    and f."created_by" = v_email
    and f."user_email" = v_email
  for update;
  -- Not found and not mine are ONE answer on purpose. Telling them apart tells
  -- a caller that a contact with this id exists in somebody else's book, which
  -- is the disclosure the per-person predicate exists to prevent.
  if not found then
    raise exception using errcode='42501', message='PENNSYNC_FAX_CONTACT_NOT_FOUND';
  end if;
  v_now := clock_timestamp();
  update "pennsync_records"."fax_contact" f set
    "name" = case when p_contact ? 'name'
      then "pennsync_records".fax_text(p_contact->'name', 200) else f."name" end,
    "fax_number" = case when p_contact ? 'fax_number'
      then "pennsync_records".fax_text(p_contact->'fax_number', 40) else f."fax_number" end,
    "company" = case when p_contact ? 'company'
      then "pennsync_records".fax_text(p_contact->'company', 200) else f."company" end,
    "organization" = case when p_contact ? 'organization'
      then "pennsync_records".fax_text(p_contact->'organization', 200) else f."organization" end,
    "department" = case when p_contact ? 'department'
      then "pennsync_records".fax_text(p_contact->'department', 200) else f."department" end,
    "notes" = case when p_contact ? 'notes'
      then "pennsync_records".fax_text(p_contact->'notes', 2000) else f."notes" end,
    "is_shared" = case when p_contact ? 'is_shared'
      then "pennsync_records".fax_flag(p_contact->'is_shared', f."is_shared") else f."is_shared" end,
    "is_favorite" = case when p_contact ? 'is_favorite'
      then "pennsync_records".fax_flag(p_contact->'is_favorite', f."is_favorite") else f."is_favorite" end,
    "updated_date" = v_now
  where f."source_app_id" = v_row."source_app_id" and f."id" = v_row."id"
  returning * into v_row;
  -- The two required fields cannot be cleared by an update either. Checked on
  -- the STORED row rather than on the payload, because a caller clears a field
  -- by sending an empty string and the shaping above turns that into null.
  if v_row."name" is null then
    raise exception using errcode='22023', message='PENNSYNC_FAX_CONTACT_NAME_REQUIRED';
  end if;
  if v_row."fax_number" is null then
    raise exception using errcode='22023', message='PENNSYNC_FAX_CONTACT_NUMBER_REQUIRED';
  end if;
  return jsonb_build_object('success', true,
    'contact', "pennsync_records".fax_contact_row(v_row));
end $contract$;

create function "pennsync_records".contract_fax_contact_delete(
  p_agency text, p_id text)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_email text; v_deleted text;
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_FAX_CONTACT_FORBIDDEN';
  end if;
  if coalesce(pg_catalog.btrim(coalesce(p_id, '')), '') = '' then
    raise exception using errcode='22023', message='PENNSYNC_FAX_CONTACT_ID_REQUIRED';
  end if;
  v_email := "pennsync_records".caller_email();
  delete from "pennsync_records"."fax_contact" f
  where f."source_app_id" = "pennsync_records".deployment_app()
    and f."agency_id" = p_agency
    and f."id" = p_id
    and f."created_by" = v_email
    and f."user_email" = v_email
  returning f."id" into v_deleted;
  if v_deleted is null then
    raise exception using errcode='42501', message='PENNSYNC_FAX_CONTACT_NOT_FOUND';
  end if;
  return jsonb_build_object('success', true, 'id', v_deleted);
end $contract$;

reset role;

revoke all on function
  "pennsync_records".fax_contact_writable(),
  "pennsync_records".fax_contact_reserved(),
  "pennsync_records".fax_contact_check_payload(jsonb),
  "pennsync_records".fax_text(jsonb,integer),
  "pennsync_records".fax_flag(jsonb,boolean),
  "pennsync_records".fax_contact_row("pennsync_records"."fax_contact"),
  "pennsync_records".contract_fax_contact_list(text,integer),
  "pennsync_records".contract_fax_contact_create(text,jsonb),
  "pennsync_records".contract_fax_contact_bulk_create(text,jsonb),
  "pennsync_records".contract_fax_contact_update(text,text,jsonb),
  "pennsync_records".contract_fax_contact_delete(text,text)
  from public, anon, authenticated, service_role;
grant execute on function
  "pennsync_records".contract_fax_contact_list(text,integer),
  "pennsync_records".contract_fax_contact_create(text,jsonb),
  "pennsync_records".contract_fax_contact_bulk_create(text,jsonb),
  "pennsync_records".contract_fax_contact_update(text,text,jsonb),
  "pennsync_records".contract_fax_contact_delete(text,text)
  to authenticated;

create function "public"."pennsync_contract_fax_contact_list"(
  p_agency text, p_limit integer default 100) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_fax_contact_list(p_agency, p_limit)
$contract$;

create function "public"."pennsync_contract_fax_contact_create"(
  p_agency text, p_contact jsonb) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_fax_contact_create(p_agency, p_contact)
$contract$;

create function "public"."pennsync_contract_fax_contact_bulk_create"(
  p_agency text, p_contacts jsonb) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_fax_contact_bulk_create(p_agency, p_contacts)
$contract$;

create function "public"."pennsync_contract_fax_contact_update"(
  p_agency text, p_id text, p_contact jsonb) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_fax_contact_update(p_agency, p_id, p_contact)
$contract$;

create function "public"."pennsync_contract_fax_contact_delete"(
  p_agency text, p_id text) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_fax_contact_delete(p_agency, p_id)
$contract$;

revoke all on function
  "public"."pennsync_contract_fax_contact_list"(text,integer),
  "public"."pennsync_contract_fax_contact_create"(text,jsonb),
  "public"."pennsync_contract_fax_contact_bulk_create"(text,jsonb),
  "public"."pennsync_contract_fax_contact_update"(text,text,jsonb),
  "public"."pennsync_contract_fax_contact_delete"(text,text)
  from public, anon, authenticated, service_role;
grant execute on function
  "public"."pennsync_contract_fax_contact_list"(text,integer),
  "public"."pennsync_contract_fax_contact_create"(text,jsonb),
  "public"."pennsync_contract_fax_contact_bulk_create"(text,jsonb),
  "public"."pennsync_contract_fax_contact_update"(text,text,jsonb),
  "public"."pennsync_contract_fax_contact_delete"(text,text)
  to authenticated;

commit;
