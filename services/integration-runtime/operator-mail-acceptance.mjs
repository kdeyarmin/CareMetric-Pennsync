import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { loadConfig, createStore, performDurable } from './runtime.mjs';
import { buildMailPayload, emailAddress } from './mail-contract.mjs';
import { hash, fail, IntegrationError } from './safety.mjs';

// Fixed synthetic content only. Normal server imports neither this CLI nor its
// authorization switch. SendGrid sandbox validates payloads without delivery.
export const MAIL_FIXTURE = Object.freeze({
  to: 'acceptance@example.invalid',
  from_name: 'PennSync by CareMetric',
  subject: 'Synthetic mail compatibility acceptance - do not deliver',
  body: '<!doctype html><html><body><table role="presentation"><tr><td style="color:#213a76"><strong>Synthetic review</strong><p>Training fixture &amp; escaped text.</p></td></tr></table><a href="https://app.caremetricai.com/privacy">Public privacy page</a></body></html>',
  content_type: 'text/html',
});
const CONFIRMATION = 'explicit-mail-sandbox-v1';
export async function runMailAcceptance(config, { authorization, fetcher = fetch, store: suppliedStore } = {}) {
  if (authorization !== CONFIRMATION || config.released || config.browserReleased || !config.configured || !config.sendgridKey
    || config.operations.length || config.browserOperations?.length || !/^[a-f0-9]{40}$/.test(config.revision || '')) fail(403, 'MAIL_ACCEPTANCE_NOT_AUTHORIZED');
  // Reject malformed sender configuration before creating an irrevocable
  // acceptance reservation. The same pure builder validates the actual send.
  buildMailPayload(MAIL_FIXTURE, config.fromEmail, { sandbox: true });
  const requestBinding = { contract: 'cm.mail.sandbox.acceptance.v1', revision: config.revision, sender: emailAddress(config.fromEmail) };
  const bindingId = hash(config.hashKey, requestBinding);
  const subject = hash(config.hashKey, [config.appId, 'operator-synthetic-mail-contract-v1']);
  const actor = { subject, snapshot: 'operator-synthetic-not-employee-authority', canEmail: true };
  const counts = { sandboxRequests: 0, stateRequests: 0, modelRequests: 0, base44Requests: 0, deliveries: 0 };
  const seen = new Set();
  async function fixedEgress(input, options = {}) {
    const url = new URL(input);
    if (url.username || url.password || url.hash || url.search || options.method !== 'POST') fail(403, 'MAIL_ACCEPTANCE_EGRESS_REJECTED');
    const value = JSON.parse(options.body);
    if (url.origin === 'https://api.sendgrid.com' && url.pathname === '/v3/mail/send') {
      if (counts.sandboxRequests >= 2) fail(409, 'MAIL_ACCEPTANCE_BUDGET');
      const type = value.content?.[0]?.type;
      if (!['text/plain', 'text/html'].includes(type) || seen.has(type)) fail(403, 'MAIL_ACCEPTANCE_CONTENT_REJECTED');
      const fixture = type === 'text/html' ? MAIL_FIXTURE : { ...MAIL_FIXTURE, content_type: 'text/plain', body: 'Synthetic plain-text compatibility. No delivery.' };
      const expected = buildMailPayload(fixture, config.fromEmail, { sandbox: true });
      if (JSON.stringify(value) !== JSON.stringify(expected) || value.mail_settings?.sandbox_mode?.enable !== true) fail(403, 'MAIL_ACCEPTANCE_NOT_SANDBOXED');
      seen.add(type); counts.sandboxRequests++;
    } else if (url.origin === config.supabaseUrl && ['/rest/v1/rpc/cm_integration_reserve', '/rest/v1/rpc/cm_integration_finish'].includes(url.pathname)) {
      if (value.p_app_id && value.p_app_id !== config.appId) fail(403, 'MAIL_ACCEPTANCE_APP_MISMATCH');
      if (value.p_subject && value.p_subject !== subject) fail(403, 'MAIL_ACCEPTANCE_SUBJECT_MISMATCH');
      counts.stateRequests++;
    } else fail(403, 'MAIL_ACCEPTANCE_EGRESS_REJECTED');
    return fetcher(url.href, { ...options, redirect: 'error' });
  }
  const store = suppliedStore || createStore(config, fixedEgress);
  const provider = async (_operation, params) => {
    const response = await fixedEgress('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST', headers: { Authorization: `Bearer ${config.sendgridKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildMailPayload(params, config.fromEmail, { sandbox: true })), signal: AbortSignal.timeout(20000),
    });
    if (response.status !== 200) fail(502, 'MAIL_SANDBOX_NOT_VALIDATED');
    return { sandboxValidated: true, delivered: false, contentType: params.content_type, provider: 'sendgrid' };
  };
  const invoke = (params, label) => performDurable({ config, req: new Request('https://operator.invalid'),
    agencyId: 'synthetic-not-an-agency', operation: 'SendEmail', params,
    requestId: `operator-mail-${label}-${bindingId}`, requestBinding, authority: async () => actor, store, provider });
  const plain = await invoke({ ...MAIL_FIXTURE, content_type: 'text/plain', body: 'Synthetic plain-text compatibility. No delivery.' }, 'plain');
  const html = await invoke(MAIL_FIXTURE, 'html');
  const before = counts.sandboxRequests;
  await invoke(MAIL_FIXTURE, 'html');
  const passed = plain.sandboxValidated === true && plain.contentType === 'text/plain' && plain.delivered === false
    && html.sandboxValidated === true && html.contentType === 'text/html' && html.delivered === false && counts.sandboxRequests === before;
  return { event: 'external_mail_contract_acceptance', revision: config.revision, passed,
    scope: 'fixed-synthetic-sandbox-not-customer-delivery', plainTextValidated: plain.sandboxValidated === true,
    htmlValidated: html.sandboxValidated === true, replayAvoided: counts.sandboxRequests === before,
    counts, customerRecordsAccessed: false, actualDelivery: false, trafficCutover: false };
}
export async function main(args = process.argv.slice(2), env = process.env, log = value => process.stdout.write(JSON.stringify(value) + '\n')) {
  if (args.length !== 1 || args[0] !== '--execute-mail-sandbox-v1') {
    log({ event: 'external_mail_acceptance_refused', code: 'EXPLICIT_FLAG_REQUIRED' }); return 2;
  }
  try {
    const report = await runMailAcceptance(loadConfig(env), { authorization: env.INTEGRATIONS_MAIL_ACCEPTANCE });
    log(report); return report.passed ? 0 : 1;
  } catch (error) {
    log({ event: 'external_mail_contract_acceptance', passed: false,
      code: error instanceof IntegrationError ? error.code : 'MAIL_ACCEPTANCE_UNAVAILABLE', actualDelivery: false, trafficCutover: false }); return 1;
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = await main();
