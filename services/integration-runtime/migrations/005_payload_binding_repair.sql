-- Installed-definition correction after the first rollback-only 004 test.
-- Corrected fresh 004 installations are unchanged by this historical repair.
do $$
declare definition text;
begin
 definition := pg_get_functiondef('public.cm_integration_reserve(text,text,text,text,text,uuid,integer)'::regprocedure);
 if position('values(p_app_id,p_subject,p_operation,p_request_id,payload_hash,p_claim' in definition)>0 then
  definition:=replace(definition,'values(p_app_id,p_subject,p_operation,p_request_id,payload_hash,p_claim','values(p_app_id,p_subject,p_operation,p_request_id,p_payload_hash,p_claim');
  execute definition;
 elsif position('values(p_app_id,p_subject,p_operation,p_request_id,p_payload_hash,p_claim' in definition)=0 then
  raise exception 'Expected reservation payload binding not found';
 end if;
end $$;
