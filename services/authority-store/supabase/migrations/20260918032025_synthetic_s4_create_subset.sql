-- Synthetic staging S4 CREATE SUBSET. Not a production/UI workflow selection.
-- No AI execution, update/recovery, findings, overrides or configured rules.
begin;
do $$ begin
  if not exists(select 1 from pg_catalog.pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then
    raise exception using errcode='42501',message='PENNSYNC_BYPASSRLS_MIGRATION_OWNER_REQUIRED';
  end if;
end $$;

alter table pennsync_private.patient add column status text not null default 'active'
  check(status in ('active','inactive'));

create table pennsync_private.s4_visit (
  app_id pennsync_private.staging_app not null,
  id uuid not null,
  agency_id pennsync_private.identifier not null,
  patient_id pennsync_private.identifier not null,
  actor_id uuid not null,
  data jsonb not null check(jsonb_typeof(data)='object' and octet_length(data::text)<=2400000),
  primary key(app_id,id),
  unique(app_id,agency_id,patient_id,id),
  foreign key(app_id,agency_id,patient_id) references pennsync_private.patient(app_id,agency_id,id),
  foreign key(app_id,actor_id) references pennsync_private.identity_map(app_id,auth_user_id)
);
create table pennsync_private.s4_note_history (
  app_id pennsync_private.staging_app not null,
  id uuid not null,
  agency_id pennsync_private.identifier not null,
  patient_id pennsync_private.identifier not null,
  visit_id uuid not null,
  data jsonb not null check(jsonb_typeof(data)='object' and octet_length(data::text)<=2400000),
  primary key(app_id,id),
  unique(app_id,visit_id),
  foreign key(app_id,agency_id,patient_id,visit_id) references pennsync_private.s4_visit(app_id,agency_id,patient_id,id)
);
create table pennsync_private.s4_note_conversion (
  app_id pennsync_private.staging_app not null,
  id uuid not null,
  agency_id pennsync_private.identifier not null,
  patient_id pennsync_private.identifier not null,
  visit_id uuid not null,
  data jsonb not null check(jsonb_typeof(data)='object' and octet_length(data::text)<=16384),
  primary key(app_id,id),
  unique(app_id,visit_id),
  foreign key(app_id,agency_id,patient_id,visit_id) references pennsync_private.s4_visit(app_id,agency_id,patient_id,id)
);
create table pennsync_private.s4_compliance_audit (
  app_id pennsync_private.staging_app not null,
  id uuid not null,
  agency_id pennsync_private.identifier not null,
  patient_id pennsync_private.identifier not null,
  visit_id uuid not null,
  data jsonb not null check(jsonb_typeof(data)='object' and octet_length(data::text)<=16384),
  primary key(app_id,id),
  unique(app_id,visit_id),
  foreign key(app_id,agency_id,patient_id,visit_id) references pennsync_private.s4_visit(app_id,agency_id,patient_id,id)
);
-- Dedicated bounded receipt; existing administrative receipt limits are untouched.
create table pennsync_private.s4_create_receipt (
  app_id pennsync_private.staging_app not null,
  actor_id uuid not null,
  request_id uuid not null,
  agency_id pennsync_private.identifier not null,
  patient_id pennsync_private.identifier not null,
  membership_id pennsync_private.identifier not null,
  membership_version pennsync_private.revision not null,
  patient_version pennsync_private.revision not null,
  visit_id uuid not null,
  history_id uuid not null,
  conversion_id uuid not null,
  audit_id uuid not null,
  payload_sha256 text not null check(payload_sha256 ~ '^[a-f0-9]{64}$'),
  artifacts_sha256 text not null check(artifacts_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  primary key(app_id,actor_id,request_id),
  unique(app_id,visit_id),
  foreign key(app_id,actor_id) references pennsync_private.identity_map(app_id,auth_user_id),
  foreign key(app_id,agency_id,membership_id) references pennsync_private.membership(app_id,agency_id,id),
  foreign key(app_id,agency_id,patient_id,visit_id) references pennsync_private.s4_visit(app_id,agency_id,patient_id,id),
  foreign key(app_id,history_id) references pennsync_private.s4_note_history(app_id,id),
  foreign key(app_id,conversion_id) references pennsync_private.s4_note_conversion(app_id,id),
  foreign key(app_id,audit_id) references pennsync_private.s4_compliance_audit(app_id,id)
);

create function pennsync_private.s4_immutable() returns trigger
language plpgsql security invoker set search_path='' as $$ begin
  raise exception using errcode='23514',message='PENNSYNC_S4_IMMUTABLE';
end $$;
do $$ declare t text; begin
  foreach t in array array['s4_visit','s4_note_history','s4_note_conversion','s4_compliance_audit','s4_create_receipt'] loop
    execute format('alter table pennsync_private.%I enable row level security',t);
    execute format('alter table pennsync_private.%I force row level security',t);
    execute format('revoke all on table pennsync_private.%I from public,anon,authenticated',t);
    execute format('create trigger immutable before update or delete on pennsync_private.%I for each row execute function pennsync_private.s4_immutable()',t);
  end loop;
end $$;

-- JS helper compatibility: lengths are UTF-16 code units, not SQL code points.
create function pennsync_private.s4_utf16_length(p_text text) returns integer
language sql immutable strict security invoker set search_path='' as $$
  select char_length(p_text)+regexp_count(p_text,U&'[\+010000-\+10FFFF]');
$$;

create function pennsync_private.s4_fields(p_fields jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare k text; item jsonb; n numeric; d date; vitals jsonb := '{}';
  required text[] := array['visit_date','visit_type','status','nurse_notes','raw_transcription',
    'vital_signs','compliance_score','draft_presence_score','homebound_status_verified',
    'skilled_intervention_documented','homebound_justification','documentation_source',
    'grounding_pending','compliance_issues','ai_tags','chart_findings','denial_findings',
    'sustained_trends','acknowledgment','rule_versions','diagnosis'];
begin
  if p_fields is null or jsonb_typeof(p_fields)<>'object' or octet_length(p_fields::text)>2400000
    or not p_fields ?& required or p_fields - required <> '{}'::jsonb then
    raise exception using errcode='22023',message='PENNSYNC_S4_UNSUPPORTED_FIELDS';
  end if;
  if p_fields->>'visit_type' is distinct from 'skilled_nursing'
    or p_fields->>'status' is distinct from 'completed'
    or p_fields->>'documentation_source' is distinct from 'smart_note'
    or p_fields->'grounding_pending' is distinct from 'false'::jsonb
    or p_fields->'diagnosis' is distinct from '""'::jsonb
    or p_fields->'acknowledgment' is distinct from 'null'::jsonb then
    raise exception using errcode='22023',message='PENNSYNC_S4_UNSUPPORTED_WORKFLOW';
  end if;
  foreach k in array array['compliance_issues','ai_tags','chart_findings','denial_findings','sustained_trends','rule_versions'] loop
    if p_fields->k is distinct from '[]'::jsonb then
      raise exception using errcode='22023',message='PENNSYNC_S4_UNSUPPORTED_FINDINGS';
    end if;
  end loop;
  foreach k in array array['nurse_notes','raw_transcription','homebound_justification'] loop
    if jsonb_typeof(p_fields->k)<>'string' or pennsync_private.s4_utf16_length(p_fields->>k) >
      (case when k='homebound_justification' then 20000 else 250000 end) then
      raise exception using errcode='22023',message='PENNSYNC_S4_INVALID_TEXT';
    end if;
  end loop;
  if p_fields->>'nurse_notes' ~ '^[[:space:]]*$' then
    raise exception using errcode='22023',message='PENNSYNC_S4_NOTE_REQUIRED';
  end if;
  foreach k in array array['homebound_status_verified','skilled_intervention_documented'] loop
    if jsonb_typeof(p_fields->k)<>'boolean' then
      raise exception using errcode='22023',message='PENNSYNC_S4_INVALID_BOOLEAN';
    end if;
  end loop;
  foreach k in array array['compliance_score','draft_presence_score'] loop
    if jsonb_typeof(p_fields->k)<>'number' or (p_fields->>k)::numeric not between 0 and 100 then
      raise exception using errcode='22023',message='PENNSYNC_S4_INVALID_SCORE';
    end if;
  end loop;
  if jsonb_typeof(p_fields->'visit_date')<>'string' or p_fields->>'visit_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception using errcode='22023',message='PENNSYNC_S4_INVALID_DATE';
  end if;
  begin d := (p_fields->>'visit_date')::date;
  exception when datetime_field_overflow or invalid_datetime_format then
    raise exception using errcode='22023',message='PENNSYNC_S4_INVALID_DATE';
  end;
  if to_char(d,'YYYY-MM-DD')<>p_fields->>'visit_date' then
    raise exception using errcode='22023',message='PENNSYNC_S4_INVALID_DATE';
  end if;
  if jsonb_typeof(p_fields->'vital_signs')<>'object' then
    raise exception using errcode='22023',message='PENNSYNC_S4_INVALID_VITALS';
  end if;
  for k,item in select key,value from jsonb_each(p_fields->'vital_signs') loop
    if not k=any(array['temperature','blood_pressure_systolic','blood_pressure_diastolic','heart_rate',
      'respiratory_rate','oxygen_saturation','pain_level','weight']) then
      raise exception using errcode='22023',message='PENNSYNC_S4_INVALID_VITALS';
    end if;
    if item='null'::jsonb then continue; end if;
    if jsonb_typeof(item)<>'number' then
      raise exception using errcode='22023',message='PENNSYNC_S4_INVALID_VITALS';
    end if;
    n := item::text::numeric;
    if abs(n)>1000000 then raise exception using errcode='22023',message='PENNSYNC_S4_INVALID_VITALS'; end if;
    vitals := vitals || jsonb_build_object(k,item);
  end loop;
  return jsonb_set(p_fields,'{vital_signs}',vitals);
end $$;

create function pennsync_private.s4_scope(p_app_id text,p_agency_id text,p_patient_id text,
  p_expected_actor_version bigint,p_expected_patient_version bigint,p_write boolean) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare i pennsync_private.identity_map; c jsonb; p pennsync_private.patient;
begin
  i := pennsync_private.actor(p_app_id,p_write);
  c := pennsync_private.context_value(i,p_agency_id);
  if p_expected_actor_version is null or (c->>'membership_version')::bigint<>p_expected_actor_version then
    raise exception using errcode='PT409',message='PENNSYNC_ACTOR_VERSION_CHANGED';
  end if;
  select * into p from pennsync_private.patient where app_id=p_app_id and agency_id=p_agency_id
    and id=p_patient_id and synthetic and status='active' for share;
  if not found or not pennsync_private.visible_patient(p_app_id,p_agency_id,p_patient_id,c) then
    raise exception using errcode='42501',message='PENNSYNC_PATIENT_DENIED';
  end if;
  if p_expected_patient_version is null or p.version<>p_expected_patient_version then
    raise exception using errcode='PT409',message='PENNSYNC_PATIENT_VERSION_CHANGED';
  end if;
  -- The application lock orders assignment changes. The patient row lock also
  -- fences privileged status/version changes against this transaction.
  return c;
end $$;

create function pennsync_private.s4_artifacts(p_receipt pennsync_private.s4_create_receipt) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v jsonb; h jsonb; n jsonb; a jsonb; bundle jsonb;
begin
  select data into v from pennsync_private.s4_visit where app_id=p_receipt.app_id and id=p_receipt.visit_id
    and agency_id=p_receipt.agency_id and patient_id=p_receipt.patient_id and actor_id=p_receipt.actor_id;
  select data into h from pennsync_private.s4_note_history where app_id=p_receipt.app_id and id=p_receipt.history_id
    and agency_id=p_receipt.agency_id and patient_id=p_receipt.patient_id and visit_id=p_receipt.visit_id;
  select data into n from pennsync_private.s4_note_conversion where app_id=p_receipt.app_id and id=p_receipt.conversion_id
    and agency_id=p_receipt.agency_id and patient_id=p_receipt.patient_id and visit_id=p_receipt.visit_id;
  select data into a from pennsync_private.s4_compliance_audit where app_id=p_receipt.app_id and id=p_receipt.audit_id
    and agency_id=p_receipt.agency_id and patient_id=p_receipt.patient_id and visit_id=p_receipt.visit_id;
  bundle := jsonb_build_object('visit',v,'note_history',h,'note_conversion',n,'compliance_audit',a);
  if v is null or h is null or n is null or a is null
    or encode(sha256(convert_to(bundle::text,'UTF8')),'hex')<>p_receipt.artifacts_sha256 then
    raise exception using errcode='PT409',message='PENNSYNC_S4_ARTIFACTS_CHANGED';
  end if;
  return bundle;
end $$;

create function pennsync_private.s4_result(p_receipt pennsync_private.s4_create_receipt,p_context jsonb,p_replayed boolean) returns jsonb
language sql security invoker set search_path='' as $$
  select jsonb_build_object('contract','cm.pennsync.s4-create.staging.v1','staging',true,'synthetic',true,
    'app_id',p_receipt.app_id,'request_id',p_receipt.request_id,'context',p_context,'replayed',p_replayed,
    'artifacts',pennsync_private.s4_artifacts(p_receipt),'receipt',jsonb_build_object(
      'payload_sha256',p_receipt.payload_sha256,'artifacts_sha256',p_receipt.artifacts_sha256));
$$;

create function pennsync_private.s4_create(p_app_id text,p_agency_id text,p_patient_id text,
  p_expected_actor_version bigint,p_expected_patient_version bigint,p_request_id uuid,p_fields jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c jsonb; f jsonb; payload_hash text; r pennsync_private.s4_create_receipt;
  vid uuid:=gen_random_uuid(); hid uuid:=gen_random_uuid(); nid uuid:=gen_random_uuid(); aid uuid:=gen_random_uuid();
  stamp text; note_hash text; v jsonb; h jsonb; n jsonb; a jsonb; bundle jsonb; score numeric; draft numeric;
begin
  c := pennsync_private.s4_scope(p_app_id,p_agency_id,p_patient_id,p_expected_actor_version,p_expected_patient_version,true);
  if p_request_id is null then raise exception using errcode='22023',message='PENNSYNC_S4_REQUEST_REQUIRED'; end if;
  f := pennsync_private.s4_fields(p_fields);
  payload_hash := encode(sha256(convert_to(jsonb_build_object('contract','cm.pennsync.s4-create.staging.v1',
    'app_id',p_app_id,'agency_id',p_agency_id,'patient_id',p_patient_id,'actor_id',c->'auth_user_id',
    'membership_id',c->'membership_id','membership_version',p_expected_actor_version,
    'patient_version',p_expected_patient_version,'request_id',p_request_id,'fields',p_fields)::text,'UTF8')),'hex');
  select * into r from pennsync_private.s4_create_receipt where app_id=p_app_id
    and actor_id=(c->>'auth_user_id')::uuid and request_id=p_request_id;
  if found then
    if r.payload_sha256<>payload_hash then
      raise exception using errcode='PT409',message='PENNSYNC_S4_IDEMPOTENCY_CONFLICT';
    end if;
    return pennsync_private.s4_result(r,c,true);
  end if;
  stamp := to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  note_hash := encode(sha256(convert_to(f->>'nurse_notes','UTF8')),'hex');
  score := (f->>'compliance_score')::numeric; draft := (f->>'draft_presence_score')::numeric;
  v := (f - array['draft_presence_score','chart_findings','denial_findings','sustained_trends','acknowledgment','rule_versions','diagnosis'])
    || jsonb_build_object('id',vid,'agency_id',p_agency_id,'patient_id',p_patient_id,'nurse_id',c->'user_id',
      'nurse_email',c->'user_email','created_by',c->'user_email','created_by_user_id',c->'user_id',
      'created_by_user_email_normalized',c->'user_email','created_date',stamp,'updated_date',stamp,'client_request_id',p_request_id,
      'emr_handoff_status','not_started','emr_handoff_history','[]'::jsonb,'documentation_review_ack',null);
  h := jsonb_build_object('id',hid,'agency_id',p_agency_id,'patient_id',p_patient_id,'visit_id',vid,
    'mode','append','visit_date',f->'visit_date','visit_type',f->'visit_type','note',f->'nurse_notes',
    'clinical_notes',f->'nurse_notes','compliance_score',score,'actor_user_id',c->'user_id',
    'actor_email_normalized',c->'user_email','membership_id',c->'membership_id','membership_version',c->'membership_version',
    'visit_revision_at',stamp,'created_by',c->'user_email','created_at',stamp,'recorded_at',stamp,'note_sha256',note_hash,
    'payload_fingerprint',encode(sha256(convert_to(jsonb_build_object('mode','append','visit_date',f->'visit_date',
      'visit_type',f->'visit_type','note',f->'nurse_notes','clinical_notes',f->'nurse_notes','compliance_score',score)::text,'UTF8')),'hex'),
    'logical_note_key',encode(sha256(convert_to(jsonb_build_array(p_agency_id,p_patient_id,vid)::text,'UTF8')),'hex'),
    'event_key',encode(sha256(convert_to(jsonb_build_array(p_agency_id,p_patient_id,vid,payload_hash)::text,'UTF8')),'hex'));
  n := jsonb_build_object('id',nid,'agency_id',p_agency_id,'patient_id',p_patient_id,'visit_id',vid,
    'nurse_email',c->'user_email','visit_type',f->'visit_type','diagnosis','',
    'rough_note_length',pennsync_private.s4_utf16_length(f->>'raw_transcription'),
    'enhanced_note_length',pennsync_private.s4_utf16_length(f->>'nurse_notes'),
    'rough_len',pennsync_private.s4_utf16_length(f->>'raw_transcription'),
    'enhanced_len',pennsync_private.s4_utf16_length(f->>'nurse_notes'),
    'quality_score',score,'compliance_score',score,'rough_note_compliance',draft,'enhanced_note_compliance',score,
    'draft_presence_score',draft,'compliance_improvement',greatest(0,score-draft),'created_by',c->'user_email','created_date',stamp);
  a := jsonb_build_object('id',aid,'agency_id',p_agency_id,'patient_id',p_patient_id,'visit_id',vid,
    'nurse_email',c->'user_email','audit_date',stamp,'audit_type','automated','compliance_score',score,
    'status',case when score>=90 then 'passed' when score>=80 then 'flagged' else 'critical' end,
    'issues','[]'::jsonb,'acknowledgment',null,'rule_versions','[]'::jsonb,'created_by',c->'user_email','created_date',stamp);
  bundle := jsonb_build_object('visit',v,'note_history',h,'note_conversion',n,'compliance_audit',a);
  -- Escaping expands JSON bytes; immutable history preserves the note twice.
  -- Check complete serialized artifacts before inserts, returning a fixed input
  -- error instead of a row-bearing constraint DETAIL for oversized artifacts.
  if octet_length(v::text)>2400000 or octet_length(h::text)>2400000
    or octet_length(n::text)>16384 or octet_length(a::text)>16384
    or octet_length(bundle::text)>4800000 then
    raise exception using errcode='22023',message='PENNSYNC_S4_ARTIFACT_LIMIT';
  end if;
  insert into pennsync_private.s4_visit values(p_app_id,vid,p_agency_id,p_patient_id,(c->>'auth_user_id')::uuid,v);
  insert into pennsync_private.s4_note_history values(p_app_id,hid,p_agency_id,p_patient_id,vid,h);
  insert into pennsync_private.s4_note_conversion values(p_app_id,nid,p_agency_id,p_patient_id,vid,n);
  insert into pennsync_private.s4_compliance_audit values(p_app_id,aid,p_agency_id,p_patient_id,vid,a);
  insert into pennsync_private.s4_create_receipt(app_id,actor_id,request_id,agency_id,patient_id,membership_id,
    membership_version,patient_version,visit_id,history_id,conversion_id,audit_id,payload_sha256,artifacts_sha256)
    values(p_app_id,(c->>'auth_user_id')::uuid,p_request_id,p_agency_id,p_patient_id,c->>'membership_id',
      p_expected_actor_version,p_expected_patient_version,vid,hid,nid,aid,payload_hash,
      encode(sha256(convert_to(bundle::text,'UTF8')),'hex')) returning * into r;
  return pennsync_private.s4_result(r,c,false);
end $$;

create function pennsync_private.s4_read(p_app_id text,p_agency_id text,p_patient_id text,
  p_expected_actor_version bigint,p_expected_patient_version bigint,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c jsonb; r pennsync_private.s4_create_receipt;
begin
  c := pennsync_private.s4_scope(p_app_id,p_agency_id,p_patient_id,p_expected_actor_version,p_expected_patient_version,false);
  select * into r from pennsync_private.s4_create_receipt where app_id=p_app_id
    and actor_id=(c->>'auth_user_id')::uuid and request_id=p_request_id and agency_id=p_agency_id and patient_id=p_patient_id;
  if not found then raise exception using errcode='42501',message='PENNSYNC_S4_RECEIPT_DENIED'; end if;
  if r.membership_id<>c->>'membership_id' or r.membership_version<>p_expected_actor_version
    or r.patient_version<>p_expected_patient_version then
    raise exception using errcode='PT409',message='PENNSYNC_S4_REPLAY_STATE_CHANGED';
  end if;
  return pennsync_private.s4_result(r,c,true);
end $$;

create function public.pennsync_staging_s4_create(p_app_id text,p_agency_id text,p_patient_id text,
  p_expected_actor_version bigint,p_expected_patient_version bigint,p_request_id uuid,p_fields jsonb) returns jsonb
language sql security invoker set search_path='' as $$
  select pennsync_private.s4_create(p_app_id,p_agency_id,p_patient_id,p_expected_actor_version,p_expected_patient_version,p_request_id,p_fields);
$$;
create function public.pennsync_staging_s4_read(p_app_id text,p_agency_id text,p_patient_id text,
  p_expected_actor_version bigint,p_expected_patient_version bigint,p_request_id uuid) returns jsonb
language sql security invoker set search_path='' as $$
  select pennsync_private.s4_read(p_app_id,p_agency_id,p_patient_id,p_expected_actor_version,p_expected_patient_version,p_request_id);
$$;

revoke all on function pennsync_private.s4_immutable(),pennsync_private.s4_utf16_length(text),pennsync_private.s4_fields(jsonb),
  pennsync_private.s4_scope(text,text,text,bigint,bigint,boolean),pennsync_private.s4_artifacts(pennsync_private.s4_create_receipt),
  pennsync_private.s4_result(pennsync_private.s4_create_receipt,jsonb,boolean),
  pennsync_private.s4_create(text,text,text,bigint,bigint,uuid,jsonb),pennsync_private.s4_read(text,text,text,bigint,bigint,uuid),
  public.pennsync_staging_s4_create(text,text,text,bigint,bigint,uuid,jsonb),public.pennsync_staging_s4_read(text,text,text,bigint,bigint,uuid)
  from public,anon,authenticated;
grant execute on function pennsync_private.s4_create(text,text,text,bigint,bigint,uuid,jsonb),
  pennsync_private.s4_read(text,text,text,bigint,bigint,uuid),
  public.pennsync_staging_s4_create(text,text,text,bigint,bigint,uuid,jsonb),public.pennsync_staging_s4_read(text,text,text,bigint,bigint,uuid)
  to authenticated;
commit;
