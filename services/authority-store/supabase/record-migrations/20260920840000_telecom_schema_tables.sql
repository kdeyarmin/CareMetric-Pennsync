-- D7's schema clause, for a store that already exists (D88).
--
-- D7 carries the paused domains as `preserved_paused` and says of them: "Their
-- schemas and data still migrate; only their execution stays off." The schema
-- planner could not express that until `SCHEMA_ONLY` named these six fax and
-- phone entities, and regenerating
-- `20260919170000_record_store.sql` reaches a fresh provision and no
-- deployment that has already applied it -- so the change lives in both places
-- and this is the second.
--
-- DERIVED, never typed: `node tools-pennsync-record-catchup.mjs --write` reads
-- each table's whole block and each of its policies out of the generated
-- migration. A hand-kept copy of 135 columns and 24 policies would drift in
-- the one direction nothing measures.
--
-- WHAT THIS DOES NOT DO. A table is not an access path. Fax is live in
-- the hosted app and nothing here activates it; the generic broker family
-- serves `broker` alone, and D16's
-- ceiling refuses all six on their own account as well -- every one of them
-- CONDITIONS its reads, which D2 does not let a generic family evaluate, and
-- three can hold a file besides (measured, not assumed: `auditBrokerCeiling`
-- also refuses `fax_log` for a credential reference and three clinical
-- subjects, and `phone_number` for a claim token); so after this applies
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

create table if not exists "pennsync_records"."call_log" (
  "source_app_id" text not null,
  "id" text not null,
  "created_date" timestamptz,
  "updated_date" timestamptz,
  "created_by" text,
  "direction" text,
  "from_number" text,
  "to_number" text,
  "displayed_number" text,
  "nurse_email" text,
  "patient_id" text,
  "call_mode" text,
  "status" text,
  "provider_call_id" text,
  "duration_seconds" double precision,
  "failure_reason" text,
  "has_voicemail" boolean default false,
  "voicemail_url" text,
  "voicemail_transcription" text,
  "voicemail_duration_seconds" double precision,
  "voicemail_notified" boolean default false,
  "sent_by" text,
  "note" text,
  "disposition" text,
  "agency_id" text not null,
  constraint "call_log_pkey" primary key ("source_app_id", "id"),
  constraint "call_log_direction_allowed" check ("direction" is null or "direction" in ('inbound', 'outbound')),
  constraint "call_log_call_mode_allowed" check ("call_mode" is null or "call_mode" in ('masked_bridge', 'office_transfer', 'after_hours_transfer', 'off_duty_transfer', 'voicemail', 'unresolved', 'outbound_clicktocall')),
  constraint "call_log_status_allowed" check ("status" is null or "status" in ('initiated', 'ringing', 'in_progress', 'completed', 'failed')),
  constraint "call_log_disposition_allowed" check ("disposition" is null or "disposition" in ('resolved', 'follow_up_needed', 'callback_requested', 'left_voicemail', 'no_action'))
);
alter table "pennsync_records"."call_log" enable row level security;
alter table "pennsync_records"."call_log" force row level security;
revoke all on "pennsync_records"."call_log" from public;

drop policy if exists "call_log_read" on "pennsync_records"."call_log";
create policy "call_log_read" on "pennsync_records"."call_log" for select using ("call_log"."source_app_id" = "pennsync_records".deployment_app() and "call_log"."agency_id" in (select "pennsync_records".caller_agencies()) and ("call_log"."patient_id" is null or "pennsync_records".caller_opens_every_chart("call_log"."agency_id") or "call_log"."patient_id" in (select "pennsync_records".caller_assigned_patients("call_log"."agency_id"))));
drop policy if exists "call_log_insert" on "pennsync_records"."call_log";
create policy "call_log_insert" on "pennsync_records"."call_log" for insert with check ("call_log"."source_app_id" = "pennsync_records".deployment_app() and "call_log"."agency_id" in (select "pennsync_records".caller_agencies()) and ("call_log"."patient_id" is null or "pennsync_records".caller_opens_every_chart("call_log"."agency_id") or "call_log"."patient_id" in (select "pennsync_records".caller_assigned_patients("call_log"."agency_id"))));
drop policy if exists "call_log_update" on "pennsync_records"."call_log";
create policy "call_log_update" on "pennsync_records"."call_log" for update using ("call_log"."source_app_id" = "pennsync_records".deployment_app() and "call_log"."agency_id" in (select "pennsync_records".caller_agencies()) and ("call_log"."patient_id" is null or "pennsync_records".caller_opens_every_chart("call_log"."agency_id") or "call_log"."patient_id" in (select "pennsync_records".caller_assigned_patients("call_log"."agency_id")))) with check ("call_log"."source_app_id" = "pennsync_records".deployment_app() and "call_log"."agency_id" in (select "pennsync_records".caller_agencies()) and ("call_log"."patient_id" is null or "pennsync_records".caller_opens_every_chart("call_log"."agency_id") or "call_log"."patient_id" in (select "pennsync_records".caller_assigned_patients("call_log"."agency_id"))));
drop policy if exists "call_log_delete" on "pennsync_records"."call_log";
create policy "call_log_delete" on "pennsync_records"."call_log" for delete using ("call_log"."source_app_id" = "pennsync_records".deployment_app() and "call_log"."agency_id" in (select "pennsync_records".caller_agencies()) and ("call_log"."patient_id" is null or "pennsync_records".caller_opens_every_chart("call_log"."agency_id") or "call_log"."patient_id" in (select "pennsync_records".caller_assigned_patients("call_log"."agency_id"))));

create table if not exists "pennsync_records"."fax_contact" (
  "source_app_id" text not null,
  "id" text not null,
  "created_date" timestamptz,
  "updated_date" timestamptz,
  "created_by" text,
  "name" text,
  "fax_number" text,
  "company" text,
  "organization" text,
  "department" text,
  "notes" text,
  "user_email" text,
  "agency_id" text,
  "is_shared" boolean default false,
  "is_favorite" boolean default false,
  constraint "fax_contact_pkey" primary key ("source_app_id", "id")
);
alter table "pennsync_records"."fax_contact" enable row level security;
alter table "pennsync_records"."fax_contact" force row level security;
revoke all on "pennsync_records"."fax_contact" from public;

drop policy if exists "fax_contact_read" on "pennsync_records"."fax_contact";
create policy "fax_contact_read" on "pennsync_records"."fax_contact" for select using ("fax_contact"."source_app_id" = "pennsync_records".deployment_app() and "fax_contact"."agency_id" in (select "pennsync_records".caller_agencies()));
drop policy if exists "fax_contact_insert" on "pennsync_records"."fax_contact";
create policy "fax_contact_insert" on "pennsync_records"."fax_contact" for insert with check ("fax_contact"."source_app_id" = "pennsync_records".deployment_app() and "fax_contact"."agency_id" in (select "pennsync_records".caller_agencies()));
drop policy if exists "fax_contact_update" on "pennsync_records"."fax_contact";
create policy "fax_contact_update" on "pennsync_records"."fax_contact" for update using ("fax_contact"."source_app_id" = "pennsync_records".deployment_app() and "fax_contact"."agency_id" in (select "pennsync_records".caller_agencies())) with check ("fax_contact"."source_app_id" = "pennsync_records".deployment_app() and "fax_contact"."agency_id" in (select "pennsync_records".caller_agencies()));
drop policy if exists "fax_contact_delete" on "pennsync_records"."fax_contact";
create policy "fax_contact_delete" on "pennsync_records"."fax_contact" for delete using ("fax_contact"."source_app_id" = "pennsync_records".deployment_app() and "fax_contact"."agency_id" in (select "pennsync_records".caller_agencies()));

create table if not exists "pennsync_records"."fax_log" (
  "source_app_id" text not null,
  "id" text not null,
  "created_date" timestamptz,
  "updated_date" timestamptz,
  "created_by" text,
  "agency_id" text,
  "referral_id" text,
  "document_id" text,
  "document_binding_id" text,
  "document_binding_version" bigint,
  "document_content_sha256" text,
  "sent_by_user_id" text,
  "sent_by_membership_id" text,
  "sent_by_membership_version" bigint,
  "from_number" text,
  "to_number" text,
  "to_name" text,
  "document_url" text,
  "document_name" text,
  "status" text default 'queued',
  "provider_submission_state" text,
  "provider_submission_attempt_id" text,
  "provider_accepted_at" timestamptz,
  "provider_terminal_status" text,
  "provider_terminal_at" timestamptz,
  "provider" text,
  "integration_secret_id" text,
  "integration_secret_updated_at" timestamptz,
  "fax_connection_id" text,
  "sender_telecom_binding_id" text,
  "sender_telecom_binding_version" bigint,
  "sender_provider_number_id" text,
  "sender_settings_id" text,
  "sender_settings_updated_at" timestamptz,
  "telnyx_fax_id" text,
  "pages" double precision,
  "cover_page_details" jsonb,
  "failure_reason" text,
  "patient_id" text,
  "sent_by" text,
  "priority" text default 'normal',
  "retry_count" double precision default 0,
  "retry_of_fax_log_id" text,
  "scheduled_fax_id" text,
  "batch_request_key" text,
  "batch_recipient_key" text,
  "retry_generation" bigint default 0,
  "next_retry_at" timestamptz,
  "automatic_retry_queue_attempts" bigint default 0,
  "automatic_retry_last_error_code" text,
  "automatic_retry_quarantined_at" timestamptz,
  "status_poll_last_attempt_at" timestamptz,
  "status_poll_next_attempt_at" timestamptz,
  "status_poll_attempt_count" bigint default 0,
  "status_poll_last_error_code" text,
  "status_poll_quarantined_at" timestamptz,
  "retry_recovery_quarantined_at" timestamptz,
  "retry_recovery_last_error_code" text,
  "retry_recovery_last_attempt_at" timestamptz,
  "retry_recovery_next_attempt_at" timestamptz,
  "notification_recovery_quarantined_at" timestamptz,
  "notification_recovery_last_error_code" text,
  "notification_recovery_last_attempt_at" timestamptz,
  "notification_recovery_next_attempt_at" timestamptz,
  "final_failure_notified" boolean default false,
  "estimated_cost" double precision,
  "delivery_confirmation_sent" boolean default false,
  "delivery_notify_claimed_by" text,
  "delivery_notify_claimed_at" timestamptz,
  "delivery_notify_publication_state" text,
  "failure_notify_claimed_by" text,
  "failure_notify_claimed_at" timestamptz,
  "failure_notify_publication_state" text,
  "ocr_text" text,
  "ocr_processed" boolean default false,
  "ocr_confidence" double precision,
  "ocr_failure_reason" text,
  "retry_claimed_by" text,
  "retry_claimed_at" timestamptz,
  "retry_claimed_by_user_id" text,
  "retry_submission_state" text,
  constraint "fax_log_pkey" primary key ("source_app_id", "id"),
  constraint "fax_log_status_allowed" check ("status" is null or "status" in ('queued', 'sending', 'sent', 'delivered', 'failed', 'submission_unknown', 'retrying', 'retried')),
  constraint "fax_log_provider_submission_state_allowed" check ("provider_submission_state" is null or "provider_submission_state" in ('pending', 'accepted', 'rejected', 'indeterminate')),
  constraint "fax_log_provider_terminal_status_allowed" check ("provider_terminal_status" is null or "provider_terminal_status" in ('delivered', 'failed')),
  constraint "fax_log_provider_allowed" check ("provider" is null or "provider" in ('telnyx')),
  constraint "fax_log_priority_allowed" check ("priority" is null or "priority" in ('urgent', 'normal', 'low')),
  constraint "fax_log_delivery_notify_publication_state_allowed" check ("delivery_notify_publication_state" is null or "delivery_notify_publication_state" in ('ready', 'started')),
  constraint "fax_log_failure_notify_publication_state_allowed" check ("failure_notify_publication_state" is null or "failure_notify_publication_state" in ('ready', 'started')),
  constraint "fax_log_retry_submission_state_allowed" check ("retry_submission_state" is null or "retry_submission_state" in ('ready', 'started'))
);
alter table "pennsync_records"."fax_log" enable row level security;
alter table "pennsync_records"."fax_log" force row level security;
revoke all on "pennsync_records"."fax_log" from public;

drop policy if exists "fax_log_read" on "pennsync_records"."fax_log";
create policy "fax_log_read" on "pennsync_records"."fax_log" for select using ("fax_log"."source_app_id" = "pennsync_records".deployment_app() and "fax_log"."agency_id" in (select "pennsync_records".caller_agencies()) and ("fax_log"."patient_id" is null or "pennsync_records".caller_opens_every_chart("fax_log"."agency_id") or "fax_log"."patient_id" in (select "pennsync_records".caller_assigned_patients("fax_log"."agency_id"))));
drop policy if exists "fax_log_insert" on "pennsync_records"."fax_log";
create policy "fax_log_insert" on "pennsync_records"."fax_log" for insert with check ("fax_log"."source_app_id" = "pennsync_records".deployment_app() and "fax_log"."agency_id" in (select "pennsync_records".caller_agencies()) and ("fax_log"."patient_id" is null or "pennsync_records".caller_opens_every_chart("fax_log"."agency_id") or "fax_log"."patient_id" in (select "pennsync_records".caller_assigned_patients("fax_log"."agency_id"))));
drop policy if exists "fax_log_update" on "pennsync_records"."fax_log";
create policy "fax_log_update" on "pennsync_records"."fax_log" for update using ("fax_log"."source_app_id" = "pennsync_records".deployment_app() and "fax_log"."agency_id" in (select "pennsync_records".caller_agencies()) and ("fax_log"."patient_id" is null or "pennsync_records".caller_opens_every_chart("fax_log"."agency_id") or "fax_log"."patient_id" in (select "pennsync_records".caller_assigned_patients("fax_log"."agency_id")))) with check ("fax_log"."source_app_id" = "pennsync_records".deployment_app() and "fax_log"."agency_id" in (select "pennsync_records".caller_agencies()) and ("fax_log"."patient_id" is null or "pennsync_records".caller_opens_every_chart("fax_log"."agency_id") or "fax_log"."patient_id" in (select "pennsync_records".caller_assigned_patients("fax_log"."agency_id"))));
drop policy if exists "fax_log_delete" on "pennsync_records"."fax_log";
create policy "fax_log_delete" on "pennsync_records"."fax_log" for delete using ("fax_log"."source_app_id" = "pennsync_records".deployment_app() and "fax_log"."agency_id" in (select "pennsync_records".caller_agencies()) and ("fax_log"."patient_id" is null or "pennsync_records".caller_opens_every_chart("fax_log"."agency_id") or "fax_log"."patient_id" in (select "pennsync_records".caller_assigned_patients("fax_log"."agency_id"))));

create table if not exists "pennsync_records"."fax_retry_config" (
  "source_app_id" text not null,
  "id" text not null,
  "created_date" timestamptz,
  "updated_date" timestamptz,
  "created_by" text,
  "agency_id" text,
  "max_retries" bigint default 3,
  "retry_delay_minutes" double precision default 15,
  "auto_retry_enabled" boolean default true,
  "priority_multiplier" jsonb,
  "notify_on_final_failure" boolean default true,
  "is_active" boolean default true,
  "agency_name" text,
  constraint "fax_retry_config_pkey" primary key ("source_app_id", "id")
);
alter table "pennsync_records"."fax_retry_config" enable row level security;
alter table "pennsync_records"."fax_retry_config" force row level security;
revoke all on "pennsync_records"."fax_retry_config" from public;

drop policy if exists "fax_retry_config_read" on "pennsync_records"."fax_retry_config";
create policy "fax_retry_config_read" on "pennsync_records"."fax_retry_config" for select using ("fax_retry_config"."source_app_id" = "pennsync_records".deployment_app() and "fax_retry_config"."agency_id" in (select "pennsync_records".caller_agencies()));
drop policy if exists "fax_retry_config_insert" on "pennsync_records"."fax_retry_config";
create policy "fax_retry_config_insert" on "pennsync_records"."fax_retry_config" for insert with check ("fax_retry_config"."source_app_id" = "pennsync_records".deployment_app() and "fax_retry_config"."agency_id" in (select "pennsync_records".caller_agencies()));
drop policy if exists "fax_retry_config_update" on "pennsync_records"."fax_retry_config";
create policy "fax_retry_config_update" on "pennsync_records"."fax_retry_config" for update using ("fax_retry_config"."source_app_id" = "pennsync_records".deployment_app() and "fax_retry_config"."agency_id" in (select "pennsync_records".caller_agencies())) with check ("fax_retry_config"."source_app_id" = "pennsync_records".deployment_app() and "fax_retry_config"."agency_id" in (select "pennsync_records".caller_agencies()));
drop policy if exists "fax_retry_config_delete" on "pennsync_records"."fax_retry_config";
create policy "fax_retry_config_delete" on "pennsync_records"."fax_retry_config" for delete using ("fax_retry_config"."source_app_id" = "pennsync_records".deployment_app() and "fax_retry_config"."agency_id" in (select "pennsync_records".caller_agencies()));

create table if not exists "pennsync_records"."fax_template" (
  "source_app_id" text not null,
  "id" text not null,
  "created_date" timestamptz,
  "updated_date" timestamptz,
  "created_by" text,
  "name" text,
  "description" text,
  "cover_page_data" jsonb,
  "recipient_name" text,
  "recipient_fax_number" text,
  "recipient_organization" text,
  "document_url" text,
  "document_name" text,
  "subject" text,
  "notes" text,
  "is_default" boolean default false,
  "use_count" double precision default 0,
  "agency_id" text not null,
  constraint "fax_template_pkey" primary key ("source_app_id", "id")
);
alter table "pennsync_records"."fax_template" enable row level security;
alter table "pennsync_records"."fax_template" force row level security;
revoke all on "pennsync_records"."fax_template" from public;

drop policy if exists "fax_template_read" on "pennsync_records"."fax_template";
create policy "fax_template_read" on "pennsync_records"."fax_template" for select using ("fax_template"."source_app_id" = "pennsync_records".deployment_app() and "fax_template"."agency_id" in (select "pennsync_records".caller_agencies()));
drop policy if exists "fax_template_insert" on "pennsync_records"."fax_template";
create policy "fax_template_insert" on "pennsync_records"."fax_template" for insert with check ("fax_template"."source_app_id" = "pennsync_records".deployment_app() and "fax_template"."agency_id" in (select "pennsync_records".caller_agencies()));
drop policy if exists "fax_template_update" on "pennsync_records"."fax_template";
create policy "fax_template_update" on "pennsync_records"."fax_template" for update using ("fax_template"."source_app_id" = "pennsync_records".deployment_app() and "fax_template"."agency_id" in (select "pennsync_records".caller_agencies())) with check ("fax_template"."source_app_id" = "pennsync_records".deployment_app() and "fax_template"."agency_id" in (select "pennsync_records".caller_agencies()));
drop policy if exists "fax_template_delete" on "pennsync_records"."fax_template";
create policy "fax_template_delete" on "pennsync_records"."fax_template" for delete using ("fax_template"."source_app_id" = "pennsync_records".deployment_app() and "fax_template"."agency_id" in (select "pennsync_records".caller_agencies()));

create table if not exists "pennsync_records"."phone_number" (
  "source_app_id" text not null,
  "id" text not null,
  "created_date" timestamptz,
  "updated_date" timestamptz,
  "created_by" text,
  "e164" text,
  "label" text,
  "status" text default 'available',
  "assigned_to_email" text,
  "twilio_phone_number_sid" text,
  "notes" text,
  "creation_claim_token" text,
  "agency_id" text not null,
  constraint "phone_number_pkey" primary key ("source_app_id", "id"),
  constraint "phone_number_status_allowed" check ("status" is null or "status" in ('available', 'assigned', 'reserved'))
);
alter table "pennsync_records"."phone_number" enable row level security;
alter table "pennsync_records"."phone_number" force row level security;
revoke all on "pennsync_records"."phone_number" from public;

drop policy if exists "phone_number_read" on "pennsync_records"."phone_number";
create policy "phone_number_read" on "pennsync_records"."phone_number" for select using ("phone_number"."source_app_id" = "pennsync_records".deployment_app() and "phone_number"."agency_id" in (select "pennsync_records".caller_agencies()));
drop policy if exists "phone_number_insert" on "pennsync_records"."phone_number";
create policy "phone_number_insert" on "pennsync_records"."phone_number" for insert with check ("phone_number"."source_app_id" = "pennsync_records".deployment_app() and "phone_number"."agency_id" in (select "pennsync_records".caller_agencies()));
drop policy if exists "phone_number_update" on "pennsync_records"."phone_number";
create policy "phone_number_update" on "pennsync_records"."phone_number" for update using ("phone_number"."source_app_id" = "pennsync_records".deployment_app() and "phone_number"."agency_id" in (select "pennsync_records".caller_agencies())) with check ("phone_number"."source_app_id" = "pennsync_records".deployment_app() and "phone_number"."agency_id" in (select "pennsync_records".caller_agencies()));
drop policy if exists "phone_number_delete" on "pennsync_records"."phone_number";
create policy "phone_number_delete" on "pennsync_records"."phone_number" for delete using ("phone_number"."source_app_id" = "pennsync_records".deployment_app() and "phone_number"."agency_id" in (select "pennsync_records".caller_agencies()));

reset role;
commit;
