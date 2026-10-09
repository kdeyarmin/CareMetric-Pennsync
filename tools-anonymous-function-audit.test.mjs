import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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
test('every discovered backend is exercised and returns a denial or an exact documented unavailable/retired response', async () => {
  const result = await auditAnonymousFunctions();
  const expected = readdirSync('base44/functions', { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  assert.deepEqual(result.discoveredFunctionNames, expected);
  assert.deepEqual(result.results.map(row => row.name), expected);
  assert.equal(result.total, expected.length);
  assert.deepEqual(result.discoveryErrors, []);
  assert.equal(result.interceptedNetworkAttempts, 0);
  assert.equal(Object.hasOwn(result, 'hostedRequests'), false);
  assert.equal(result.unexpectedIoCount, 0);
  assert.equal(result.passed, true, JSON.stringify(result.results.filter(row => !row.safeNegativeResult)));
});


test('body-supplied role and tenant claims do not bypass any no-session function gate', async () => {
  const result = await auditAnonymousFunctions(process.cwd(), {
    action: 'list', role: 'admin', account_type: 'super_admin', is_manager: true,
    user_id: 'synthetic-caller', agency_id: 'synthetic-agency', patient_id: 'synthetic-patient',
    employee_email: 'synthetic@example.test', token: 'synthetic-not-a-real-capability',
  });
  assert.equal(result.interceptedNetworkAttempts, 0);
  assert.equal(result.passed, true, JSON.stringify(result.results.filter(row => !row.safeNegativeResult)));
});


test('arbitrary internal errors and exceptions never count as authenticated denials', async () => {
  for (const source of [
    "Deno.serve(() => Response.json({error:'Internal server error'}, {status:500}));",
    "Deno.serve(() => Response.json({error:'unknown'}, {status:503}));",
    "Deno.serve(() => { throw new Error('synthetic'); });",
  ]) {
    const result = await auditAnonymousSource(source, 'test');
    assert.equal(result.safeNegativeResult, false);
    assert.ok(['server_error', 'execution_error'].includes(result.outcome));
  }
});
test('only a reviewed exact 503 body is identified as expected unavailable', async () => {
  // deletePatientsMissingFirstName is destructive one-off maintenance and stays
  // paused, so its reviewed body is a stable fixture for this check.
  const source = "Deno.serve(() => Response.json({error:'Legacy Patient service-role writer is temporarily unavailable',code:'legacy_patient_service_writer_paused',reason:'immutable_tenant_authorization_and_atomic_write_broker_required',endpoint:'deletePatientsMissingFirstName'}, {status:503}));";
  const result = await auditAnonymousSource(source, 'deletePatientsMissingFirstName');
  assert.equal(result.outcome, 'expected_unavailable'); assert.equal(result.safeNegativeResult, true);
  for (const altered of [source.replace('temporarily', 'permanently'), source.replace('503', '500'), source.replace("error:'Legacy", "extra:'not allowed',error:'Legacy")]) {
    assert.equal((await auditAnonymousSource(altered, 'deletePatientsMissingFirstName')).safeNegativeResult, false);
  }
});
test('retirement exception requires exact success=true and no extra fields', async () => {
  for (const body of [{ skipped: 'automatic patient assignment disabled' },
    { success: false, skipped: 'automatic patient assignment disabled' },
    { success: true, skipped: 'automatic patient assignment disabled', records: ['synthetic'] }]) {
    assert.equal((await auditAnonymousSource(`Deno.serve(() => Response.json(${JSON.stringify(body)}));`, 'autoAssignNurseToPatient')).safeNegativeResult, false);
  }
});
test('network-attempt instrumentation increments from the fetch boundary', async () => {
  const source = "Deno.serve(async () => { for (let i=0;i<2;i++) { try { await fetch('https://example.test'); } catch {} } return Response.json({error:'denied'},{status:403}); });";
  const result = await auditAnonymousSource(source, 'network-test');
  assert.equal(result.interceptedNetworkAttempts, 2); assert.equal(result.safeNegativeResult, false);
});
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'audit-discovery-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'base44/functions'), { recursive: true });
  return root;
}
test('a missing entry produces a failed result instead of disappearing from the count', async t => {
  const root = fixture(t); mkdirSync(join(root, 'base44/functions/missing'));
  const result = await auditAnonymousFunctions(root);
  assert.equal(result.passed, false); assert.deepEqual(result.discoveredFunctionNames, ['missing']);
  assert.equal(result.total, 1); assert.equal(result.results[0].outcome, 'entry_unreadable');
});
test('a discovered entry read failure cannot pass even when another function succeeds', async t => {
  const root = fixture(t);
  for (const name of ['good', 'unreadable']) { mkdirSync(join(root, 'base44/functions', name)); writeFileSync(join(root, 'base44/functions', name, 'entry.ts'), "Deno.serve(() => Response.json({error:'sign in'},{status:401}));"); }
  const { readFileSync } = await import('node:fs');
  const result = await auditAnonymousFunctions(root, {}, { readSource(path, encoding) { if (path.includes('/unreadable/')) throw new Error('SYNTHETIC_PRIVATE_PATH'); return readFileSync(path, encoding); } });
  assert.equal(result.total, 2); assert.equal(result.passed, false);
  assert.deepEqual(result.discoveryErrors, [{ name: 'unreadable', code: 'FUNCTION_ENTRY_UNREADABLE' }]);
  assert.ok(!JSON.stringify(result).includes('SYNTHETIC_PRIVATE_PATH'));
});
test('an empty or unavailable discovery directory cannot report success', async t => {
  const root = fixture(t); assert.equal((await auditAnonymousFunctions(root)).passed, false);
  assert.equal((await auditAnonymousFunctions(join(root, 'missing'))).passed, false);
});

// The Base44 editor's newer function format (2026-10-09): a default export
// instead of Deno.serve, secrets from `base44:runtime`, and imports from
// base44/shared/ that the CLI bundles. Each shape is planted here, because a
// harness that cannot load a function reports it as uncaptured and nothing more.
test('a default-exported handler is captured and judged like a served one', async () => {
  const refused = await auditAnonymousSource(`export default async function () { return Response.json({error:'sign in'}, {status:401}); }`, 'modern');
  assert.equal(refused.outcome, 'rejected');
  assert.equal(refused.safeNegativeResult, true);
  const open = await auditAnonymousSource(`export default async function () { return Response.json({ok:true}); }`, 'modernOpen');
  assert.equal(open.outcome, 'success_without_session');
  assert.equal(open.safeNegativeResult, false);
});

test('a base44:runtime secret read is recorded as an environment read', async () => {
  const result = await auditAnonymousSource(`import { secrets } from 'base44:runtime';
    export default async function () {
      if (!secrets.get('RELEASE_SWITCH')) return Response.json({error:'unavailable'}, {status:403});
      return Response.json({ok:true});
    }`, 'modernSecret');
  assert.equal(result.outcome, 'rejected');
  assert.deepEqual(result.environmentKeys, ['RELEASE_SWITCH']);
});

test('a shared import is evaluated as code under base44/, and nothing outside it is read', async () => {
  const root = mkdtempSync(join(tmpdir(), 'anon-audit-shared-'));
  try {
    mkdirSync(join(root, 'base44/functions/modern'), { recursive: true });
    mkdirSync(join(root, 'base44/shared'), { recursive: true });
    writeFileSync(join(root, 'base44/shared/gate.ts'), `import { secrets } from 'base44:runtime';
      export function gate() { return secrets.get('SHARED_SWITCH') ? null : Response.json({error:'off'}, {status:403}); }`);
    writeFileSync(join(root, 'base44/functions/modern/entry.ts'), `import { gate } from '../../shared/gate.ts';
      export default async function () { return gate() ?? Response.json({ok:true}); }`);
    writeFileSync(join(root, 'outside.ts'), `export function gate() { return Response.json({ok:true}); }`);
    mkdirSync(join(root, 'base44/functions/escape'), { recursive: true });
    writeFileSync(join(root, 'base44/functions/escape/entry.ts'), `import { gate } from '../../../outside.ts';
      export default async function () { return gate(); }`);
    const result = await auditAnonymousFunctions(root);
    const modern = result.results.find(row => row.name === 'modern');
    assert.equal(modern.outcome, 'rejected');
    assert.deepEqual(modern.environmentKeys, ['SHARED_SWITCH'], 'the shared module ran, and its secret read was recorded');
    // An import leaving base44/ is not read: it gets the trapping provider.
    const escape = result.results.find(row => row.name === 'escape');
    assert.equal(escape.safeNegativeResult, false);
    assert.deepEqual(escape.operations, ['provider.gate']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
