// This is the explicitly covered synthetic fixture, not a production inventory.
// New/renamed tables or columns require review and fixture/probe updates instead
// of silently inheriting an older migration's coverage claim.
const expected = {
  'auth.sessions': 'id,user_id,not_after,created_at,aal',
  'auth.users': 'id,email,email_confirmed_at,banned_until,deleted_at,is_anonymous',
  'cron.job': 'jobid,jobname,schedule,command,active',
  'pennsync_private.agency': 'app_id,id,name,status,version',
  'pennsync_private.archive_patient_import_receipt': 'app_id,plan_sha256,owner_sha256,projection_sha256,patient_count,patient_ids,state,database_name,operator_role,created_at,rolled_back_at',
  'pennsync_private.assignment': 'app_id,agency_id,patient_id,membership_id,status,version,changed_by,changed_at,id',
  // D24's production care team, a sibling of `assignment` rather than the same
  // table: `assignment` keys to `pennsync_private.patient`, which holds
  // synthetic rows only, and that key is one of four the archive import relies
  // on to refuse a rollback that would orphan a care team.
  'pennsync_private.chart_assignment': 'app_id,id,agency_id,patient_id,membership_id,status,version,changed_by,changed_at,last_action,last_reason,last_request_key,granted_at,suspended_at,revoked_at',
  'pennsync_private.deployment': 'singleton,app_id,source,pinned_at',
  'pennsync_private.enrollment_receipt': 'app_id,plan_sha256,projection_sha256,identity_count,agency_count,membership_count,database_name,operator_role,created_at',
  // D99 appends `provenance`: `base44_migrated` for the ten migrated accounts,
  // `locally_verified` for a person admitted on evidence alone.
  'pennsync_private.identity_map': 'app_id,auth_user_id,base44_user_id,expected_email,source_evidence_sha256,verified_at,enabled,revoked_at,version,provenance',
  'pennsync_private.known_app': 'app_id,label',
  'pennsync_private.membership': 'app_id,id,agency_id,auth_user_id,base44_user_id,membership_key,tenant_role,status,version,revoked_at,revoked_by,last_action,last_reason,activated_at,suspended_at',
  'pennsync_private.mutation_receipt': 'app_id,actor_id,request_id,payload,result,created_at',
  'pennsync_private.patient': 'app_id,id,agency_id,display_name,synthetic,version,status',
  'pennsync_private.patient_context': 'app_id,agency_id,patient_id,version,provenance_kind,provenance_sha256,data,data_sha256,created_at',
  'pennsync_private.patient_disclosure_audit': 'id,app_id,actor_id,agency_id,membership_id,membership_version,tenant_role,patient_id,context_version,context_sha256,purpose,access_basis,assignment_id,assignment_version,created_at',
  'pennsync_private.s3_receipt': 'app_id,actor_id,request_id,agency_id,patient_id,referral_id,action,payload,result,payload_sha256,referral_sha256',
  'pennsync_private.s3_referral': 'app_id,id,agency_id,patient_id,actor_id,creation_request_id,version,data',
  'pennsync_private.s4_compliance_audit': 'app_id,id,agency_id,patient_id,visit_id,data',
  'pennsync_private.s4_create_receipt': 'app_id,actor_id,request_id,agency_id,patient_id,membership_id,membership_version,patient_version,visit_id,history_id,conversion_id,audit_id,payload_sha256,artifacts_sha256,created_at',
  'pennsync_private.s4_note_conversion': 'app_id,id,agency_id,patient_id,visit_id,data',
  'pennsync_private.s4_note_history': 'app_id,id,agency_id,patient_id,visit_id,data',
  'pennsync_private.s4_visit': 'app_id,id,agency_id,patient_id,actor_id,data',
  // The staff name Kevin chose over showing a work email. Its own table rather
  // than a column on `identity_map`, because that row is verification evidence
  // and `protect_identity()` permits only a revocation, so a name there could be
  // set at enrolment and never again. Keyed per PERSON, not per membership.
  'pennsync_private.staff_name': 'app_id,auth_user_id,display_name,recorded_at',
  'pennsync_private.visit_disclosure_audit': 'id,app_id,actor_id,agency_id,membership_id,membership_version,tenant_role,patient_id,visit_id,purpose,access_basis,assignment_id,assignment_version,created_at',
  'pennsync_private.visit_list_disclosure_audit': 'id,app_id,actor_id,agency_id,membership_id,membership_version,tenant_role,patient_id,access_basis,assignment_id,assignment_version,purpose,status_filter,after_id,page_size,visit_ids,has_more,created_at',
  'public.cm_integration_daily_budget': 'app_id,subject,budget_day,attempts',
  'public.cm_integration_files': 'id,app_id,subject,object_path,content_type,size_bytes,sha256,created_at',
  'public.cm_integration_jobs': 'id,app_id,subject,operation,request_id,payload_hash,claim,state,result_encrypted,created_at,finished_at,result_expires_at,attempt_count',
  'public.restore_unrelated_fixture': 'id,note',
  'storage.buckets': 'id,name,public,file_size_limit,allowed_mime_types',
  'storage.objects': 'id,bucket_id,name',
};

export async function assertRestoreFixtureShape(db) {
  const rows = (await db.query(`select n.nspname||'.'||c.relname as name,c.relkind as kind,
    coalesce(string_agg(a.attname,',' order by a.attnum),'') as columns
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    left join pg_catalog.pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
    where c.relkind in ('r','p','v','m','f') and n.nspname !~ '^pg_' and n.nspname<>'information_schema'
    group by n.nspname,c.relname,c.relkind order by n.nspname,c.relname`)).rows;
  if (JSON.stringify(rows) !== JSON.stringify(Object.entries(expected).map(([name, columns]) => ({ name, kind: 'r', columns })))) {
    throw new Error('LOCAL_RESTORE_FIXTURE_SCHEMA_CHANGED');
  }
}
