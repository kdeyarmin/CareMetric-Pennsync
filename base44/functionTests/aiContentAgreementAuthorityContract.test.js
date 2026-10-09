import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import JSON5 from 'json5';
import { importBackendModule, loadFunctionEntry } from './functionEntryLoader.js';
import {
  AI_CONTENT_AGREEMENT_ACKNOWLEDGMENTS,
  AI_CONTENT_AGREEMENT_VERSION,
} from '../../src/lib/aiContentAgreement.js';

async function loadStatusBroker(client, runtime) {
  return loadFunctionEntry(
    new URL('../functions/getAiContentAgreementStatus/entry.ts', import.meta.url),
    { client, runtime },
  );
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

function statusClient({ rows = [], currentActor = actor, onActorRead, policyRows = [] } = {}) {
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
      // The platform consent policy (base44/shared/aiResponsibilityPolicy.ts).
      // Absent by default: no bypass, so every historical row re-prompts.
      AIResponsibilityPolicy: {
        filter: async (query, sort, limit) => {
          assert.deepEqual(query, { policy_key: 'platform-ai-responsibility-v1' });
          assert.equal(sort, '-created_date');
          assert.equal(limit, 2);
          return policyRows;
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

// The platform consent policy (2026-10-09): a server-signed row may let a
// person who acknowledged an EARLIER version through without re-prompting.
// Signed with the shared module's own signAiPolicy, never a retyped HMAC.
const POLICY_SECRET = 'synthetic-policy-signing-secret';
const policyRuntime = (secret = POLICY_SECRET) => ({
  secrets: { get: (key) => (key === 'SIGNATURE_HMAC_SECRET' ? secret : undefined) },
});
async function signedPolicy(bypass, secret = POLICY_SECRET) {
  const { AI_POLICY_KEY, signAiPolicy } = await importBackendModule(
    new URL('../shared/aiResponsibilityPolicy.ts', import.meta.url),
    { runtime: policyRuntime(secret) },
  );
  return {
    id: 'policy-1',
    ...await signAiPolicy({
      policy_key: AI_POLICY_KEY,
      bypass_previously_acknowledged: bypass,
      changed_by_user_id: 'owner-1',
      changed_at: '2026-10-09T15:00:00.000Z',
    }, undefined),
  };
}
const historicalAttestation = {
  ...currentAttestation,
  id: 'attestation-old',
  agreement_version: '0.9',
  acknowledgments: ['A prior canonical acknowledgment'],
};

test('a signed bypass policy lets an earlier acknowledgment through, and nothing else', async () => {
  const bypassOn = await signedPolicy(true);
  const answer = async (rows, policyRows) => {
    const handler = await loadStatusBroker(statusClient({ rows, policyRows }), policyRuntime());
    const response = await handler(statusRequest());
    assert.equal(response.status, 200);
    return response.json();
  };
  assert.deepEqual(await answer([historicalAttestation], [bypassOn]), {
    accepted: false, agreement_version: AI_CONTENT_AGREEMENT_VERSION, bypassed: true,
  });
  // Never acknowledged anything: the policy does not stand in for consent.
  assert.deepEqual(await answer([], [bypassOn]), {
    accepted: false, agreement_version: AI_CONTENT_AGREEMENT_VERSION,
  });
  // A current acceptance is reported as acceptance, not as a bypass.
  assert.deepEqual(await answer([currentAttestation], [bypassOn]), {
    accepted: true, agreement_version: AI_CONTENT_AGREEMENT_VERSION,
  });
  // The policy turned off re-prompts exactly as having no policy does.
  assert.deepEqual(await answer([historicalAttestation], [await signedPolicy(false)]), {
    accepted: false, agreement_version: AI_CONTENT_AGREEMENT_VERSION,
  });
});

test('a policy that is altered, unsigned, foreign-keyed or duplicated fails closed', async () => {
  const bypassOff = await signedPolicy(false);
  for (const [name, policyRows] of [
    ['bypass flipped after signing', [{ ...bypassOff, bypass_previously_acknowledged: true }]],
    ['signature removed', [{ ...bypassOff, bypass_previously_acknowledged: true, policy_signature: undefined }]],
    ['signed with another key', [await signedPolicy(true, 'not-the-deployment-secret')]],
    ['two policy rows', [await signedPolicy(true), { ...await signedPolicy(true), id: 'policy-2' }]],
  ]) {
    const handler = await loadStatusBroker(
      statusClient({ rows: [historicalAttestation], policyRows }),
      policyRuntime(),
    );
    const response = await handler(statusRequest());
    assert.equal(response.status, 500, name);
    const body = await response.json();
    assert.equal(body.bypassed, undefined, name);
    assert.equal(body.accepted, undefined, name);
  }
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
  // Acceptance is confirmed by a fresh protected read, not by the recording
  // call's answer. Since 2026-10-09 that read lives in its own helper.
  assert.match(app, /onAccepted=\{\(\) => verifyAiContentAgreementAcceptance\(/);
  const verify = await readFile(
    new URL('../../src/lib/verifyAiContentAgreementAcceptance.js', import.meta.url),
    'utf8',
  );
  assert.match(verify, /await getAiContentAgreementStatus\(\)/);
  assert.match(verify, /if \(!hasAcceptedAiContentAgreement\(status\)\) \{\s*throw new Error\(/);
});
