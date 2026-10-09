import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireClinicalWorkspace } from './securityAccess.ts';

export async function smartNoteRequest(req) {
  if (req.method !== 'POST') throw Object.assign(new Error('Method not allowed'), { status: 405 });
  const headers = new Headers(req.headers);
  const appId = headers.get('Base44-App-Id');
  if (appId && appId !== '694ec16e72e01b60d22f7cbf') throw Object.assign(new Error('Forbidden'), { status: 403 });
  headers.set('Base44-App-Id', '694ec16e72e01b60d22f7cbf');
  headers.delete('Base44-Api-Url');
  const base44 = createClientFromRequest(new Request(req.url, { headers }));
  const user = await base44.auth.me();
  if (!user?.id || user.is_active === false || user.disabled === true || user.is_service === true) throw Object.assign(new Error('Unauthorized'), { status: 401 });
  try { await requireClinicalWorkspace(base44); }
  catch { throw Object.assign(new Error('Active clinical workspace required'), { status: 403 }); }
  const body = await req.text();
  if (body.length > 100000) throw Object.assign(new Error('Note input is too large'), { status: 413 });
  let input;
  try { input = JSON.parse(body); }
  catch { throw Object.assign(new Error('Invalid request'), { status: 400 }); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Object.assign(new Error('Invalid request'), { status: 400 });
  return { base44, input };
}
export function noteText(value, max = 30000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw Object.assign(new Error('Invalid note text'), { status: 400 });
  return value;
}
export function exactKeys(input, keys) {
  if (Object.keys(input).some(key => !keys.includes(key))) throw Object.assign(new Error('Unsupported note options'), { status: 400 });
}
export function noteList(value, limit, parse) {
  if (!Array.isArray(value) || value.length > limit) throw Object.assign(new Error('Invalid note input'), { status: 400 });
  return value.map(parse);
}
export function noteFailure(error) {
  const status = error.status || error.response?.status || 500;
  return Response.json({ error: status < 500 ? error.message : 'The note operation could not be completed.', retryable: false }, { status, headers: { 'Cache-Control': 'no-store' } });
}