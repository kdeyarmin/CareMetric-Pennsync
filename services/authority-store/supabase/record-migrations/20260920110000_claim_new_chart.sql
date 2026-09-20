-- The production grant path `chart_assignment` was created without (D28).
--
-- D24 made `pennsync_private.chart_assignment` the only thing that says who
-- may open a chart, and the record store's `caller_assigned_patients()` reads
-- it. What that left unanswered is how a chart gets its first care-team seat
-- when somebody creates it.
--
-- The Base44 original has no such question: `createAuthorizedPatient` writes
-- the patient and a `patient_creator` care-team assignment in one place. Here
-- they are two writes to two owners — the patient row belongs to
-- `pennsync_records_owner`, the assignment to this store's administrator, and
-- neither owner may write the other's schema. Without a path across, a
-- clinician can create a patient and then cannot open it:
-- `insert … returning` is a read of the row just written, and the read policy
-- refuses it. Measured, and pinned in `record-tenant-isolation.test.mjs`.
--
-- **Both writes are in one transaction.** D28 first reasoned about the order
-- to use if they could not be — grant first, because an assignment naming a
-- patient that does not exist is inert while a chart its creator cannot open
-- is not. That analysis stands and is still what makes the ordering here safe,
-- but it was answering a harder question than the one in front of us: the two
-- ownership domains are two SCHEMAS IN ONE DATABASE, not two databases, so a
-- contract can claim and insert atomically and neither write survives the
-- other failing. The ordering argument is the failure analysis; atomicity is
-- the design.
--
-- That is why this is reached by the record store's contracts and not by a
-- client. It is granted to `pennsync_records_owner` and has no public wrapper:
-- a caller that could claim without creating would only be able to leave
-- grants behind, and nothing needs to.
--
-- **The identity is minted here, never accepted from the caller.** That is the
-- security property the whole function turns on: a caller who could name the
-- id would name a chart that already exists, and the grant would hand them
-- somebody else's record. Minting also lets the check be exact rather than
-- probabilistic — this reads `pennsync_records.patient` to confirm the id is
-- free, which it can do because the function is owned by the administrator
-- that owns both schemas' helpers, and refuses rather than looping forever.
--
-- What the caller learns is only that a freshly minted id was free, which it
-- always is.
--
-- It lives in the RECORD directory although it creates objects in
-- `pennsync_private`, and the reason is dependency order rather than
-- ownership: it asks `pennsync_records.caller_tenant_role`, and the
-- provisioner applies every authority migration before any record one. A file
-- in the authority directory could not have found that helper. It is the first
-- migration here that is a bridge rather than a record-store object, which is
-- what a cross-store write looks like.
begin;

do $$
begin
  if to_regclass('pennsync_private.chart_assignment') is null
    or to_regprocedure('pennsync_records.caller_tenant_role(text)') is null then
    raise exception using errcode='42501',message='PENNSYNC_RECORD_STORE_REQUIRED';
  end if;
end $$;

/*
 * Claim a new chart: mint its identity and take the care-team seat.
 *
 * SECURITY DEFINER and owned by the migration administrator, which is what
 * lets it read the record store's caller helpers and write this store's
 * assignment table. It is the only production writer of `chart_assignment`
 * besides the operator backfill.
 */
create function pennsync_private.claim_new_chart(p_agency text) returns text
  language plpgsql security definer set search_path = '' as $claim$
declare v_role text; v_uid uuid; v_membership text; v_id text; v_attempt integer;
begin
  -- Membership is asked of this store, never of the request. Null means the
  -- caller holds nothing in this agency.
  v_role := pennsync_records.caller_tenant_role(p_agency);
  if v_role is null then
    raise exception using errcode='42501', message='PENNSYNC_CHART_AGENCY_NOT_HELD';
  end if;
  -- The original's `PATIENT_CREATE_ROLES`, and no wider. A social worker or a
  -- spiritual care worker opens charts they are assigned to and does not start
  -- one; office staff do neither.
  if v_role not in ('agency_admin', 'manager', 'clinician') then
    raise exception using errcode='42501', message='PENNSYNC_CHART_FORBIDDEN';
  end if;

  select i.auth_user_id into v_uid from pennsync_records.caller_identity() i;
  -- The seat is the CALLER's own membership. Nothing here takes a subject, so
  -- this cannot put somebody else on a care team.
  select m.id into v_membership from pennsync_private.membership m
  where m.app_id = pennsync_private.deployment_app_id()
    and m.agency_id = p_agency and m.auth_user_id = v_uid
    and m.status = 'active' and m.revoked_at is null;
  if v_uid is null or v_membership is null then
    raise exception using errcode='42501', message='PENNSYNC_CHART_AGENCY_NOT_HELD';
  end if;

  -- Minted, and checked against the charts that exist rather than trusted to
  -- entropy. Bounded, so a pathological store refuses instead of spinning.
  for v_attempt in 1..8 loop
    v_id := pg_catalog.substr(pg_catalog.md5(pg_catalog.gen_random_uuid()::text), 1, 24);
    exit when not exists (
      select 1 from pennsync_records.patient p
      where p.source_app_id = pennsync_private.deployment_app_id() and p.id = v_id)
      and not exists (
      select 1 from pennsync_private.chart_assignment a
      where a.app_id = pennsync_private.deployment_app_id() and a.patient_id = v_id);
    v_id := null;
  end loop;
  if v_id is null then
    raise exception using errcode='53400', message='PENNSYNC_CHART_IDENTITY_EXHAUSTED';
  end if;

  insert into pennsync_private.chart_assignment
    (app_id, agency_id, patient_id, membership_id, status, changed_by)
  values (pennsync_private.deployment_app_id(), p_agency, v_id, v_membership, 'active', v_uid);
  return v_id;
end $claim$;

-- Nothing reads or writes `chart_assignment` directly, and no client reaches
-- this either: the only caller is a record-store contract, inside its own
-- transaction. A current session is still mandatory, because
-- `caller_tenant_role` answers null without one.
revoke all on function pennsync_private.claim_new_chart(text)
  from public, anon, authenticated, service_role;

-- The record owner may NAME this schema and call this one function. Usage on
-- a schema grants nothing on its objects, so the owner reaches no table here
-- and no other function; a test measures exactly that rather than trusting it.
grant usage on schema pennsync_private to "pennsync_records_owner";
grant execute on function pennsync_private.claim_new_chart(text) to "pennsync_records_owner";

-- What that usage exposes beyond the function named above, measured rather
-- than assumed: no table at all, and two trigger functions that later
-- migrations created after the store's blanket revoke and which therefore
-- still carry PostgreSQL's default `execute` for everyone. Both refuse to run
-- outside a trigger, so nothing follows from reaching them.
--
-- A blanket `revoke all on all functions in schema pennsync_private` would
-- tidy those two away and take the entire staging surface with them: every
-- `pennsync_staging_*` wrapper is an invoker calling an inner function that is
-- explicitly granted to `authenticated`. Nine suites say so. Left alone
-- deliberately, and the test below pins the exposure so a real one would show.

commit;
