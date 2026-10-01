import test from 'node:test';
import assert from 'node:assert/strict';
import { HANDLERS } from './handlers.mjs';
import {
  CMS_REGULATION_PROMPT, CMS_REGULATION_SCHEMA, REGULATION_MODEL, syncCmsRegulations,
} from './cms-regulations.mjs';

/**
 * The regulation sync's paused search leg.
 *
 * **This capability had no test of any kind until the pause**, which is how a
 * model name and a web-search flag the owned runtime refuses by name survived
 * in a shipped port: nothing ever drove it, and both halves — the params this
 * service sends and the params that runtime accepts — were right on their own.
 * The cross-check that catches the class is in
 * `base44/functionTests/pennsyncApiOriginalParity.test.js`; what is here is
 * this capability's own behaviour.
 */
const rejects = async (promise, code, status) => {
  await assert.rejects(promise, error => {
    assert.equal(error.code, code);
    assert.equal(error.status, status);
    return true;
  });
};
const broker = () => {
  const calls = [];
  return { calls, integration: async (operation, payload) => { calls.push({ operation, payload }); return {}; } };
};

test('the search leg is refused by name, before the model is reached', async () => {
  const b = broker();
  const contract = async () => assert.fail('no contract call may be made');
  const audit = async () => assert.fail('no trail entry may be written');
  await rejects(syncCmsRegulations({ integration: b.integration, contract, audit }),
    'WEB_SEARCH_RELEASE_PAUSED', 503);
  // The important half. A refusal AFTER the call would still have asked a model
  // for current regulations, and a refusal after the contract would have left a
  // half-written sync.
  assert.deepEqual(b.calls, []);
});

test('the handler refuses the same way, so no caller sees a different answer', async () => {
  const b = broker();
  await rejects(HANDLERS.syncCMSRegulations.handle({
    params: {}, integration: b.integration,
    contract: async () => assert.fail('unreachable'),
    audit: async () => assert.fail('unreachable'),
  }), 'WEB_SEARCH_RELEASE_PAUSED', 503);
  assert.deepEqual(b.calls, []);
});

test('the params are still the original s, so the pause is reversible', () => {
  // The port below the guard is whole and is not edited down to match the
  // pause: restoring the capability when a web search provider exists is
  // deleting one guard, not rebuilding a prompt. These are the three the
  // runtime refuses, kept as the original wrote them.
  assert.equal(REGULATION_MODEL, 'gemini_3_1_pro');
  assert.match(CMS_REGULATION_PROMPT, /Search the internet/);
  assert.equal(CMS_REGULATION_SCHEMA.type, 'object');
});

test('the capability is still declared as reaching the runtime', () => {
  // Left true deliberately. The pause is this service's, not a statement that
  // the capability has no integration half — and the release ladder reads this
  // flag, so flipping it would move the capability out of the wave that
  // describes it.
  assert.equal(HANDLERS.syncCMSRegulations.needsIntegration, true);
});
