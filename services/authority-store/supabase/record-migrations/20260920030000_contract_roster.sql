-- The staff roster (D23), as a reviewed contract.
--
-- HAND WRITTEN, like the contracts beside it and for the same reason: a
-- capability's authorization is its own, so there is nothing to generate from.
--
-- What makes this one different from `listPolicyLibrary` is where its answer
-- comes from. Every other contract projects a carried table. This one joins
-- TWO stores, and which side wins is the whole decision:
--
-- - **The authority store leads.** `caller_roster(agency)` reads
--   `pennsync_private.membership` joined to `agency` and `identity_map`, and
--   that join is the FROM clause. A person with a membership and no carried
--   profile row is on the roster with empty profile fields; a carried row with
--   no membership is not on it at all. Membership decides who exists here.
-- - **The carried row is joined on, and only for what it alone knows.** Staff
--   discipline, duty status, credentials, telephone number — things the
--   authority store has no column for and no business having one.
--
-- So four columns the callers read most are NOT projected from the carried row
-- even though it has them. `agency_id`, `agency_name`, `account_type` and
-- `role` are self-editable profile labels: the entity schema says so in each
-- field's own description, and says never to authorize from them. Returning
-- them here under the names the old code reads would put the untrustworthy
-- copy back in front of every ported handler, which is precisely what D23
-- exists to stop. `agency_id` and `agency_name` come from the membership and
-- its agency; `role` and `account_type` are replaced by `tenant_role`, which
-- is the authority store's own and cannot be edited by its subject.
--
-- `is_manager` and `is_approved` are derived for the same reason. Both exist
-- as booleans on the carried row and both are self-editable, so a handler
-- gating on the stored `is_manager` gates on the user's own assertion. They
-- are computed from `tenant_role` and from the membership being live.
--
-- Two visibilities, and the widening is decided by the authoritative role
-- rather than by the stored flag. Every member of an agency may see who their
-- colleagues are, what discipline they work in and whether they are on duty —
-- that is the working roster, and 35 capabilities want exactly it. Personnel
-- detail (telephone, credentials, licence number, reporting line, whether they
-- have accepted the AI content agreement) is administrative, so it is returned
-- only to an `agency_admin` or `manager` and is null for everyone else. Null
-- rather than absent, so a caller reads the same shape either way and cannot
-- mistake "not shown to you" for "not recorded".
--
-- Read only. There is no `contract_roster_update` here, and the table carries
-- no write policy, because D23 leaves the profile-write path deliberately
-- open: the 8 capabilities that update a profile stay blocked rather than
-- being quietly enabled by a contract that happened to be in the area.
begin;

do $$
begin
  if to_regprocedure('pennsync_records.caller_roster(text)') is null then
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

-- Owned by the record owner, so `force row level security` binds it exactly as
-- it binds the brokers. A contract is not an exemption from the policies, and
-- this one relies on that: the carried row it joins is admitted by
-- `user_read`, which asks the same authority store this contract's FROM clause
-- does. The two agree because they ask one source, not because anybody kept
-- them in step.
set local role "pennsync_records_owner";

-- The projection, in one place, because two contracts return it and a second
-- copy is a second thing to keep honest.
--
-- `p_privileged` is passed in rather than asked here: the caller's role is
-- checked once, against the agency being read, and handing the answer down
-- keeps this from re-deriving authorization per row.
create function "pennsync_records".roster_entry(
  p_user_id text, p_email text, p_agency_id text, p_agency_name text, p_tenant_role text,
  p_is_active boolean, p_profile "pennsync_records"."user", p_privileged boolean)
  returns jsonb language sql immutable set search_path = '' as $projection$
  select jsonb_build_object(
    -- Authority, from the authority store. Never the carried row's copy.
    'id', p_user_id,
    'email', p_email,
    'agency_id', p_agency_id,
    'agency_name', p_agency_name,
    'tenant_role', p_tenant_role,
    'is_active', p_is_active,
    -- Derived, because the stored booleans are self-editable.
    'is_manager', p_tenant_role in ('agency_admin', 'manager'),
    'is_approved', p_is_active,
    -- The carried row, for what only it knows.
    'staff_role', p_profile."staff_role",
    'service_type', p_profile."service_type",
    'care_scope', p_profile."care_scope",
    'credential_type', p_profile."credential_type",
    'duty_status', p_profile."duty_status",
    'duty_on_since', p_profile."duty_on_since",
    'off_duty_message', p_profile."off_duty_message",
    'scheduled_off_duty_start', p_profile."scheduled_off_duty_start",
    'scheduled_off_duty_end', p_profile."scheduled_off_duty_end",
    'scheduled_off_duty_recurring', p_profile."scheduled_off_duty_recurring",
    -- Administrative. Null rather than absent for a caller who may not see it,
    -- so the shape does not tell a handler which kind of caller it is serving.
    'phone', case when p_privileged then p_profile."phone" end,
    'credentials', case when p_privileged then p_profile."credentials" end,
    'license_number', case when p_privileged then p_profile."license_number" end,
    'manager_email', case when p_privileged then p_profile."manager_email" end,
    'profile_completeness_score', case when p_privileged then p_profile."profile_completeness_score" end,
    'ai_content_agreement_accepted',
      case when p_privileged then p_profile."ai_content_agreement_accepted" end)
$projection$;

create function "pennsync_records".contract_roster_list(
  p_agency text, p_limit integer default 200, p_after text default null)
  returns jsonb language plpgsql stable security definer set search_path = '' as $contract$
declare v_role text; v_rows jsonb; v_limit integer; v_privileged boolean; v_next text;
begin
  -- Membership is asked of the authority store, never of the request. Null
  -- means the caller holds nothing in this agency, which is a refusal rather
  -- than an empty list: an empty list would say the agency exists and is
  -- empty, which tells a caller something about an agency that is not theirs.
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_ROSTER_AGENCY_NOT_HELD';
  end if;
  v_privileged := v_role in ('agency_admin', 'manager');
  -- A cursor nobody can parse is refused rather than read as "from the
  -- start": silently answering page one to a caller asking for page three
  -- repeats colleagues they have already seen.
  if p_after is not null and p_after !~ '^[a-f0-9]{24}$' then
    raise exception using errcode='22023', message='PENNSYNC_ROSTER_CURSOR_INVALID';
  end if;
  -- A well-formed cursor naming nobody on this roster is refused, and the
  -- reason is the case that produces one in practice: a colleague revoked
  -- between two pages of a walk. The row the cursor names is then gone, the
  -- keyset comparison has nothing to compare against, and the walk ends early
  -- — silently reporting an agency of thirty as an agency of three. Answering
  -- the whole roster instead would repeat every colleague already seen. So
  -- neither: the caller is told to start again.
  if p_after is not null and not exists (
    select 1 from "pennsync_records".caller_roster(p_agency) c where c.user_id = p_after) then
    raise exception using errcode='22023', message='PENNSYNC_ROSTER_CURSOR_UNKNOWN';
  end if;
  v_limit := least(greatest(coalesce(p_limit, 200), 1), 500);

  -- A roster is read alphabetically, so it is ordered by email with the user
  -- id as the tiebreaker, and the cursor is that id alone — the row it names
  -- supplies its own email below, so no delimiter has to be invented and no
  -- caller has to build one.
  --
  -- The carried row travels as a whole composite (`u as profile`) rather than
  -- column by column: the left join leaves it null for a colleague with a
  -- membership and no profile row, and a null composite answers null to every
  -- field, which is the shape the projection should produce for that person.
  with page as (
    select m.user_id, m.email, m.agency_id, m.agency_name, m.tenant_role, m.is_active, u as profile
    from "pennsync_records".caller_roster(p_agency) m
    left join "pennsync_records"."user" u
      on u."source_app_id" = "pennsync_records".deployment_app() and u."id" = m.user_id
    where p_after is null or (m.email, m.user_id) > (
      select c.email, c.user_id from "pennsync_records".caller_roster(p_agency) c where c.user_id = p_after)
    order by m.email, m.user_id
    limit v_limit
  )
  select coalesce(jsonb_agg("pennsync_records".roster_entry(
      page.user_id, page.email, page.agency_id, page.agency_name, page.tenant_role, page.is_active,
      page.profile, v_privileged)
    order by page.email, page.user_id), '[]'::jsonb)
  into v_rows from page;

  if jsonb_array_length(v_rows) = v_limit then
    v_next := v_rows -> (v_limit - 1) ->> 'id';
  end if;
  return jsonb_build_object('entries', v_rows, 'next', v_next);
end $contract$;

create function "pennsync_records".contract_roster_get(p_agency text, p_user_id text)
  returns jsonb language plpgsql stable security definer set search_path = '' as $contract$
declare v_role text; v_row jsonb; v_privileged boolean;
begin
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_ROSTER_AGENCY_NOT_HELD';
  end if;
  if p_user_id is null or p_user_id !~ '^[a-f0-9]{24}$' then
    raise exception using errcode='22023', message='PENNSYNC_ROSTER_SUBJECT_INVALID';
  end if;
  v_privileged := v_role in ('agency_admin', 'manager');
  select "pennsync_records".roster_entry(
      m.user_id, m.email, m.agency_id, m.agency_name, m.tenant_role, m.is_active, u, v_privileged)
  into v_row
  from "pennsync_records".caller_roster(p_agency) m
  left join "pennsync_records"."user" u
    on u."source_app_id" = "pennsync_records".deployment_app() and u."id" = m.user_id
  where m.user_id = p_user_id;
  -- Absent and not-a-colleague answer the same way, which is what keeps a
  -- caller from learning that somebody exists in an agency they cannot see.
  return v_row;
end $contract$;

reset role;

revoke all on function "pennsync_records".roster_entry(
    text, text, text, text, text, boolean, "pennsync_records"."user", boolean),
  "pennsync_records".contract_roster_list(text,integer,text),
  "pennsync_records".contract_roster_get(text,text)
  from public, anon, authenticated, service_role;

grant execute on function "pennsync_records".contract_roster_list(text,integer,text),
  "pennsync_records".contract_roster_get(text,text) to authenticated;

create function "public"."pennsync_contract_roster_list"(
  p_agency text, p_limit integer default 200, p_after text default null) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_roster_list(p_agency, p_limit, p_after)
$contract$;

create function "public"."pennsync_contract_roster_get"(p_agency text, p_user_id text) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_roster_get(p_agency, p_user_id)
$contract$;

revoke all on function "public"."pennsync_contract_roster_list"(text,integer,text),
  "public"."pennsync_contract_roster_get"(text,text)
  from public, anon, authenticated, service_role;

grant execute on function "public"."pennsync_contract_roster_list"(text,integer,text),
  "public"."pennsync_contract_roster_get"(text,text) to authenticated;

commit;
