-- Where a carried row's Base44 storage URL becomes an owned handle (D77).
--
-- D56 measured what the file-bound capabilities actually wait on and named
-- three things: the inventory, the copy into the private bucket under a
-- SHA-256 manifest, and the `file_url` -> `cmfile:` compatibility layer. The
-- inventory is `tools-file-reference-census.mjs`; the copy needs a live app
-- and an operator; this is the layer the other two meet in.
--
-- **What it is not.** It is not a place a caller reads. A locator is projected
-- by the contract that authorizes the read of the row holding it — D71 makes
-- that explicit by deliberately NOT projecting `pdf_url` from `pdf_index`,
-- because a storage locator is why `PDFIndex` is outside the generic broker
-- family at all. So this table is reached only by a definer the record owner
-- may call, inside a contract that has already established who the caller is.
-- It is the store's own knowledge of where bytes went, not a record.
--
-- That is why it lives in `pennsync_private` with forced RLS and no policy,
-- like `chart_assignment`, and why it is in the RECORD directory although it
-- creates `pennsync_private` objects, like `claim_new_chart` (D28): the grant
-- names `pennsync_records_owner`, and the provisioner creates that role with
-- the record store, after every authority migration has applied.
--
-- **It is keyed on the locator, not on (entity, row, field).** The census
-- lists 66 locator FIELDS across 58 entities, but a locator is a reference to
-- bytes and the same bytes are referenced from more than one row — a
-- `Document`, the `DocumentVersion` under it and a `Referral` naming the same
-- upload are three paths to one object. Keying on the row would copy it three
-- times and let two of the copies drift.
--
-- **A mapping is immutable, and that is the load-bearing property.** Every
-- carried row that holds a legacy URL resolves through this table, so
-- remapping one locator silently repoints every row referencing it at
-- different bytes — a patient's document becoming another patient's, with
-- nothing in either row changed to show it. D32's rule in its strongest form:
-- refuse every update and every delete. A copy that has to be corrected
-- records a new locator, never a new destination for an old one.
--
-- **It fails closed.** An unmapped legacy locator resolves to null and the
-- capability refuses. The tempting alternative is exactly what D56 forbids:
-- "Do not widen the allowlist to unblock yourself." A fallback that fetched
-- the Base44 URL would carry that host into the service the exit exists to
-- remove, and would do it silently, for precisely the rows the copy missed.
--
-- **A `cmfile:` handle passes through unchanged.** The write side is already
-- owned — `services/integration-runtime` returns durable private handles from
-- `UploadFile` and `UploadPrivateFile` — so a row written after cutover holds
-- a handle and needs no mapping. A resolver that demanded one would break the
-- half that already works.
begin;

do $$
begin
  if to_regclass('pennsync_private.membership') is null
    or to_regclass('pennsync_records.patient') is null then
    raise exception using errcode='42501',message='PENNSYNC_RECORD_STORE_REQUIRED';
  end if;
end $$;

create table pennsync_private.file_object (
  app_id pennsync_private.deployment_app not null,
  -- sha256 of the EXACT locator string as the carried row holds it. A URL can
  -- be longer than an index tolerates and differs in ways that matter (a query
  -- string is part of the address), so the key is a hash of the whole thing
  -- and the string itself is kept beside it for the report to name.
  locator_key text not null check (locator_key ~ '^[0-9a-f]{64}$'),
  locator text not null check (length(locator) between 1 and 4096),
  -- The owned handle, in the runtime's own form.
  file_uri text not null
    check (file_uri ~ '^cmfile:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  -- The manifest D56 names. Two locators may legitimately carry the same
  -- digest: the same bytes uploaded twice are one object with two addresses.
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  byte_size bigint not null check (byte_size >= 0),
  -- Which planned run produced this row, so a report can be traced back.
  copy_run text not null check (length(copy_run) between 1 and 200),
  recorded_by uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),
  primary key (app_id, locator_key)
);

create or replace function pennsync_private.file_object_immutable() returns trigger
  language plpgsql security definer set search_path = '' as $immutable$
begin
  -- No branch for a "harmless" column. A mapping row is one fact — these bytes
  -- are now at this handle — and every column is part of it.
  raise exception using errcode='42501', message='PENNSYNC_FILE_OBJECT_IMMUTABLE';
end $immutable$;

create trigger file_object_immutable before update or delete on pennsync_private.file_object
  for each row execute function pennsync_private.file_object_immutable();

alter table pennsync_private.file_object enable row level security;
alter table pennsync_private.file_object force row level security;
revoke all on pennsync_private.file_object from public, anon, authenticated, service_role;

/*
 * Resolve one locator to an owned handle, or to null.
 *
 * SECURITY DEFINER and owned by the migration administrator, which is what
 * lets it read a table forced RLS admits nobody to. It is granted to
 * `pennsync_records_owner` alone and has no public wrapper: a caller who could
 * ask it directly would be asking about a file without having read the row
 * that references it, which is the one thing the projection rule exists to
 * prevent.
 *
 * It takes no agency and performs no authorization, deliberately. Authorizing
 * is the calling contract's job and it has already happened by the time a
 * locator is in hand — adding a tenant predicate here would be the second
 * answer to a question the policies already answered, which is the defect D41,
 * D43 and D62 each found in an original.
 */
create function pennsync_private.resolve_file_locator(p_locator text) returns text
  language plpgsql stable security definer set search_path = '' as $resolve$
declare v_uri text;
begin
  if p_locator is null or p_locator = '' then
    return null;
  end if;
  -- Already owned. The write side mints these and they need no mapping.
  if p_locator ~ '^cmfile:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return p_locator;
  end if;
  select f.file_uri into v_uri from pennsync_private.file_object f
  where f.app_id = pennsync_private.deployment_app_id()
    -- The built-in `sha256`, as every other digest in this store uses. pgcrypto
    -- is not assumed to be installed and PGlite does not carry it.
    and f.locator_key = pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(p_locator, 'UTF8')), 'hex');
  -- Null, never the locator. Returning the input would hand a Base44 URL back
  -- to a caller that asked for an owned handle, and the caller would fetch it.
  return v_uri;
end $resolve$;

-- PostgreSQL grants EXECUTE on a new function to PUBLIC by default, so the
-- grant below is not what decides who may call this — the revoke above it is.
-- `authenticated` holds USAGE on `pennsync_private` (every `pennsync_staging_*`
-- wrapper depends on that), so without this revoke any authenticated caller
-- reaching this schema could translate a known legacy locator into an owned
-- handle WITHOUT passing the contract that authorizes the row holding it —
-- which is the one thing the projection rule at the top of this file exists to
-- prevent. `claim_new_chart` revokes first for the same reason; this file
-- cited that precedent and then did it only for the TABLE.
--
-- Targeted, never a blanket `revoke all on all functions in schema
-- pennsync_private`: every `pennsync_staging_*` wrapper is an invoker calling
-- an inner function granted to `authenticated`, and nine suites go red.
revoke all on function pennsync_private.resolve_file_locator(text)
  from public, anon, authenticated, service_role;

grant usage on schema pennsync_private to pennsync_records_owner;
grant execute on function pennsync_private.resolve_file_locator(text) to pennsync_records_owner;

commit;
