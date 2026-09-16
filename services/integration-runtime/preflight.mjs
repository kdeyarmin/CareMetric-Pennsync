import { BUCKET, createStore } from './runtime.mjs';
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
  if (config.anthropicKey) await check('anthropic', 'https://api.anthropic.com/v1/models?limit=100', {
    headers: { 'x-api-key': config.anthropicKey, 'anthropic-version': '2023-06-01' },
  }, data => ({ valid: Array.isArray(data.data) && data.data.some(model => model.id === config.model),
    model: config.model, hasMore: data.has_more === true }));
  else checks.anthropic = { valid: false, configured: false };
  if (config.sendgridKey) await check('sendgrid', 'https://api.sendgrid.com/v3/scopes', {
    headers: { Authorization: `Bearer ${config.sendgridKey}` },
  }, data => ({ valid: Array.isArray(data.scopes) && data.scopes.includes('mail.send'), senderConfigured: !!config.fromEmail }));
  else checks.sendgrid = { valid: false, configured: false };
  if (config.supabaseUrl && config.supabaseKey) {
    await check('storage', `${config.supabaseUrl}/storage/v1/bucket/${BUCKET}`, {
      headers: { apikey: config.supabaseKey, Authorization: `Bearer ${config.supabaseKey}` },
    }, data => ({ valid: data.id === BUCKET && data.public === false && data.file_size_limit === 8388608 }));
    try {
      // Explicitly nonexistent synthetic lookup. No user identity or real file
      // list is read; the API only returns an exact owner-bound result.
      const result = await createStore(config, fetcher).fileGet({ p_id: '00000000-0000-0000-0000-000000000000', p_app_id: config.appId, p_subject: '0'.repeat(64) });
      checks.stateRpc = { valid: result === null };
    } catch { checks.stateRpc = { valid: false }; }
  } else { checks.storage = { valid: false, configured: false }; checks.stateRpc = { valid: false }; }
  checks.resultEncryption = { valid: /^[a-f0-9]{64}$/.test(config.encryptionKey) };
  checks.identityHashing = { valid: /^[a-f0-9]{64}$/.test(config.hashKey) && config.hashKey !== config.encryptionKey };
  return { event: 'external_integration_preflight', paidCalls: 0, writes: 0,
    base44FunctionCalls: 0, checks, passed: Object.values(checks).every(check => check.valid === true) };
}
