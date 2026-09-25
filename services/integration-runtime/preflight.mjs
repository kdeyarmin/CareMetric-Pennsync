import { AUTHORITY_RPC, authorityKeyAccepted } from './authority.mjs';
import { BUCKET, createStore, validSender } from './runtime.mjs';
import { readJson } from './safety.mjs';

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
  if (config.sendgridKey) await check('sendgrid', 'https://api.sendgrid.com/v3/scopes', {
    headers: { Authorization: `Bearer ${config.sendgridKey}` },
  }, data => ({ valid: Array.isArray(data.scopes) && data.scopes.includes('mail.send') && validSender(config.fromEmail), senderConfigured: validSender(config.fromEmail) }));
  else checks.sendgrid = { valid: !needsEmail, configured: false, notApplicable: !needsEmail };
  checks.sendgrid.required = needsEmail;
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
      // carries. Kept as its own field beside the refusal, as `senderConfigured`
      // is kept beside SendGrid's `valid`, so a failure says which half failed.
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
