-- The staff roster projects `created_date`, and can be read in creation order.
--
-- This is a FORWARD migration rather than an edit to
-- `20260920030000_contract_roster.sql`, and that is not a style choice: the
-- migration ledger keys on a file's STEM and holds no content hash (D88), so a
-- deployment that has already applied the roster contract would skip an edited
-- copy of it forever, while a fresh build would get the new text. The two
-- stores would then differ with every suite green. So the change ships as its
-- own file and the original stays exactly as applied.
--
-- WHY `created_date` and nothing else. D23's rule is that the carried row
-- contributes only what the authority store has no column for. `created_date`
-- qualifies: nothing in `pennsync_private` records when a person's profile was
-- created — `identity_map.verified_at`, `membership.granted_at` and
-- `activated_at` all answer a different question, about a grant rather than
-- about the row. `role` and `account_type` do NOT qualify and are still
-- unprojected: `tenant_role` supersedes both, and they are the self-editable
-- labels D23 forbids authorizing on.
--
-- It is also safe against the coupling batch E found, where a read's
-- projection is an input to the matching write's key check. There is no roster
-- write contract at all: `user` has one read policy, and since D82 the only
-- write path is `auth.updateMe`, whose field set is `PROFILE_SELF_WRITABLE`.
-- `created_date` is not on that allowlist, so no screen can send it back, and
-- `contract-roster.test.mjs` pins the overlap so a later widening that DOES
-- add a writable column fails there instead of in production.
--
-- WHY the order matters more than the column. 25 of the frontend's `User.list`
-- call sites ask for `-created_date`, which this contract could not answer, so
-- the route refused them and they still read Base44. The column alone unblocks
-- none of those; the order is the thing they need.
--
-- Measured rather than asserted: `check:entity-routes` moves from 47 to 71
-- SERVED on this change, and its sort refusals from 30 to 6. 24 rather than 25
-- because one of those sites also passes an offset the route has no parameter
-- for, so it stays refused for that reason instead. The 6 left all ask for
-- `full_name`, which no store holds.
begin;

set local role "pennsync_records_owner";

-- Unchanged apart from the one added key, and replaced in place because its
-- signature does not move: the carried row already travels as a whole
-- composite, so `created_date` was always in reach here.
create or replace function "pennsync_records".roster_entry(
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
    -- The carried row, for what only it knows. `created_date` is null for a
    -- colleague who holds a membership and has no profile row at all, which is
    -- the same null the rest of this block already answers for that person.
    'created_date', p_profile."created_date",
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

-- The list gains an ORDER, which means a new parameter, which means a DROP
-- rather than a replace: adding a parameter to a `create or replace` creates a
-- SECOND function instead, and a three-argument call would then be ambiguous
-- between the two. The new parameter is defaulted, so every body PostgREST
-- already resolves — `{p_agency, p_limit, p_after}` — still resolves here.
drop function "pennsync_records".contract_roster_list(text,integer,text);

create function "pennsync_records".contract_roster_list(
  p_agency text, p_limit integer default 200, p_after text default null,
  p_order text default 'email')
  returns jsonb language plpgsql stable security definer set search_path = '' as $contract$
declare
  v_role text; v_rows jsonb; v_limit integer; v_privileged boolean; v_next text;
  v_order text; v_after_created timestamptz; v_after_email text; v_after_found boolean;
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

  -- An order this contract does not implement is refused by name rather than
  -- silently served in the default one: a caller asking for newest-first and
  -- given alphabetical gets a plausible page that is simply the wrong people.
  v_order := coalesce(p_order, 'email');
  if v_order not in ('email', 'created_desc') then
    raise exception using errcode='22023', message='PENNSYNC_ROSTER_ORDER_UNSUPPORTED';
  end if;

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
  --
  -- The cursor row's own sort keys are read here rather than inside the page's
  -- WHERE clause, because in creation order one of them comes from the carried
  -- row and the comparison below has to branch on whether it is null. Plain
  -- variables, not a `record`: a record never assigned raises
  -- `record "x" is not assigned yet` the moment a field of it is read.
  if p_after is not null then
    select true, c.email, u."created_date"
      into v_after_found, v_after_email, v_after_created
      from "pennsync_records".caller_roster(p_agency) c
      left join "pennsync_records"."user" u
        on u."source_app_id" = "pennsync_records".deployment_app() and u."id" = c.user_id
     where c.user_id = p_after;
    if not coalesce(v_after_found, false) then
      raise exception using errcode='22023', message='PENNSYNC_ROSTER_CURSOR_UNKNOWN';
    end if;
  end if;

  v_limit := least(greatest(coalesce(p_limit, 200), 1), 500);

  -- Two orders, one page. Alphabetical is `email` then the user id as the
  -- tiebreaker, which is what a roster is read as by default.
  --
  -- Creation order is `created_date` DESCENDING with NULLS LAST, then email
  -- and the user id, so it is total: `created_date` is nullable and is null
  -- for a colleague with no profile row, and an order that is not total pages
  -- inconsistently — the same person can appear twice or never.
  --
  -- The keyset cannot be a row comparison, because the directions are mixed
  -- (created_date descending, email and id ascending) and a row comparison
  -- applies one direction to every column. So it is written out, including
  -- the null branch:
  --
  --   cursor row has a created_date -> a later row is one with a SMALLER
  --     created_date, or the same created_date and a greater (email, id), or
  --     any null created_date at all, since nulls sort last.
  --   cursor row has none -> it is already among the nulls, so a later row is
  --     another null with a greater (email, id).
  --
  -- The carried row travels as a whole composite (`u as profile`) rather than
  -- column by column: the left join leaves it null for a colleague with a
  -- membership and no profile row, and a null composite answers null to every
  -- field, which is the shape the projection should produce for that person.
  with page as (
    select m.user_id, m.email, m.agency_id, m.agency_name, m.tenant_role, m.is_active,
           u as profile, u."created_date" as created_date
    from "pennsync_records".caller_roster(p_agency) m
    left join "pennsync_records"."user" u
      on u."source_app_id" = "pennsync_records".deployment_app() and u."id" = m.user_id
    where p_after is null
       or (v_order = 'email' and (m.email, m.user_id) > (v_after_email, p_after))
       or (v_order = 'created_desc' and v_after_created is not null and (
             (u."created_date" is not null and u."created_date" < v_after_created)
             or (u."created_date" = v_after_created
                   and (m.email, m.user_id) > (v_after_email, p_after))
             or u."created_date" is null))
       or (v_order = 'created_desc' and v_after_created is null
             and u."created_date" is null
             and (m.email, m.user_id) > (v_after_email, p_after))
    order by
      case when v_order = 'created_desc' then 0 else 1 end,
      case when v_order = 'created_desc' then created_date end desc nulls last,
      m.email, m.user_id
    limit v_limit
  )
  select coalesce(jsonb_agg("pennsync_records".roster_entry(
      page.user_id, page.email, page.agency_id, page.agency_name, page.tenant_role, page.is_active,
      page.profile, v_privileged)
    order by
      case when v_order = 'created_desc' then 0 else 1 end,
      case when v_order = 'created_desc' then page.created_date end desc nulls last,
      page.email, page.user_id), '[]'::jsonb)
  into v_rows from page;

  if jsonb_array_length(v_rows) = v_limit then
    v_next := v_rows -> (v_limit - 1) ->> 'id';
  end if;
  return jsonb_build_object('entries', v_rows, 'next', v_next);
end $contract$;

-- The original resets the role before the grants and before creating the public
-- wrapper, so the wrapper is owned by the migration role and not by the record
-- owner. Reset here for the same reason: dropping it under the record owner
-- fails with "must be owner of function public.pennsync_contract_roster_list".
reset role;

revoke all on function "pennsync_records".contract_roster_list(text,integer,text,text)
  from public, anon, authenticated, service_role;
grant execute on function "pennsync_records".contract_roster_list(text,integer,text,text)
  to authenticated;

-- The public wrapper follows the same drop-and-create for the same reason.
drop function "public"."pennsync_contract_roster_list"(text,integer,text);

create function "public"."pennsync_contract_roster_list"(
  p_agency text, p_limit integer default 200, p_after text default null,
  p_order text default 'email') returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_roster_list(p_agency, p_limit, p_after, p_order)
$contract$;

revoke all on function "public"."pennsync_contract_roster_list"(text,integer,text,text)
  from public, anon, authenticated, service_role;
grant execute on function "public"."pennsync_contract_roster_list"(text,integer,text,text)
  to authenticated;

commit;
