-- Give the dashboard a documentation signal, so "N completed visits need
-- notes" can count the undocumented ones.
--
-- `20260920500000_contract_dashboard.sql` records the defect in its own
-- header: the priority is `visit.status === 'completed' && !visit.note_id`,
-- `note_id` is a column on no table and in no entity schema, so the negation
-- is always true and the tile counts EVERY completed visit. The contract
-- projected nothing in its place, because D64 forbids disclosing a column
-- nobody named and inventing one is a decision rather than a transcription.
--
-- The decision is made now and it is not an invention: `nurse_notes` is what
-- the rest of the product already treats as a visit's documentation —
-- `DataQualityDashboard`, `ReportsCenter` and `AIAutoTagger` each read it to
-- answer exactly this question — so the dashboard asks what they ask.
--
-- What is projected is a BOOLEAN and never the text. The note is a nurse's
-- narrative about a patient, the dashboard payload is the widest thing this
-- product hands a browser on page load, and the tile needs one bit. That is
-- D64's rule from the other side: every column reaching a consumer is named,
-- and a column that need not reach it does not.
--
-- `documentation_source` is deliberately NOT the signal. It carries a default
-- (`'smart_note'`), so it is non-null on a visit nobody has documented, and a
-- test asserts the two disagree on exactly such a row.
--
-- A forward migration rather than an edit, because `20260920500000` is merged
-- (#229, 2026-09-21): `planMigration` matches on the file NAME and the ledger
-- holds no content hash (D88), so an edited file is skipped forever on any
-- store that ran it. Whether one has is a claim about today, and the rule
-- exists so nobody has to make it.
--
-- Only `dashboard_visit` changes. Its signature, volatility, ownership and
-- grants are unchanged, and `contract_dashboard` calls it by name in both of
-- its visit collections, so both widen together.

begin;

do $$
begin
  if to_regprocedure(
      'pennsync_records.dashboard_visit(pennsync_records.visit)') is null then
    raise exception using errcode='42501',
      message='PENNSYNC_DASHBOARD_CONTRACT_REQUIRED';
  end if;
end $$;

set local role "pennsync_records_owner";

-- Seven columns now. `has_documentation` is derived, never stored: a visit
-- carries documentation when `nurse_notes` holds something other than
-- whitespace, which is the question `visitHasDocumentation` asks on the
-- Base44 path over the note text itself.
--
-- It is a REGEX and not `btrim`, and the test is what settled that. The
-- browser asks `String(notes).trim() !== ''`, and JavaScript's trim strips
-- every Unicode space separator, while one-argument `btrim` strips the ASCII
-- space and NOTHING else — so a note of one tab read as documentation here
-- and as nothing there. The class below is JavaScript's own whitespace set,
-- which is D38's rule arriving for a different trim: port the predicate, not
-- the word. `coalesce` is load-bearing because `null ~ anything` is null, and
-- a null `has_documentation` would be falsy in the browser by accident rather
-- than by this function's answer. It is BARE: COALESCE is a parser construct
-- and not a function in `pg_catalog`, which is the trap
-- `20260920640000_operational_limit.sql` records about LEAST.
create or replace function "pennsync_records".dashboard_visit(
    v "pennsync_records"."visit")
  returns jsonb language sql immutable set search_path = '' as $row$
  select jsonb_build_object(
    'id', v."id",
    'patient_id', v."patient_id",
    'status', v."status",
    'visit_date', v."visit_date",
    'visit_time', v."visit_time",
    'visit_type', v."visit_type",
    'has_documentation', coalesce(v."nurse_notes" ~
      '[^\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]',
      false))
$row$;

reset role;

commit;
