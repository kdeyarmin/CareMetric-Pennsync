-- The fax transmission log: two READS and no write.
--
-- HAND WRITTEN, like every contract. Five screens read this entity — the
-- history list, the hub dashboard, the analytics tab, the search interface and
-- the realtime status tracker — and all five only read it. Nothing here
-- creates, updates or deletes a row, and that is the ENTITY's own rule rather
-- than a deferral: its `rls` is `"create": false, "update": false, "delete":
-- false`, so every write already belongs to a server-owned fax workflow. Do
-- not add a write path to this file; a send is the transmission capability's,
-- and that capability is paused.
--
-- TENANCY IS NOT OWNERSHIP, for the third time in this family. The generated
-- `fax_log` policies are agency-WIDE plus D24's chart narrowing, which is
-- strictly more than the entity's own read rule: `{ "data.sent_by":
-- "{{user.email}}" }`. A port that leaned on the policies would show a nurse
-- every colleague's faxes. So the contract's own predicate is `sent_by =
-- caller_email()` and the policies narrow it further where a chart is named.
-- Read the direction: the two are ANDed, and neither is redundant — the
-- ownership check is what the original says, and the chart check is what D24
-- says about a row naming a patient.
--
-- THE TWO READS EXIST BECAUSE THE PROJECTIONS DIFFER, which is D71's split
-- arriving in a new family. `ocr_text` holds the extracted text of a faxed
-- clinical document, so it is the same corpus D71 refused to project out of
-- `PDFIndex` ("the corpus is the extracted PHI of every indexed document"), and
-- D64's rule is that every column reaching a read is NAMED.
--
--   `contract_fax_log_list` serves the history, the dashboard, the analytics
--   tab and the status tracker. It projects NO `ocr_text` at all.
--
--   `contract_fax_log_search` serves the content search, matches the query in
--   SQL, and returns a BOUNDED EXCERPT — never the whole text.
--
-- A NARROWING, REPORTED RATHER THAN HIDDEN. `FaxSearchInterface.jsx` today
-- lists five hundred rows WITH their full `ocr_text` and filters in the
-- browser, so the owned path ships less: the match happens in the database and
-- the excerpt is 300 characters, which is exactly what that screen renders
-- (`log.ocr_text.substring(0, 300)`). The consequence is concrete and is a call
-- site change rather than a hole in this contract: a browser calling
-- `FaxLog.list` gets rows with no `ocr_text`, so its content search finds
-- nothing until it calls the search read instead. That is stated here, in the
-- pull request, and in the route declaration, because a search that quietly
-- stops matching reads exactly like a corpus with nothing in it.
--
-- WHAT ELSE IS NOT PROJECTED, each for a reason rather than for brevity. The
-- entity carries eighty-one columns, and most are the transmission workflow's
-- own machinery: provider submission state, claim tokens, quarantine stamps,
-- retry generations, poll attempt counters, notification claim fields, the
-- integration secret identity and the telecom bindings. None is read by any
-- screen, several are credentials or claim tokens in the sense D16's ceiling
-- means, and a provider identity in a browser payload is a disclosure with no
-- caller. `document_url` is a STORAGE LOCATOR and is refused for D71's reason
-- about `pdf_url` — the entity's own description says new sends keep
-- `document_id` instead "of persisting an expiring delivery capability", so
-- projecting the legacy URL would hand out exactly the capability it stopped
-- storing.
begin;

do $$
begin
  if to_regclass('pennsync_records.fax_log') is null
    or to_regprocedure('pennsync_records.caller_tenant_role(text)') is null then
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

/*
 * The list projection: what the four listing screens actually render.
 *
 * Derived from the screens rather than chosen — the history filters on
 * `to_number`, `to_name` and `document_name` and renders `status`, `pages`,
 * `created_date` and `failure_reason`; the tracker reads `status`,
 * `retry_count` and `next_retry_at`; the analytics tab counts by `status` and
 * sums `pages` and `estimated_cost`. `ocr_processed` is a BOOLEAN rather than
 * the text, and it is here because the search screen's "ask the model about
 * this fax" button is gated on it.
 */
create function "pennsync_records".fax_log_row(p_row "pennsync_records"."fax_log")
  returns jsonb language sql immutable set search_path = '' as $row$
  select jsonb_build_object(
    'id', p_row."id",
    'patient_id', p_row."patient_id",
    'referral_id', p_row."referral_id",
    'from_number', p_row."from_number",
    'to_number', p_row."to_number",
    'to_name', p_row."to_name",
    'document_name', p_row."document_name",
    'status', p_row."status",
    'provider_terminal_status', p_row."provider_terminal_status",
    'failure_reason', p_row."failure_reason",
    'pages', p_row."pages",
    'priority', p_row."priority",
    'retry_count', p_row."retry_count",
    'next_retry_at', p_row."next_retry_at",
    'estimated_cost', p_row."estimated_cost",
    'ocr_processed', p_row."ocr_processed",
    'sent_by', p_row."sent_by",
    'created_date', p_row."created_date",
    'updated_date', p_row."updated_date")
$row$;

/*
 * The list.
 *
 * `p_patient` is optional and serves the history screen's two shapes in one
 * read: `FaxLog.filter({ patient_id }, …)` when it is opened on a chart and
 * `FaxLog.list(…)` when it is not. A patient named here is checked by the
 * POLICY and not again by this function — the `fax_log_read` policy carries
 * D24's narrowing, so a caller asking about a chart they do not open gets no
 * rows rather than a refusal, which is the same answer the original gives.
 */
create function "pennsync_records".contract_fax_log_list(
  p_agency text, p_patient text default null, p_limit integer default 100)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_rows jsonb; v_email text; v_limit integer; v_patient text;
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_FAX_LOG_FORBIDDEN';
  end if;
  -- Re-applied in SQL (D71). The screens ask for 100 and 500.
  v_limit := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_email := "pennsync_records".caller_email();
  v_patient := nullif(pg_catalog.btrim(coalesce(p_patient, '')), '');
  select coalesce(jsonb_agg("pennsync_records".fax_log_row(l.r) order by
      l.ordered_date desc nulls last, l.ordered_id desc), '[]'::jsonb)
    into v_rows
  from (
    select f as r, f."created_date" as ordered_date, f."id" as ordered_id
    from "pennsync_records"."fax_log" f
    where f."source_app_id" = "pennsync_records".deployment_app()
      and f."agency_id" = p_agency
      and f."sent_by" = v_email
      and (v_patient is null or f."patient_id" = v_patient)
    order by f."created_date" desc nulls last, f."id" desc
    limit v_limit
  ) l;
  return jsonb_build_object('success', true, 'entries', v_rows);
end $contract$;

/*
 * The content search.
 *
 * D71's shape: the corpus a caller may read is decided here, in SQL, and the
 * only thing that crosses the boundary is a bounded excerpt of the rows that
 * matched. Three properties are load-bearing rather than stylistic.
 *
 * The match is a plain case-insensitive substring, because that is what the
 * original does (`log.ocr_text.toLowerCase().includes(query)`). No stemming, no
 * ranking, no full-text configuration: a port that scored would answer a
 * different question and the screen would order its results differently.
 *
 * The excerpt is 300 characters FROM THE START, which is what the screen
 * renders. It is deliberately NOT a window around the match: a window would
 * show more of the document than the screen does today, so it would be a
 * disclosure this port added rather than restored.
 *
 * The query has a floor. A one-character query matches nearly every document,
 * which turns the search into "give me an excerpt of every fax I ever sent" —
 * so under two characters is refused rather than served, and the limit is
 * capped in SQL for D71's reason.
 */
create function "pennsync_records".contract_fax_log_search(
  p_agency text, p_query text, p_limit integer default 50)
  returns jsonb language plpgsql security definer set search_path = '' as $contract$
declare v_rows jsonb; v_email text; v_limit integer; v_query text; v_total integer;
begin
  if "pennsync_records".caller_tenant_role(p_agency) is null then
    raise exception using errcode='42501', message='PENNSYNC_FAX_LOG_FORBIDDEN';
  end if;
  v_query := pg_catalog.btrim(coalesce(p_query, ''));
  if pg_catalog.length(v_query) < 2 then
    raise exception using errcode='22023', message='PENNSYNC_FAX_LOG_QUERY_TOO_SHORT';
  end if;
  v_limit := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_email := "pennsync_records".caller_email();
  -- The count is taken over the whole matching corpus while the rows are
  -- bounded, so a caller is told there is more rather than shown it. That is
  -- the one thing this read says about documents it does not return.
  select pg_catalog.count(*) into v_total
  from "pennsync_records"."fax_log" f
  where f."source_app_id" = "pennsync_records".deployment_app()
    and f."agency_id" = p_agency and f."sent_by" = v_email
    and f."ocr_text" is not null
    and pg_catalog.strpos(pg_catalog.lower(f."ocr_text"), pg_catalog.lower(v_query)) > 0;
  select coalesce(jsonb_agg(
      "pennsync_records".fax_log_row(l.r) || jsonb_build_object(
        'ocr_excerpt', pg_catalog.left(l.text, 300),
        'ocr_truncated', pg_catalog.length(l.text) > 300)
      order by l.ordered_date desc nulls last, l.ordered_id desc), '[]'::jsonb)
    into v_rows
  from (
    select f as r, f."ocr_text" as text,
      f."created_date" as ordered_date, f."id" as ordered_id
    from "pennsync_records"."fax_log" f
    where f."source_app_id" = "pennsync_records".deployment_app()
      and f."agency_id" = p_agency
      and f."sent_by" = v_email
      and f."ocr_text" is not null
      and pg_catalog.strpos(pg_catalog.lower(f."ocr_text"), pg_catalog.lower(v_query)) > 0
    order by f."created_date" desc nulls last, f."id" desc
    limit v_limit
  ) l;
  return jsonb_build_object('success', true, 'entries', v_rows, 'matched', v_total);
end $contract$;

reset role;

revoke all on function
  "pennsync_records".fax_log_row("pennsync_records"."fax_log"),
  "pennsync_records".contract_fax_log_list(text,text,integer),
  "pennsync_records".contract_fax_log_search(text,text,integer)
  from public, anon, authenticated, service_role;
grant execute on function
  "pennsync_records".contract_fax_log_list(text,text,integer),
  "pennsync_records".contract_fax_log_search(text,text,integer)
  to authenticated;

create function "public"."pennsync_contract_fax_log_list"(
  p_agency text, p_patient text default null, p_limit integer default 100) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_fax_log_list(p_agency, p_patient, p_limit)
$contract$;

create function "public"."pennsync_contract_fax_log_search"(
  p_agency text, p_query text, p_limit integer default 50) returns jsonb
  language sql security invoker set search_path = '' as $contract$
  select "pennsync_records".contract_fax_log_search(p_agency, p_query, p_limit)
$contract$;

revoke all on function
  "public"."pennsync_contract_fax_log_list"(text,text,integer),
  "public"."pennsync_contract_fax_log_search"(text,text,integer)
  from public, anon, authenticated, service_role;
grant execute on function
  "public"."pennsync_contract_fax_log_list"(text,text,integer),
  "public"."pennsync_contract_fax_log_search"(text,text,integer)
  to authenticated;

commit;
