-- The general activity trail (D25).
--
-- HAND WRITTEN, like the contracts beside it and for the same reason: this is
-- not a carried Base44 entity, so there is nothing to generate it from. It is
-- new infrastructure the exit needs and did not have.
--
-- Why it exists at all: `UserActivity`, `SecurityLog` and `SystemLog` are
-- dispositioned `retire` with a six-year archive basis, which decided where the
-- EXISTING rows go. It did not decide whether the product keeps auditing, and
-- reading the modules shows what the elision would have cost — of the 19
-- capabilities touching `UserActivity`, all 19 WRITE and only one reads. They
-- are producers of the audit trail, not consumers of a table. Retiring it
-- without a successor drops 28 audit paths in a regulated product, invisibly,
-- until somebody needs the record.
--
-- Three properties are load-bearing rather than stylistic:
--
-- 1. **Append-only by absence.** There is an insert policy and a read policy
--    and NO update or delete policy. Forced RLS with no policy is a refusal, so
--    nothing rewrites or removes an audit row — not a caller, not a contract,
--    not the record owner, which `force row level security` binds too.
-- 2. **The actor is stamped, never supplied.** It comes from the caller
--    helpers. A capability cannot attribute its action to somebody else, which
--    is the one thing an audit trail must refuse.
-- 3. **Detail is bounded.** An unbounded `jsonb` becomes the place somebody
--    puts a patient's record. The contract refuses an oversized payload rather
--    than truncating it: a silently truncated audit entry is worse than a
--    refused write, because it looks complete.
begin;

do $$
begin
  if to_regprocedure('pennsync_records.caller_tenant_role(text)') is null then
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

create table "pennsync_records"."activity_audit" (
  "source_app_id" text not null,
  "id" text not null,
  "agency_id" text not null,
  "occurred_at" timestamptz not null,
  -- Both, because neither alone survives: an id outlives a changed address,
  -- and an address is what a person reading the trail recognises.
  "actor_user_id" text not null,
  "actor_email" text not null,
  "action" text not null,
  -- What the action was about, when it was about something. Deliberately a
  -- loose pair rather than a foreign key: an audit row must survive the
  -- deletion of its subject, which a reference would prevent.
  "subject_kind" text,
  "subject_id" text,
  "detail" jsonb,
  constraint "activity_audit_pkey" primary key ("source_app_id", "id"),
  constraint "activity_audit_action_present" check (length("action") between 1 and 120),
  constraint "activity_audit_subject_paired"
    check (("subject_kind" is null) = ("subject_id" is null)),
  constraint "activity_audit_subject_kind_allowed" check ("subject_kind" is null or "subject_kind" in
    ('patient', 'visit', 'document', 'referral', 'user', 'agency', 'membership', 'other'))
);
alter table "pennsync_records"."activity_audit" enable row level security;
alter table "pennsync_records"."activity_audit" force row level security;
revoke all on "pennsync_records"."activity_audit" from public;

-- Read and insert only. The absence of the other two is the append-only
-- guarantee, and it binds the owner as well as any caller.
create policy "activity_audit_read" on "pennsync_records"."activity_audit" for select
  using ("activity_audit"."source_app_id" = "pennsync_records".deployment_app()
    and "activity_audit"."agency_id" in (select "pennsync_records".caller_agencies()));
create policy "activity_audit_insert" on "pennsync_records"."activity_audit" for insert
  with check ("activity_audit"."source_app_id" = "pennsync_records".deployment_app()
    and "activity_audit"."agency_id" in (select "pennsync_records".caller_agencies()));

-- Appending is not privileged: every capability audits as it works, so any
-- member of the agency may write its own action. What it may not do is write
-- somebody else's — the actor is taken from the caller helpers, not the call.
create function "pennsync_records".contract_activity_append(
  p_agency text, p_action text, p_subject_kind text, p_subject_id text, p_detail jsonb)
  returns text language plpgsql volatile security definer set search_path = '' as $contract$
declare v_role text; v_id text; v_actor text; v_email text;
begin
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_AUDIT_AGENCY_NOT_HELD';
  end if;
  if p_action is null or length(p_action) < 1 or length(p_action) > 120 then
    raise exception using errcode='22023', message='PENNSYNC_AUDIT_ACTION_INVALID';
  end if;
  if (p_subject_kind is null) <> (p_subject_id is null) then
    raise exception using errcode='22023', message='PENNSYNC_AUDIT_SUBJECT_INVALID';
  end if;
  if p_detail is not null and jsonb_typeof(p_detail) <> 'object' then
    raise exception using errcode='22023', message='PENNSYNC_AUDIT_DETAIL_INVALID';
  end if;
  -- Refused rather than truncated. A silently shortened audit entry looks
  -- complete, which is the worse failure of the two.
  if p_detail is not null and length(p_detail::text) > 8192 then
    raise exception using errcode='22023', message='PENNSYNC_AUDIT_DETAIL_TOO_LARGE';
  end if;
  v_actor := "pennsync_records".caller_user_id();
  v_email := "pennsync_records".caller_email();
  if v_actor is null or v_email is null then
    raise exception using errcode='42501', message='PENNSYNC_AUDIT_AGENCY_NOT_HELD';
  end if;
  v_id := replace(gen_random_uuid()::text, '-', '');
  insert into "pennsync_records"."activity_audit"
    ("source_app_id","id","agency_id","occurred_at","actor_user_id","actor_email",
     "action","subject_kind","subject_id","detail")
  -- `clock_timestamp()`, not `now()`. `now()` is the TRANSACTION timestamp, so
  -- a handler auditing twice while serving one request would write two rows
  -- with the same `occurred_at` and no way to order them against each other —
  -- and the trail is read to answer what happened in what order. This is the
  -- common case here rather than the rare one.
  values ("pennsync_records".deployment_app(), v_id, p_agency, clock_timestamp(), v_actor, v_email,
    p_action, p_subject_kind, p_subject_id, p_detail);
  return v_id;
end $contract$;

-- Reading the trail is an administrative act. The policy decides whose rows
-- these are; this decides who may ask for them, which is D19's division.
--
-- Newest first, and paged on `(occurred_at, id)` rather than on `id` alone.
-- The ids here are random uuids, so an `order by id` would have handed an
-- administrator the trail in arbitrary order and paged it into arbitrary
-- slices — correct as keyset pagination and useless as an audit trail, which
-- is read to answer "what happened, and in what order". The id stays in the
-- key as the tiebreaker, because two rows can share a timestamp and a cursor
-- that cannot separate them either repeats a row or skips one.
--
-- The cursor is opaque and the caller does not build it: each page answers
-- with the `next` to send back, or null at the end. `|` cannot occur in either
-- half — a timestamptz never renders one and an id is 32 hex characters.
create function "pennsync_records".contract_activity_list(
  p_agency text, p_limit integer default 100, p_after text default null)
  returns jsonb language plpgsql stable security definer set search_path = '' as $contract$
declare
  v_role text; v_rows jsonb; v_limit integer;
  v_at timestamptz; v_id text; v_next text;
begin
  v_role := "pennsync_records".caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_AUDIT_AGENCY_NOT_HELD';
  end if;
  if v_role <> 'agency_admin' then
    raise exception using errcode='42501', message='PENNSYNC_AUDIT_FORBIDDEN';
  end if;
  -- A cursor nobody can parse is refused rather than read as "from the start":
  -- silently returning page one to a caller asking for page nine repeats rows
  -- an auditor has already seen and looks like duplicated activity.
  if p_after is not null then
    begin
      v_at := split_part(p_after, '|', 1)::timestamptz;
      v_id := split_part(p_after, '|', 2);
    exception when others then
      raise exception using errcode='22023', message='PENNSYNC_AUDIT_CURSOR_INVALID';
    end;
    if v_at is null or v_id is null or v_id !~ '^[0-9a-f]{32}$' then
      raise exception using errcode='22023', message='PENNSYNC_AUDIT_CURSOR_INVALID';
    end if;
  end if;
  v_limit := least(greatest(coalesce(p_limit, 100), 1), 1000);
  select coalesce(jsonb_agg(to_jsonb(a) order by a."occurred_at" desc, a."id" desc), '[]'::jsonb) into v_rows
  from (
    select * from "pennsync_records"."activity_audit" t
    where t."agency_id" = p_agency
      and (p_after is null or (t."occurred_at", t."id") < (v_at, v_id))
    order by t."occurred_at" desc, t."id" desc
    limit v_limit
  ) a;
  -- Only when the page was full: a short page is the end of the trail, and a
  -- cursor there would invite a round trip that can only come back empty.
  if jsonb_array_length(v_rows) = v_limit then
    v_next := (v_rows -> (v_limit - 1) ->> 'occurred_at') || '|' || (v_rows -> (v_limit - 1) ->> 'id');
  end if;
  return jsonb_build_object('entries', v_rows, 'next', v_next);
end $contract$;

reset role;

revoke all on function "pennsync_records".contract_activity_append(text,text,text,text,jsonb),
  "pennsync_records".contract_activity_list(text,integer,text)
  from public, anon, authenticated, service_role;

grant execute on function "pennsync_records".contract_activity_append(text,text,text,text,jsonb),
  "pennsync_records".contract_activity_list(text,integer,text) to authenticated;

create function "public"."pennsync_contract_activity_append"(
  p_agency text, p_action text, p_subject_kind text, p_subject_id text, p_detail jsonb) returns text
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_activity_append(p_agency, p_action, p_subject_kind, p_subject_id, p_detail)
$contract$;

create function "public"."pennsync_contract_activity_list"(
  p_agency text, p_limit integer default 100, p_after text default null) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_activity_list(p_agency, p_limit, p_after)
$contract$;

revoke all on function "public"."pennsync_contract_activity_append"(text,text,text,text,jsonb),
  "public"."pennsync_contract_activity_list"(text,integer,text)
  from public, anon, authenticated, service_role;

grant execute on function "public"."pennsync_contract_activity_append"(text,text,text,text,jsonb),
  "public"."pennsync_contract_activity_list"(text,integer,text) to authenticated;

commit;
