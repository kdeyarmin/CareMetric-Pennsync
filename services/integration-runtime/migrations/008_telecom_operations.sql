-- Let the two telecom operations be RESERVED. Not released — reserved.
--
-- Every operation is reserved in `cm_integration_jobs` before its provider
-- runs, which is what makes a send idempotent and what bounds the daily
-- budget. An operation absent from the reservation path cannot run at all, and
-- 006 recorded the thing that makes this easy to get half right: **the
-- operation list lives in TWO places** — the table's CHECK, and a second copy
-- inside `cm_integration_reserve`'s own body — so extending one and not the
-- other leaves the operation refused by a guard nobody was looking at. The
-- review that found it the first time named only the constraint; the second
-- copy surfaced when a test drove the real function instead of a double.
--
-- So this migration does what 006 did, for the same reason and in the same
-- way: it replaces the CHECK by name, and it PATCHES the function from its
-- installed definition rather than retyping a hundred lines that would then be
-- free to drift. The patch refuses if the expected list is absent, so a changed
-- body fails loudly instead of being quietly left un-extended, and it does
-- nothing when the list is already extended.
--
-- **Reserving is not sending.** A row in this table is a claim on an
-- idempotency key and a budget unit; whether a fax or a text actually leaves
-- the service is decided in `telecom.mjs` by `INTEGRATIONS_TELECOM_RELEASE`,
-- which is unset, and by a provider credential, which does not exist. Both
-- operations are also in `BROWSER_FORBIDDEN_OPERATIONS`, so no browser caller
-- may name them whatever the allowlist says. This file moves none of that.
--
-- **Forward-only, as 005, 006 and 007 are.** It replaces one constraint and one
-- function body and drops no data.
begin;

alter table public.cm_integration_jobs
  drop constraint cm_integration_jobs_operation_check,
  add constraint cm_integration_jobs_operation_check
    check (operation in ('InvokeLLM','ExtractDataFromUploadedFile','GenerateImage','SendEmail','UploadFile','UploadPrivateFile','CreateFileSignedUrl','UploadRecordFile','SendFax','SendSms'));

do $$
declare definition text; before text; after text;
begin
 -- 006's list, as it leaves the function. Matched exactly: a near-miss must
 -- refuse rather than patch something this file does not understand.
 before := '''InvokeLLM'',''ExtractDataFromUploadedFile'',''GenerateImage'',''SendEmail'',''UploadFile'',''UploadPrivateFile'',''CreateFileSignedUrl'',''UploadRecordFile''';
 after := before || ',''SendFax'',''SendSms''';
 definition := pg_get_functiondef('public.cm_integration_reserve(text,text,text,text,text,uuid,integer)'::regprocedure);
 if position(after in definition) > 0 then return; end if;
 if position(before in definition) = 0 then
  raise exception 'Expected reservation operation list not found';
 end if;
 execute replace(definition, before, after);
end $$;

commit;
