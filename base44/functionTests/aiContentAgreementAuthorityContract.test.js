import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import JSON5 from 'json5';
import { transpileTs } from '../../tools-transpile-ts.mjs';
import {
  AI_CONTENT_AGREEMENT_ACKNOWLEDGMENTS,
  AI_CONTENT_AGREEMENT_VERSION,
} from '../../src/lib/aiContentAgreement.js';

async function loadStatusBroker(client) {
  let source = await readFile(
    new URL('../functions/getAiContentAgreementStatus/entry.ts', import.meta.url),
    'utf8',
  );
  source = source.replace(
    /import\s+\{[^}]*\}\s+from\s+'npm:@base44\/sdk@[^']*';?/,
    'const createClientFromRequest = globalThis.__agreementStatusClient;',
  );
  const file = join(
    tmpdir(),
    `agreement_status_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
  );
  await writeFile(file, transpileTs(source).outputText);
  let handler;
  const previousDeno = globalThis.Deno;
  globalThis.__agreementStatusClient = () => client;
  globalThis.Deno = { serve: (candidate) => { handler = candidate; } };
  try {
    await import(pathToFileURL(file).href);
  } finally {
    await unlink(file).catch(() => {});
    delete globalThis.__agreementStatusClient;
    if (previousDeno === undefined) delete globalThis.Deno;
    else globalThis.Deno = previousDeno;
  }
  return handler;
}

const statusRequest = (body = {}, method = 'POST') => new Request(
  'http://local/get-ai-content-agreement-status',
  {
    method,
    headers: { 'content-type': 'application/json' },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  },
);

const actor = {
  id: 'user-1',
  email: 'Nurse@Example.test',
  full_name: 'Nurse One',
  is_active: true,
};

const currentAttestation = {
  id: 'attestation-1',
  user_id: 'user-1',
  user_email_normalized: 'nurse@example.test',
  agreement_version: AI_CONTENT_AGREEMENT_VERSION,
  accepted_at: '2026-09-04T12:00:00.000Z',
  acknowledgments: AI_CONTENT_AGREEMENT_ACKNOWLEDGMENTS,
  audit_event_id: 'event-1',
};

function statusClient({ rows = [], currentActor = actor, onActorRead } = {}) {
  return {
    auth: { me: async () => currentActor },
    asServiceRole: { entities: {
      User: { filter: async (query, sort, limit) => {
        assert.deepEqual(query, { id: 'user-1' });
        assert.equal(sort, undefined);
        assert.equal(limit, 2);
        onActorRead?.();
        return [currentActor];
      } },
      AIContentAgreementAttestation: {
        filter: async (query, sort, limit) => {
          assert.deepEqual(query, {
            user_id: 'user-1',
            user_email_normalized: 'nurse@example.test',
          });
          assert.equal(sort, '-created_date');
          assert.equal(limit, 50);
          return rows;
        },
      },
      // Historical UserActivity data was once browser-forgeable. The status
      // broker must never consult it as gate authority.
      get UserActivity() {
        throw new Error('UserActivity must not be read for agreement authority');
      },
    } },
  };
}

test('agreement authority entity is private and immutable to every SDK user', async () => {
  const schema = JSON5.parse(await readFile(
    new URL('../entities/AIContentAgreementAttestation.jsonc', import.meta.url),
    'utf8',
  ));
  assert.deepEqual(schema.rls, {
    read: false,
    create: false,
    update: false,
    delete: false,
  });
});

test('status broker accepts only a current immutable authority record', async () => {
  let actorReads = 0;
  const handler = await loadStatusBroker(statusClient({
    rows: [currentAttestation],
    onActorRead: () => { actorReads += 1; },
  }));
  const response = await handler(statusRequest());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), {
    accepted: true,
    agreement_version: AI_CONTENT_AGREEMENT_VERSION,
  });
  assert.equal(actorReads, 2, 'protected actor must be checked before and after authority read');
});

test('valid historical authority re-prompts instead of failing verification', async () => {
  const historical = {
    ...currentAttestation,
    id: 'attestation-old',
    agreement_version: '0.9',
    acknowledgments: ['A prior canonical acknowledgment'],
  };
  const handler = await loadStatusBroker(statusClient({ rows: [historical] }));
  const response = await handler(statusRequest());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    accepted: false,
    agreement_version: AI_CONTENT_AGREEMENT_VERSION,
  });
});

test('status broker rejects wrong transport, caller-shaped input, and blocked actors', async () => {
  let authReads = 0;
  const blockedClient = {
    auth: { me: async () => {
      authReads += 1;
      return { ...actor, is_service: true };
    } },
    asServiceRole: { get entities() { throw new Error('service access must not occur'); } },
  };
  const handler = await loadStatusBroker(blockedClient);

  const wrongMethod = await handler(statusRequest(undefined, 'GET'));
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get('allow'), 'POST');
  assert.equal(wrongMethod.headers.get('cache-control'), 'no-store');
  assert.equal(authReads, 0);

  const blocked = await handler(statusRequest());
  assert.equal(blocked.status, 403);
  assert.equal(blocked.headers.get('cache-control'), 'no-store');
  assert.equal(authReads, 1);

  let serviceReads = 0;
  const validClient = {
    auth: { me: async () => actor },
    asServiceRole: { get entities() { serviceReads += 1; return {}; } },
  };
  const validHandler = await loadStatusBroker(validClient);
  const extra = await validHandler(statusRequest({ user_id: 'victim' }));
  assert.equal(extra.status, 400);
  assert.equal(serviceReads, 0);
});

test('status broker fails closed on malformed, foreign, or altered authority rows', async () => {
  for (const [name, row] of [
    ['foreign actor', { ...currentAttestation, user_id: 'victim' }],
    ['noncanonical email', { ...currentAttestation, user_email_normalized: 'Other@Example.test' }],
    ['invalid timestamp', { ...currentAttestation, accepted_at: 'yesterday' }],
    ['altered current wording', { ...currentAttestation, acknowledgments: ['different'] }],
    ['missing audit correlation', { ...currentAttestation, audit_event_id: '' }],
  ]) {
    const handler = await loadStatusBroker(statusClient({ rows: [row] }));
    const response = await handler(statusRequest());
    assert.equal(response.status, 409, name);
    assert.equal(response.headers.get('cache-control'), 'no-store', name);
  }
});

test('status broker fails closed if protected account state changes during read', async () => {
  let reads = 0;
  let mutableActor = { ...actor };
  const client = {
    auth: { me: async () => mutableActor },
    asServiceRole: { entities: {
      User: { filter: async () => {
        reads += 1;
        if (reads === 2) mutableActor = { ...mutableActor, disabled: true };
        return [mutableActor];
      } },
      AIContentAgreementAttestation: { filter: async () => [currentAttestation] },
    } },
  };
  const handler = await loadStatusBroker(client);
  const response = await handler(statusRequest());
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('App gates on broker status and never on legacy User flags', async () => {
  const app = await readFile(new URL('../../src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /queryFn:\s*getAiContentAgreementStatus/);
  assert.match(app, /hasAcceptedAiContentAgreement\(agreementStatus\.data\)/);
  assert.doesNotMatch(app, /hasAcceptedAiContentAgreement\(user\)/);
  assert.match(app, /AgreementVerificationUnavailable/);
  assert.match(app, /agreementStatus\.isFetching/);
  assert.match(app, /Protected agreement verification did not confirm the current version/);
});
