-- Make `operational_limit` executable.
--
-- `20260920580000_contract_operational_tables.sql` ends its page-size helper
-- with `return pg_catalog.least(p_limit, 5000);`. LEAST and GREATEST are
-- parser CONSTRUCTS in PostgreSQL, not functions in `pg_catalog`, so the
-- qualified spelling resolves to nothing and the call raises
-- `function pg_catalog.least(integer, integer) does not exist` (42883).
--
-- Nothing caught it because the body is plpgsql: names in a plpgsql body are
-- not resolved when the function is created, so the migration applies clean
-- and the helper fails on its first call. The same trap D51 records about a
-- column name, arriving for a function.
--
-- Seven capabilities call it and every one of them fails on any caller-supplied
-- limit — `contract_agency_settings_read`, `contract_task_list`,
-- `contract_pdf_template_list`, `contract_care_plan_list`,
-- `contract_face_to_face_list`, `contract_document_record_list` and
-- `contract_note_conversion_list`. Measured by building the whole record
-- directory and calling all 33 public wrappers that take `p_limit` with a real
-- limit: exactly those seven raise 42883 and the other 26 answer. A sweep of
-- every `pg_catalog.<name>(` in this store — 45 distinct names, checked
-- against `pg_proc` on a real PostgreSQL 16.13 — finds `least` as the only one
-- that is not a function there, so this is one mistake in one place rather
-- than a class.
--
-- It is not latent. `src/lib/independentEntityRoutes.js` REFUSES a call that
-- names no limit (`limit_required`) and passes `probeFor(limit, …)`, so every
-- frontend call through these routes supplies one and every one of them would
-- have failed. Only the null default (50) works, which is the only value the
-- suite ever passed.
--
-- A forward migration rather than a correction in place, because
-- `20260920580000` is merged: `planMigration` matches on the file NAME and the
-- ledger holds no content hash (D88), so an edited file is skipped forever on
-- any store that ran it, and `ledgerVersion` keys on the stem, so an apply of
-- one version against a repository holding another reads as applied with
-- nothing reporting it. No deployment has run `20260920580000` yet — the
-- record store is unapplied — and this file is still forward rather than an
-- edit, because "no deployment has run it" is a claim about today that the
-- rule exists so nobody has to make.
--
-- The signature, volatility, ownership and the refusal are unchanged: only the
-- qualification is dropped. `least` is resolved by the parser and not through
-- `search_path`, so `set search_path = ''` stays as it is and the empty path
-- protects the rest of the body as before.

begin;

do $$
begin
  if to_regprocedure(
      'pennsync_records.operational_limit(integer,text)') is null then
    raise exception using errcode='42501',
      message='PENNSYNC_OPERATIONAL_CAPABILITIES_REQUIRED';
  end if;
end $$;

set local role "pennsync_records_owner";

create or replace function "pennsync_records".operational_limit(
    p_limit integer, p_prefix text)
  returns integer language plpgsql immutable set search_path = '' as $limit$
begin
  if p_limit is null then return 50; end if;
  if p_limit < 1 then
    raise exception using errcode='22023', message=p_prefix || '_LIMIT_INVALID';
  end if;
  return least(p_limit, 5000);
end $limit$;

reset role;

commit;
