-- Finite synthetic S4 documentation read under CURRENT authority, independent of
-- the creator's request receipt. No chart/history/provider migration or source import.
begin;
do $$ begin
  if not exists(select 1 from pg_catalog.pg_roles where rolname=current_user
    and (rolsuper or rolbypassrls)) then
    raise exception using errcode='42501',message='PENNSYNC_BYPASSRLS_MIGRATION_OWNER_REQUIRED';
  end if;
end $$;

-- Persisted synthetic assignment identity; this does not claim a Base44 source ID.
alter table pennsync_private.assignment add column id uuid
  not null default gen_random_uuid();
alter table pennsync_private.assignment add unique(app_id,id);
create function pennsync_private.assignment_provenance_immutable() returns trigger
language plpgsql security invoker set search_path='' as $$ begin
  if tg_op='DELETE' then
    raise exception using errcode='23514',message='PENNSYNC_ASSIGNMENT_PROVENANCE_IMMUTABLE';
  end if;
  if (new.id,new.app_id,new.agency_id,new.patient_id,new.membership_id)
    is distinct from (old.id,old.app_id,old.agency_id,old.patient_id,old.membership_id) then
    raise exception using errcode='23514',message='PENNSYNC_ASSIGNMENT_PROVENANCE_IMMUTABLE';
  end if;
  return new;
end $$;
create trigger provenance_immutable before update or delete on pennsync_private.assignment
  for each row execute function pennsync_private.assignment_provenance_immutable();

-- Deliberately no patient FK: immutable disclosure provenance must survive source
-- lifecycle changes and must not create a cascading patient-delete path.
create table pennsync_private.visit_disclosure_audit (
  id uuid primary key default gen_random_uuid(),
  app_id pennsync_private.staging_app not null,
  actor_id uuid not null,
  agency_id pennsync_private.identifier not null,
  membership_id pennsync_private.identifier not null,
  membership_version pennsync_private.revision not null,
  tenant_role text not null check(tenant_role in ('agency_admin','clinician')),
  patient_id pennsync_private.identifier not null,
  visit_id uuid not null,
  purpose text not null check(purpose='documentation'),
  access_basis text not null check(access_basis in ('agency_wide','care_team_assignment')),
  assignment_id uuid,
  assignment_version pennsync_private.revision,
  created_at timestamptz not null default clock_timestamp(),
  check((tenant_role='agency_admin' and access_basis='agency_wide' and assignment_id is null and assignment_version is null)
    or (tenant_role='clinician' and access_basis='care_team_assignment' and assignment_id is not null and assignment_version is not null))
);
alter table pennsync_private.visit_disclosure_audit enable row level security;
alter table pennsync_private.visit_disclosure_audit force row level security;
revoke all on pennsync_private.visit_disclosure_audit from public,anon,authenticated,service_role;
create function pennsync_private.visit_disclosure_immutable() returns trigger
language plpgsql security invoker set search_path='' as $$ begin
  raise exception using errcode='23514',message='PENNSYNC_VISIT_DISCLOSURE_IMMUTABLE';
end $$;
create trigger immutable before update or delete on pennsync_private.visit_disclosure_audit
  for each row execute function pennsync_private.visit_disclosure_immutable();

create function pennsync_private.visit_documentation(p_app_id text,p_agency_id text,p_visit_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare i pennsync_private.identity_map; c jsonb; p pennsync_private.patient;
  a pennsync_private.assignment; r pennsync_private.s4_create_receipt;
  v pennsync_private.s4_visit; source jsonb; projected jsonb; scope jsonb; result jsonb;
  target_patient text; basis text; keys text[] := array['id','patient_id','visit_date','visit_type','status',
    'nurse_notes','raw_transcription','vital_signs','documentation_source','grounding_pending',
    'emr_handoff_status','emr_handoff_history','updated_date'];
begin
  -- Shared application lock plus current native user/session/identity row locks.
  -- Revocation uses the matching exclusive lock; neither ordering exposes stale scope.
  i := pennsync_private.actor(p_app_id,false);
  c := pennsync_private.context_value(i,p_agency_id);
  if p_visit_id is null or c->>'tenant_role' not in ('agency_admin','clinician') then
    raise exception using errcode='42501',message='PENNSYNC_VISIT_DENIED';
  end if;
  -- Only internal metadata resolves the patient; caller-supplied patient IDs are absent.
  select patient_id into target_patient from pennsync_private.s4_visit where app_id=p_app_id
    and agency_id=p_agency_id and id=p_visit_id;
  if not found then raise exception using errcode='42501',message='PENNSYNC_VISIT_DENIED'; end if;
  select * into p from pennsync_private.patient where app_id=p_app_id
    and agency_id=p_agency_id and id=target_patient and synthetic and status='active' for share;
  if not found then raise exception using errcode='42501',message='PENNSYNC_VISIT_DENIED'; end if;
  if c->>'tenant_role'='clinician' then
    select * into a from pennsync_private.assignment where app_id=p_app_id
      and agency_id=p_agency_id and patient_id=p.id and membership_id=c->>'membership_id'
      and status='active' for share;
    if not found then raise exception using errcode='42501',message='PENNSYNC_VISIT_DENIED'; end if;
    basis := 'care_team_assignment';
  else basis := 'agency_wide'; end if;
  select * into v from pennsync_private.s4_visit where app_id=p_app_id
    and agency_id=p_agency_id and patient_id=p.id and id=p_visit_id for share;
  if not found then raise exception using errcode='42501',message='PENNSYNC_VISIT_DENIED'; end if;
  select * into r from pennsync_private.s4_create_receipt where app_id=p_app_id
    and agency_id=p_agency_id and patient_id=p.id and visit_id=p_visit_id and actor_id=v.actor_id for share;
  if not found then raise exception using errcode='PT409',message='PENNSYNC_S4_ARTIFACTS_CHANGED'; end if;
  -- Verify all immutable creator artifacts without requiring the caller to be their author.
  source := pennsync_private.s4_artifacts(r)->'visit';
  if not source ?& keys or source->>'id' is distinct from p_visit_id::text
    or source->>'patient_id' is distinct from p.id::text then
    raise exception using errcode='PT409',message='PENNSYNC_S4_ARTIFACTS_CHANGED';
  end if;
  select jsonb_object_agg(key,value) into projected from jsonb_each(source) where key=any(keys);
  scope := jsonb_build_object('agency_id',p_agency_id,'membership_id',c->>'membership_id',
    'membership_version',(c->>'membership_version')::bigint,'tenant_role',c->>'tenant_role',
    'patient_id',p.id,'access_basis',basis,'assignment_id',a.id,'assignment_version',a.version);
  result := jsonb_build_object('contract','cm.pennsync.authority.staging.v1','staging',true,'synthetic',true,
    'app_id',p_app_id,'auth_user_id',i.auth_user_id,'context',c,'purpose','documentation','visit',projected,'scope',scope);
  if octet_length(convert_to(result::text,'UTF8'))>2500000 then
    raise exception using errcode='22023',message='PENNSYNC_VISIT_RESPONSE_LIMIT';
  end if;
  -- The insert and response share one transaction. An audit failure withholds PHI.
  begin
    insert into pennsync_private.visit_disclosure_audit(app_id,actor_id,agency_id,membership_id,membership_version,
      tenant_role,patient_id,visit_id,purpose,access_basis,assignment_id,assignment_version)
    values(p_app_id,i.auth_user_id,p_agency_id,c->>'membership_id',(c->>'membership_version')::bigint,
      c->>'tenant_role',p.id,p_visit_id,'documentation',basis,a.id,a.version);
  exception when others then
    raise exception using errcode='PT503',message='PENNSYNC_VISIT_AUDIT_UNAVAILABLE';
  end;
  return result;
end $$;

create function public.pennsync_staging_visit_documentation(p_app_id text,p_agency_id text,p_visit_id uuid)
returns jsonb language sql volatile security invoker set search_path='' as $$
  select pennsync_private.visit_documentation(p_app_id,p_agency_id,p_visit_id);
$$;
revoke all on function pennsync_private.assignment_provenance_immutable(),
  pennsync_private.visit_disclosure_immutable(),pennsync_private.visit_documentation(text,text,uuid),
  public.pennsync_staging_visit_documentation(text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function pennsync_private.visit_documentation(text,text,uuid),
  public.pennsync_staging_visit_documentation(text,text,uuid) to authenticated;
comment on function public.pennsync_staging_visit_documentation(text,text,uuid) is
  'Current-authority, audited documentation projection of one synthetic S4 Visit only; POST required.';
commit;
