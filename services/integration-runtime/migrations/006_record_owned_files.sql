-- Objects whose readers are decided by a contract, not by who uploaded them.
--
-- `001` mints every object uploader-owned: `cm_integration_file_get` matches on
-- the caller's hashed subject and `cm_integration_file_record` pins the object
-- path to `app/subject/id`. That is right for a file a caller uploaded in their
-- own session, and it cannot serve a carried clinical document at all — a
-- migrated object has no uploader, and a document one nurse generates is read
-- by the care team, so binding it to the generator loses it to everybody else.
--
-- The split this migration makes is that the runtime authorizes the TENANT and
-- the contract authorizes the CHART, and neither is asked the other's question.
-- A record-owned row carries the agency it was minted in; a read is admitted
-- when the caller's live authority — which the runtime reads itself, from the
-- caller's own bearer, on every request — is an active membership in that
-- agency. The chart narrowing stays one layer up in `pennsync-api`, where the
-- record store can be asked, and is evaluated on every path to these bytes.
--
-- **A handle still is not a bearer capability**, which is the property that
-- must survive. A leaked `cmfile:` UUID buys its holder nothing: they must
-- independently qualify in the tenant, which means an active membership the
-- runtime resolves for itself and the caller cannot assert.
--
-- **Forward-only, as `005` was.** `001` is applied in the hosted project and
-- its README is explicit that the sequence is never replayed there. So this
-- adds columns and functions and replaces one function body; it drops nothing
-- and rewrites no history. Existing rows are uploader-owned and the default
-- says so, so the backfill is the default and there is no data step.
begin;

alter table public.cm_integration_files
  add column owner_kind text not null default 'subject'
    check (owner_kind in ('subject','record')),
  -- Null for an uploader-owned row, required for a record-owned one. The two
  -- halves are one constraint rather than two, because a record-owned row with
  -- no agency would be readable by nobody and an uploader-owned row with one
  -- would claim a tenant nothing checks.
  add column agency_id text
    check (agency_id is null or agency_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  add constraint cm_integration_files_owner_agency
    check ((owner_kind = 'subject' and agency_id is null)
        or (owner_kind = 'record' and agency_id is not null));

-- The operation list lives in TWO places and an operation absent from either
-- cannot run: the table's CHECK, and a second copy inside
-- `cm_integration_reserve` itself (004's body). Every operation is RESERVED
-- before its provider runs, so the insert dies on the CHECK and, before that,
-- the function raises on its own guard. `001` named seven and this service now
-- serves eight. The review that found this named only the constraint; the
-- second copy surfaced when a test drove the real function instead of a double.
alter table public.cm_integration_jobs
  drop constraint cm_integration_jobs_operation_check,
  add constraint cm_integration_jobs_operation_check
    check (operation in ('InvokeLLM','ExtractDataFromUploadedFile','GenerateImage','SendEmail','UploadFile','UploadPrivateFile','CreateFileSignedUrl','UploadRecordFile'));

-- The function's copy is PATCHED from its installed definition rather than
-- retyped, exactly as `005` repairs its payload binding: restating 004's body
-- here would be a second copy of a hundred lines, free to drift in the one
-- direction nothing measures. Refuses if the expected list is absent, so a
-- changed body fails loudly instead of being silently left un-extended, and
-- does nothing when the list is already extended.
do $$
declare definition text; seven text; eight text;
begin
 seven := '''InvokeLLM'',''ExtractDataFromUploadedFile'',''GenerateImage'',''SendEmail'',''UploadFile'',''UploadPrivateFile'',''CreateFileSignedUrl''';
 eight := seven || ',''UploadRecordFile''';
 definition := pg_get_functiondef('public.cm_integration_reserve(text,text,text,text,text,uuid,integer)'::regprocedure);
 if position(eight in definition) > 0 then return; end if;
 if position(seven in definition) = 0 then
  raise exception 'Expected reservation operation list not found';
 end if;
 execute replace(definition, seven, eight);
end $$;

comment on column public.cm_integration_files.owner_kind is
  'Who may read these bytes: ''subject'' is the uploader alone; ''record'' is an active membership of agency_id, with the chart narrowing enforced by the calling contract.';
comment on column public.cm_integration_files.subject is
  'The caller who minted the row. For owner_kind=''subject'' it is also the only reader; for ''record'' it is provenance and authorizes nothing.';

-- Uploader-owned reads get NARROWER, not wider. A record-owned row carries a
-- minter in `subject`, so without this filter that one person would match here
-- and reach their own record-owned object through the uploader path. The
-- runtime's path check would refuse it a moment later, but a getter that hands
-- back a row the caller may not read is the wrong place to be relying on that.
create or replace function public.cm_integration_file_get(p_id uuid,p_app_id text,p_subject text)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
 select to_jsonb(f) from public.cm_integration_files f
 where f.id=p_id and f.app_id=p_app_id and f.subject=p_subject and f.owner_kind='subject'; $$;

-- One getter for both kinds, so a read is one round trip and the SQL is the
-- authorization rather than something the caller assembles from two answers.
-- `p_agency_id` is the agency the runtime resolved for this request; null means
-- the caller has no tenant (a platform owner with no agency scope), and then no
-- record-owned row matches at all.
create function public.cm_integration_file_get_authorized(p_id uuid,p_app_id text,p_subject text,p_agency_id text)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
 select to_jsonb(f) from public.cm_integration_files f
 where f.id=p_id and f.app_id=p_app_id
   and ((f.owner_kind='subject' and f.subject=p_subject)
     or (f.owner_kind='record' and p_agency_id is not null and f.agency_id=p_agency_id)); $$;

-- Minting a record-owned object. Separate from `cm_integration_file_record`
-- rather than a flag on it: the two bind their object path to different facts,
-- and the existing function keeps the exact shape every applied caller uses.
create function public.cm_integration_file_record_owned(p_id uuid,p_app_id text,p_subject text,p_agency_id text,p_object_path text,p_content_type text,p_size bigint,p_sha256 text)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 -- The path embeds the agency exactly as the uploader-owned path embeds the
 -- subject, so a row whose agency was altered no longer addresses its bytes and
 -- the unique constraint on the path still catches a second registration.
 if p_app_id !~ '^[A-Za-z0-9_-]{1,128}$' or p_agency_id !~ '^[A-Za-z0-9_-]{1,128}$'
   or p_object_path<>p_app_id||'/record/'||p_agency_id||'/'||p_id::text then raise exception 'Invalid file binding';end if;
 insert into public.cm_integration_files(id,app_id,subject,agency_id,owner_kind,object_path,content_type,size_bytes,sha256)
 values(p_id,p_app_id,p_subject,p_agency_id,'record',p_object_path,p_content_type,p_size,p_sha256);
 return true;
end $$;

revoke all on function public.cm_integration_file_get_authorized(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.cm_integration_file_record_owned(uuid,text,text,text,text,text,bigint,text) from public,anon,authenticated;
grant execute on function public.cm_integration_file_get_authorized(uuid,text,text,text) to service_role;
grant execute on function public.cm_integration_file_record_owned(uuid,text,text,text,text,text,bigint,text) to service_role;

commit;
