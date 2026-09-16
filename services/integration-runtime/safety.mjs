import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

import { fail, MAX_FILE, MIME, stable } from './contracts.mjs';
export * from './contracts.mjs';

export const hash = (key, value) => createHmac('sha256', key).update(stable(value)).digest('hex');
export function seal(key, context, value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  cipher.setAAD(Buffer.from(context));
  const bytes = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), bytes].map(part => part.toString('base64url')).join('.');
}
export function unseal(key, context, value) {
  try {
    const parts = value.split('.');
    if (parts.length !== 3) throw new Error();
    const [iv, tag, bytes] = parts.map(part => Buffer.from(part, 'base64url'));
    if (iv.length !== 12 || tag.length !== 16) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
    decipher.setAAD(Buffer.from(context)); decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(bytes), decipher.final()]).toString('utf8'));
  } catch { fail(409, 'RESULT_RECONCILIATION_REQUIRED'); }
}
export async function limitedBytes(response, maximum) {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) { await reader.cancel(); fail(413, 'RESPONSE_TOO_LARGE'); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
export async function readJson(response, maximum = 1024 * 1024) {
  const bytes = await limitedBytes(response, maximum);
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { fail(502, 'INVALID_UPSTREAM_RESPONSE'); }
}
export function fileBytes(base64, mime) {
  if (!MIME.has(mime) || typeof base64 !== 'string' || base64.length > Math.ceil(MAX_FILE / 3) * 4
    || base64.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) fail(400, 'INVALID_FILE');
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length || bytes.length > MAX_FILE) fail(413, 'INVALID_FILE_SIZE');
  const hex = bytes.subarray(0, 12).toString('hex');
  const valid = mime === 'application/pdf' ? bytes.subarray(0, 5).toString() === '%PDF-'
    : mime === 'image/png' ? hex.startsWith('89504e470d0a1a0a')
    : mime === 'image/jpeg' ? hex.startsWith('ffd8ff')
    : mime === 'image/webp' ? bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'
    : !bytes.includes(0);
  if (!valid) fail(400, 'FILE_TYPE_MISMATCH');
  return bytes;
}
