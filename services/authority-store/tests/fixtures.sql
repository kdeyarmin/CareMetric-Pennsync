-- LOCAL AUTH STUB FIXTURES ONLY; every test wraps this file in BEGIN/ROLLBACK.
do $$ begin
  if not auth.pennsync_local_test_double() then raise exception 'LOCAL TEST ONLY'; end if;
end $$;
insert into auth.users(id,email,email_confirmed_at) values
 ('10000000-0000-4000-8000-000000000001','admin-a@example.invalid',clock_timestamp()),
 ('10000000-0000-4000-8000-000000000002','clinician-a@example.invalid',clock_timestamp()),
 ('10000000-0000-4000-8000-000000000003','clinician-empty@example.invalid',clock_timestamp()),
 ('10000000-0000-4000-8000-000000000004','admin-b@example.invalid',clock_timestamp());
insert into auth.sessions(id,user_id,not_after) select
  ('20000000-0000-4000-8000-'||right(id::text,12))::uuid,id,clock_timestamp()+interval '1 hour' from auth.users;
insert into pennsync_private.identity_map(app_id,auth_user_id,base44_user_id,expected_email,source_evidence_sha256,verified_at)
  select '6a9881683dc68a0bd54f1ef7',id,'6aac00000000'||right(id::text,12),email,repeat('a',64),clock_timestamp()
  from auth.users;
insert into pennsync_private.agency(app_id,id,name,status) values
 ('6a9881683dc68a0bd54f1ef7','agency-a','Synthetic Agency A','active'),
 ('6a9881683dc68a0bd54f1ef7','agency-b','Synthetic Agency B','trial');
insert into pennsync_private.membership(app_id,id,agency_id,auth_user_id,base44_user_id,tenant_role,status)
  select app_id,'membership-'||right(auth_user_id::text,1),
    case when right(auth_user_id::text,1)='4' then 'agency-b' else 'agency-a' end,
    auth_user_id,base44_user_id,
    case when right(auth_user_id::text,1) in ('1','4') then 'agency_admin' else 'clinician' end,'active'
  from pennsync_private.identity_map;
insert into pennsync_private.patient(app_id,id,agency_id,display_name) values
 ('6a9881683dc68a0bd54f1ef7','patient-a1','agency-a','Synthetic Patient A1'),
 ('6a9881683dc68a0bd54f1ef7','patient-a2','agency-a','Synthetic Patient A2'),
 ('6a9881683dc68a0bd54f1ef7','patient-b1','agency-b','Synthetic Patient B1');
insert into pennsync_private.assignment(app_id,agency_id,patient_id,membership_id,status,changed_by)
  values('6a9881683dc68a0bd54f1ef7','agency-a','patient-a1','membership-2','active','10000000-0000-4000-8000-000000000001');
-- The same care team, in the table D24 authorizes from. Two tables rather than
-- one because `assignment` keys to `pennsync_private.patient` — synthetic rows
-- only, and that key guards the archive import's rollback — while a chart of
-- record lives in `pennsync_records.patient`. Both rows name the same
-- clinician and the same patient id, so a test reading either sees one team.
insert into pennsync_private.chart_assignment(app_id,agency_id,patient_id,membership_id,status,changed_by)
  values('6a9881683dc68a0bd54f1ef7','agency-a','patient-a1','membership-2','active','10000000-0000-4000-8000-000000000001');
