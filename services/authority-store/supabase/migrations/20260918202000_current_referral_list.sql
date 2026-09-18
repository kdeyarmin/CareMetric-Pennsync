-- Current, bounded existing-patient referral discovery. No new write surface.
begin;
do $$ begin
  if not exists(select 1 from pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then
    raise exception using errcode='42501',message='PENNSYNC_BYPASSRLS_MIGRATION_OWNER_REQUIRED';
  end if;
end $$;
create function pennsync_private.s3_list(p_app_id text,p_agency_id text,p_patient_id text,
  p_expected_actor_version bigint,p_expected_patient_version bigint,p_limit integer,p_after_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c jsonb; v jsonb; row_id uuid; items jsonb:='[]'::jsonb; next_id uuid;
begin
  c:=pennsync_private.s3_scope(p_app_id,p_agency_id,p_patient_id,p_expected_actor_version,p_expected_patient_version,false);
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception using errcode='22023',message='PENNSYNC_INVALID_PAGE';
  end if;
  if p_after_id is not null then perform pennsync_private.s3_current(p_app_id,p_agency_id,p_patient_id,p_after_id); end if;
  for row_id in select id from pennsync_private.s3_referral
    where app_id=p_app_id and agency_id=p_agency_id and patient_id=p_patient_id and (p_after_id is null or id>p_after_id)
    order by id limit p_limit+1 for share loop
    if jsonb_array_length(items)=p_limit then next_id:=(items->(p_limit-1)->'referral'->>'id')::uuid;exit;end if;
    v:=pennsync_private.s3_current(p_app_id,p_agency_id,p_patient_id,row_id);
    items:=items||jsonb_build_array(jsonb_build_object('referral',v,'referral_sha256',pennsync_private.s3_hash(v)));
  end loop;
  return jsonb_build_object('contract','cm.pennsync.s3-referral-list.staging.v1','staging',true,'synthetic',true,
    'app_id',p_app_id,'action','list','context',c,'items',items,'next_cursor',next_id);
end $$;
create function public.pennsync_staging_s3_list(p_app_id text,p_agency_id text,p_patient_id text,
  p_expected_actor_version bigint,p_expected_patient_version bigint,p_limit integer,p_after_id uuid) returns jsonb
language sql volatile security invoker set search_path='' as $$
  select pennsync_private.s3_list(p_app_id,p_agency_id,p_patient_id,p_expected_actor_version,p_expected_patient_version,p_limit,p_after_id);
$$;
revoke all on function pennsync_private.s3_list(text,text,text,bigint,bigint,integer,uuid),
  public.pennsync_staging_s3_list(text,text,text,bigint,bigint,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function pennsync_private.s3_list(text,text,text,bigint,bigint,integer,uuid),
  public.pennsync_staging_s3_list(text,text,text,bigint,bigint,integer,uuid) to authenticated;
commit;
