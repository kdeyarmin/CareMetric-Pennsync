-- Take the last nine non-authorizing helpers out of a caller's reach.
--
-- PostgreSQL grants EXECUTE on a new function to PUBLIC by default, so a
-- helper is reachable unless a migration revokes it. Every contract file in
-- this directory ends with a `revoke all on function … from public, anon,
-- authenticated, service_role` naming its own helpers, and then re-grants only
-- the capabilities. Two of those blocks are incomplete, and what they miss is
-- reachable today.
--
-- Measured rather than read. Building the whole record directory and crossing
-- every `pennsync_records` function against
-- `has_function_privilege('authenticated', …, 'execute')` gives 349 functions,
-- of which 14 are reachable and are not `contract_*`. Five of those fourteen
-- are the broker family's `entity_list`, `entity_get`, `entity_insert`,
-- `entity_update` and `entity_delete`, and they are reachable BY DECISION:
-- `20260919180000_record_brokers.sql` revokes them with everything else and
-- then grants those five back to `authenticated` on its own line, which is the
-- family's whole caller surface. That is the evidence, not the `entity_`
-- prefix — its four siblings `brokered`, `broker_scope`, `broker_reserved` and
-- `broker_check_payload` are revoked in the same statement and not re-granted,
-- and they are correctly unreachable.
--
-- The remaining NINE are this file's subject. Each does no authorization, each
-- has siblings named in a revoke block beside it, and each is callable:
--
--   `20260920180000_contract_assignment.sql` creates two pure helpers after its
--   `set local role` — `bounded_reason` and `care_team_row` — and revokes only
--   the second, with the two contracts.
--
--   `20260920580000_contract_operational_tables.sql` revokes 37 names,
--   `operational_check_fields`, `operational_limit`, `operational_locator` and
--   `operational_new_id` among them, and misses `operational_chart`,
--   `operational_check_required` and all six `*_defaults()`.
--
-- The shape is worth stating because it is why nobody saw it: a long, plainly
-- careful list reads as complete, and a reviewer stops. What finds it is asking
-- the BUILT store who may execute what, never reading the block.
--
-- None of the nine is a disclosure. `bounded_reason` and the six `*_defaults()`
-- take no table at all — text or nothing in, a constant or a trimmed string
-- out. `operational_chart` and `operational_check_required` read nothing a
-- caller could not already ask a contract for, and both are consulted by
-- definers that re-derive their arguments from the caller's own parameters.
-- What is broken is the rule those revoke blocks exist to enforce: nothing that
-- performs no authorization may be reachable, because a reachable helper is a
-- second entry point past the contract that owns the decision, and the next
-- person to add a table lookup to one of these has no reason to check.
--
-- A forward migration rather than an edit in place, because both files are
-- merged: `planMigration` matches on the file NAME and the ledger holds no
-- content hash (D88), so an edited file is skipped forever on any store that
-- ran it. A revoke is idempotent, so this is safe on a store that somehow
-- already lacks the grant, and it changes no signature, body, volatility or
-- ownership — only who may call.
--
-- `contract-credential.test.mjs` pinned `bounded_reason`'s reachability as a
-- known gap, asserting it callable so the fix could not land quietly. That pin
-- flips to a refusal in the same change as this file. It has to: once a suite
-- builds from the whole directory, a pinned state and the migration that
-- changes it are one fact about the store, and landing either half alone reds
-- `main` until the other arrives (D149).

begin;

do $$
declare
  v_missing text;
begin
  foreach v_missing in array array[
    'pennsync_records.bounded_reason(text)',
    'pennsync_records.operational_chart(text,text,text)',
    'pennsync_records.operational_check_required(jsonb,text[],text[],text,boolean)',
    'pennsync_records.care_plan_defaults()',
    'pennsync_records.f2f_defaults()',
    'pennsync_records.note_conversion_defaults()',
    'pennsync_records.settings_defaults()',
    'pennsync_records.task_defaults()',
    'pennsync_records.template_defaults()'
  ] loop
    if to_regprocedure(v_missing) is null then
      raise exception using errcode='42501',
        message='PENNSYNC_HELPER_REVOKE_TARGET_MISSING: ' || v_missing;
    end if;
  end loop;
end $$;

set local role "pennsync_records_owner";

revoke all on function
  "pennsync_records".bounded_reason(text),
  "pennsync_records".operational_chart(text, text, text),
  "pennsync_records".operational_check_required(jsonb, text[], text[], text, boolean),
  "pennsync_records".care_plan_defaults(),
  "pennsync_records".f2f_defaults(),
  "pennsync_records".note_conversion_defaults(),
  "pennsync_records".settings_defaults(),
  "pennsync_records".task_defaults(),
  "pennsync_records".template_defaults()
  from public, anon, authenticated, service_role;

reset role;

commit;
