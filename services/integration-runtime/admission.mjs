import { createHash } from 'node:crypto';
import { fail } from './safety.mjs';

export function bearerFingerprint(req) {
  const value = req.headers.get('authorization');
  if (!value || !/^Bearer [A-Za-z0-9._~-]{20,16000}$/.test(value)) fail(401, 'AUTHENTICATION_REQUIRED');
  return createHash('sha256').update(value).digest('hex');
}

// Bounded process-local admission; not a distributed WAF. Provider quotas are
// durable in SQL. Raw credentials are never retained as limiter keys.
export function createAdmission({ now = Date.now, windowMs = 60000, requestLimit = 120,
  tokenRequestLimit = 12, authorityLimit = 300, tokenAuthorityLimit = 36,
  bodySlots = 16, tokenBodySlots = 1, authoritySlots = 8, operationSlots = 8,
  actorOperationSlots = 2, maxKeys = 1024 } = {}) {
  const buckets = new Map(), bodies = new Map(), actors = new Map();
  let global = { until: 0, requests: 0, authority: 0 }, reading = 0, checking = 0, running = 0;
  function allowance(key, kind, perKey, total) {
    const time = now();
    if (time >= global.until) global = { until: time + windowMs, requests: 0, authority: 0 };
    for (const [id, row] of buckets) if (time >= row.until) buckets.delete(id);
    let row = buckets.get(key);
    if (!row) {
      if (buckets.size >= maxKeys) fail(429, 'ADMISSION_CAPACITY_REACHED');
      row = { until: time + windowMs, requests: 0, authority: 0 }; buckets.set(key, row);
    }
    if (row[kind] >= perKey || global[kind] >= total) fail(429, 'AUTHORITY_RATE_LIMIT');
    row[kind]++; global[kind]++;
  }
  function once(fn) { let done = false; return () => { if (!done) { done = true; fn(); } }; }
  return {
    request(key) { allowance(key, 'requests', tokenRequestLimit, requestLimit); },
    body(key) {
      if (reading >= bodySlots || (bodies.get(key) || 0) >= tokenBodySlots) fail(429, 'BODY_ADMISSION_BUSY');
      reading++; bodies.set(key, (bodies.get(key) || 0) + 1);
      return once(() => { reading--; const left = bodies.get(key) - 1; if (left) bodies.set(key, left); else bodies.delete(key); });
    },
    async authority(key, callback) {
      if (checking >= authoritySlots) fail(429, 'AUTHORITY_BUSY');
      allowance(key, 'authority', tokenAuthorityLimit, authorityLimit);
      checking++;
      try { return await callback(); } finally { checking--; }
    },
    operation(subject) {
      if (running >= operationSlots || (actors.get(subject) || 0) >= actorOperationSlots) fail(429, 'SERVICE_BUSY');
      running++; actors.set(subject, (actors.get(subject) || 0) + 1);
      return once(() => { running--; const left = actors.get(subject) - 1; if (left) actors.set(subject, left); else actors.delete(subject); });
    },
    stats() { return { reading, checking, running, keys: buckets.size }; },
  };
}

export async function readRequestBody(req, maximum = 12 * 1024 * 1024, deadlineMs = 5000) {
  const length = req.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > maximum)) fail(413, 'BODY_TOO_LARGE');
  const reader = req.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  let timer, expired = false, total = 0;
  const chunks = [];
  const cancel = () => { try { Promise.resolve(reader.cancel()).catch(() => {}); } catch { /* never wait for an uncooperative sender */ } };
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { expired = true; cancel(); try { fail(408, 'BODY_READ_TIMEOUT'); } catch (error) { reject(error); } }, deadlineMs);
  });
  const read = async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (expired) fail(408, 'BODY_READ_TIMEOUT');
      if (done) return Buffer.concat(chunks);
      total += value.byteLength;
      if (total > maximum) { cancel(); fail(413, 'BODY_TOO_LARGE'); }
      chunks.push(Buffer.from(value));
    }
  };
  try { return await Promise.race([read(), deadline]); }
  finally { clearTimeout(timer); try { reader.releaseLock(); } catch { cancel(); } }
}
