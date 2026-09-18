-- Patient-scoped discovery of existing immutable synthetic visits.
begin;
do $$ begin
  if not exists(select 1 from pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then
    raise exception using errcode='42501',message='PENNSYNC_BYPASSRLS_MIGRATION_OWNER_REQUIRED';
  end if;
end $$;
create table pennsync_private.visit_list_disclosure_audit (
  id uuid primary key default gen_random_uuid(),
  app_id pennsync_private.staging_app not null,
  actor_id uuid not null,
  agency_id pennsync_private.identifier not null,
  membership_id pennsync_private.identifier not null,
  membership_version pennsync_private.revision not null,
  tenant_role text not null check(tenant_role in ('agency_admin','clinician')),
  patient_id pennsync_private.identifier not null,
  access_basis text not null check(access_basis in ('agency_wide','care_team_assignment')),
  assignment_id uuid,
  assignment_version pennsync_private.revision,
  purpose text not null check(purpose='schedule'),
  status_filter text check(status_filter='completed'),
  after_id uuid,
  page_size integer not null check(page_size between 1 and 50),
  visit_ids uuid[] not null check(cardinality(visit_ids)<=50),
  has_more boolean not null,
  created_at timestamptz not null default clock_timestamp(),
  check((tenant_role='agency_admin' and access_basis='agency_wide' and assignment_id is null and assignment_version is null)
    or (tenant_role='clinician' and access_basis='care_team_assignment' and assignment_id is not null and assignment_version is not null))
);
alter table pennsync_private.visit_list_disclosure_audit enable row level security;
alter table pennsync_private.visit_list_disclosure_audit force row level security;
revoke all on pennsync_private.visit_list_disclosure_audit from public,anon,authenticated,service_role;
create trigger immutable before update or delete on pennsync_private.visit_list_disclosure_audit
  for each row execute function pennsync_private.visit_disclosure_immutable();
create index s4_visit_patient_discovery on pennsync_private.s4_visit(app_id,agency_id,patient_id,id);

create function pennsync_private.visits_schedule(p_app_id text,p_agency_id text,p_patient_id text,
  p_status text,p_page_size integer,p_cursor jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare i pennsync_private.identity_map; c jsonb; p pennsync_private.patient; a pennsync_private.assignment;
  v pennsync_private.s4_visit; r pennsync_private.s4_create_receipt; source jsonb;
  scope jsonb; cursor_value jsonb; result jsonb; projected jsonb; rows jsonb:='[]'::jsonb;
  ids uuid[]:='{}'::uuid[]; anchor uuid; more boolean:=false; basis text;
  keys text[]:=array['id','patient_id','visit_date','visit_type','status','updated_date'];
begin
  i:=pennsync_private.actor(p_app_id,false); c:=pennsync_private.context_value(i,p_agency_id);
  if p_page_size is null or p_page_size not between 1 and 50 or (p_status is not null and p_status<>'completed')
    or p_patient_id is null or c->>'tenant_role' not in ('agency_admin','clinician') then
    raise exception using errcode='42501',message='PENNSYNC_VISIT_LIST_DENIED';
  end if;
  select * into p from pennsync_private.patient where app_id=p_app_id and agency_id=p_agency_id
    and id=p_patient_id and synthetic and status='active' for share;
  if not found then raise exception using errcode='42501',message='PENNSYNC_VISIT_LIST_DENIED'; end if;
  if c->>'tenant_role'='clinician' then
    select * into a from pennsync_private.assignment where app_id=p_app_id and agency_id=p_agency_id
      and patient_id=p_patient_id and membership_id=c->>'membership_id' and status='active' for share;
    if not found then raise exception using errcode='42501',message='PENNSYNC_VISIT_LIST_DENIED'; end if;
    basis:='care_team_assignment';
  else basis:='agency_wide'; end if;
  scope:=jsonb_build_object('agency_id',p_agency_id,'membership_id',c->>'membership_id',
    'membership_version',(c->>'membership_version')::bigint,'tenant_role',c->>'tenant_role',
    'patient_id',p_patient_id,'access_basis',basis,'assignment_id',a.id,'assignment_version',a.version);
  cursor_value:=scope || jsonb_build_object('version',1,'after_id',null,'purpose','schedule',
    'status',p_status,'sort','id_asc','page_size',p_page_size,'subject_user_id',c->>'user_id');
  if p_cursor is not null then
    if jsonb_typeof(p_cursor)<>'object' or jsonb_typeof(p_cursor->'after_id') is distinct from 'string'
      or (p_cursor->>'after_id') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
      or p_cursor is distinct from (cursor_value || jsonb_build_object('after_id',p_cursor->'after_id')) then
      raise exception using errcode='42501',message='PENNSYNC_VISIT_CURSOR_CHANGED';
    end if;
    anchor:=(p_cursor->>'after_id')::uuid;
    if not exists(select 1 from pennsync_private.s4_visit where app_id=p_app_id and agency_id=p_agency_id
      and patient_id=p_patient_id and id=anchor) then
      raise exception using errcode='42501',message='PENNSYNC_VISIT_CURSOR_CHANGED';
    end if;
  end if;
  for v in select * from pennsync_private.s4_visit where app_id=p_app_id and agency_id=p_agency_id
    and patient_id=p_patient_id and (anchor is null or id>anchor)
    order by id limit p_page_size+1 for share loop
    if cardinality(ids)=p_page_size then more:=true; exit; end if;
    select * into r from pennsync_private.s4_create_receipt where app_id=p_app_id and agency_id=p_agency_id
      and patient_id=p_patient_id and visit_id=v.id and actor_id=v.actor_id for share;
    if not found then raise exception using errcode='PT409',message='PENNSYNC_S4_ARTIFACTS_CHANGED'; end if;
    source:=pennsync_private.s4_artifacts(r)->'visit';
    if not source ?& keys or source->>'id' is distinct from v.id::text
      or source->>'patient_id' is distinct from p_patient_id or source->>'status' is distinct from 'completed'
      or source->>'visit_type' is distinct from 'skilled_nursing' then
      raise exception using errcode='PT409',message='PENNSYNC_S4_ARTIFACTS_CHANGED';
    end if;
    select jsonb_object_agg(key,value) into projected from jsonb_each(source) where key=any(keys);
    rows:=rows || jsonb_build_array(projected); ids:=array_append(ids,v.id);
  end loop;
  result:=jsonb_build_object('contract','cm.pennsync.authority.staging.v1','staging',true,'synthetic',true,
    'app_id',p_app_id,'auth_user_id',i.auth_user_id,'context',c,'purpose','schedule','visits',rows,'scope',scope,
    'page',jsonb_build_object('page_size',p_page_size,'sort','id_asc','after_id',anchor,'has_more',more,
      'next_cursor',case when more then cursor_value || jsonb_build_object('after_id',ids[cardinality(ids)]) else null end));
  if octet_length(convert_to(result::text,'UTF8'))>1048576 then
    raise exception using errcode='22023',message='PENNSYNC_VISIT_LIST_RESPONSE_LIMIT';
  end if;
  begin
    insert into pennsync_private.visit_list_disclosure_audit(app_id,actor_id,agency_id,membership_id,membership_version,
      tenant_role,patient_id,access_basis,assignment_id,assignment_version,purpose,status_filter,after_id,page_size,visit_ids,has_more)
    values(p_app_id,i.auth_user_id,p_agency_id,c->>'membership_id',(c->>'membership_version')::bigint,
      c->>'tenant_role',p_patient_id,basis,a.id,a.version,'schedule',p_status,anchor,p_page_size,ids,more);
  exception when others then raise exception using errcode='PT503',message='PENNSYNC_VISIT_LIST_AUDIT_UNAVAILABLE'; end;
  return result;
end $$;
create function public.pennsync_staging_visits_schedule(p_app_id text,p_agency_id text,p_patient_id text,
  p_status text,p_page_size integer,p_cursor jsonb) returns jsonb
language sql volatile security invoker set search_path='' as $$
  select pennsync_private.visits_schedule(p_app_id,p_agency_id,p_patient_id,p_status,p_page_size,p_cursor);
$$;
revoke all on function pennsync_private.visits_schedule(text,text,text,text,integer,jsonb),
  public.pennsync_staging_visits_schedule(text,text,text,text,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function pennsync_private.visits_schedule(text,text,text,text,integer,jsonb),
  public.pennsync_staging_visits_schedule(text,text,text,text,integer,jsonb) to authenticated;
commit;
