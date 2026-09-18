-- Explicit fictional patient context, not an inferred chart or customer importer.
begin;
do $$ begin
  if not exists(select 1 from pg_catalog.pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then
    raise exception using errcode='42501',message='PENNSYNC_BYPASSRLS_MIGRATION_OWNER_REQUIRED';
  end if;
end $$;

create function pennsync_private.patient_context_valid(p_patient_id text,p_data jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare k text; item jsonb; value text; d date; stamp timestamptz;
  fields text[]:=array['id','first_name','middle_name','last_name','date_of_birth','medical_record_number',
    'status','care_type','primary_diagnosis','secondary_diagnoses','chronic_conditions','past_medical_history',
    'current_medications','allergies','functional_status','wounds','enhanced_notes_history','clinical_notes','updated_date'];
begin
  if p_patient_id is null or p_data is null or jsonb_typeof(p_data)<>'object'
    or octet_length(convert_to(p_data::text,'UTF8'))>900000
    or not p_data ?& array['id','first_name','last_name'] or p_data-fields<>'{}'::jsonb
    or p_data->>'id' is distinct from p_patient_id or jsonb_typeof(p_data->'id')<>'string' then return false; end if;
  for k,item in select entry.key,entry.value from jsonb_each(p_data) entry loop
    if k='id' then continue;
    elsif k in ('first_name','last_name') then
      value:=item#>>'{}';
      if jsonb_typeof(item)<>'string' or value='' or pennsync_private.s4_utf16_length(value)>200
        or btrim(value,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')<>value then return false; end if;
    elsif k in ('middle_name','medical_record_number','primary_diagnosis','allergies','clinical_notes') then
      if jsonb_typeof(item)<>'string' then return false; end if;
    elsif k='status' then
      if item not in ('"active"'::jsonb,'"hospitalized"'::jsonb,'"discharged"'::jsonb) then return false; end if;
    elsif k='care_type' then
      if item not in ('"home_health"'::jsonb,'"hospice"'::jsonb) then return false; end if;
    elsif k='date_of_birth' then
      value:=item#>>'{}';
      if jsonb_typeof(item)<>'string' or value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or left(value,4)='0000' then return false; end if;
      begin d:=value::date;
      exception when datetime_field_overflow or invalid_datetime_format then return false; end;
      if to_char(d,'YYYY-MM-DD')<>value then return false; end if;
    elsif k='updated_date' then
      value:=item#>>'{}';
      if jsonb_typeof(item)<>'string' or value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
        or left(value,4)='0000' then return false; end if;
      begin stamp:=value::timestamptz;
      exception when datetime_field_overflow or invalid_datetime_format then return false; end;
      if to_char(stamp at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>value then return false; end if;
    elsif k in ('secondary_diagnoses','past_medical_history') then
      if jsonb_typeof(item)<>'array' then return false; end if;
      if exists(select 1 from jsonb_array_elements(item) e where jsonb_typeof(e)<>'string') then return false; end if;
    elsif k in ('chronic_conditions','current_medications','wounds','enhanced_notes_history') then
      if jsonb_typeof(item)<>'array' then return false; end if;
      if jsonb_array_length(item)>(case when k='enhanced_notes_history' then 5000 else 500 end)
        or exists(select 1 from jsonb_array_elements(item) e where jsonb_typeof(e)<>'object') then return false; end if;
    elsif k='functional_status' then
      if jsonb_typeof(item)<>'object' then return false; end if;
    else return false;
    end if;
  end loop;
  return true;
end $$;

create table pennsync_private.patient_context (
  app_id pennsync_private.staging_app not null,
  agency_id pennsync_private.identifier not null,
  patient_id pennsync_private.identifier not null,
  version pennsync_private.revision not null default 1,
  provenance_kind text not null check(provenance_kind='synthetic_fixture'),
  provenance_sha256 text not null check(provenance_sha256 ~ '^[a-f0-9]{64}$'),
  data jsonb not null check(pennsync_private.patient_context_valid(patient_id,data) is true),
  data_sha256 text not null constraint patient_context_data_sha256_check check(data_sha256=encode(sha256(convert_to(data::text,'UTF8')),'hex')),
  created_at timestamptz not null default clock_timestamp(),
  primary key(app_id,patient_id),
  foreign key(app_id,agency_id,patient_id) references pennsync_private.patient(app_id,agency_id,id) on delete no action
);
comment on table pennsync_private.patient_context is
  'Immutable explicit fictional context only. data_sha256 binds stored canonical JSONB, not original source bytes. No customer import or write API.';

create table pennsync_private.patient_disclosure_audit (
  id uuid primary key default gen_random_uuid(),
  app_id pennsync_private.staging_app not null,
  actor_id uuid not null,
  agency_id pennsync_private.identifier not null,
  membership_id pennsync_private.identifier not null,
  membership_version pennsync_private.revision not null,
  tenant_role text not null check(tenant_role in ('agency_admin','clinician')),
  patient_id pennsync_private.identifier not null,
  context_version pennsync_private.revision not null,
  context_sha256 text not null check(context_sha256 ~ '^[a-f0-9]{64}$'),
  purpose text not null check(purpose in ('display','smart_note_context')),
  access_basis text not null check(access_basis in ('agency_wide','care_team_assignment')),
  assignment_id uuid,
  assignment_version pennsync_private.revision,
  created_at timestamptz not null default clock_timestamp(),
  check((tenant_role='agency_admin' and access_basis='agency_wide' and assignment_id is null and assignment_version is null)
    or (tenant_role='clinician' and access_basis='care_team_assignment' and assignment_id is not null and assignment_version is not null))
);
create function pennsync_private.patient_context_immutable() returns trigger
language plpgsql security invoker set search_path='' as $$ begin
  raise exception using errcode='23514',message='PENNSYNC_PATIENT_CONTEXT_IMMUTABLE';
end $$;
do $$ declare t text; begin
  foreach t in array array['patient_context','patient_disclosure_audit'] loop
    execute format('alter table pennsync_private.%I enable row level security',t);
    execute format('alter table pennsync_private.%I force row level security',t);
    execute format('revoke all on pennsync_private.%I from public,anon,authenticated,service_role',t);
    execute format('create trigger immutable before update or delete on pennsync_private.%I for each row execute function pennsync_private.patient_context_immutable()',t);
  end loop;
end $$;

create function pennsync_private.patient_context_read(p_app_id text,p_agency_id text,p_patient_id text,p_purpose text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare i pennsync_private.identity_map; c jsonb; p pennsync_private.patient;
  a pennsync_private.assignment; stored pennsync_private.patient_context;
  projected jsonb; scope jsonb; result jsonb; basis text;
begin
  i:=pennsync_private.actor(p_app_id,false);
  c:=pennsync_private.context_value(i,p_agency_id);
  if p_purpose is null or p_purpose not in ('display','smart_note_context')
    or c->>'tenant_role' not in ('agency_admin','clinician') then
    raise exception using errcode='42501',message='PENNSYNC_PATIENT_CONTEXT_DENIED';
  end if;
  select * into p from pennsync_private.patient where app_id=p_app_id and agency_id=p_agency_id
    and id=p_patient_id and synthetic and status='active' for share;
  if not found then raise exception using errcode='42501',message='PENNSYNC_PATIENT_CONTEXT_DENIED'; end if;
  if c->>'tenant_role'='clinician' then
    select * into a from pennsync_private.assignment where app_id=p_app_id and agency_id=p_agency_id
      and patient_id=p_patient_id and membership_id=c->>'membership_id' and status='active' for share;
    if not found then raise exception using errcode='42501',message='PENNSYNC_PATIENT_CONTEXT_DENIED'; end if;
    basis:='care_team_assignment';
  else basis:='agency_wide'; end if;
  select * into stored from pennsync_private.patient_context where app_id=p_app_id
    and agency_id=p_agency_id and patient_id=p_patient_id for share;
  if not found or pennsync_private.patient_context_valid(p_patient_id,stored.data) is not true
    or stored.data_sha256 is distinct from encode(sha256(convert_to(stored.data::text,'UTF8')),'hex')
    or (p_purpose='smart_note_context' and not stored.data ?& array['status','updated_date']) then
    raise exception using errcode='42501',message='PENNSYNC_PATIENT_CONTEXT_UNAVAILABLE';
  end if;
  if p_purpose='display' then
    select jsonb_object_agg(key,value) into projected from jsonb_each(stored.data)
      where key=any(array['id','first_name','middle_name','last_name']);
  else projected:=stored.data; end if;
  scope:=jsonb_build_object('agency_id',p_agency_id,'membership_id',c->>'membership_id',
    'membership_version',(c->>'membership_version')::bigint,'tenant_role',c->>'tenant_role');
  result:=jsonb_build_object('contract','cm.pennsync.authority.staging.v1','staging',true,'synthetic',true,
    'app_id',p_app_id,'auth_user_id',i.auth_user_id,'context',c,'purpose',p_purpose,'patient',projected,'scope',scope);
  if octet_length(convert_to(result::text,'UTF8'))>1048576 then
    raise exception using errcode='22023',message='PENNSYNC_PATIENT_CONTEXT_RESPONSE_LIMIT';
  end if;
  begin
    insert into pennsync_private.patient_disclosure_audit(app_id,actor_id,agency_id,membership_id,membership_version,
      tenant_role,patient_id,context_version,context_sha256,purpose,access_basis,assignment_id,assignment_version)
    values(p_app_id,i.auth_user_id,p_agency_id,c->>'membership_id',(c->>'membership_version')::bigint,
      c->>'tenant_role',p_patient_id,stored.version,stored.data_sha256,p_purpose,basis,a.id,a.version);
  exception when others then
    raise exception using errcode='PT503',message='PENNSYNC_PATIENT_AUDIT_UNAVAILABLE';
  end;
  return result;
end $$;
create function public.pennsync_staging_patient_context(p_app_id text,p_agency_id text,p_patient_id text,p_purpose text)
returns jsonb language sql volatile security invoker set search_path='' as $$
  select pennsync_private.patient_context_read(p_app_id,p_agency_id,p_patient_id,p_purpose);
$$;
revoke all on function pennsync_private.patient_context_valid(text,jsonb),pennsync_private.patient_context_immutable(),
  pennsync_private.patient_context_read(text,text,text,text),public.pennsync_staging_patient_context(text,text,text,text)
  from public,anon,authenticated,service_role;
grant execute on function pennsync_private.patient_context_read(text,text,text,text),
  public.pennsync_staging_patient_context(text,text,text,text) to authenticated;
commit;
