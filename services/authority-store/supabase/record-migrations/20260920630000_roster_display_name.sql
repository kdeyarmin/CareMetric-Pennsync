-- The staff roster carries a name, in PennSync's own store.
--
-- Kevin chose this on a decision card: of "show the work email", "add a name to
-- our own store" and "copy the names over from Base44", his answer was the
-- second. So the screens keep showing names and stop depending on Base44, and
-- nothing is copied from it.
--
-- WHAT HIS ANSWER BOUGHT. The COLUMN, not the NAMES. Real people's names in
-- production is one of the holds he keeps himself, and he answered where a name
-- comes from rather than whose names go in. So this ships EMPTY, and the CHECK
-- on the table — in the authority migration named below — is what makes that a
-- refusal rather than a convention.
--
-- WHY IT IS NOT ON THE CARRIED TABLE, which is the first thing anybody will
-- reach for. `pennsync_records."user"` is GENERATED from the entity definitions
-- (`node tools-entity-schema-plan.mjs --write-migration`), and
-- `base44/entities/User.jsonc` has NO name property at all — the only name-ish
-- key on it is `agency_name`. Base44 keeps a person's name on the platform
-- ACCOUNT, not on the entity, which is D69's gap read from the other side. A
-- column there would mean either describing a field Base44 does not have or
-- breaking the generated-equals-committed test.
--
-- WHERE IT BELONGS is `pennsync_private`, which is where the roster's ADDRESS
-- already comes from (`identity_map.expected_email`) for exactly that reason.
-- D34's rule says to check which store already models something before writing
-- anything; the answer here is that this store models the person and the other
-- one does not model their name at all. Which TABLE it belongs in, and which
-- DIRECTORY, are both in that migration, and the first answer to each was
-- wrong.
--
-- WHO MAY SET IT IS STILL OPEN, and this placement is what keeps it open
-- honestly rather than by omission. `pennsync_private` is force-RLS with no
-- policy, so `auth.updateMe` — which since D82 is the only roster write path,
-- four named-field call sites and no spread — cannot reach this column at all.
-- There is no self-write allowlist to widen and no D82 change here. A write path
-- would be a new contract with its own gate, and the card's own consequence line
-- said that decision was still to come. It has not been taken, so nothing here
-- takes it.
--
-- WHAT THIS DOES NOT DO. It adds no order. Six `User.list` call sites ask to
-- sort by `full_name`, and they stay refused: until names are loaded the column
-- is null for every row, so a name-sorted list would read in email order under
-- a name heading — a plausible page that is not what it says it is, which is the
-- same reason `20260920620000_roster_created_date.sql` refuses an unknown order
-- rather than serving it in the default one.
begin;

-- THE TABLE IS NOT CREATED HERE. It is
-- `migrations/20260920605000_staff_name.sql`, in the authority directory, which
-- also carries why it is not a column on `identity_map` and why it is keyed per
-- person. In short: `pennsync_private` is the authority store's schema, the
-- table depends on nothing in `pennsync_records`, and
-- `restore-schema-fixture.mjs` pins the shape this store survives a dump and
-- restore with from that directory alone — so a table created from here would
-- sit outside the backup rehearsal with nothing reporting it. Both
-- `tools-pennsync-migrate.mjs` and every harness apply the authority directory
-- whole before this one, so the table exists by the time the functions below
-- read it.
--
-- What is here is the half that needs the record store: the bridge that reads
-- the name and the two contracts that project it.

-- `caller_roster` is the bridge and already reads this table. It is a definer
-- owned by the MIGRATION role, which is why it can read `pennsync_private` at
-- all: `contract_roster_list` and `contract_roster_get` are owned by
-- `pennsync_records_owner`, which holds `usage` on that schema and no table in
-- it, so they cannot look a name up themselves. Widening the bridge is the
-- existing seam rather than a new helper.
--
-- DROP and create rather than `create or replace`, because the RETURN TYPE
-- moves and PostgreSQL refuses to replace a function's return type. The four
-- other contracts that call it (`contract_data_quality`,
-- `contract_roster_report`, `contract_report_metrics`, and the roster pair) all
-- alias it and name their columns, so an appended column reaches none of them;
-- plpgsql resolves the name at run time, so none needed recreating.
--
-- Dropping it also drops its grants. Restoring them is not tidiness: a policy
-- or definer calling a function it cannot execute fails outright with
-- `permission denied for function` rather than returning no rows.
drop function "pennsync_records".caller_roster(text);

create function "pennsync_records".caller_roster(p_agency text) returns table(
    user_id text, email text, agency_id text, agency_name text, tenant_role text,
    is_active boolean, full_name text)
  language sql stable security definer set search_path = '' as $$
  select peer.base44_user_id, peers.expected_email, m.agency_id::text, a.name,
         peer.tenant_role::text, peers.enabled, named.display_name
  from "pennsync_records".caller_identity() i
  join pennsync_private.membership m
    on m.app_id = i.app_id and m.auth_user_id = i.auth_user_id
   and m.base44_user_id = i.base44_user_id
  join pennsync_private.agency a on a.app_id = m.app_id and a.id = m.agency_id
  join pennsync_private.membership peer on peer.app_id = m.app_id and peer.agency_id = m.agency_id
  join pennsync_private.identity_map peers
    on peers.app_id = peer.app_id and peers.auth_user_id = peer.auth_user_id
   and peers.base44_user_id = peer.base44_user_id
  -- LEFT, because a colleague with no name recorded is on the roster exactly as
  -- a colleague with no carried profile row is. An inner join here would drop
  -- every staff member until a name existed for them.
  left join pennsync_private.staff_name named
    on named.app_id = peers.app_id and named.auth_user_id = peers.auth_user_id
  where i.auth_user_id is not null
    and m.agency_id::text = p_agency
    and m.status = 'active' and m.revoked_at is null
    and a.status in ('active','trial')
    -- The same criterion caller_roster_ids() uses, so the two cannot disagree.
    -- Unchanged from the generated original, and deliberately quoted rather
    -- than summarised: a revoked colleague listed here while the policy hides
    -- their profile row is a phantom that reads as somebody who filled nothing
    -- in.
    and peer.status = 'active' and peer.revoked_at is null
$$;

revoke all on function "pennsync_records".caller_roster(text)
  from public, anon, authenticated, service_role;
grant execute on function "pennsync_records".caller_roster(text) to "pennsync_records_owner";

set local role "pennsync_records_owner";

-- The projection gains one key, and `p_full_name` is REQUIRED rather than
-- defaulted on purpose. A defaulted parameter would let a caller nobody
-- updated keep compiling and answer a null name — the projection would say
-- "this person has no name recorded" about somebody who has one. Required, an
-- un-updated caller raises `function does not exist` at run time instead, which
-- is a failure somebody reads. Both callers are recreated below.
--
-- DROP and create because the signature moves; `create or replace` with an
-- added parameter makes a SECOND function and leaves the old arity callable.
drop function "pennsync_records".roster_entry(
  text, text, text, text, text, boolean, "pennsync_records"."user", boolean);

create function "pennsync_records".roster_entry(
  p_user_id text, p_email text, p_full_name text, p_agency_id text, p_agency_name text,
  p_tenant_role text, p_is_active boolean, p_profile "pennsync_records"."user",
  p_privileged boolean)
  returns jsonb language sql immutable set search_path = '' as $projection$
  select jsonb_build_object(
    -- Authority, from the authority store. Never the carried row's copy.
    'id', p_user_id,
    'email', p_email,
    -- PennSync's own, from `pennsync_private.identity_map`. Projected for every
    -- caller rather than only a privileged one, because the ADDRESS beside it
    -- already is: a colleague's name is not personnel detail, and making it one
    -- would tell a handler which kind of caller it is serving.
    'full_name', p_full_name,
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

-- Both callers are LIFTED out of the migrations that define them and edited by
-- one insertion each rather than retyped: the name goes third, right after the
-- email, and the list's CTE carries the column through. Retyping a 120-line
-- contract to add one argument is the transcription D12 settled against, and
-- every line retyped is a place this port could drift quietly.

drop function "pennsync_records".contract_roster_list(text,integer,text,text);

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
    select m.user_id, m.email, m.full_name, m.agency_id, m.agency_name, m.tenant_role, m.is_active,
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
      page.user_id, page.email, page.full_name, page.agency_id, page.agency_name, page.tenant_role, page.is_active,
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

drop function "pennsync_records".contract_roster_get(text,text);

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
      m.user_id, m.email, m.full_name, m.agency_id, m.agency_name, m.tenant_role, m.is_active, u, v_privileged)
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

-- The two contracts' own grants survive a `drop ... create` of the FUNCTIONS
-- THEY CALL, but not of themselves, and both were just recreated.
revoke all on function "pennsync_records".roster_entry(
    text, text, text, text, text, text, boolean, "pennsync_records"."user", boolean),
  "pennsync_records".contract_roster_list(text,integer,text,text),
  "pennsync_records".contract_roster_get(text,text)
  from public, anon, authenticated, service_role;

grant execute on function "pennsync_records".contract_roster_list(text,integer,text,text),
  "pennsync_records".contract_roster_get(text,text) to authenticated;

commit;
