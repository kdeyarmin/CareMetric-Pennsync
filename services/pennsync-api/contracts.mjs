// Value contracts for the ported business API. No credential, provider call or
// Base44 import belongs in this file.

export class ApiError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
export const fail = (status, code) => { throw new ApiError(status, code); };

export const ID = /^[A-Za-z0-9_-]{1,128}$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_BODY = 1024 * 1024;

export const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);

export function exactObject(value, allowed, code = 'INVALID_INPUT') {
  if (!isObject(value) || Object.keys(value).some(key => !allowed.includes(key))) fail(400, code);
  return value;
}

/**
 * Read a request body under both a byte ceiling and a wall-clock deadline, so a
 * slow or oversized sender cannot hold a worker.
 */
export async function readBody(req, maximum = MAX_BODY, deadlineMs = 5000) {
  const reader = req.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const timer = setTimeout(() => { void reader.cancel().catch(() => {}); }, deadlineMs);
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) { await reader.cancel().catch(() => {}); fail(413, 'BODY_TOO_LARGE'); }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    fail(400, 'INVALID_BODY');
  } finally {
    clearTimeout(timer);
    try { reader.releaseLock(); } catch { /* already released */ }
  }
  return Buffer.concat(chunks);
}

/**
 * The ceiling on an upstream JSON body this service will read.
 *
 * Sized for the largest legitimate answer rather than tightly: the broker's
 * `list` caps at 5,000 rows and a row may hold sizeable JSON, so a smaller cap
 * would refuse valid pages. The point is that it is BOUNDED — `response.json()`
 * reads whatever arrives, and a chunked or headerless response from a
 * misbehaving upstream would otherwise exhaust the service before any shape
 * check runs. Exceeding it is a refusal, not a crash.
 */
export const MAX_UPSTREAM_BYTES = 16 * 1024 * 1024;

export async function readJson(response, maximum = 64 * 1024) {
  const reader = response.body?.getReader();
  if (!reader) fail(502, 'INVALID_UPSTREAM_RESPONSE');
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) { await reader.cancel().catch(() => {}); fail(502, 'UPSTREAM_RESPONSE_TOO_LARGE'); }
      chunks.push(Buffer.from(value));
    }
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { fail(502, 'INVALID_UPSTREAM_RESPONSE'); }
}
