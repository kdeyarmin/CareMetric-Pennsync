import { readFile, readdir } from 'node:fs/promises';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';

const app = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const request = n => `30000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let db; let fixtures;
before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql',import.meta.url),'utf8'));
  const migrationDir = new URL('../supabase/migrations/',import.meta.url);
  for (const name of (await readdir(migrationDir)).filter(n=>n.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name,migrationDir),'utf8'));
  }
  fixtures=await readFile(new URL('./fixtures.sql',import.meta.url),'utf8');
});
after(async()=>db?.close());
async function login(n, extra={}) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({sub:uid(n),session_id:sid(n),role:'authenticated',exp:Math.floor(Date.now()/1000)+3600,...extra})]);
  await db.exec('set local role authenticated');
}
async function rpc(name,args=[]) {
  const {rows}=await db.query(`select public.pennsync_staging_${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) as result`,args);
  return rows[0].result;
}
async function denied(fn,code) {
  await db.exec('savepoint rejected_operation');
  try { await assert.rejects(fn, e=>code ? e.message.includes(code) : true); }
  finally { await db.exec('rollback to savepoint rejected_operation'); }
}
async function privileged(sql,params=[]) {
  await db.exec('reset role'); const r=await db.query(sql,params); await db.exec('set local role authenticated'); return r;
}
function scenario(name,fn) { test(name,async()=>{
  await db.exec('begin');
  try { await db.exec(fixtures); await login(1); await fn(); }
  finally { await db.exec('rollback'); }
}); }
const assign = (patient='patient-a2',member='membership-2',action='grant',version=0,id=1,targetVersion=1,actorVersion=1) =>
  rpc('assignment',[app,'agency-a',patient,member,action,actorVersion,targetVersion,version,request(id)]);
const revoke = (member='membership-2',version=1,id=10) =>
  rpc('revoke_membership',[app,'agency-a',member,1,version,request(id)]);

test('migration refuses a non-BYPASSRLS owner before creating any authority schema',async()=>{
  const isolated=new PGlite();
  try {
    await isolated.exec(await readFile(new URL('./bootstrap.sql',import.meta.url),'utf8'));
    await isolated.exec(`create role pennsync_test_migration nologin nosuperuser nobypassrls;
      do $$ begin execute format('grant create on database %I to pennsync_test_migration',current_database()); end $$;
      set role pennsync_test_migration`);
    const sql=await readFile(new URL('../supabase/migrations/20260918015112_independent_staging_authority.sql',import.meta.url),'utf8');
    await assert.rejects(isolated.exec(sql), error=>error.code==='42501'
      && error.message==='PENNSYNC_BYPASSRLS_MIGRATION_OWNER_REQUIRED');
    await isolated.exec('rollback; reset role');
    const {rows}=await isolated.query("select count(*)::integer as count from pg_namespace where nspname='pennsync_private'");
    assert.equal(rows[0].count,0);
  } finally { await isolated.close(); }
});

scenario('four exact mapped identities obtain only their membership contexts', async()=>{
  for(let n=1;n<=4;n++) {
    await login(n); const result=await rpc('memberships',[app]);
    assert.equal(result.auth_user_id,uid(n)); assert.equal(result.user_id,`6aac00000000${String(n).padStart(12,'0')}`);
    assert.equal(result.memberships.length,1);
    const context=result.memberships[0]; assert.equal(context.is_platform_owner,false);
    assert.equal(context.membership_key,`${context.agency_id}:${result.user_id}`);
    assert.equal(context.membership_version,1); assert.equal(context.contract,'cm.pennsync.authority.staging.v1');
  }
});
scenario('admin roster, assigned clinician, empty clinician and other agency have different allowed results', async()=>{
  assert.deepEqual((await rpc('patients',[app,'agency-a'])).items.map(r=>r.id),['patient-a1','patient-a2']);
  await login(2); assert.deepEqual((await rpc('patients',[app,'agency-a'])).items.map(r=>r.id),['patient-a1']);
  assert.equal((await rpc('patient',[app,'agency-a','patient-a1'])).patient.synthetic,true);
  await denied(()=>rpc('patient',[app,'agency-a','patient-a2']),'PENNSYNC_PATIENT_DENIED');
  await login(3); assert.deepEqual((await rpc('patients',[app,'agency-a'])).items,[]);
  await login(4); assert.deepEqual((await rpc('patients',[app,'agency-b'])).items.map(r=>r.id),['patient-b1']);
  await denied(()=>rpc('context',[app,'agency-a']),'PENNSYNC_TENANT_DENIED');
});
scenario('no caller-supplied owner, role or agency claims create grants',async()=>{
  await login(3,{user_metadata:{role:'agency_admin',is_platform_owner:true},app_metadata:{agency_id:'agency-b'}});
  assert.equal((await rpc('context',[app,'agency-a'])).tenant_role,'clinician');
  await denied(()=>assign(),'PENNSYNC_ADMIN_REQUIRED');
  await denied(()=>rpc('context',[app,'agency-b']),'PENNSYNC_TENANT_DENIED');
  await denied(()=>rpc('context',['694ec16e72e01b60d22f7cbf','agency-a']),'PENNSYNC_APP_NOT_ADMITTED');
});
scenario('malformed, missing, expired, other-user and deleted sessions fail closed',async()=>{
  for(const extra of [{session_id:null},{session_id:'invalid'},{session_id:sid(4)},{exp:0},{exp:null},{role:'service_role'}]) {
    await login(1,extra); await denied(()=>rpc('memberships',[app]));
  }
  await login(1);
  await privileged('delete from auth.sessions where id=$1',[sid(1)]);
  await denied(()=>rpc('context',[app,'agency-a']),'PENNSYNC_SESSION_INACTIVE');
});
scenario('unverified, anonymous, banned and deleted native users are rejected',async()=>{
  for(const [column,value] of [['email_confirmed_at',null],['is_anonymous',true],['banned_until','2100-01-01'],['deleted_at','2026-01-01']]) {
    await db.exec('savepoint native_state');
    await privileged(`update auth.users set ${column}=$1 where id=$2`,[value,uid(1)]);
    await denied(()=>rpc('memberships',[app]),'PENNSYNC_IDENTITY_INACTIVE');
    await db.exec('rollback to savepoint native_state');
  }
});
scenario('mapping email mismatch, missing mapping and terminal revocation do not authenticate',async()=>{
  await privileged("update auth.users set email='wrong@example.invalid' where id=$1",[uid(1)]);
  await denied(()=>rpc('memberships',[app]),'PENNSYNC_IDENTITY_UNMAPPED');
  await privileged("update auth.users set email='admin-a@example.invalid' where id=$1",[uid(1)]);
  await privileged('update pennsync_private.identity_map set enabled=false,revoked_at=clock_timestamp(),version=version+1 where auth_user_id=$1',[uid(1)]);
  await denied(()=>rpc('memberships',[app]),'PENNSYNC_IDENTITY_UNMAPPED');
});
scenario('native session not_after and twelve-hour bound are enforced',async()=>{
  await privileged("update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=$1",[sid(1)]);
  await denied(()=>rpc('memberships',[app]),'PENNSYNC_SESSION_INACTIVE');
  await privileged("update auth.sessions set not_after=null,created_at=clock_timestamp()-interval '13 hours' where id=$1",[sid(1)]);
  await denied(()=>rpc('memberships',[app]),'PENNSYNC_SESSION_INACTIVE');
});
scenario('pagination is bounded and refuses unknown, foreign or inaccessible cursors',async()=>{
  const first=await rpc('patients',[app,'agency-a',1,null]); assert.equal(first.next_cursor,'patient-a1');
  const second=await rpc('patients',[app,'agency-a',1,first.next_cursor]); assert.equal(second.next_cursor,null);
  assert.deepEqual(second.items.map(x=>x.id),['patient-a2']);
  for(const cursor of ['missing','patient-b1','bad cursor']) await denied(()=>rpc('patients',[app,'agency-a',1,cursor]),'PENNSYNC_INVALID_PAGE');
  for(const limit of [0,-1,101,null]) await denied(()=>rpc('patients',[app,'agency-a',limit,null]),'PENNSYNC_INVALID_PAGE');
  await login(2); await denied(()=>rpc('patients',[app,'agency-a',1,'patient-a2']),'PENNSYNC_INVALID_PAGE');
});
scenario('unique assignment creation and payload-bound replay produce one durable change',async()=>{
  const first=await assign(); assert.equal(first.assignment_version,1); assert.equal(first.replayed,false);
  const again=await assign(); assert.equal(again.assignment_version,1); assert.equal(again.replayed,true);
  const counts=await privileged('select (select count(*) from pennsync_private.assignment) assignments,(select count(*) from pennsync_private.mutation_receipt) receipts');
  assert.equal(counts.rows[0].assignments,2); assert.equal(counts.rows[0].receipts,1);
  await denied(()=>assign('patient-a1','membership-2','grant',1,1),'PENNSYNC_IDEMPOTENCY_CONFLICT');
  await denied(()=>assign('patient-a2','membership-2','grant',0,2),'PENNSYNC_ASSIGNMENT_VERSION_CHANGED');
  await login(2); assert.equal((await rpc('patients',[app,'agency-a'])).items.length,2);
});
scenario('assignment revocation changes access atomically and obsolete receipt cannot restore it',async()=>{
  await assign('patient-a2','membership-2','grant',0,1);
  const removed=await assign('patient-a2','membership-2','revoke',1,2); assert.equal(removed.assignment_version,2);
  await denied(()=>assign('patient-a2','membership-2','grant',0,1),'PENNSYNC_REPLAY_STATE_CHANGED');
  await login(2); await denied(()=>rpc('patient',[app,'agency-a','patient-a2']),'PENNSYNC_PATIENT_DENIED');
});
scenario('clinician revocation changes membership and assignments in one transaction',async()=>{
  const result=await revoke(); assert.equal(result.membership_version,2);
  const replay=await revoke(); assert.equal(replay.replayed,true);
  const states=await privileged("select (select status from pennsync_private.membership where id='membership-2') membership,(select status from pennsync_private.assignment where membership_id='membership-2') assignment");
  assert.deepEqual(states.rows[0],{membership:'revoked',assignment:'revoked'});
  await denied(()=>assign(),'PENNSYNC_TARGET_VERSION_CHANGED');
  await login(2); assert.deepEqual((await rpc('memberships',[app])).memberships,[]);
  await denied(()=>rpc('patient',[app,'agency-a','patient-a1']),'PENNSYNC_TENANT_DENIED');
});
scenario('clinicians cannot mutate and administrators cannot revoke self, another admin or foreign target',async()=>{
  for(const member of ['membership-1','membership-4','missing']) await denied(()=>revoke(member),'PENNSYNC_TARGET_DENIED');
  await denied(()=>assign('patient-b1'),'PENNSYNC_PATIENT_DENIED');
  await login(2); await denied(()=>assign(),'PENNSYNC_ADMIN_REQUIRED');
  await denied(()=>revoke('membership-3'),'PENNSYNC_ADMIN_REQUIRED');
});
scenario('stale actor and target revisions cannot mutate or replay',async()=>{
  await assign();
  await privileged("update pennsync_private.membership set version=2 where id='membership-1'");
  await denied(()=>assign(),'PENNSYNC_ACTOR_VERSION_CHANGED');
  await denied(()=>assign('patient-a2','membership-3','grant',0,2,2,2),'PENNSYNC_TARGET_VERSION_CHANGED');
});
scenario('database identity provenance, duplicate memberships and cross-agency assignment FKs cannot be bypassed',async()=>{
  await db.exec('reset role');
  await denied(()=>db.query("update pennsync_private.identity_map set expected_email='changed@example.invalid' where auth_user_id=$1",[uid(1)]),'PENNSYNC_IMMUTABLE_IDENTITY');
  await denied(()=>db.exec("insert into pennsync_private.membership(app_id,id,agency_id,auth_user_id,base44_user_id,tenant_role,status,version,revoked_at,revoked_by) select app_id,'duplicate',agency_id,auth_user_id,base44_user_id,tenant_role,status,version,revoked_at,revoked_by from pennsync_private.membership where id='membership-1'"),'duplicate key');
  await denied(()=>db.exec("insert into pennsync_private.assignment(app_id,agency_id,patient_id,membership_id,status,version,changed_by,changed_at) values('6a9881683dc68a0bd54f1ef7','agency-b','patient-b1','membership-2','active',1,'10000000-0000-4000-8000-000000000001',clock_timestamp())"),'foreign key');
  await denied(()=>db.exec("insert into pennsync_private.identity_map(app_id,auth_user_id,base44_user_id,expected_email,source_evidence_sha256,verified_at) values('6a9881683dc68a0bd54f1ef7','10000000-0000-4000-8000-000000000001','6a98816d3dc68a0bd54f1ef8','owner@example.invalid',repeat('a',64),clock_timestamp())"),'check constraint');
});
scenario('browser table CRUD, internal helper execution and anonymous wrappers are denied',async()=>{
  for(const name of ['identity_map','agency','membership','patient','assignment','chart_assignment','mutation_receipt','archive_patient_import_receipt','visit_disclosure_audit','patient_context','patient_disclosure_audit','visit_list_disclosure_audit']) {
    await denied(()=>db.exec(`select * from pennsync_private.${name}`),'permission denied');
  }
  await denied(()=>db.query('select pennsync_private.actor($1,false)',[app]),'permission denied');
  await db.exec('set local role anon');
  await denied(()=>rpc('memberships',[app]),'permission denied');
  await db.exec('set local role service_role');
  await denied(()=>rpc('memberships',[app]),'permission denied');
});
scenario('public wrappers are invoker-only; private grants and RLS are complete',async()=>{
  const rows=await privileged("select p.proname,p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'pennsync_staging_%'");
  assert.deepEqual(rows.rows.map(x=>x.proname).sort(),['context','memberships','patients','patient','assignment','revoke_membership','s4_create','s4_read','s3_create','s3_confirm','s3_read','s3_list','visit_documentation','patient_context','visits_schedule','referral_patient','referral_patients'].map(x=>`pennsync_staging_${x}`).sort());
  assert.equal(rows.rows.some(x=>x.prosecdef),false);
  const tables=await privileged("select relname,relrowsecurity,relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='pennsync_private' and relkind='r'");
  assert.deepEqual(tables.rows.map(x=>x.relname).sort(),['identity_map','agency','membership','patient','assignment','chart_assignment','mutation_receipt','archive_patient_import_receipt','visit_disclosure_audit','patient_context','patient_disclosure_audit','visit_list_disclosure_audit','s4_visit','s4_note_history','s4_note_conversion','s4_compliance_audit','s4_create_receipt','s3_referral','s3_receipt','known_app','deployment','enrollment_receipt'].sort());
  assert.equal(tables.rows.every(x=>x.relrowsecurity&&x.relforcerowsecurity),true);
  const paths=await privileged("select proname,proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='pennsync_private'");
  assert.equal(paths.rows.every(x=>x.proconfig?.includes('search_path=""')),true);
});
scenario('inactive target identity blocks fresh grants and successful-result replay',async()=>{
  await assign();
  await privileged('update pennsync_private.identity_map set enabled=false,revoked_at=clock_timestamp(),version=version+1 where auth_user_id=$1',[uid(2)]);
  await denied(()=>assign(),'PENNSYNC_TARGET_INACTIVE');
  await denied(()=>assign('patient-a1','membership-2','grant',1,2),'PENNSYNC_TARGET_INACTIVE');
  assert.equal((await revoke()).membership_status,'revoked');
});
scenario('a receipt persistence failure rolls back membership and assignment changes together',async()=>{
  await privileged(`create function pennsync_private.test_receipt_failure() returns trigger language plpgsql as $$ begin raise exception 'INJECTED_RECEIPT_FAILURE'; end $$`);
  await privileged('create trigger fail_receipt before insert on pennsync_private.mutation_receipt for each row execute function pennsync_private.test_receipt_failure()');
  await denied(()=>revoke(),'INJECTED_RECEIPT_FAILURE');
  const result=await privileged("select (select status from pennsync_private.membership where id='membership-2') membership,(select status from pennsync_private.assignment where membership_id='membership-2') assignment,(select count(*) from pennsync_private.mutation_receipt) receipts");
  assert.deepEqual(result.rows[0],{membership:'active',assignment:'active',receipts:0});
});
scenario('RLS remains denying after accidental authenticated table grants',async()=>{
  await privileged('grant select,insert,update,delete on pennsync_private.patient to authenticated');
  assert.deepEqual((await db.query('select * from pennsync_private.patient')).rows,[]);
  await denied(()=>db.exec("insert into pennsync_private.patient values('6a9881683dc68a0bd54f1ef7','forged','agency-a','Synthetic Forged',true,1)"),'row-level security');
  assert.equal((await rpc('patients',[app,'agency-a'])).items.length,2);
});
scenario('service database role is rejected even when supplied claims impersonate authenticated',async()=>{
  await privileged('grant usage on schema pennsync_private to service_role');
  await privileged('grant execute on function public.pennsync_staging_memberships(text),pennsync_private.memberships(text) to service_role');
  await db.exec('set local role service_role');
  await denied(()=>rpc('memberships',[app]),'PENNSYNC_SESSION_REQUIRED');
});
scenario('all six stored roles are finite but this roster slice grants only its implemented roles',async()=>{
  for(const role of ['manager','office_staff','social_worker','spiritual_care']) {
    await privileged("update pennsync_private.membership set tenant_role=$1 where id='membership-2'",[role]);
    await login(2); assert.equal((await rpc('context',[app,'agency-a'])).tenant_role,role);
    await denied(()=>rpc('patients',[app,'agency-a']),'PENNSYNC_ROSTER_ROLE_DENIED');
  }
  await db.exec('reset role');
  await denied(()=>db.exec("update pennsync_private.membership set tenant_role='platform_owner' where id='membership-2'"),'check constraint');
});
