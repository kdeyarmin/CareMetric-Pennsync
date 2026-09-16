import test from 'node:test';
import assert from 'node:assert/strict';
import { auditAnonymousSource, auditAnonymousFunctions } from './tools-anonymous-function-audit.mjs';

test('a rejected handler without side effects passes the negative probe', async () => {
  const result = await auditAnonymousSource(`Deno.serve(() => Response.json({error:'sign in'}, {status:401}));`, 'test');
  assert.equal(result.safeNegativeResult, true);
});
test('a premature entity read is trapped without touching any hosted service', async () => {
  const result = await auditAnonymousSource(`import {createClientFromRequest} from 'npm:@base44/sdk@0.8.48'; Deno.serve(async req => { const b=createClientFromRequest(req); await b.asServiceRole.entities.Patient.list(); return Response.json({}); });`, 'unsafe');
  assert.deepEqual(result.unexpectedOperations, ['entities.Patient.list']);
  assert.equal(result.safeNegativeResult, false);
});
test('external network and datastore writes are trapped', async () => {
  for (const statement of ["await fetch('https://example.test')", "await b.asServiceRole.entities.Record.create({})"]) {
    const result = await auditAnonymousSource(`import {createClientFromRequest} from 'npm:@base44/sdk'; Deno.serve(async req => { const b=createClientFromRequest(req); ${statement}; return Response.json({}); });`, 'unsafe');
    assert.equal(result.safeNegativeResult, false); assert.equal(result.unexpectedOperations.length, 1);
  }
});
test('an arbitrary successful no-session handler cannot pass as a retirement stub', async () => {
  const result = await auditAnonymousSource(`Deno.serve(() => Response.json({success:true}));`, 'unprotected');
  assert.equal(result.safeNegativeResult, false);
});
test('only the exact documented retirement response is permitted', async () => {
  const valid = await auditAnonymousSource(`Deno.serve(() => Response.json({success:true,skipped:'automatic patient assignment disabled'}));`, 'autoAssignNurseToPatient');
  const invalid = await auditAnonymousSource(`Deno.serve(() => Response.json({success:true}));`, 'autoAssignNurseToPatient');
  assert.equal(valid.safeNegativeResult, true); assert.equal(invalid.safeNegativeResult, false);
});
test('every backend entry rejects a no-session probe or is the documented inert retirement', async () => {
  const result = await auditAnonymousFunctions();
  assert.ok(result.total >= 282);
  assert.equal(result.hostedRequests, 0);
  assert.equal(result.unexpectedIoCount, 0);
  assert.equal(result.passed, true, JSON.stringify(result.results.filter(row => !row.safeNegativeResult)));
});


test('body-supplied role and tenant claims do not bypass any no-session function gate', async () => {
  const result = await auditAnonymousFunctions(process.cwd(), {
    action: 'list', role: 'admin', account_type: 'super_admin', is_manager: true,
    user_id: 'synthetic-caller', agency_id: 'synthetic-agency', patient_id: 'synthetic-patient',
    employee_email: 'synthetic@example.test', token: 'synthetic-not-a-real-capability',
  });
  assert.equal(result.hostedRequests, 0);
  assert.equal(result.passed, true, JSON.stringify(result.results.filter(row => !row.safeNegativeResult)));
});
