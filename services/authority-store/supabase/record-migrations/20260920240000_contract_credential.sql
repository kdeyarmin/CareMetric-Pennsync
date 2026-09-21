-- Submitting a staff credential for approval.
--
-- HAND WRITTEN, like every contract. It ports `submitPersonnelCredential` and
-- NOT its sibling, and the reason is a finding rather than a scoping choice.
--
-- **`reviewPersonnelCredential` is the first WHOLE capability with no performer
-- left.** Its gate is one line:
--
--     if (!isAdminLike(user)) return 403;   // isAdminLike = u.role === 'admin'
--
-- — the Base44 built-in admin, the platform tier D14 and D22 removed. Every
-- earlier case of this (D31's `set_ai_tags`, D35's `provision`, D36's `list`)
-- was ONE ACTION of a capability whose other actions survived. Here it is the
-- entire endpoint: approving and rejecting a credential is all it does.
--
-- That question has since been answered. **D40** records the owner's decision
-- that an `agency_admin`, scoped to their own agency, is the successor to the
-- built-in admin — a WIDENING, granted deliberately — and the approve path
-- lives in `20260920250000_contract_credential_review.sql`, not here. This
-- file still carries NO decision field: `status`, `approved_by`, `approved_at`
-- and `rejection_reason` stay server-controlled on the submission side,
-- precisely because a staff member with row access could otherwise approve
-- their own licence.
--
-- DIVERGENCES from the original, each a narrowing, each deliberate:
--
-- 1. No platform tier, so `ownsRecord`'s super-admin and cross-agency branches
--    close. The row is the caller's own, or an `agency_admin`'s of the same
--    agency to correct — and the agency half is the table's policy rather than
--    a comparison of `agency_name` strings.
-- 2. `user_name` is the address. The carried `User` table has no `full_name`
--    column, which D38 found and recorded; the original's
--    `user.full_name || user.email` therefore has only one branch here.
-- 3. The writable set is the original's `SELF_SERVICE_FIELDS` and an unknown
--    key is REFUSED rather than ignored. The original filters silently; a
--    caller who misspells `expiration_date` would have their credential filed
--    with no expiry and never know.
--
-- `uploaded_file_url` is carried, with the original's own check: HTTPS, and no
-- user information in the authority. It is an opaque locator the caller
-- already holds — nothing ported ever fetches one, which is the same position
-- the document pair took — so this is not the file-layer dependency that
-- blocks an upload capability.
begin;

do $$
begin
  if to_regclass('pennsync_records.personnel_credential') is null
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
 * The original's file-link check: an absolute HTTPS URL carrying no user
 * information in its authority. It is never fetched, here or anywhere in the
 * port, so this bounds what can be STORED rather than what can be reached.
 */
create function "pennsync_records".credential_file_url(p_value text) returns boolean
  language sql immutable set search_path = '' as $url$
  select p_value ~ '^https://[^/@\s:]+(:[0-9]{1,5})?(/[^\s]*)?$'
$url$;

create function "pennsync_records".credential_row(r "pennsync_records"."personnel_credential")
  returns jsonb language sql stable set search_path = '' as $row$
  select jsonb_build_object(
    'id', r."id", 'user_id', r."user_id", 'user_name', r."user_name",
    'item_type', r."item_type", 'title', r."title",
    'issuing_organization', r."issuing_organization",
    'credential_number', r."credential_number",
    'issued_date', r."issued_date", 'expiration_date', r."expiration_date",
    'uploaded_file_name', r."uploaded_file_name", 'notes', r."notes",
    'status', r."status", 'approved_by', r."approved_by",
    'approved_at', r."approved_at", 'rejection_reason', r."rejection_reason")
$row$;

create function "pennsync_records".contract_credential_submit(
  p_agency text, p_credential_id text, p_renews_id text, p_credential jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare
  v_row "pennsync_records"."personnel_credential"; v_email text; v_role text;
  v_key text; v_value text; v_issued date; v_expires date; v_id text; v_now timestamptz;
  v_existing "pennsync_records"."personnel_credential";
begin
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_CREDENTIAL_AGENCY_NOT_HELD';
  end if;
  if p_credential is null or jsonb_typeof(p_credential) <> 'object' then
    raise exception using errcode='22023', message='PENNSYNC_CREDENTIAL_INVALID';
  end if;
  for v_key in select k from jsonb_object_keys(p_credential) k loop
    -- The original's SELF_SERVICE_FIELDS, refused rather than filtered: a
    -- caller who misspells `expiration_date` would otherwise file a credential
    -- with no expiry and never be told.
    if v_key not in ('item_type', 'title', 'issuing_organization', 'credential_number',
      'issued_date', 'expiration_date', 'uploaded_file_url', 'uploaded_file_name', 'notes') then
      raise exception using errcode='22023', message='PENNSYNC_CREDENTIAL_FIELD_UNSUPPORTED';
    end if;
    if jsonb_typeof(p_credential->v_key) <> 'string' then
      raise exception using errcode='22023', message='PENNSYNC_CREDENTIAL_INVALID';
    end if;
    v_value := p_credential->>v_key;
    if pg_catalog.length(v_value) > (case when v_key = 'notes' then 4000 else 2000 end) then
      raise exception using errcode='22023', message='PENNSYNC_CREDENTIAL_INVALID';
    end if;
  end loop;

  if coalesce(p_credential->>'title', '') = ''
    or coalesce(p_credential->>'item_type', '') not in ('license', 'certification', 'insurance')
    or coalesce(p_credential->>'expiration_date', '') = '' then
    raise exception using errcode='22023', message='PENNSYNC_CREDENTIAL_REQUIRED';
  end if;
  v_expires := "pennsync_records".time_off_date(p_credential->>'expiration_date');
  if v_expires is null then
    raise exception using errcode='22023', message='PENNSYNC_CREDENTIAL_DATE_INVALID';
  end if;
  if p_credential ? 'issued_date' and coalesce(p_credential->>'issued_date', '') <> '' then
    v_issued := "pennsync_records".time_off_date(p_credential->>'issued_date');
    if v_issued is null then
      raise exception using errcode='22023', message='PENNSYNC_CREDENTIAL_DATE_INVALID';
    end if;
    if v_issued > v_expires then
      raise exception using errcode='22023', message='PENNSYNC_CREDENTIAL_DATE_ORDER';
    end if;
  end if;
  if coalesce(p_credential->>'uploaded_file_url', '') <> ''
    and not "pennsync_records".credential_file_url(p_credential->>'uploaded_file_url') then
    raise exception using errcode='22023', message='PENNSYNC_CREDENTIAL_FILE_URL_INVALID';
  end if;

  v_email := "pennsync_records".caller_email();
  if v_email is null then
    raise exception using errcode='42501', message='PENNSYNC_CREDENTIAL_AGENCY_NOT_HELD';
  end if;
  v_now := clock_timestamp();

  if p_credential_id is not null then
    if p_credential_id !~ '^[A-Za-z0-9_-]{1,200}$' then
      raise exception using errcode='22023', message='PENNSYNC_CREDENTIAL_SUBJECT_INVALID';
    end if;
    select * into v_existing from "pennsync_records"."personnel_credential" c
    where c."source_app_id" = "pennsync_records".deployment_app()
      and c."id" = p_credential_id and c."agency_id" = p_agency
    for update;
    if not found then
      raise exception using errcode='42501', message='PENNSYNC_CREDENTIAL_NOT_FOUND';
    end if;
    -- Yours, or an administrator's of this agency to correct. The agency half
    -- is the policy's; the ownership half is the contract's (D36).
    if pg_catalog.lower(coalesce(v_existing."user_id", '')) is distinct from pg_catalog.lower(v_email)
      and v_role <> 'agency_admin' then
      raise exception using errcode='42501', message='PENNSYNC_CREDENTIAL_FORBIDDEN';
    end if;
    -- Every resubmission returns to review, and the previous decision is
    -- cleared: the original nulls all three, because an edited credential is
    -- not the one that was approved.
    update "pennsync_records"."personnel_credential" c set
      "item_type" = p_credential->>'item_type',
      "title" = p_credential->>'title',
      "issuing_organization" = p_credential->>'issuing_organization',
      "credential_number" = p_credential->>'credential_number',
      "issued_date" = v_issued,
      "expiration_date" = v_expires,
      "uploaded_file_url" = nullif(p_credential->>'uploaded_file_url', ''),
      "uploaded_file_name" = nullif(p_credential->>'uploaded_file_name', ''),
      "notes" = p_credential->>'notes',
      "status" = 'pending_approval',
      "approved_by" = null, "approved_at" = null, "rejection_reason" = null,
      "updated_date" = v_now
    where c."source_app_id" = v_existing."source_app_id" and c."id" = v_existing."id"
    returning * into v_row;
  else
    v_id := pg_catalog.substr(pg_catalog.md5(pg_catalog.gen_random_uuid()::text), 1, 24);
    insert into "pennsync_records"."personnel_credential"
      ("source_app_id", "id", "agency_id", "user_id", "user_name", "item_type", "title",
       "issuing_organization", "credential_number", "issued_date", "expiration_date",
       "uploaded_file_url", "uploaded_file_name", "notes", "status",
       "reminder_offsets_sent", "created_by", "created_date", "updated_date")
    values ("pennsync_records".deployment_app(), v_id, p_agency, v_email,
      -- Divergence 2: no carried name column exists, so this is the address,
      -- which is the original's own fallback.
      v_email,
      p_credential->>'item_type', p_credential->>'title',
      p_credential->>'issuing_organization', p_credential->>'credential_number',
      v_issued, v_expires, nullif(p_credential->>'uploaded_file_url', ''),
      nullif(p_credential->>'uploaded_file_name', ''), p_credential->>'notes',
      'pending_approval', '[]'::jsonb, v_email, v_now, v_now)
    returning * into v_row;
  end if;

  -- The renewal stamp. The old credential's STATUS is untouched — it stays
  -- approved until a reviewer supersedes it — and only its notes record that a
  -- renewal is in flight, exactly as the original does.
  if p_renews_id is not null and p_renews_id is distinct from p_credential_id then
    if p_renews_id !~ '^[A-Za-z0-9_-]{1,200}$' then
      raise exception using errcode='22023', message='PENNSYNC_CREDENTIAL_SUBJECT_INVALID';
    end if;
    update "pennsync_records"."personnel_credential" c set
      "notes" = pg_catalog.left(pg_catalog.btrim(coalesce(c."notes", '') || chr(10)
        || '[Renewal submitted on ' || pg_catalog.to_char(v_now, 'YYYY-MM-DD') || ']'), 4000),
      "updated_date" = v_now
    where c."source_app_id" = "pennsync_records".deployment_app()
      and c."id" = p_renews_id and c."agency_id" = p_agency
      and (pg_catalog.lower(coalesce(c."user_id", '')) = pg_catalog.lower(v_email)
        or v_role = 'agency_admin');
  end if;

  return jsonb_build_object('success', true, 'credential',
    "pennsync_records".credential_row(v_row));
end $contract$;

reset role;

revoke all on function
  "pennsync_records".credential_file_url(text),
  "pennsync_records".credential_row("pennsync_records"."personnel_credential"),
  "pennsync_records".contract_credential_submit(text,text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function
  "pennsync_records".contract_credential_submit(text,text,text,jsonb) to authenticated;

create function "public"."pennsync_contract_credential_submit"(
  p_agency text, p_credential_id text, p_renews_id text, p_credential jsonb) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_credential_submit(p_agency, p_credential_id,
    p_renews_id, p_credential)
$contract$;

revoke all on function "public"."pennsync_contract_credential_submit"(text,text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function "public"."pennsync_contract_credential_submit"(text,text,text,jsonb)
  to authenticated;

commit;
