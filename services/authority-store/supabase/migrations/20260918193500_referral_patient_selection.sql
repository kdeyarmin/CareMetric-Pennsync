-- Intake patient selection: managers are agency-wide; office staff require an
-- active assignment. This does not widen the existing clinical roster contract.
begin;
do $$ begin
  if not exists(select 1 from pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then
    raise exception using errcode='42501',message='PENNSYNC_BYPASSRLS_MIGRATION_OWNER_REQUIRED';
  end if;
end $$;

create function pennsync_private.referral_patient_value(p_app_id text,p_agency_id text,p_patient_id text,p_context jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p pennsync_private.patient; a pennsync_private.assignment;
begin
  if p_context->>'tenant_role' not in ('agency_admin','manager','office_staff') or p_patient_id is null
    or p_patient_id !~ '^[A-Za-z0-9_-]{1,128}$' then
    raise exception using errcode='42501',message='PENNSYNC_REFERRAL_PATIENT_DENIED';
  end if;
  select * into p from pennsync_private.patient where app_id=p_app_id and agency_id=p_agency_id
    and id=p_patient_id and synthetic and status='active' for share;
  if not found then raise exception using errcode='42501',message='PENNSYNC_REFERRAL_PATIENT_DENIED'; end if;
  if p_context->>'tenant_role'='office_staff' then
    select * into a from pennsync_private.assignment where app_id=p_app_id and agency_id=p_agency_id
      and patient_id=p_patient_id and membership_id=p_context->>'membership_id' and status='active' for share;
    if not found then raise exception using errcode='42501',message='PENNSYNC_REFERRAL_PATIENT_DENIED'; end if;
  end if;
  return jsonb_build_object('id',p.id,'agency_id',p.agency_id,'display_name',p.display_name,'version',p.version,'synthetic',p.synthetic);
end $$;

create function pennsync_private.referral_patient(p_app_id text,p_agency_id text,p_patient_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i pennsync_private.identity_map; c jsonb; p jsonb;
begin
  i:=pennsync_private.actor(p_app_id,false); c:=pennsync_private.context_value(i,p_agency_id);
  p:=pennsync_private.referral_patient_value(p_app_id,p_agency_id,p_patient_id,c);
  return jsonb_build_object('contract','cm.pennsync.authority.staging.v1','staging',true,'synthetic',true,
    'app_id',p_app_id,'auth_user_id',i.auth_user_id,'context',c,'patient',p);
end $$;

create function pennsync_private.referral_patients(p_app_id text,p_agency_id text,p_limit integer,p_after_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i pennsync_private.identity_map; c jsonb; row_id text; rows jsonb:='[]'::jsonb; next_id text;
begin
  i:=pennsync_private.actor(p_app_id,false); c:=pennsync_private.context_value(i,p_agency_id);
  if c->>'tenant_role' not in ('agency_admin','manager','office_staff') then
    raise exception using errcode='42501',message='PENNSYNC_REFERRAL_PATIENT_DENIED';
  end if;
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception using errcode='22023',message='PENNSYNC_INVALID_PAGE';
  end if;
  if p_after_id is not null then perform pennsync_private.referral_patient_value(p_app_id,p_agency_id,p_after_id,c); end if;
  for row_id in select p.id from pennsync_private.patient p where p.app_id=p_app_id and p.agency_id=p_agency_id
    and p.synthetic and p.status='active' and (p_after_id is null or p.id>p_after_id)
    and (c->>'tenant_role' in ('agency_admin','manager') or exists(select 1 from pennsync_private.assignment a
      where a.app_id=p_app_id and a.agency_id=p_agency_id and a.patient_id=p.id and a.membership_id=c->>'membership_id' and a.status='active'))
    order by p.id limit p_limit+1 for share of p loop
    if jsonb_array_length(rows)=p_limit then next_id:=rows->(p_limit-1)->>'id'; exit; end if;
    rows:=rows || jsonb_build_array(pennsync_private.referral_patient_value(p_app_id,p_agency_id,row_id,c));
  end loop;
  return jsonb_build_object('contract','cm.pennsync.authority.staging.v1','staging',true,'synthetic',true,
    'app_id',p_app_id,'auth_user_id',i.auth_user_id,'context',c,'items',rows,'next_cursor',next_id);
end $$;

create function public.pennsync_staging_referral_patient(p_app_id text,p_agency_id text,p_patient_id text)
returns jsonb language sql volatile security invoker set search_path='' as $$
  select pennsync_private.referral_patient(p_app_id,p_agency_id,p_patient_id);
$$;
create function public.pennsync_staging_referral_patients(p_app_id text,p_agency_id text,p_limit integer,p_after_id text)
returns jsonb language sql volatile security invoker set search_path='' as $$
  select pennsync_private.referral_patients(p_app_id,p_agency_id,p_limit,p_after_id);
$$;
revoke all on function pennsync_private.referral_patient_value(text,text,text,jsonb),
  pennsync_private.referral_patient(text,text,text),pennsync_private.referral_patients(text,text,integer,text),
  public.pennsync_staging_referral_patient(text,text,text),public.pennsync_staging_referral_patients(text,text,integer,text)
  from public,anon,authenticated,service_role;
grant execute on function pennsync_private.referral_patient(text,text,text),pennsync_private.referral_patients(text,text,integer,text),
  public.pennsync_staging_referral_patient(text,text,text),public.pennsync_staging_referral_patients(text,text,integer,text) to authenticated;
-- Selection is not a write capability. Recheck assignment inside every S3
-- create, confirm, read and receipt-replay transaction, in the same lock order.
create or replace function pennsync_private.s3_scope(p_app_id text,p_agency_id text,p_patient_id text,
  p_expected_actor_version bigint,p_expected_patient_version bigint,p_write boolean) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare i pennsync_private.identity_map; c jsonb; p pennsync_private.patient; a pennsync_private.assignment;
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
  if c->>'tenant_role'='office_staff' then
    select * into a from pennsync_private.assignment where app_id=p_app_id and agency_id=p_agency_id
      and patient_id=p_patient_id and membership_id=c->>'membership_id' and status='active' for share;
    if not found then raise exception using errcode='42501',message='PENNSYNC_REFERRAL_PATIENT_DENIED'; end if;
  end if;
  return c;
end $$;
commit;
