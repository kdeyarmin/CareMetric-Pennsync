-- D99. A second provenance kind for an identity, so a person who never held a
-- Base44 account can be admitted to the owned store.
--
-- D6 moves identity by re-enrollment: verified out of band, the person accepts
-- a Supabase Auth invitation THEMSELVES, and only then does an operator bind the
-- two together with `tools-pennsync-enroll.mjs`. None of that changes here, and
-- the change is deliberately the smallest one that lets a new hire through it:
-- `identity_map` required a Base44 user id for every row, so the table could
-- migrate ten known accounts and could not onboard anybody.
--
-- **What is NOT done, and why.** The column is not renamed and is not made
-- nullable. `membership.base44_user_id` is `not null`, `membership_key` is
-- GENERATED from it, `caller_identity`, `caller_roster` and `caller_roster_ids`
-- all join on it, `contract_roster_get` checks its parameter against
-- `^[a-f0-9]{24}$`, and 589 record policies reach it through `caller_user_id()`.
-- Every one of those is a place a nullable identity would have to be handled
-- again. So the column keeps its shape and every consumer keeps working; what
-- widens is what it may HOLD, which is what the consumers already call it —
-- `caller_roster` returns it as `user_id` and the roster contract takes it as
-- `p_user_id`.
--
-- **The two id spaces are disjoint by construction, not by hope.** A locally
-- verified person's id is minted rather than issued, so it must begin
-- `ffffffff`, and a migrated person's must not. A Base44 id is an ObjectId whose
-- leading four bytes are a unix timestamp, so `ffffffff` is a date in 2106 —
-- but that is the reason the prefix was CHOSEN and not what this constraint
-- rests on. What it rests on is the constraint itself: if a real Base44 id ever
-- arrived with that prefix, enrolling that person would be REFUSED here rather
-- than conflated with a minted identity. It fails closed either way, which is
-- why the shape of somebody else's ids is not load-bearing.
begin;

alter table pennsync_private.identity_map
  add column provenance text not null default 'base44_migrated'
    check (provenance in ('base44_migrated', 'locally_verified'));

-- The DEFAULT is load-bearing rather than tidy, the reason D33's `granted_at`
-- carries one: it fills the rows that already exist, and it makes a writer that
-- forgets the column fail CLOSED. A minted id inserted without naming the
-- provenance is `base44_migrated`, which the constraint below refuses — so the
-- omission is an error rather than a row recorded as the wrong kind.
alter table pennsync_private.identity_map
  add constraint identity_map_provenance_id_space check (
    (provenance = 'base44_migrated' and base44_user_id not like 'ffffffff%')
    or (provenance = 'locally_verified' and base44_user_id like 'ffffffff%'));

-- The immutability trigger enumerates the columns it protects, so adding one
-- left it MUTABLE: the only update this trigger permits is a revocation, and a
-- revocation could have rewritten `provenance` on its way through. That is this
-- repository's own recurring shape — a check that decides from an enumeration
-- and is silently wrong about what the enumeration does not name — so the
-- function is replaced rather than the column merely added, and a test plants
-- the revocation that would have carried it.
create or replace function pennsync_private.protect_identity() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if (new.app_id,new.auth_user_id,new.base44_user_id,new.expected_email,
      new.source_evidence_sha256,new.verified_at,new.provenance) is distinct from
     (old.app_id,old.auth_user_id,old.base44_user_id,old.expected_email,
      old.source_evidence_sha256,old.verified_at,old.provenance)
     or not old.enabled or new.enabled or new.revoked_at is null
     or new.version <> old.version + 1 then
    raise exception using errcode='23514',message='PENNSYNC_IMMUTABLE_IDENTITY';
  end if;
  return new;
end $$;

commit;
