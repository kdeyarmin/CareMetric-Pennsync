-- A staff member's display name, in the authority store.
--
-- Kevin chose this on a decision card: of "show the work email", "add a name to
-- our own store" and "copy the names over from Base44", his answer was the
-- second. So the screens keep showing names and stop depending on Base44, and
-- nothing is copied from it.
--
-- WHAT HIS ANSWER BOUGHT. The COLUMN, not the NAMES. Real people's names in
-- production is one of the holds he keeps himself, and he answered where a name
-- comes from rather than whose names go in. So this ships EMPTY, and the CHECK
-- below is what makes that a refusal rather than a convention.
--
-- WHY IT IS AN AUTHORITY MIGRATION and not the record one that reads it. The
-- table depends on nothing in `pennsync_records` — only on `identity_map` — and
-- every other table in `pennsync_private` is created here. The reason to care
-- is coverage rather than tidiness: `restore-schema-fixture.mjs` pins the shape
-- this store survives a dump and restore with, and it builds from THIS
-- directory alone, so a `pennsync_private` table created from
-- `record-migrations/` would sit outside the backup rehearsal with nothing
-- reporting it. That is how the first draft of this change was written, and the
-- ratchet caught it only because the fixture was edited to match — a guard that
-- reads correctly and does nothing is the outcome to avoid, so the table moved
-- to where the guard can see it. `20260920110000_claim_new_chart.sql` is the
-- exception on the other side and states its reason: it asks
-- `pennsync_records.caller_tenant_role` and so cannot apply before the record
-- store exists. Nothing here does.
--
-- The ordering that makes the pair safe is not the timestamps: both
-- `tools-pennsync-migrate.mjs` and every harness walk the authority directory
-- whole before the record directory, so this table exists before
-- `record-migrations/20260920630000_roster_display_name.sql` reads it.
--
-- WHY IT IS NOT ON THE CARRIED TABLE, which is the first thing anybody will
-- reach for. `pennsync_records."user"` is GENERATED from the entity definitions
-- (`node tools-entity-schema-plan.mjs --write-migration`), and
-- `base44/entities/User.jsonc` has NO name property at all — the only name-ish
-- key on it is `agency_name`. Base44 keeps a person's name on the platform
-- ACCOUNT, not on the entity, which is D69's gap read from the other side. A
-- column there would mean either describing a field Base44 does not have or
-- breaking the generated-equals-committed test.
begin;

-- WHY IT IS NOT ON `identity_map` EITHER, which is where it went first and
-- where the schema refused it. That table permits exactly ONE update:
-- `pennsync_private.protect_identity()` raises `PENNSYNC_IMMUTABLE_IDENTITY`
-- unless the change is a revocation, enumerating the columns that may not move.
-- A name there could be set at enrolment and never again, which is dead for
-- every staff member already enrolled — and D99's own comment on that function
-- says why adding a column to the table is not free: a check that decides from
-- an enumeration is silently wrong about what the enumeration does not name, so
-- a revocation could have rewritten the name on its way through.
--
-- The refusal is correct on the merits. `identity_map` holds VERIFICATION
-- EVIDENCE — `source_evidence_sha256`, `verified_at`, a one-way revocation —
-- and a display name is mutable profile data. Mixing the second into the first
-- is what the trigger exists to prevent. So the name gets its own table, keyed
-- per PERSON rather than per membership: somebody who holds a membership in two
-- agencies is one person with one name, and a per-membership row would let
-- those two disagree.
create table pennsync_private.staff_name (
  -- `deployment_app`, read off the LIVE `identity_map` column rather than out of
  -- the migration that created the table: that migration says `staging_app`, and
  -- the domain has been renamed since. A type name copied from the oldest file
  -- that mentions it applies cleanly against a fresh reading of history and
  -- fails against the store.
  app_id pennsync_private.deployment_app not null,
  auth_user_id uuid not null,
  -- The hold, in the database. `pennsync_private.agency.name` is constrained
  -- `like 'Synthetic %'` and its lift sits written and never run, awaiting the
  -- owner's word; a person's name is that same hold in a sharper form, so it
  -- gets the same shape of constraint and its lift will be its own migration,
  -- gated the same way. A hold kept by hand is one slip from gone.
  display_name text not null check (display_name like 'Synthetic %'
    and display_name = btrim(display_name) and length(display_name) between 11 and 120),
  recorded_at timestamptz not null default clock_timestamp(),
  -- NOT NULL, because absence is the absent ROW. A nullable column would give
  -- two ways to say "no name recorded" and the roster would have to mean the
  -- same thing by both.
  primary key (app_id, auth_user_id),
  foreign key (app_id, auth_user_id)
    references pennsync_private.identity_map(app_id, auth_user_id)
);

-- Force-RLS with NO policy, like `chart_assignment`: with no policy for a
-- command PostgreSQL matches no rows rather than raising, so no caller reads or
-- writes this table by any path, the record owner included. That is what keeps
-- "who may set a name" an open decision rather than one taken by omission —
-- since D82 the only roster write is `auth.updateMe` over
-- `pennsync_records."user"`, and this table is not reachable from there at all,
-- so there is no self-write allowlist to widen. A write path would be a new
-- contract with a gate of its own.
alter table pennsync_private.staff_name enable row level security;
alter table pennsync_private.staff_name force row level security;

commit;
