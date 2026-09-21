-- The membership lifecycle the roster and the tenant context already read.
--
-- `manageAgencyMembership` moves a membership through pending, active,
-- suspended and revoked, and changes its role. This store's `membership` has
-- carried only `active` and `revoked` because nothing here could move one:
-- enrollment inserts an active row and the staging surface can revoke it.
-- Porting the capability means the table has to be able to hold the states the
-- capability produces.
--
-- **Why adding two statuses is safe, and how that was established rather than
-- assumed.** Twenty-seven places in this store's SQL read a membership, and
-- every one of them filters `status = 'active'`. A status that is not `active`
-- is therefore admitted by none of them: `caller_agencies`, `caller_tenant_role`,
-- `caller_roster_ids`, the staging context and the D34 tenant contract all
-- close rather than open. This is the same property that made D33's
-- `suspended` safe on `chart_assignment`, and it is a property of the readers,
-- not of this migration — so it is worth re-checking rather than inheriting if
-- a future reader stops filtering.
--
-- **`activated_at` carries a default, and that is the D33 lesson applied
-- before it bit.** Every existing writer — `tools-pennsync-enroll.mjs`, the
-- archive import's harness and the shared fixtures — inserts an ACTIVE row and
-- names none of these columns. On `chart_assignment` the equivalent column was
-- merely nullable and the coherence check then refused every grant those
-- writers made; the fixtures failed on their first insert. A default avoids
-- that for the three states that have a timestamp. The consequence is the
-- reverse for `pending`, which must have NO activation: a pending row has to
-- name `activated_at` as null explicitly. Nothing in the port does — D35 does
-- not serve `provision` — so the only creator of a pending row is an operator
-- or a future enrollment path, and the constraint tells them.
begin;

do $$
begin
  if to_regclass('pennsync_private.membership') is null then
    raise exception using errcode='42501',message='PENNSYNC_AUTHORITY_STORE_REQUIRED';
  end if;
end $$;

alter table pennsync_private.membership
  add column last_action text not null default 'provision'
    check (last_action in ('provision','activate','suspend','revoke','change_role')),
  add column last_reason text,
  add column activated_at timestamptz,
  add column suspended_at timestamptz;
-- Existing rows first, so a membership that already existed keeps a plausible
-- activation rather than the moment this migration ran. There is no earlier
-- timestamp on the row to use, so this is the honest one available.
update pennsync_private.membership set activated_at = clock_timestamp()
  where activated_at is null and status <> 'pending';
alter table pennsync_private.membership
  alter column activated_at set default clock_timestamp();

alter table pennsync_private.membership
  drop constraint membership_status_check;
alter table pennsync_private.membership
  add constraint membership_status_check
  check (status in ('pending','active','suspended','revoked'));

-- The original's `validateMemberships` re-derives all of this on every read,
-- because a Base44 entity can hold a row no rule produced. Here it is the
-- table's own rule, which is what D34's test asserts.
alter table pennsync_private.membership
  drop constraint membership_check;
alter table pennsync_private.membership
  add constraint membership_check check (
    (status = 'pending' and revoked_at is null and revoked_by is null
      and activated_at is null and suspended_at is null)
    or (status = 'active' and revoked_at is null and revoked_by is null
      and activated_at is not null)
    or (status = 'suspended' and revoked_at is null and revoked_by is null
      and activated_at is not null and suspended_at is not null)
    or (status = 'revoked' and revoked_at is not null and revoked_by is not null));

commit;
