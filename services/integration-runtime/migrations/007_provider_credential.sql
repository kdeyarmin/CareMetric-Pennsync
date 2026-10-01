-- Where a telecom provider credential lives on the owned side.
--
-- Base44 holds this on an `IntegrationSecret` row whose `rls` is
-- `__service_role_only__` on all four operations, and our own instructions say
-- twice that it is deliberately not an environment variable. That decision is
-- kept: a credential an operator can rotate without a deploy is the whole
-- reason the row exists, and three separate incidents came from someone adding
-- a `Deno.env.get('TELNYX_…')` fallback when a credential READ failed and was
-- reported as "not configured". So this is the owned equivalent of the row,
-- not of the env var.
--
-- **Why it is here and not in the record store.** `IntegrationSecret` carries
-- no agency and no clinical subject: it is one platform-level row. In the
-- record store it could be neither `agency` (it has no tenant) nor `global`
-- (D83 refuses a `global` reference table that carries an actor column, and
-- this one carries `updated_by_email`), and `pennsync-api` holds only a
-- publishable key, so nothing over there could read it anyway. The integration
-- runtime is the side that already holds a service role and an encryption key,
-- and it is the side that would present the credential to a provider. The
-- credential belongs where the sending happens.
--
-- **The API key is sealed; the resource ids are not.** `IntegrationSecret`'s
-- own descriptions make that split: the API key is "stored backend-only; never
-- returned to the client", while the webhook public key is "not a secret, but
-- kept here so all Telnyx config lives in one row", and the three connection
-- ids are ids. So `api_key_sealed` holds the runtime's AEAD blob, bound to the
-- same `app_id:provider` context the service seals it under, and the rest sit
-- in cleartext columns. That is not tidiness: it makes
-- `cm_integration_credential_status` STRUCTURALLY unable to return the key,
-- because the column it would have to read is not in its projection and the
-- value it would have to return cannot be unsealed in SQL.
--
-- **One active version, enforced by an index rather than by a sort.** The
-- Base44 read was an unsorted `rows[0]` with no `is_active` filter, and
-- `saveTelnyxSecret` picked from the same unordered query — so with two
-- `provider: 'telnyx'` rows the admin could be writing one row while the
-- senders read the other, and re-entering the key could never fix it. The
-- shipped helper repaired that by sorting and preferring an active row with a
-- non-empty key. The partial unique index below removes the condition the
-- repair compensates for: two active rows per provider cannot exist, so the
-- preference order has nothing left to choose between and
-- `provider-credential.mjs` carries none. Deleting a compensation is only safe
-- when the thing it compensated for is gone, and here it is gone by
-- construction.
--
-- **Rotation is append-only and deactivation is one-way.** A new credential is
-- a new version; the previous one is deactivated and kept. The trigger refuses
-- every delete, refuses a change to anything but `is_active`, and refuses
-- `false -> true` — reactivating a retired key would silently repoint every
-- send at a credential somebody withdrew, with nothing in the row changed to
-- show it. Same shape as `identity_map`'s revocation, and the reason is the
-- same: the one-way edge is what makes the record of a withdrawal worth
-- anything.
--
-- **Forward-only, as 005 and 006 are.** 001 is applied in the hosted project
-- and its README is explicit that the sequence is never replayed there. This
-- adds a table, an index, a trigger and three functions; it drops nothing and
-- rewrites no history.
begin;

create table public.cm_integration_credential (
  id uuid primary key,
  app_id text not null check (app_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  -- One provider today, as the Base44 enum has one. A second provider is a new
  -- value here and nothing else, which is why the key is (app, provider,
  -- version) rather than (app, version).
  provider text not null check (provider in ('telnyx')),
  -- Monotonic per (app, provider). Not a timestamp: two rotations inside one
  -- clock tick are two versions, and a reader that ordered by time could not
  -- tell them apart.
  version bigint not null check (version >= 1),
  -- The runtime's AEAD blob over the secret. Opaque here on purpose: SQL
  -- cannot open it, so no function in this file can return the key even by
  -- accident, and a dump of this table discloses no credential.
  api_key_sealed text not null check (length(api_key_sealed) between 1 and 8192),
  -- Non-secret, and the only thing a status read may say about the key. Derived
  -- by the service from the key it sealed, never taken from a caller: a
  -- caller-supplied last four would let the panel show a different credential
  -- from the one the senders use, which is the unfalsifiable state the Base44
  -- incidents reported.
  api_key_last_four text not null check (api_key_last_four ~ '^.{4}$'),
  -- "Not a secret, but kept here so all Telnyx config lives in one row."
  public_key text check (public_key is null or length(public_key) between 1 and 1024),
  messaging_profile_id text check (messaging_profile_id is null or messaging_profile_id ~ '^[A-Za-z0-9_-]{1,200}$'),
  voice_connection_id text check (voice_connection_id is null or voice_connection_id ~ '^[A-Za-z0-9_-]{1,200}$'),
  fax_connection_id text check (fax_connection_id is null or fax_connection_id ~ '^[A-Za-z0-9_-]{1,200}$'),
  is_active boolean not null default true,
  -- Who set it. `IntegrationSecret.updated_by_email` in the original, and the
  -- status read returns it, so it is carried rather than dropped.
  updated_by text not null check (length(updated_by) between 1 and 254),
  recorded_at timestamptz not null default clock_timestamp(),
  deactivated_at timestamptz,
  constraint cm_integration_credential_version_unique unique (app_id, provider, version),
  -- A deactivated row says when, an active row does not claim to have been.
  constraint cm_integration_credential_deactivated_coherent
    check ((is_active and deactivated_at is null) or (not is_active and deactivated_at is not null))
);

-- The property that lets the resolver stop choosing. Partial, over active rows
-- only, because every retired version is history the table keeps.
create unique index cm_integration_credential_one_active
  on public.cm_integration_credential (app_id, provider) where is_active;

create or replace function public.cm_integration_credential_guard() returns trigger
  language plpgsql security definer set search_path = pg_catalog, public as $guard$
begin
  if tg_op = 'DELETE' then
    raise exception 'Credential history is append-only';
  end if;
  -- Every column but `is_active` and its timestamp is part of the one fact this
  -- row records: this credential, sealed this way, was set by this person at
  -- this time. Editing any of it in place would change what the senders use
  -- with no new version to point at.
  if new.id is distinct from old.id
    or new.app_id is distinct from old.app_id
    or new.provider is distinct from old.provider
    or new.version is distinct from old.version
    or new.api_key_sealed is distinct from old.api_key_sealed
    or new.api_key_last_four is distinct from old.api_key_last_four
    or new.public_key is distinct from old.public_key
    or new.messaging_profile_id is distinct from old.messaging_profile_id
    or new.voice_connection_id is distinct from old.voice_connection_id
    or new.fax_connection_id is distinct from old.fax_connection_id
    or new.updated_by is distinct from old.updated_by
    or new.recorded_at is distinct from old.recorded_at then
    raise exception 'Credential rotation records a new version';
  end if;
  -- One-way. A retired credential is never the one in use again.
  if old.is_active = false and new.is_active = true then
    raise exception 'A retired credential cannot be reactivated';
  end if;
  return new;
end $guard$;

create trigger cm_integration_credential_guard
  before update or delete on public.cm_integration_credential
  for each row execute function public.cm_integration_credential_guard();

alter table public.cm_integration_credential enable row level security;
alter table public.cm_integration_credential force row level security;
revoke all on public.cm_integration_credential from public, anon, authenticated, service_role;

/*
 * Set a credential: retire the active version and record a new one, in one
 * transaction.
 *
 * `version` is chosen here rather than by the caller. A caller computing it
 * would read the current maximum, and two operators rotating at once would
 * both read the same number — the unique constraint would catch the second,
 * but as a raw duplicate-key error the HTTP boundary cannot classify. Taking
 * it from `max + 1` inside the statement, under the active row's lock, means
 * the loser waits and then gets the next number.
 */
create function public.cm_integration_credential_put(
  p_id uuid, p_app_id text, p_provider text, p_api_key_sealed text, p_api_key_last_four text,
  p_public_key text, p_messaging_profile_id text, p_voice_connection_id text,
  p_fax_connection_id text, p_updated_by text
) returns bigint language plpgsql security definer set search_path = pg_catalog, public as $put$
declare v_version bigint;
begin
  -- Serialize rotations of this provider against each other. `for update` on a
  -- row that does not exist locks nothing, which is D78's warning; here the
  -- first rotation has no active row to lock and is protected instead by the
  -- partial unique index, which is why both halves are present rather than
  -- either alone.
  perform 1 from public.cm_integration_credential
    where app_id = p_app_id and provider = p_provider and is_active for update;

  update public.cm_integration_credential
    set is_active = false, deactivated_at = clock_timestamp()
    where app_id = p_app_id and provider = p_provider and is_active;

  select coalesce(max(version), 0) + 1 into v_version
    from public.cm_integration_credential
    where app_id = p_app_id and provider = p_provider;

  insert into public.cm_integration_credential (
    id, app_id, provider, version, api_key_sealed, api_key_last_four, public_key,
    messaging_profile_id, voice_connection_id, fax_connection_id, updated_by
  ) values (
    p_id, p_app_id, p_provider, v_version, p_api_key_sealed, p_api_key_last_four, p_public_key,
    p_messaging_profile_id, p_voice_connection_id, p_fax_connection_id, p_updated_by
  );
  return v_version;
end $put$;

/*
 * The sending path's read. Returns the sealed key and the routing ids for the
 * one active version, or no row at all.
 *
 * Deliberately NOT a "latest" read: a retired version is never served, so an
 * operator who deactivated a credential has actually withdrawn it. `limit 1`
 * is belt over the partial unique index rather than the thing that makes the
 * answer single.
 */
create function public.cm_integration_credential_active(p_app_id text, p_provider text)
returns jsonb language sql stable security definer set search_path = pg_catalog, public as $active$
  select to_jsonb(c) from (
    select id, app_id, provider, version, api_key_sealed, api_key_last_four, public_key,
           messaging_profile_id, voice_connection_id, fax_connection_id, updated_by, recorded_at
    from public.cm_integration_credential
    where app_id = p_app_id and provider = p_provider and is_active
    limit 1
  ) c;
$active$;

/*
 * The panel's read. The same row with `api_key_sealed` left out.
 *
 * A second function rather than a flag on the first, for the reason 006 split
 * its two getters: the projection IS the control. A caller of this function
 * cannot receive the key because the column is not selected, and a future
 * change that widened the projection would have to name the column to do it.
 */
create function public.cm_integration_credential_status(p_app_id text, p_provider text)
returns jsonb language sql stable security definer set search_path = pg_catalog, public as $status$
  select to_jsonb(c) from (
    select provider, version, api_key_last_four,
           public_key is not null as public_key_configured,
           messaging_profile_id is not null as messaging_profile_configured,
           voice_connection_id is not null as voice_connection_configured,
           fax_connection_id is not null as fax_connection_configured,
           updated_by, recorded_at
    from public.cm_integration_credential
    where app_id = p_app_id and provider = p_provider and is_active
    limit 1
  ) c;
$status$;

comment on table public.cm_integration_credential is
  'Owned successor to Base44''s IntegrationSecret row. The API key is sealed by the runtime and opaque to SQL; rotation appends a version and deactivation is one-way.';
comment on column public.cm_integration_credential.api_key_sealed is
  'Runtime AEAD blob over the provider API key. Never returned by cm_integration_credential_status, and not openable in SQL at all.';

revoke all on function public.cm_integration_credential_put(uuid,text,text,text,text,text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.cm_integration_credential_active(text,text) from public, anon, authenticated;
revoke all on function public.cm_integration_credential_status(text,text) from public, anon, authenticated;
grant execute on function public.cm_integration_credential_put(uuid,text,text,text,text,text,text,text,text,text) to service_role;
grant execute on function public.cm_integration_credential_active(text,text) to service_role;
grant execute on function public.cm_integration_credential_status(text,text) to service_role;

commit;
