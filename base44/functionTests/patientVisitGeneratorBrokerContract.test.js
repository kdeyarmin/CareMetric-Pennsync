import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (relative) => readFileSync(path.join(ROOT, relative), 'utf8');

const FORBIDDEN_RUNTIME_PRIMITIVES = /createClient|\.auth\.|\.entities\.|\.functions\.|InvokeLLM|console\.|req\.json/;
const FORBIDDEN_UI_SINK_ACCESS = /\bbase44\b|useQuery|useMutation|PatientEducationDelivery|DischargeSummary\.(?:filter|get|list|update|create)|functions\.invoke/;

function assertQuarantined(source, code) {
  assert.match(source, /Deno\.serve\(\(req\)\s*=>/);
  assert.match(source, /status:\s*503/);
  assert.match(source, /'Cache-Control':\s*'no-store'/);
  assert.match(source, new RegExp(`code:\\s*'${code}'`));
  assert.doesNotMatch(source, FORBIDDEN_RUNTIME_PRIMITIVES);
}

async function loadHandler(relative) {
  const previousDeno = globalThis.Deno;
  let handler = null;
  globalThis.Deno = { serve: (candidate) => { handler = candidate; } };
  try {
    const source = read(relative);
    const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${Math.random()}`;
    await import(url);
  } finally {
    globalThis.Deno = previousDeno;
  }
  assert.equal(typeof handler, 'function');
  return handler;
}

async function assertPausedResponse(relative, code) {
  const handler = await loadHandler(relative);
  const response = await handler(new Request('https://local.test/generator', { method: 'POST' }));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('pragma'), 'no-cache');
  assert.deepEqual(await response.json(), {
    success: false,
    paused: true,
    code,
    error: code === 'PATIENT_EDUCATION_GENERATION_PAUSED'
      ? 'Patient education generation is temporarily unavailable pending tenant-safe storage'
      : 'Discharge summary generation is temporarily unavailable pending tenant-safe storage',
  });

  const methodDenied = await handler(new Request('https://local.test/generator', { method: 'GET' }));
  assert.equal(methodDenied.status, 405);
  assert.equal(methodDenied.headers.get('cache-control'), 'no-store');
  assert.equal(methodDenied.headers.get('allow'), 'POST');
  assert.deepEqual(await methodDenied.json(), { success: false, error: 'Method not allowed' });
}

test('patient education generation is quarantined before client, model, or sink access', async () => {
  assertQuarantined(
    read('base44/functions/generatePatientEducation/entry.ts'),
    'PATIENT_EDUCATION_GENERATION_PAUSED',
  );
  const caller = read('src/components/hub-tabs/PatientEducationPortal.jsx');
  assert.doesNotMatch(caller, /functions\.invoke\(['"]generatePatientEducation/);
  assert.doesNotMatch(caller, FORBIDDEN_UI_SINK_ACCESS);
  assert.match(caller, /Patient education generation is temporarily unavailable/);
  await assertPausedResponse(
    'base44/functions/generatePatientEducation/entry.ts',
    'PATIENT_EDUCATION_GENERATION_PAUSED',
  );
});

test('discharge generation is quarantined before client, model, or sink access', async () => {
  assertQuarantined(
    read('base44/functions/generateDischargeSummary/entry.ts'),
    'DISCHARGE_SUMMARY_GENERATION_PAUSED',
  );
  for (const relative of [
    'src/components/discharge/DischargeSummaryWorkflow.jsx',
    'src/components/discharge/DischargeSummaryGenerator.jsx',
    'src/components/hub-tabs/DischargeSummaries.jsx',
  ]) {
    const caller = read(relative);
    assert.doesNotMatch(caller, /functions\.invoke\(['"]generateDischargeSummary/);
    assert.doesNotMatch(caller, FORBIDDEN_UI_SINK_ACCESS);
    assert.match(caller, /temporarily unavailable|Unavailable|paused pending tenant-safe storage/);
  }
  await assertPausedResponse(
    'base44/functions/generateDischargeSummary/entry.ts',
    'DISCHARGE_SUMMARY_GENERATION_PAUSED',
  );
});

test('quarantined generator-only read purposes are not exposed by Patient or Visit brokers', () => {
  for (const relative of [
    'base44/functions/getAuthorizedPatient/entry.ts',
    'base44/functions/getAuthorizedVisit/entry.ts',
    'base44/functions/listAuthorizedVisits/entry.ts',
    'src/functions/getAuthorizedPatient.js',
    'src/functions/getAuthorizedVisit.js',
    'src/functions/listAuthorizedVisits.js',
  ]) {
    const source = read(relative);
    assert.doesNotMatch(source, /education_generation|discharge_summary_generation/);
  }
});
