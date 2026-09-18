// Only used after provision() establishes a fresh owned local Auth/API stack.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localRequest } from './fixture.mjs';
import { seedPatientContexts } from '../../authority-store/tests/patient-context-fixture.mjs';
import { s4Fields } from '../../authority-store/tests/s4-fixture.mjs';
import { STAGING_APP_ID as APP } from '../client.mjs';

export async function clinicalFixture(db, status, actors) {
  assert.equal((await db.query('select count(*)::int n from auth.users')).rows[0].n,4);
  assert.equal((await db.query('select count(*)::int n from pennsync_private.s4_visit')).rows[0].n,0);
  await seedPatientContexts(db);
  const actor=actors.find(value=>value.name==='clinician-a');
  let token;
  try {
    const login=await localRequest('/auth/v1/token?grant_type=password',status.PUBLISHABLE_KEY,{email:actor.email,password:actor.password});
    assert.equal(login.status,200);const grant=await login.json();
    if(typeof grant.access_token==='string')token=grant.access_token;
    assert.equal(grant.user.id,actor.uuid);assert.equal(grant.user.email,actor.email);assert.ok(token);
    const response=await localRequest('/rest/v1/rpc/pennsync_staging_s4_create',status.PUBLISHABLE_KEY,
      {p_app_id:APP,p_agency_id:'agency-a',p_patient_id:'patient-a1',p_expected_actor_version:1,p_expected_patient_version:1,
        p_request_id:randomUUID(),p_fields:s4Fields({nurse_notes:'FICTIONAL saved browser visit. Preserve é 心 🩺.',vital_signs:{pain_level:0,weight:70}})},token);
    assert.equal(response.status,200);const saved=await response.json();
    assert.match(saved.artifacts.visit.id,/^[a-f0-9-]{36}$/);return saved.artifacts.visit;
  } finally {
    if(token){const response=await localRequest('/auth/v1/logout?scope=local',status.PUBLISHABLE_KEY,undefined,token);assert.equal(response.status,204);}
  }
}
