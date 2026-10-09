import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { secrets } from 'base44:runtime';
import { AI_POLICY_KEY, readAiPolicy, signAiPolicy } from '../../shared/aiResponsibilityPolicy.ts';

export default async function(req) {
  const headers = { 'Cache-Control': 'no-store' };
  let stage = 'initialization';
  try {
    if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers });
    const appId = '694ec16e72e01b60d22f7cbf';
    const inboundApp = req.headers.get('Base44-App-Id');
    if (inboundApp && inboundApp !== appId) return Response.json({ error: 'Forbidden' }, { status: 403, headers });
    const pinnedHeaders = new Headers(req.headers);
    pinnedHeaders.set('Base44-App-Id', appId);
    pinnedHeaders.delete('Base44-Api-Url');
    stage = 'authentication';
    const client = createClientFromRequest(new Request(req.clone(), { headers: pinnedHeaders }));
    const user = await client.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers });
    stage = 'administrator configuration';
    const owner = String(secrets.get('SUPER_ADMIN_EMAIL') || '').trim().toLowerCase();
    if (!owner || user.role !== 'admin' || String(user.email || '').trim().toLowerCase() !== owner || user.is_active === false || user.disabled === true || user.is_service === true || user.is_verified === false) return Response.json({ error: 'Only the configured platform administrator can manage this setting.' }, { status: 403, headers });
    stage = 'request validation';
    const body = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'bypass_previously_acknowledged') || ('bypass_previously_acknowledged' in body && typeof body.bypass_previously_acknowledged !== 'boolean')) return Response.json({ error: 'Invalid request' }, { status: 400, headers });
    const entities = client.asServiceRole.entities;
    const dataEnv = req.headers.get('X-Data-Env');
    stage = 'policy retrieval';
    let policy = await readAiPolicy(entities, dataEnv);
    if ('bypass_previously_acknowledged' in body) {
      const signed = await signAiPolicy({ policy_key: AI_POLICY_KEY, bypass_previously_acknowledged: body.bypass_previously_acknowledged, changed_by_user_id: user.id, changed_at: new Date().toISOString() }, dataEnv);
      if (policy) await entities.AIResponsibilityPolicy.update(policy.id, signed);
      else await entities.AIResponsibilityPolicy.create(signed);
      policy = await readAiPolicy(entities, dataEnv);
      if (policy?.bypass_previously_acknowledged !== body.bypass_previously_acknowledged) throw new Error('Policy save was not confirmed');
    }
    return Response.json({ bypass_previously_acknowledged: policy?.bypass_previously_acknowledged === true }, { headers });
  } catch (error) {
    console.error('Consent policy request failed', error?.message);
    return Response.json({ error: `The consent setting could not be verified or saved (${stage}).` }, { status: 500, headers });
  }
}