import { secrets } from 'base44:runtime';

export const AI_POLICY_KEY = 'platform-ai-responsibility-v1';
async function signature(row, dataEnv) {
  const secret = secrets.get('SIGNATURE_HMAC_SECRET');
  if (!secret) throw new Error('Policy signing is unavailable');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const message = JSON.stringify(['694ec16e72e01b60d22f7cbf', dataEnv === 'dev' ? 'dev' : 'prod', row.policy_key, row.bypass_previously_acknowledged, row.changed_by_user_id, row.changed_at]);
  const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
}
export async function signAiPolicy(row, dataEnv) {
  return { ...row, policy_signature: await signature(row, dataEnv) };
}
export async function readAiPolicy(entities, dataEnv) {
  const rows = await entities.AIResponsibilityPolicy.filter({ policy_key: AI_POLICY_KEY }, '-created_date', 2);
  if (!Array.isArray(rows) || rows.length > 1) throw new Error('Consent policy could not be reconciled');
  if (!rows.length) return null;
  const row = rows[0];
  if (typeof row.bypass_previously_acknowledged !== 'boolean' || typeof row.changed_by_user_id !== 'string' || !row.changed_by_user_id || typeof row.changed_at !== 'string' || !Number.isFinite(Date.parse(row.changed_at))) throw new Error('Invalid consent policy');
  const expected = await signature(row, dataEnv);
  const actual = row.policy_signature;
  if (typeof actual !== 'string' || actual.length !== expected.length) throw new Error('Invalid consent policy signature');
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  if (difference !== 0) throw new Error('Invalid consent policy signature');
  return row;
}