import { AUTHORITY_RPC, authorityKeyAccepted } from './authority.mjs';
import { BUCKET, createStore, validSender } from './runtime.mjs';
import { readJson } from './safety.mjs';

export const VERIFIED_SENDERS_URL = 'https://api.sendgrid.com/v3/verified_senders';
export const AUTHENTICATED_DOMAINS_URL = 'https://api.sendgrid.com/v3/whitelabel/domains';

/**
 * Whether the from-address is itself a verified single sender.
 *
 * `/v3/verified_senders` returns verified AND unverified senders together —
 * SendGrid's own description of the endpoint says so — so presence in the list
 * proves nothing and the `verified` flag is the entire answer. A check that
 * tested membership would report an unverified sender as verified, which is the
 * class of answer this whole check exists to stop giving.
 *
 * Returns null for a shape this does not recognise, which the caller reports as
 * NOT_MEASURED rather than as a negative verdict.
 */
export function singleSenderVerified(data, fromEmail) {
  if (!data || !Array.isArray(data.results)) return null;
  const wanted = String(fromEmail).trim().toLowerCase();
  return data.results.some(entry => entry && entry.verified === true
    && typeof entry.from_email === 'string' && entry.from_email.trim().toLowerCase() === wanted);
}

/**
 * Whether the from-address's DOMAIN is authenticated and validated.
 *
 * This half is not thoroughness, it is the difference between a true and a
 * false answer. SendGrid's support documentation states that with the sender
 * domain authenticated an address may be used "without having to authenticate a
 * Single Sender email address", and that single senders are not recommended for
 * API sending at all — so the recommended production configuration is exactly
 * the one a sender-list check ALONE would report as unverified.
 *
 * The domain match is EXACT and never a suffix: an authenticated `example.com`
 * supports no claim about `mail.example.com`, and answering VERIFIED too
 * readily is the expensive direction to be wrong in. A from-domain matching
 * nothing is reported with the valid domains beside it, so a subdomain setup is
 * visible to whoever reads the report instead of being silently judged.
 */
export function domainAuthenticated(data, fromEmail) {
  if (!Array.isArray(data)) return null;
  const domain = String(fromEmail).split('@').pop().trim().toLowerCase();
  if (!domain) return false;
  return data.some(entry => entry && entry.valid === true
    && typeof entry.domain === 'string' && entry.domain.trim().toLowerCase() === domain);
}

/** The domains the provider says are authenticated, for a report a human reads. */
function validDomains(data) {
  return Array.isArray(data)
    ? data.filter(entry => entry && entry.valid === true && typeof entry.domain === 'string')
      .map(entry => entry.domain.trim().toLowerCase()).slice(0, 20)
    : [];
}

const unmeasured = (reason, extra = {}) =>
  ({ verdict: 'NOT_MEASURED', measured: false, valid: false, reason, ...extra });

/**
 * Ask the PROVIDER whether the configured from-address may send.
 *
 * Three verdicts, and they are deliberately different values. VERIFIED and
 * NOT_VERIFIED are answers SendGrid gave. NOT_MEASURED is the absence of one: a
 * key without the scope to read a list has told us about the key, never about
 * the sender, and recording that as NOT_VERIFIED would be a verdict nobody
 * issued. Only once BOTH routes have answered can absence mean anything.
 *
 * Reads only. Nothing here sends, and every failure is contained, because this
 * runs after `listen` and must not be able to fail a boot.
 */
async function senderVerification(config, fetcher) {
  if (!config.sendgridKey) return unmeasured('NO_PROVIDER_KEY');
  if (!validSender(config.fromEmail)) return unmeasured('FROM_ADDRESS_MALFORMED');
  const fromDomain = String(config.fromEmail).split('@').pop().trim().toLowerCase();
  async function read(url, interpret) {
    try {
      const response = await fetcher(url, {
        headers: { Authorization: `Bearer ${config.sendgridKey}` },
        redirect: 'error', signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        return { answer: null, status: response.status,
          reason: [401, 403].includes(response.status) ? 'PROVIDER_REFUSED_THE_READ' : 'PROVIDER_ERROR' };
      }
      const body = await readJson(response, 512000);
      const answer = interpret(body);
      return answer === null
        ? { answer: null, status: response.status, reason: 'UNRECOGNISED_RESPONSE' }
        : { answer, status: response.status, body };
    } catch { return { answer: null, reason: 'PROVIDER_UNREACHABLE' }; }
  }
  const sender = await read(VERIFIED_SENDERS_URL, data => singleSenderVerified(data, config.fromEmail));
  if (sender.answer === true) {
    return { verdict: 'VERIFIED', measured: true, valid: true, route: 'single_sender', fromDomain };
  }
  const domain = await read(AUTHENTICATED_DOMAINS_URL, data => domainAuthenticated(data, config.fromEmail));
  if (domain.answer === true) {
    return { verdict: 'VERIFIED', measured: true, valid: true, route: 'authenticated_domain', fromDomain };
  }
  if (sender.answer === false && domain.answer === false) {
    return { verdict: 'NOT_VERIFIED', measured: true, valid: false, fromDomain,
      singleSenderVerified: false, domainAuthenticated: false, validDomains: validDomains(domain.body) };
  }
  const failed = sender.answer === null ? sender : domain;
  return unmeasured(failed.reason, { fromDomain, ...(failed.status ? { status: failed.status } : {}) });
}

export async function runPreflight(config, fetcher = fetch) {
  const checks = {};
  async function check(name, url, options, evaluate) {
    try {
      const response = await fetcher(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (!response.ok) { checks[name] = { status: response.status, valid: false }; return; }
      checks[name] = { status: response.status, ...evaluate(await readJson(response, 512000)) };
    } catch { checks[name] = { valid: false, error: 'METADATA_CHECK_UNAVAILABLE' }; }
  }
  const needsAI = config.operations.some(name => ['InvokeLLM', 'ExtractDataFromUploadedFile'].includes(name));
  const needsEmail = config.operations.includes('SendEmail');
  if (config.anthropicKey) await check('anthropic', 'https://api.anthropic.com/v1/models?limit=100', {
    headers: { 'x-api-key': config.anthropicKey, 'anthropic-version': '2023-06-01' },
  }, data => ({ valid: Array.isArray(data.data) && data.data.some(model => model.id === config.model), model: config.model, hasMore: data.has_more === true }));
  else checks.anthropic = { valid: !needsAI, configured: false, notApplicable: !needsAI };
  checks.anthropic.required = needsAI;
  // `fromAddressWellFormed` is this process reading its own configuration with a
  // regular expression, and is named so that nobody can mistake it for the
  // provider's answer about the sender. The provider's answer is
  // `checks.sendgridSender` below, and it is the only thing here that has asked.
  if (config.sendgridKey) await check('sendgrid', 'https://api.sendgrid.com/v3/scopes', {
    headers: { Authorization: `Bearer ${config.sendgridKey}` },
  }, data => ({ valid: Array.isArray(data.scopes) && data.scopes.includes('mail.send') && validSender(config.fromEmail), fromAddressWellFormed: validSender(config.fromEmail) }));
  else checks.sendgrid = { valid: !needsEmail, configured: false, notApplicable: !needsEmail };
  checks.sendgrid.required = needsEmail;
  checks.sendgridSender = needsEmail
    ? await senderVerification(config, fetcher)
    : { verdict: 'NOT_APPLICABLE', measured: false, valid: true, notApplicable: true };
  checks.sendgridSender.required = needsEmail;
  if (config.supabaseUrl && config.supabaseKey) {
    await check('storage', `${config.supabaseUrl}/storage/v1/bucket/${BUCKET}`, {
      headers: { apikey: config.supabaseKey, Authorization: `Bearer ${config.supabaseKey}` },
    }, data => ({ valid: data.id === BUCKET && data.public === false && data.file_size_limit === 8388608 }));
    try {
      const result = await createStore(config, fetcher).fileGet({ p_id: '00000000-0000-0000-0000-000000000000', p_app_id: config.appId, p_subject: '0'.repeat(64) });
      checks.stateRpc = { valid: result === null };
    } catch { checks.stateRpc = { valid: false }; }
  } else { checks.storage = { valid: false, configured: false }; checks.stateRpc = { valid: false }; }
  // Independent authority: prove the fixed RPC exists and that the publishable
  // key alone is refused. A successful anonymous call would mean the caller's
  // own token is not what authorizes; that must fail the preflight.
  const needsAuthority = config.authorityMode === 'independent';
  if (needsAuthority) {
    try {
      const response = await fetcher(`${config.authorityUrl}/rest/v1/rpc/${AUTHORITY_RPC}`, {
        method: 'POST',
        headers: { apikey: config.authorityKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ p_app_id: config.appId, p_agency_id: 'preflight-anonymous-denial-probe' }),
        redirect: 'error', signal: AbortSignal.timeout(15000),
      });
      // A refusal is necessary and not sufficient: a REVOKED publishable key is
      // refused identically to a live one, so the status alone passes the check
      // in exactly the state it exists to catch. `authorityKeyAccepted` reads
      // the body for the SQLSTATE that only a request reaching the database
      // carries. Kept as its own field beside the refusal, as
      // `fromAddressWellFormed` is kept beside SendGrid's `valid`, so a failure
      // says which half failed.
      const anonymousDenied = [401, 403].includes(response.status);
      let keyAccepted = false;
      if (anonymousDenied) {
        try { keyAccepted = authorityKeyAccepted(await readJson(response, 65536)); } catch { keyAccepted = false; }
      }
      checks.authority = { status: response.status, valid: anonymousDenied && keyAccepted, anonymousDenied, keyAccepted };
    } catch { checks.authority = { valid: false, error: 'AUTHORITY_CHECK_UNAVAILABLE' }; }
  } else {
    checks.authority = { valid: true, notApplicable: true, mode: config.authorityMode || 'base44' };
  }
  checks.authority.required = needsAuthority;
  checks.resultEncryption = { valid: /^[a-f0-9]{64}$/.test(config.encryptionKey) };
  checks.identityHashing = { valid: /^[a-f0-9]{64}$/.test(config.hashKey) && config.hashKey !== config.encryptionKey };
  return { event: 'external_integration_preflight', paidCalls: 0, writes: 0,
    base44FunctionCalls: 0, checks, passed: Object.values(checks).every(check => check.required === false || check.valid === true) };
}
