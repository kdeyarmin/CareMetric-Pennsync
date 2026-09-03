import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const FUNCTION_NAMES = [
  'processDischargeReport',
  'monitorClinicalDataForCarePlanUpdates',
  'deletePatientsMissingFirstName',
  'migrateExistingData',
  'calculateDataQualityScores',
  'enforceDataCompleteness',
  'predictPatientRisks',
  'predictiveRiskAnalysis',
];

const PAUSE_CODE = 'legacy_patient_service_writer_paused';
const PAUSE_REASON = 'immutable_tenant_authorization_and_atomic_write_broker_required';

const sourceUrl = (functionName) => new URL(
  `../functions/${functionName}/entry.ts`,
  import.meta.url,
);

async function loadHandler(functionName, activity) {
  let source = await readFile(sourceUrl(functionName), 'utf8');
  source = source.replace(
    /import\s+\{\s*createClientFromRequest\s*\}\s+from\s+'npm:[^']+';?/,
    'const createClientFromRequest = globalThis.__legacyPatientWriterMakeClient;',
  );

  const temporaryModule = join(
    tmpdir(),
    `legacy_patient_writer_${functionName}_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
  );
  await writeFile(temporaryModule, transpileTs(source).outputText);

  const trackedMethods = new Proxy({}, {
    get() {
      activity.entityOrIntegrationCalls += 1;
      return async () => {
        activity.entityOrIntegrationCalls += 1;
        throw new Error('contained handler reached a privileged resource');
      };
    },
  });
  const trackedClient = {
    auth: {
      me: async () => {
        activity.authCalls += 1;
        return {
          id: 'forged-platform-owner',
          email: 'owner@example.test',
          role: 'admin',
          account_type: 'super_admin',
          is_active: true,
          is_verified: true,
        };
      },
    },
    asServiceRole: new Proxy({}, {
      get(_target, property) {
        activity.serviceRoleReads += 1;
        if (property === 'entities' || property === 'integrations') {
          return new Proxy({}, {
            get() {
              activity.entityOrIntegrationReads += 1;
              return trackedMethods;
            },
          });
        }
        return trackedMethods;
      },
    }),
  };

  let handler;
  globalThis.__legacyPatientWriterMakeClient = () => {
    activity.clientCreations += 1;
    return trackedClient;
  };
  globalThis.Deno = {
    env: {
      get: () => {
        activity.envReads += 1;
        return 'owner@example.test';
      },
    },
    serve: (candidate) => { handler = candidate; },
  };

  try {
    await import(pathToFileURL(temporaryModule).href);
  } finally {
    await unlink(temporaryModule).catch(() => {});
    delete globalThis.__legacyPatientWriterMakeClient;
  }
  assert.equal(typeof handler, 'function', `${functionName} must register a handler`);
  return handler;
}

function makeAdversarialRequest(activity) {
  const target = {
    method: 'POST',
    headers: new Headers({
      authorization: 'Bearer forged-platform-owner-token',
      'content-type': 'application/json',
    }),
    json: async () => {
      activity.bodyReads += 1;
      return {
        confirm: true,
        patient_id: { $ne: null },
        file_url: 'https://attacker.invalid/private.csv',
        agency_id: 'victim-agency',
        role: 'admin',
        account_type: 'super_admin',
      };
    },
  };
  return new Proxy(target, {
    get(object, property, receiver) {
      activity.requestReads += 1;
      return Reflect.get(object, property, receiver);
    },
  });
}

test('all legacy Patient service-role writers return the same controlled boundary without activity', async () => {
  for (const functionName of FUNCTION_NAMES) {
    const activity = {
      requestReads: 0,
      bodyReads: 0,
      clientCreations: 0,
      authCalls: 0,
      serviceRoleReads: 0,
      entityOrIntegrationReads: 0,
      entityOrIntegrationCalls: 0,
      envReads: 0,
    };
    const handler = await loadHandler(functionName, activity);
    const response = await handler(makeAdversarialRequest(activity));

    assert.equal(response.status, 503, functionName);
    assert.deepEqual(await response.json(), {
      error: 'Legacy Patient service-role writer is temporarily unavailable',
      code: PAUSE_CODE,
      reason: PAUSE_REASON,
      endpoint: functionName,
    });
    assert.deepEqual(activity, {
      requestReads: 0,
      bodyReads: 0,
      clientCreations: 0,
      authCalls: 0,
      serviceRoleReads: 0,
      entityOrIntegrationReads: 0,
      entityOrIntegrationCalls: 0,
      envReads: 0,
    }, `${functionName} must stop before request, client, auth, service, entity, or integration activity`);
  }
});

test('the pause is the first executable handler statement and precedes all legacy input and client code', async () => {
  for (const functionName of FUNCTION_NAMES) {
    const source = await readFile(sourceUrl(functionName), 'utf8');
    const serveMarker = 'Deno.serve(async (req) => {';
    const serveIndex = source.indexOf(serveMarker);
    assert.notEqual(serveIndex, -1, functionName);

    const handlerSource = source.slice(serveIndex + serveMarker.length);
    const firstExecutable = handlerSource.replace(/^\s*(?:\/\/[^\n]*\n\s*)*/, '');
    assert.ok(
      firstExecutable.startsWith('return Response.json({'),
      `${functionName} must return before any executable handler code`,
    );

    const pauseReturnIndex = handlerSource.indexOf('return Response.json({');
    const clientIndex = handlerSource.indexOf('createClientFromRequest(req)');
    assert.ok(pauseReturnIndex >= 0, `${functionName} must include the pause response`);
    assert.ok(clientIndex > pauseReturnIndex, `${functionName} must pause before client creation`);
    assert.ok(
      handlerSource.indexOf("code: 'legacy_patient_service_writer_paused'", pauseReturnIndex) > pauseReturnIndex,
      `${functionName} must pin the machine-readable pause code`,
    );
    assert.ok(
      handlerSource.indexOf(
        "reason: 'immutable_tenant_authorization_and_atomic_write_broker_required'",
        pauseReturnIndex,
      ) > pauseReturnIndex,
      `${functionName} must pin the machine-readable reason`,
    );
  }
});

test('all contained sources transpile successfully with their dormant redesign code preserved', async () => {
  for (const functionName of FUNCTION_NAMES) {
    const source = await readFile(sourceUrl(functionName), 'utf8');
    const result = transpileTs(source);
    assert.equal(result.diagnostics?.length || 0, 0, functionName);
    assert.match(result.outputText, /legacy_patient_service_writer_paused/, functionName);
    assert.match(result.outputText, /createClientFromRequest\(req\)/, functionName);
  }
});
