-- D7's schema clause, for a store that already exists (D88).
--
-- D7 carries the paused domains as `preserved_paused` and says of them: "Their
-- schemas and data still migrate; only their execution stays off." The schema
-- planner could not express that until `SCHEMA_ONLY` named these eight
-- entities one at a time, and regenerating
-- `20260919170000_record_store.sql` reaches a fresh provision and no
-- deployment that has already applied it -- so the change lives in both places
-- and this is the second.
--
-- DERIVED, never typed: `node tools-pennsync-record-catchup.mjs --write` reads
-- each table's whole block and each of its policies out of the generated
-- migration. A hand-kept copy of 164 columns and 32 policies would drift in
-- the one direction nothing measures.
--
-- WHAT THIS DOES NOT DO. A table is not an access path. Every OASIS capability
-- stays `preserved_paused`; the generic broker family serves `broker` alone
-- and D22's ceiling refuses all eight on its own account; so after this applies
-- the only way to one of these rows is a hand-written contract, and there is
-- none yet. The frontend census reports these call sites as
-- `no_access_contract` rather than as served, for exactly that reason.
begin;

do $$
begin
  if to_regclass('pennsync_records.patient') is null then
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

-- As the owner, so these tables come out owned by the role the generated
-- migration would have given them. The hosted comparison reads
-- `pg_get_userbyid(c.relowner)`, so a catch-up that ran as the administrator
-- would close one difference and open another.
set local role "pennsync_records_owner";

create table if not exists "pennsync_records"."oasis_action_item" (
  "source_app_id" text not null,
  "id" text not null,
  "created_date" timestamptz,
  "updated_date" timestamptz,
  "created_by" text,
  "analysis_id" text,
  "patient_name" text,
  "action_type" text,
  "category" text,
  "oasis_item" text,
  "current_value" text,
  "proposed_value" text,
  "rationale" text,
  "revenue_impact" double precision,
  "severity" text default 'medium',
  "source" text,
  "scenario_name" text,
  "status" text default 'pending_review',
  "assigned_to" text,
  "reviewed_by" text,
  "reviewed_at" timestamptz,
  "review_notes" text,
  "linked_task_id" text,
  "original_pdgm_payment" double precision,
  "projected_pdgm_payment" double precision,
  "agency_id" text not null,
  constraint "oasis_action_item_pkey" primary key ("source_app_id", "id"),
  constraint "oasis_action_item_action_type_allowed" check ("action_type" is null or "action_type" in ('correction', 'review', 'verification', 'optimization')),
  constraint "oasis_action_item_category_allowed" check ("category" is null or "category" in ('functional_status', 'diagnosis', 'admission_source', 'episode_timing', 'comorbidity', 'compliance', 'documentation')),
  constraint "oasis_action_item_severity_allowed" check ("severity" is null or "severity" in ('critical', 'high', 'medium', 'low')),
  constraint "oasis_action_item_source_allowed" check ("source" is null or "source" in ('discrepancy', 'what_if_scenario', 'ai_recommendation', 'manual')),
  constraint "oasis_action_item_status_allowed" check ("status" is null or "status" in ('pending_review', 'approved', 'rejected', 'implemented', 'task_created'))
);
alter table "pennsync_records"."oasis_action_item" enable row level security;
alter table "pennsync_records"."oasis_action_item" force row level security;
revoke all on "pennsync_records"."oasis_action_item" from public;

drop policy if exists "oasis_action_item_read" on "pennsync_records"."oasis_action_item";
create policy "oasis_action_item_read" on "pennsync_records"."oasis_action_item" for select using ("oasis_action_item"."source_app_id" = "pennsync_records".deployment_app() and "oasis_action_item"."agency_id" in (select "pennsync_records".caller_agencies()));
drop policy if exists "oasis_action_item_insert" on "pennsync_records"."oasis_action_item";
create policy "oasis_action_item_insert" on "pennsync_records"."oasis_action_item" for insert with check ("oasis_action_item"."source_app_id" = "pennsync_records".deployment_app() and "oasis_action_item"."agency_id" in (select "pennsync_records".caller_agencies()));
drop policy if exists "oasis_action_item_update" on "pennsync_records"."oasis_action_item";
create policy "oasis_action_item_update" on "pennsync_records"."oasis_action_item" for update using ("oasis_action_item"."source_app_id" = "pennsync_records".deployment_app() and "oasis_action_item"."agency_id" in (select "pennsync_records".caller_agencies())) with check ("oasis_action_item"."source_app_id" = "pennsync_records".deployment_app() and "oasis_action_item"."agency_id" in (select "pennsync_records".caller_agencies()));
drop policy if exists "oasis_action_item_delete" on "pennsync_records"."oasis_action_item";
create policy "oasis_action_item_delete" on "pennsync_records"."oasis_action_item" for delete using ("oasis_action_item"."source_app_id" = "pennsync_records".deployment_app() and "oasis_action_item"."agency_id" in (select "pennsync_records".caller_agencies()));

create table if not exists "pennsync_records"."oasis_assessment" (
  "source_app_id" text not null,
  "id" text not null,
  "created_date" timestamptz,
  "updated_date" timestamptz,
  "created_by" text,
  "agency_id" text,
  "patient_id" text,
  "visit_id" text,
  "visit_type" text,
  "assessment_date" date,
  "oasis_items" jsonb,
  "clinical_summary" text,
  "estimated_pdgm_group" text,
  "status" text default 'draft',
  "completion_percentage" double precision,
  "completed_by" text,
  "completed_date" timestamptz,
  "response_schema_id" text,
  "instrument_version" text,
  "response_schema_source" text,
  "migration_status" text,
  "last_written_by" text,
  "last_written_at" timestamptz,
  constraint "oasis_assessment_pkey" primary key ("source_app_id", "id"),
  constraint "oasis_assessment_visit_type_allowed" check ("visit_type" is null or "visit_type" in ('Start of Care', 'Resumption of Care', 'Recertification', 'Discharge', 'Transfer')),
  constraint "oasis_assessment_status_allowed" check ("status" is null or "status" in ('draft', 'in_progress', 'completed', 'submitted')),
  constraint "oasis_assessment_response_schema_id_allowed" check ("response_schema_id" is null or "response_schema_id" in ('pennsync-oasis-response-v1-legacy', 'pennsync-oasis-response-v2-cms-e2')),
  constraint "oasis_assessment_migration_status_allowed" check ("migration_status" is null or "migration_status" in ('native_v2', 'legacy_unconverted', 'legacy_provenance_annotated'))
);
alter table "pennsync_records"."oasis_assessment" enable row level security;
alter table "pennsync_records"."oasis_assessment" force row level security;
revoke all on "pennsync_records"."oasis_assessment" from public;

drop policy if exists "oasis_assessment_read" on "pennsync_records"."oasis_assessment";
create policy "oasis_assessment_read" on "pennsync_records"."oasis_assessment" for select using ("oasis_assessment"."source_app_id" = "pennsync_records".deployment_app() and "oasis_assessment"."agency_id" in (select "pennsync_records".caller_agencies()) and ("oasis_assessment"."patient_id" is null or "pennsync_records".caller_opens_every_chart("oasis_assessment"."agency_id") or "oasis_assessment"."patient_id" in (select "pennsync_records".caller_assigned_patients("oasis_assessment"."agency_id"))));
drop policy if exists "oasis_assessment_insert" on "pennsync_records"."oasis_assessment";
create policy "oasis_assessment_insert" on "pennsync_records"."oasis_assessment" for insert with check ("oasis_assessment"."source_app_id" = "pennsync_records".deployment_app() and "oasis_assessment"."agency_id" in (select "pennsync_records".caller_agencies()) and ("oasis_assessment"."patient_id" is null or "pennsync_records".caller_opens_every_chart("oasis_assessment"."agency_id") or "oasis_assessment"."patient_id" in (select "pennsync_records".caller_assigned_patients("oasis_assessment"."agency_id"))));
drop policy if exists "oasis_assessment_update" on "pennsync_records"."oasis_assessment";
create policy "oasis_assessment_update" on "pennsync_records"."oasis_assessment" for update using ("oasis_assessment"."source_app_id" = "pennsync_records".deployment_app() and "oasis_assessment"."agency_id" in (select "pennsync_records".caller_agencies()) and ("oasis_assessment"."patient_id" is null or "pennsync_records".caller_opens_every_chart("oasis_assessment"."agency_id") or "oasis_assessment"."patient_id" in (select "pennsync_records".caller_assigned_patients("oasis_assessment"."agency_id")))) with check ("oasis_assessment"."source_app_id" = "pennsync_records".deployment_app() and "oasis_assessment"."agency_id" in (select "pennsync_records".caller_agencies()) and ("oasis_assessment"."patient_id" is null or "pennsync_records".caller_opens_every_chart("oasis_assessment"."agency_id") or "oasis_assessment"."patient_id" in (select "pennsync_records".caller_assigned_patients("oasis_assessment"."agency_id"))));
drop policy if exists "oasis_assessment_delete" on "pennsync_records"."oasis_assessment";
create policy "oasis_assessment_delete" on "pennsync_records"."oasis_assessment" for delete using ("oasis_assessment"."source_app_id" = "pennsync_records".deployment_app() and "oasis_assessment"."agency_id" in (select "pennsync_records".caller_agencies()) and ("oasis_assessment"."patient_id" is null or "pennsync_records".caller_opens_every_chart("oasis_assessment"."agency_id") or "oasis_assessment"."patient_id" in (select "pennsync_records".caller_assigned_patients("oasis_assessment"."agency_id"))));

create table if not exists "pennsync_records"."oasis_audit" (
  "source_app_id" text not null,
  "id" text not null,
  "created_date" timestamptz,
  "updated_date" timestamptz,
  "created_by" text,
  "user_email" text,
  "patient_id" text,
  "status" text,
  "summary" text,
  "details" jsonb,
  "oasis_file_url" text,
  "analysis_date" timestamptz,
  "completeness_score" double precision,
  "accuracy_score" double precision,
  "missing_data_points" jsonb,
  "accuracy_flags" jsonb,
  "predictive_summary" text,
  "care_plan_summary" text,
  "risk_scores" jsonb,
  "predicted_los" double precision,
  "oasis_upload_id" text,
  "patient_name" text,
  "flag_reason" text,
  "compliance_score" double precision,
  "revenue_score" double precision,
  "overall_score" double precision,
  "key_issues" jsonb,
  "rescore_opportunities" jsonb,
  "documentation_gaps" jsonb,
  "estimated_revenue_impact" double precision,
  "priority" text,
  "assigned_to" text,
  "reviewed_by" text,
  "reviewed_at" timestamptz,
  "auditor_findings" text,
  "auditor_recommendations" jsonb,
  "corrections_made" jsonb,
  "report_generated" boolean,
  "agency_id" text not null,
  constraint "oasis_audit_pkey" primary key ("source_app_id", "id"),
  constraint "oasis_audit_status_allowed" check ("status" is null or "status" in ('compliant', 'flagged', 'critical', 'pending_review', 'in_review', 'reviewed'))
);
alter table "pennsync_records"."oasis_audit" enable row level security;
alter table "pennsync_records"."oasis_audit" force row level security;
revoke all on "pennsync_records"."oasis_audit" from public;

drop policy if exists "oasis_audit_read" on "pennsync_records"."oasis_audit";
create policy "oasis_audit_read" on "pennsync_records"."oasis_audit" for select using ("oasis_audit"."source_app_id" = "pennsync_records".deployment_app() and "oasis_audit"."agency_id" in (select "pennsync_records".caller_agencies()) and ("oasis_audit"."patient_id" is null or "pennsync_records".caller_opens_every_chart("oasis_audit"."agency_id") or "oasis_audit"."patient_id" in (select "pennsync_records".caller_assigned_patients("oasis_audit"."agency_id"))));
drop policy if exists "oasis_audit_insert" on "pennsync_records"."oasis_audit";
create policy "oasis_audit_insert" on "pennsync_records"."oasis_audit" for insert with check ("oasis_audit"."source_app_id" = "pennsync_records".deployment_app() and "oasis_audit"."agency_id" in (select "pennsync_records".caller_agencies()) and ("oasis_audit"."patient_id" is null or "pennsync_records".caller_opens_every_chart("oasis_audit"."agency_id") or "oasis_audit"."patient_id" in (select "pennsync_records".caller_assigned_patients("oasis_audit"."agency_id"))));
drop policy if exists "oasis_audit_update" on "pennsync_records"."oasis_audit";
create policy "oasis_audit_update" on "pennsync_records"."oasis_audit" for update using ("oasis_audit"."source_app_id" = "pennsync_records".deployment_app() and "oasis_audit"."agency_id" in (select "pennsync_records".caller_agencies()) and ("oasis_audit"."patient_id" is null or "pennsync_records".caller_opens_every_chart("oasis_audit"."agency_id") or "oasis_audit"."patient_id" in (select "pennsync_records".caller_assigned_patients("oasis_audit"."agency_id")))) with check ("oasis_audit"."source_app_id" = "pennsync_records".deployment_app() and "oasis_audit"."agency_id" in (select "pennsync_records".caller_agencies()) and ("oasis_audit"."patient_id" is null or "pennsync_records".caller_opens_every_chart("oasis_audit"."agency_id") or "oasis_audit"."patient_id" in (select "pennsync_records".caller_assigned_patients("oasis_audit"."agency_id"))));
drop policy if exists "oasis_audit_delete" on "pennsync_records"."oasis_audit";
create policy "oasis_audit_delete" on "pennsync_records"."oasis_audit" for delete using ("oasis_audit"."source_app_id" = "pennsync_records".deployment_app() and "oasis_audit"."agency_id" in (select "pennsync_records".caller_agencies()) and ("oasis_audit"."patient_id" is null or "pennsync_records".caller_opens_every_chart("oasis_audit"."agency_id") or "oasis_audit"."patient_id" in (select "pennsync_records".caller_assigned_patients("oasis_audit"."agency_id"))));

create table if not exists "pennsync_records"."oasis_automation_rule" (
  "source_app_id" text not null,
  "id" text not null,
  "created_date" timestamptz,
  "updated_date" timestamptz,
  "created_by" text,
  "rule_name" text,
  "description" text,
  "trigger_type" text,
  "trigger_conditions" jsonb,
  "action_type" text,
  "action_config" jsonb,
  "is_active" boolean default true,
  "priority" double precision default 0,
  "apply_to_patient_types" jsonb,
  "agency_id" text not null,
  constraint "oasis_automation_rule_pkey" primary key ("source_app_id", "id"),
  constraint "oasis_automation_rule_trigger_type_allowed" check ("trigger_type" is null or "trigger_type" in ('compliance_issue', 'revenue_opportunity', 'accuracy_concern', 'missing_documentation', 'score_threshold', 'specific_m_item', 'clinical_concern', 'pdgm_discrepancy')),
  constraint "oasis_automation_rule_action_type_allowed" check ("action_type" is null or "action_type" in ('create_task', 'create_alert', 'notify_clinician', 'suggest_documentation', 'schedule_reassessment', 'flag_for_review'))
);
alter table "pennsync_records"."oasis_automation_rule" enable row level security;
alter table "pennsync_records"."oasis_automation_rule" force row level security;
revoke all on "pennsync_records"."oasis_automation_rule" from public;

drop policy if exists "oasis_automation_rule_read" on "pennsync_records"."oasis_automation_rule";
create policy "oasis_automation_rule_read" on "pennsync_records"."oasis_automation_rule" for select using ("oasis_automation_rule"."source_app_id" = "pennsync_records".deployment_app() and "oasis_automation_rule"."agency_id" in (select "pennsync_records".caller_agencies()));
drop policy if exists "oasis_automation_rule_insert" on "pennsync_records"."oasis_automation_rule";
create policy "oasis_automation_rule_insert" on "pennsync_records"."oasis_automation_rule" for insert with check ("oasis_automation_rule"."source_app_id" = "pennsync_records".deployment_app() and "oasis_automation_rule"."agency_id" in (select "pennsync_records".caller_agencies()));
drop policy if exists "oasis_automation_rule_update" on "pennsync_records"."oasis_automation_rule";
create policy "oasis_automation_rule_update" on "pennsync_records"."oasis_automation_rule" for update using ("oasis_automation_rule"."source_app_id" = "pennsync_records".deployment_app() and "oasis_automation_rule"."agency_id" in (select "pennsync_records".caller_agencies())) with check ("oasis_automation_rule"."source_app_id" = "pennsync_records".deployment_app() and "oasis_automation_rule"."agency_id" in (select "pennsync_records".caller_agencies()));
drop policy if exists "oasis_automation_rule_delete" on "pennsync_records"."oasis_automation_rule";
create policy "oasis_automation_rule_delete" on "pennsync_records"."oasis_automation_rule" for delete using ("oasis_automation_rule"."source_app_id" = "pennsync_records".deployment_app() and "oasis_automation_rule"."agency_id" in (select "pennsync_records".caller_agencies()));

create table if not exists "pennsync_records"."oasis_feedback" (
  "source_app_id" text not null,
  "id" text not null,
  "created_date" timestamptz,
  "updated_date" timestamptz,
  "created_by" text,
  "oasis_upload_id" text,
  "feedback_type" text,
  "extracted_name" text,
  "extracted_medicare_id" text,
  "extracted_dob" text,
  "suggested_patient_id" text,
  "suggested_confidence" double precision,
  "actual_patient_id" text,
  "user_notes" text,
  "match_factors_used" jsonb,
  "visit_id" text,
  "patient_id" text,
  "suggestion_type" text,
  "oasis_item" text,
  "original_suggestion" text,
  "user_action" text,
  "modified_text" text,
  "feedback_reason" text,
  "reimbursement_impact_accuracy" double precision,
  "clinical_accuracy" double precision,
  "helpfulness_rating" double precision,
  "agency_id" text not null,
  constraint "oasis_feedback_pkey" primary key ("source_app_id", "id"),
  constraint "oasis_feedback_feedback_type_allowed" check ("feedback_type" is null or "feedback_type" in ('incorrect_match', 'correct_match', 'manual_override'))
);
alter table "pennsync_records"."oasis_feedback" enable row level security;
alter table "pennsync_records"."oasis_feedback" force row level security;
revoke all on "pennsync_records"."oasis_feedback" from public;

drop policy if exists "oasis_feedback_read" on "pennsync_records"."oasis_feedback";
create policy "oasis_feedback_read" on "pennsync_records"."oasis_feedback" for select using ("oasis_feedback"."source_app_id" = "pennsync_records".deployment_app() and "oasis_feedback"."agency_id" in (select "pennsync_records".caller_agencies()) and ("oasis_feedback"."patient_id" is null or "pennsync_records".caller_opens_every_chart("oasis_feedback"."agency_id") or "oasis_feedback"."patient_id" in (select "pennsync_records".caller_assigned_patients("oasis_feedback"."agency_id"))));
drop policy if exists "oasis_feedback_insert" on "pennsync_records"."oasis_feedback";
create policy "oasis_feedback_insert" on "pennsync_records"."oasis_feedback" for insert with check ("oasis_feedback"."source_app_id" = "pennsync_records".deployment_app() and "oasis_feedback"."agency_id" in (select "pennsync_records".caller_agencies()) and ("oasis_feedback"."patient_id" is null or "pennsync_records".caller_opens_every_chart("oasis_feedback"."agency_id") or "oasis_feedback"."patient_id" in (select "pennsync_records".caller_assigned_patients("oasis_feedback"."agency_id"))));
drop policy if exists "oasis_feedback_update" on "pennsync_records"."oasis_feedback";
create policy "oasis_feedback_update" on "pennsync_records"."oasis_feedback" for update using ("oasis_feedback"."source_app_id" = "pennsync_records".deployment_app() and "oasis_feedback"."agency_id" in (select "pennsync_records".caller_agencies()) and ("oasis_feedback"."patient_id" is null or "pennsync_records".caller_opens_every_chart("oasis_feedback"."agency_id") or "oasis_feedback"."patient_id" in (select "pennsync_records".caller_assigned_patients("oasis_feedback"."agency_id")))) with check ("oasis_feedback"."source_app_id" = "pennsync_records".deployment_app() and "oasis_feedback"."agency_id" in (select "pennsync_records".caller_agencies()) and ("oasis_feedback"."patient_id" is null or "pennsync_records".caller_opens_every_chart("oasis_feedback"."agency_id") or "oasis_feedback"."patient_id" in (select "pennsync_records".caller_assigned_patients("oasis_feedback"."agency_id"))));
drop policy if exists "oasis_feedback_delete" on "pennsync_records"."oasis_feedback";
create policy "oasis_feedback_delete" on "pennsync_records"."oasis_feedback" for delete using ("oasis_feedback"."source_app_id" = "pennsync_records".deployment_app() and "oasis_feedback"."agency_id" in (select "pennsync_records".caller_agencies()) and ("oasis_feedback"."patient_id" is null or "pennsync_records".caller_opens_every_chart("oasis_feedback"."agency_id") or "oasis_feedback"."patient_id" in (select "pennsync_records".caller_assigned_patients("oasis_feedback"."agency_id"))));

create table if not exists "pennsync_records"."oasis_scenario" (
  "source_app_id" text not null,
  "id" text not null,
  "created_date" timestamptz,
  "updated_date" timestamptz,
  "created_by" text,
  "patient_id" text,
  "scenario_name" text,
  "scenario_data" jsonb,
  "simulation_result" jsonb,
  "baseline_payment" double precision,
  "simulated_payment" double precision,
  "payment_difference" double precision,
  "notes" text,
  "analysis_id" text,
  "patient_name" text,
  "description" text,
  "original_pdgm_data" jsonb,
  "modified_pdgm_data" jsonb,
  "changes_made" jsonb,
  "original_payment" double precision,
  "scenario_payment" double precision,
  "status" text,
  "agency_id" text not null,
  constraint "oasis_scenario_pkey" primary key ("source_app_id", "id")
);
alter table "pennsync_records"."oasis_scenario" enable row level security;
alter table "pennsync_records"."oasis_scenario" force row level security;
revoke all on "pennsync_records"."oasis_scenario" from public;

drop policy if exists "oasis_scenario_read" on "pennsync_records"."oasis_scenario";
create policy "oasis_scenario_read" on "pennsync_records"."oasis_scenario" for select using ("oasis_scenario"."source_app_id" = "pennsync_records".deployment_app() and "oasis_scenario"."agency_id" in (select "pennsync_records".caller_agencies()) and ("oasis_scenario"."patient_id" is null or "pennsync_records".caller_opens_every_chart("oasis_scenario"."agency_id") or "oasis_scenario"."patient_id" in (select "pennsync_records".caller_assigned_patients("oasis_scenario"."agency_id"))));
drop policy if exists "oasis_scenario_insert" on "pennsync_records"."oasis_scenario";
create policy "oasis_scenario_insert" on "pennsync_records"."oasis_scenario" for insert with check ("oasis_scenario"."source_app_id" = "pennsync_records".deployment_app() and "oasis_scenario"."agency_id" in (select "pennsync_records".caller_agencies()) and ("oasis_scenario"."patient_id" is null or "pennsync_records".caller_opens_every_chart("oasis_scenario"."agency_id") or "oasis_scenario"."patient_id" in (select "pennsync_records".caller_assigned_patients("oasis_scenario"."agency_id"))));
drop policy if exists "oasis_scenario_update" on "pennsync_records"."oasis_scenario";
create policy "oasis_scenario_update" on "pennsync_records"."oasis_scenario" for update using ("oasis_scenario"."source_app_id" = "pennsync_records".deployment_app() and "oasis_scenario"."agency_id" in (select "pennsync_records".caller_agencies()) and ("oasis_scenario"."patient_id" is null or "pennsync_records".caller_opens_every_chart("oasis_scenario"."agency_id") or "oasis_scenario"."patient_id" in (select "pennsync_records".caller_assigned_patients("oasis_scenario"."agency_id")))) with check ("oasis_scenario"."source_app_id" = "pennsync_records".deployment_app() and "oasis_scenario"."agency_id" in (select "pennsync_records".caller_agencies()) and ("oasis_scenario"."patient_id" is null or "pennsync_records".caller_opens_every_chart("oasis_scenario"."agency_id") or "oasis_scenario"."patient_id" in (select "pennsync_records".caller_assigned_patients("oasis_scenario"."agency_id"))));
drop policy if exists "oasis_scenario_delete" on "pennsync_records"."oasis_scenario";
create policy "oasis_scenario_delete" on "pennsync_records"."oasis_scenario" for delete using ("oasis_scenario"."source_app_id" = "pennsync_records".deployment_app() and "oasis_scenario"."agency_id" in (select "pennsync_records".caller_agencies()) and ("oasis_scenario"."patient_id" is null or "pennsync_records".caller_opens_every_chart("oasis_scenario"."agency_id") or "oasis_scenario"."patient_id" in (select "pennsync_records".caller_assigned_patients("oasis_scenario"."agency_id"))));

create table if not exists "pennsync_records"."oasis_upload" (
  "source_app_id" text not null,
  "id" text not null,
  "created_date" timestamptz,
  "updated_date" timestamptz,
  "created_by" text,
  "agency_id" text,
  "patient_id" text,
  "patient_name" text,
  "file_url" text,
  "file_name" text,
  "assessment_date" date,
  "assessment_type" text,
  "analysis_id" text,
  "pdgm_data" jsonb,
  "analysis_results" jsonb,
  "scores" jsonb,
  "estimated_payment" double precision,
  "optimized_payment" double precision,
  "revenue_uplift" double precision,
  "status" text default 'uploaded',
  "notes" text,
  "extracted_data" jsonb,
  "response_schema_id" text,
  "instrument_version" text,
  "derived_value_origin" text,
  "supervisor_review_status" text,
  "supervisor_reviewed_by" text,
  "supervisor_reviewed_at" timestamptz,
  "comprehensive_review" jsonb,
  constraint "oasis_upload_pkey" primary key ("source_app_id", "id"),
  constraint "oasis_upload_assessment_type_allowed" check ("assessment_type" is null or "assessment_type" in ('SOC', 'ROC', 'Recertification', 'Follow-up', 'Transfer', 'Discharge', 'Other')),
  constraint "oasis_upload_status_allowed" check ("status" is null or "status" in ('uploaded', 'analyzed', 'reviewed', 'archived')),
  constraint "oasis_upload_derived_value_origin_allowed" check ("derived_value_origin" is null or "derived_value_origin" in ('ai_extracted', 'clinician_selected')),
  constraint "oasis_upload_supervisor_review_status_allowed" check ("supervisor_review_status" is null or "supervisor_review_status" in ('approved', 'rejected'))
);
alter table "pennsync_records"."oasis_upload" enable row level security;
alter table "pennsync_records"."oasis_upload" force row level security;
revoke all on "pennsync_records"."oasis_upload" from public;

drop policy if exists "oasis_upload_read" on "pennsync_records"."oasis_upload";
create policy "oasis_upload_read" on "pennsync_records"."oasis_upload" for select using ("oasis_upload"."source_app_id" = "pennsync_records".deployment_app() and "oasis_upload"."agency_id" in (select "pennsync_records".caller_agencies()) and ("oasis_upload"."patient_id" is null or "pennsync_records".caller_opens_every_chart("oasis_upload"."agency_id") or "oasis_upload"."patient_id" in (select "pennsync_records".caller_assigned_patients("oasis_upload"."agency_id"))));
drop policy if exists "oasis_upload_insert" on "pennsync_records"."oasis_upload";
create policy "oasis_upload_insert" on "pennsync_records"."oasis_upload" for insert with check ("oasis_upload"."source_app_id" = "pennsync_records".deployment_app() and "oasis_upload"."agency_id" in (select "pennsync_records".caller_agencies()) and ("oasis_upload"."patient_id" is null or "pennsync_records".caller_opens_every_chart("oasis_upload"."agency_id") or "oasis_upload"."patient_id" in (select "pennsync_records".caller_assigned_patients("oasis_upload"."agency_id"))));
drop policy if exists "oasis_upload_update" on "pennsync_records"."oasis_upload";
create policy "oasis_upload_update" on "pennsync_records"."oasis_upload" for update using ("oasis_upload"."source_app_id" = "pennsync_records".deployment_app() and "oasis_upload"."agency_id" in (select "pennsync_records".caller_agencies()) and ("oasis_upload"."patient_id" is null or "pennsync_records".caller_opens_every_chart("oasis_upload"."agency_id") or "oasis_upload"."patient_id" in (select "pennsync_records".caller_assigned_patients("oasis_upload"."agency_id")))) with check ("oasis_upload"."source_app_id" = "pennsync_records".deployment_app() and "oasis_upload"."agency_id" in (select "pennsync_records".caller_agencies()) and ("oasis_upload"."patient_id" is null or "pennsync_records".caller_opens_every_chart("oasis_upload"."agency_id") or "oasis_upload"."patient_id" in (select "pennsync_records".caller_assigned_patients("oasis_upload"."agency_id"))));
drop policy if exists "oasis_upload_delete" on "pennsync_records"."oasis_upload";
create policy "oasis_upload_delete" on "pennsync_records"."oasis_upload" for delete using ("oasis_upload"."source_app_id" = "pennsync_records".deployment_app() and "oasis_upload"."agency_id" in (select "pennsync_records".caller_agencies()) and ("oasis_upload"."patient_id" is null or "pennsync_records".caller_opens_every_chart("oasis_upload"."agency_id") or "oasis_upload"."patient_id" in (select "pennsync_records".caller_assigned_patients("oasis_upload"."agency_id"))));

create table if not exists "pennsync_records"."oasis_workflow_execution" (
  "source_app_id" text not null,
  "id" text not null,
  "created_date" timestamptz,
  "updated_date" timestamptz,
  "created_by" text,
  "oasis_upload_id" text,
  "patient_id" text,
  "patient_name" text,
  "automation_rule_id" text,
  "rule_name" text,
  "trigger_reason" text,
  "trigger_data" jsonb,
  "actions_executed" jsonb,
  "tasks_created" jsonb,
  "alerts_created" jsonb,
  "notifications_sent" jsonb,
  "status" text default 'running',
  "completion_percentage" double precision default 0,
  "error_message" text,
  "execution_time_ms" double precision,
  "outcome_summary" text,
  "run_id" text,
  constraint "oasis_workflow_execution_pkey" primary key ("source_app_id", "id"),
  constraint "oasis_workflow_execution_status_allowed" check ("status" is null or "status" in ('running', 'completed', 'failed', 'partially_completed'))
);
alter table "pennsync_records"."oasis_workflow_execution" enable row level security;
alter table "pennsync_records"."oasis_workflow_execution" force row level security;
revoke all on "pennsync_records"."oasis_workflow_execution" from public;

drop policy if exists "oasis_workflow_execution_read" on "pennsync_records"."oasis_workflow_execution";
create policy "oasis_workflow_execution_read" on "pennsync_records"."oasis_workflow_execution" for select using ("oasis_workflow_execution"."source_app_id" = "pennsync_records".deployment_app() and exists (select 1 from "pennsync_records"."oasis_upload" t1 where t1."source_app_id" = "oasis_workflow_execution"."source_app_id" and t1."id" = "oasis_workflow_execution"."oasis_upload_id" and t1."agency_id" in (select "pennsync_records".caller_agencies()) and (t1."patient_id" is null or "pennsync_records".caller_opens_every_chart(t1."agency_id") or t1."patient_id" in (select "pennsync_records".caller_assigned_patients(t1."agency_id")))));
drop policy if exists "oasis_workflow_execution_insert" on "pennsync_records"."oasis_workflow_execution";
create policy "oasis_workflow_execution_insert" on "pennsync_records"."oasis_workflow_execution" for insert with check ("oasis_workflow_execution"."source_app_id" = "pennsync_records".deployment_app() and exists (select 1 from "pennsync_records"."oasis_upload" t1 where t1."source_app_id" = "oasis_workflow_execution"."source_app_id" and t1."id" = "oasis_workflow_execution"."oasis_upload_id" and t1."agency_id" in (select "pennsync_records".caller_agencies()) and (t1."patient_id" is null or "pennsync_records".caller_opens_every_chart(t1."agency_id") or t1."patient_id" in (select "pennsync_records".caller_assigned_patients(t1."agency_id")))));
drop policy if exists "oasis_workflow_execution_update" on "pennsync_records"."oasis_workflow_execution";
create policy "oasis_workflow_execution_update" on "pennsync_records"."oasis_workflow_execution" for update using ("oasis_workflow_execution"."source_app_id" = "pennsync_records".deployment_app() and exists (select 1 from "pennsync_records"."oasis_upload" t1 where t1."source_app_id" = "oasis_workflow_execution"."source_app_id" and t1."id" = "oasis_workflow_execution"."oasis_upload_id" and t1."agency_id" in (select "pennsync_records".caller_agencies()) and (t1."patient_id" is null or "pennsync_records".caller_opens_every_chart(t1."agency_id") or t1."patient_id" in (select "pennsync_records".caller_assigned_patients(t1."agency_id"))))) with check ("oasis_workflow_execution"."source_app_id" = "pennsync_records".deployment_app() and exists (select 1 from "pennsync_records"."oasis_upload" t1 where t1."source_app_id" = "oasis_workflow_execution"."source_app_id" and t1."id" = "oasis_workflow_execution"."oasis_upload_id" and t1."agency_id" in (select "pennsync_records".caller_agencies()) and (t1."patient_id" is null or "pennsync_records".caller_opens_every_chart(t1."agency_id") or t1."patient_id" in (select "pennsync_records".caller_assigned_patients(t1."agency_id")))));
drop policy if exists "oasis_workflow_execution_delete" on "pennsync_records"."oasis_workflow_execution";
create policy "oasis_workflow_execution_delete" on "pennsync_records"."oasis_workflow_execution" for delete using ("oasis_workflow_execution"."source_app_id" = "pennsync_records".deployment_app() and exists (select 1 from "pennsync_records"."oasis_upload" t1 where t1."source_app_id" = "oasis_workflow_execution"."source_app_id" and t1."id" = "oasis_workflow_execution"."oasis_upload_id" and t1."agency_id" in (select "pennsync_records".caller_agencies()) and (t1."patient_id" is null or "pennsync_records".caller_opens_every_chart(t1."agency_id") or t1."patient_id" in (select "pennsync_records".caller_assigned_patients(t1."agency_id")))));

reset role;
commit;
