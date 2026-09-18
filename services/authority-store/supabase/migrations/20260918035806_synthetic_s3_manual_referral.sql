-- Synthetic manual referral CREATE + CONFIRM EXISTING PATIENT subset only.
-- No production/UI selection, new patient, provider, file or communication work.
begin;
do $$ begin
  if not exists(select 1 from pg_catalog.pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then
    raise exception using errcode='42501',message='PENNSYNC_BYPASSRLS_MIGRATION_OWNER_REQUIRED';
  end if;
end $$;

create table pennsync_private.s3_referral (
  app_id pennsync_private.staging_app not null,
  id uuid not null,
  agency_id pennsync_private.identifier not null,
  patient_id pennsync_private.identifier not null,
  actor_id uuid not null,
  creation_request_id uuid not null,
  version integer not null check(version in (1,2)),
  data jsonb not null check(jsonb_typeof(data)='object' and octet_length(data::text)<=4096),
  primary key(app_id,id),
  unique(app_id,agency_id,actor_id,creation_request_id),
  unique(app_id,agency_id,patient_id,id),
  foreign key(app_id,agency_id,patient_id) references pennsync_private.patient(app_id,agency_id,id),
  foreign key(app_id,actor_id) references pennsync_private.identity_map(app_id,auth_user_id)
);
create table pennsync_private.s3_receipt (
  app_id pennsync_private.staging_app not null,
  actor_id uuid not null,
  request_id uuid not null,
  agency_id pennsync_private.identifier not null,
  patient_id pennsync_private.identifier not null,
  referral_id uuid not null,
  action text not null check(action in ('create','confirm')),
  payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=4096),
  result jsonb not null check(jsonb_typeof(result)='object' and octet_length(result::text)<=4096),
  payload_sha256 text not null check(payload_sha256 ~ '^[a-f0-9]{64}$'),
  referral_sha256 text not null check(referral_sha256 ~ '^[a-f0-9]{64}$'),
  primary key(app_id,agency_id,actor_id,request_id),
  unique(app_id,referral_id,action),
  foreign key(app_id,agency_id,patient_id,referral_id) references pennsync_private.s3_referral(app_id,agency_id,patient_id,id),
  foreign key(app_id,actor_id) references pennsync_private.identity_map(app_id,auth_user_id)
);
create function pennsync_private.s3_immutable() returns trigger
language plpgsql security invoker set search_path='' as $$ begin
  raise exception using errcode='23514',message='PENNSYNC_S3_IMMUTABLE';
end $$;
create function pennsync_private.s3_transition() returns trigger
language plpgsql security invoker set search_path='' as $$ begin
  if (new.app_id,new.id,new.agency_id,new.patient_id,new.actor_id,new.creation_request_id)
      is distinct from (old.app_id,old.id,old.agency_id,old.patient_id,old.actor_id,old.creation_request_id)
    or old.version<>1 or new.version<>2
    or new.data->'version' is distinct from '2'::jsonb
    or new.data->'status' is distinct from '"ready_for_admission"'::jsonb
    or new.data->'requires_manual_review' is distinct from 'false'::jsonb
    or new.data->'manually_confirmed' is distinct from 'true'::jsonb
    or jsonb_typeof(new.data->'updated_date') is distinct from 'string'
    or (new.data-array['version','status','requires_manual_review','manually_confirmed','updated_date'])
      is distinct from (old.data-array['version','status','requires_manual_review','manually_confirmed','updated_date']) then
    raise exception using errcode='23514',message='PENNSYNC_S3_INVALID_TRANSITION';
  end if;
  return new;
end $$;
create trigger transition before update on pennsync_private.s3_referral for each row execute function pennsync_private.s3_transition();
create trigger immutable before delete on pennsync_private.s3_referral for each row execute function pennsync_private.s3_immutable();
create trigger immutable before update or delete on pennsync_private.s3_receipt for each row execute function pennsync_private.s3_immutable();
alter table pennsync_private.s3_referral enable row level security;
alter table pennsync_private.s3_referral force row level security;
alter table pennsync_private.s3_receipt enable row level security;
alter table pennsync_private.s3_receipt force row level security;
revoke all on pennsync_private.s3_referral,pennsync_private.s3_receipt from public,anon,authenticated,service_role;

create function pennsync_private.s3_hash(p_value jsonb) returns text
language sql immutable strict security invoker set search_path='' as $$
  select encode(sha256(convert_to(p_value::text,'UTF8')),'hex');
$$;
create function pennsync_private.s3_scope(p_app_id text,p_agency_id text,p_patient_id text,
  p_expected_actor_version bigint,p_expected_patient_version bigint,p_write boolean) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare i pennsync_private.identity_map; c jsonb; p pennsync_private.patient;
begin
  i := pennsync_private.actor(p_app_id,p_write);
  c := pennsync_private.context_value(i,p_agency_id);
  if not (c->>'tenant_role')=any(array['agency_admin','manager','office_staff']) then
    raise exception using errcode='42501',message='PENNSYNC_S3_INTAKE_ROLE_REQUIRED';
  end if;
  if p_expected_actor_version is null or (c->>'membership_version')::bigint<>p_expected_actor_version then
    raise exception using errcode='PT409',message='PENNSYNC_ACTOR_VERSION_CHANGED';
  end if;
  select * into p from pennsync_private.patient where app_id=p_app_id and agency_id=p_agency_id
    and id=p_patient_id and synthetic and status='active' for share;
  if not found then raise exception using errcode='42501',message='PENNSYNC_PATIENT_DENIED'; end if;
  if p_expected_patient_version is null or p.version<>p_expected_patient_version then
    raise exception using errcode='PT409',message='PENNSYNC_PATIENT_VERSION_CHANGED';
  end if;
  return c;
end $$;
create function pennsync_private.s3_fields(p_fields jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare keys text[]:=array['patient_name','priority','document_type','status','requires_manual_review','manually_confirmed']; n text;
begin
  if p_fields is null or jsonb_typeof(p_fields)<>'object' or octet_length(p_fields::text)>2048
    or not p_fields ?& keys or p_fields-keys<>'{}'::jsonb then
    raise exception using errcode='22023',message='PENNSYNC_S3_UNSUPPORTED_FIELDS';
  end if;
  n:=p_fields->>'patient_name';
  if jsonb_typeof(p_fields->'patient_name') is distinct from 'string' or n not like 'Synthetic %'
    or n ~ '^Synthetic[[:space:]]*$' or char_length(n)+regexp_count(n,U&'[\+010000-\+10FFFF]')>120 then
    raise exception using errcode='22023',message='PENNSYNC_S3_INVALID_NAME';
  end if;
  if not (p_fields->>'priority')=any(array['low','normal','high','urgent'])
    or p_fields->'priority'='null'::jsonb
    or p_fields->'document_type' is distinct from '"manual"'::jsonb
    or p_fields->'status' is distinct from '"new"'::jsonb
    or p_fields->'requires_manual_review' is distinct from 'true'::jsonb
    or p_fields->'manually_confirmed' is distinct from 'false'::jsonb then
    raise exception using errcode='22023',message='PENNSYNC_S3_UNSUPPORTED_WORKFLOW';
  end if;
  return p_fields;
end $$;
create function pennsync_private.s3_current(p_app_id text,p_agency_id text,p_patient_id text,p_referral_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v pennsync_private.s3_referral; r pennsync_private.s3_receipt;
begin
  select * into v from pennsync_private.s3_referral where app_id=p_app_id and agency_id=p_agency_id
    and patient_id=p_patient_id and id=p_referral_id for share;
  if not found then raise exception using errcode='42501',message='PENNSYNC_S3_REFERRAL_DENIED'; end if;
  select * into r from pennsync_private.s3_receipt where app_id=p_app_id and referral_id=p_referral_id
    and action=case v.version when 1 then 'create' else 'confirm' end;
  if not found or r.agency_id<>p_agency_id or r.patient_id<>p_patient_id
    or r.result is distinct from v.data or r.referral_sha256 is distinct from pennsync_private.s3_hash(v.data)
    or r.payload_sha256 is distinct from pennsync_private.s3_hash(r.payload)
    or v.data->'id' is distinct from to_jsonb(v.id) or v.data->'agency_id' is distinct from to_jsonb(v.agency_id::text)
    or v.data->'patient_id' is distinct from to_jsonb(v.patient_id::text) or v.data->'version' is distinct from to_jsonb(v.version) then
    raise exception using errcode='PT409',message='PENNSYNC_S3_RESULT_CHANGED';
  end if;
  return v.data;
end $$;
create function pennsync_private.s3_result(p_receipt pennsync_private.s3_receipt,p_context jsonb,p_replayed boolean) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v jsonb;
begin
  v:=pennsync_private.s3_current(p_receipt.app_id,p_receipt.agency_id,p_receipt.patient_id,p_receipt.referral_id);
  if v is distinct from p_receipt.result then
    raise exception using errcode='PT409',message='PENNSYNC_S3_REPLAY_STATE_CHANGED';
  end if;
  return jsonb_build_object('contract','cm.pennsync.s3-referral.staging.v1','staging',true,'synthetic',true,
    'app_id',p_receipt.app_id,'action',p_receipt.action,'request_id',p_receipt.request_id,'context',p_context,
    'replayed',p_replayed,'referral',v,'receipt',jsonb_build_object('payload_sha256',p_receipt.payload_sha256,'referral_sha256',p_receipt.referral_sha256));
end $$;
create function pennsync_private.s3_write(p_app_id text,p_agency_id text,p_patient_id text,
  p_expected_actor_version bigint,p_expected_patient_version bigint,p_request_id uuid,p_action text,
  p_referral_id uuid,p_expected_referral_version integer,p_fields jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c jsonb; f jsonb; payload jsonb; r pennsync_private.s3_receipt; v jsonb; vid uuid; stamp text;
begin
  c:=pennsync_private.s3_scope(p_app_id,p_agency_id,p_patient_id,p_expected_actor_version,p_expected_patient_version,true);
  if p_request_id is null then raise exception using errcode='22023',message='PENNSYNC_S3_REQUEST_REQUIRED'; end if;
  if p_action='create' then f:=pennsync_private.s3_fields(p_fields);
  elsif p_action='confirm' then
    if p_referral_id is null or p_expected_referral_version is distinct from 1 then
      raise exception using errcode='PT409',message='PENNSYNC_S3_REFERRAL_VERSION_CHANGED';
    end if;
  else raise exception using errcode='22023',message='PENNSYNC_S3_ACTION_INVALID'; end if;
  payload:=jsonb_build_object('contract','cm.pennsync.s3-referral.staging.v1','action',p_action,'app_id',p_app_id,
    'agency_id',p_agency_id,'patient_id',p_patient_id,'actor_id',c->'auth_user_id','membership_id',c->'membership_id',
    'membership_version',p_expected_actor_version,'patient_version',p_expected_patient_version,'request_id',p_request_id,
    'referral_id',p_referral_id,'referral_version',p_expected_referral_version,'fields',p_fields);
  if octet_length(payload::text)>4096 then raise exception using errcode='22023',message='PENNSYNC_S3_PAYLOAD_LIMIT'; end if;
  select * into r from pennsync_private.s3_receipt where app_id=p_app_id and agency_id=p_agency_id
    and actor_id=(c->>'auth_user_id')::uuid and request_id=p_request_id;
  if found then
    if r.payload is distinct from payload or r.payload_sha256 is distinct from pennsync_private.s3_hash(payload) then
      raise exception using errcode='PT409',message='PENNSYNC_S3_IDEMPOTENCY_CONFLICT';
    end if;
    return pennsync_private.s3_result(r,c,true);
  end if;
  stamp:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  if p_action='create' then
    vid:=gen_random_uuid();
    v:=f||jsonb_build_object('id',vid,'agency_id',p_agency_id,'patient_id',p_patient_id,'version',1,
      'created_by_user_id',c->'user_id','created_by_user_email_normalized',c->'user_email','created_by',c->'user_email',
      'client_request_id',p_request_id,'referral_creation_key',p_agency_id||':'||(c->>'user_id')||':'||p_request_id::text,
      'created_date',stamp,'updated_date',stamp);
  else
    vid:=p_referral_id;
    v:=pennsync_private.s3_current(p_app_id,p_agency_id,p_patient_id,vid);
    if v->'version' is distinct from '1'::jsonb then
      raise exception using errcode='PT409',message='PENNSYNC_S3_REFERRAL_VERSION_CHANGED';
    end if;
    v:=v||jsonb_build_object('patient_id',p_patient_id,'requires_manual_review',false,'manually_confirmed',true,
      'status','ready_for_admission','version',2,'updated_date',stamp);
  end if;
  if octet_length(v::text)>4096 then raise exception using errcode='22023',message='PENNSYNC_S3_RESULT_LIMIT'; end if;
  if p_action='create' then
    insert into pennsync_private.s3_referral values(p_app_id,vid,p_agency_id,p_patient_id,(c->>'auth_user_id')::uuid,p_request_id,1,v);
  else
    update pennsync_private.s3_referral set version=2,data=v where app_id=p_app_id and agency_id=p_agency_id
      and patient_id=p_patient_id and id=vid and version=1;
    if not found then raise exception using errcode='PT409',message='PENNSYNC_S3_REFERRAL_VERSION_CHANGED'; end if;
  end if;
  insert into pennsync_private.s3_receipt values(p_app_id,(c->>'auth_user_id')::uuid,p_request_id,p_agency_id,p_patient_id,
    vid,p_action,payload,v,pennsync_private.s3_hash(payload),pennsync_private.s3_hash(v)) returning * into r;
  return pennsync_private.s3_result(r,c,false);
end $$;
create function pennsync_private.s3_create(p_app_id text,p_agency_id text,p_patient_id text,
  p_expected_actor_version bigint,p_expected_patient_version bigint,p_request_id uuid,p_fields jsonb) returns jsonb
language sql security definer set search_path='' as $$
  select pennsync_private.s3_write(p_app_id,p_agency_id,p_patient_id,p_expected_actor_version,p_expected_patient_version,p_request_id,'create',null,null,p_fields);
$$;
create function pennsync_private.s3_confirm(p_app_id text,p_agency_id text,p_patient_id text,
  p_expected_actor_version bigint,p_expected_patient_version bigint,p_referral_id uuid,p_expected_referral_version integer,p_request_id uuid) returns jsonb
language sql security definer set search_path='' as $$
  select pennsync_private.s3_write(p_app_id,p_agency_id,p_patient_id,p_expected_actor_version,p_expected_patient_version,p_request_id,'confirm',p_referral_id,p_expected_referral_version,null);
$$;
create function pennsync_private.s3_read(p_app_id text,p_agency_id text,p_patient_id text,
  p_expected_actor_version bigint,p_expected_patient_version bigint,p_referral_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c jsonb; v jsonb;
begin
  c:=pennsync_private.s3_scope(p_app_id,p_agency_id,p_patient_id,p_expected_actor_version,p_expected_patient_version,false);
  v:=pennsync_private.s3_current(p_app_id,p_agency_id,p_patient_id,p_referral_id);
  return jsonb_build_object('contract','cm.pennsync.s3-referral.staging.v1','staging',true,'synthetic',true,
    'app_id',p_app_id,'action','read','context',c,'referral',v,'referral_sha256',pennsync_private.s3_hash(v));
end $$;
create function public.pennsync_staging_s3_create(p_app_id text,p_agency_id text,p_patient_id text,
  p_expected_actor_version bigint,p_expected_patient_version bigint,p_request_id uuid,p_fields jsonb) returns jsonb
language sql security invoker set search_path='' as $$
  select pennsync_private.s3_create(p_app_id,p_agency_id,p_patient_id,p_expected_actor_version,p_expected_patient_version,p_request_id,p_fields);
$$;
create function public.pennsync_staging_s3_confirm(p_app_id text,p_agency_id text,p_patient_id text,
  p_expected_actor_version bigint,p_expected_patient_version bigint,p_referral_id uuid,p_expected_referral_version integer,p_request_id uuid) returns jsonb
language sql security invoker set search_path='' as $$
  select pennsync_private.s3_confirm(p_app_id,p_agency_id,p_patient_id,p_expected_actor_version,p_expected_patient_version,p_referral_id,p_expected_referral_version,p_request_id);
$$;
create function public.pennsync_staging_s3_read(p_app_id text,p_agency_id text,p_patient_id text,
  p_expected_actor_version bigint,p_expected_patient_version bigint,p_referral_id uuid) returns jsonb
language sql security invoker set search_path='' as $$
  select pennsync_private.s3_read(p_app_id,p_agency_id,p_patient_id,p_expected_actor_version,p_expected_patient_version,p_referral_id);
$$;
revoke all on function pennsync_private.s3_immutable(),pennsync_private.s3_transition(),pennsync_private.s3_hash(jsonb),
  pennsync_private.s3_scope(text,text,text,bigint,bigint,boolean),pennsync_private.s3_fields(jsonb),
  pennsync_private.s3_current(text,text,text,uuid),pennsync_private.s3_result(pennsync_private.s3_receipt,jsonb,boolean),
  pennsync_private.s3_write(text,text,text,bigint,bigint,uuid,text,uuid,integer,jsonb),
  pennsync_private.s3_create(text,text,text,bigint,bigint,uuid,jsonb),pennsync_private.s3_confirm(text,text,text,bigint,bigint,uuid,integer,uuid),
  pennsync_private.s3_read(text,text,text,bigint,bigint,uuid),public.pennsync_staging_s3_create(text,text,text,bigint,bigint,uuid,jsonb),
  public.pennsync_staging_s3_confirm(text,text,text,bigint,bigint,uuid,integer,uuid),public.pennsync_staging_s3_read(text,text,text,bigint,bigint,uuid)
  from public,anon,authenticated,service_role;
grant execute on function pennsync_private.s3_create(text,text,text,bigint,bigint,uuid,jsonb),
  pennsync_private.s3_confirm(text,text,text,bigint,bigint,uuid,integer,uuid),pennsync_private.s3_read(text,text,text,bigint,bigint,uuid),
  public.pennsync_staging_s3_create(text,text,text,bigint,bigint,uuid,jsonb),public.pennsync_staging_s3_confirm(text,text,text,bigint,bigint,uuid,integer,uuid),
  public.pennsync_staging_s3_read(text,text,text,bigint,bigint,uuid) to authenticated;
commit;
