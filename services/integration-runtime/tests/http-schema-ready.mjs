// Disposable local fixture only. The caller must first verify the exact SQL
// signatures below and that anon has no EXECUTE privilege on every function.
import { setTimeout as delay } from 'node:timers/promises';

const uuid = '00000000-0000-4000-8000-000000000001';
const arg = (name, type, value) => Object.freeze({ name, type, value });
export const runtimeRpcSignatures = Object.freeze([
  { name: 'cm_integration_reserve', args: [
    arg('p_app_id', 'text', 'synthetic-readiness'), arg('p_subject', 'text', 'a'.repeat(64)),
    arg('p_operation', 'text', 'InvokeLLM'), arg('p_request_id', 'text', 'synthetic-readiness'),
    arg('p_payload_hash', 'text', 'b'.repeat(64)), arg('p_claim', 'uuid', uuid), arg('p_daily_limit', 'integer', '1'),
  ] },
  { name: 'cm_integration_finish', args: [
    arg('p_id', 'uuid', uuid), arg('p_claim', 'uuid', uuid), arg('p_state', 'text', 'completed'), arg('p_result', 'text', 'synthetic-readiness'),
  ] },
  { name: 'cm_integration_file_record', args: [
    arg('p_id', 'uuid', uuid), arg('p_app_id', 'text', 'synthetic-readiness'), arg('p_subject', 'text', 'a'.repeat(64)),
    arg('p_object_path', 'text', 'synthetic-readiness'), arg('p_content_type', 'text', 'text/plain'),
    arg('p_size', 'bigint', '1'), arg('p_sha256', 'text', 'c'.repeat(64)),
  ] },
  { name: 'cm_integration_file_get', args: [
    arg('p_id', 'uuid', uuid), arg('p_app_id', 'text', 'synthetic-readiness'), arg('p_subject', 'text', 'a'.repeat(64)),
  ] },
  { name: 'cm_integration_expire_results', args: [] },
].map(signature => Object.freeze({ ...signature, args: Object.freeze(signature.args) })));

const fail = code => { throw new Error(code); };
const cancel = reader => { try { void Promise.resolve(reader?.cancel()).catch(() => {}); } catch { /* Cancellation must never delay failure. */ } };

// A live OpenAPI document is not a cache acknowledgement in PostgREST 14.14.
// Anonymous GET resolves named arguments against the cache and uses a read-only
// transaction. With the caller's verified ACLs it must fail before function code.
export async function waitForRuntimeSchema({ api, publishableKey, fetchImpl = fetch, timeoutMs = 10000, pollMs = 100 }) {
  if (api !== 'http://127.0.0.1:54321' || typeof publishableKey !== 'string' ||
      !/^sb_publishable_[A-Za-z0-9_-]{10,200}$/.test(publishableKey) || typeof fetchImpl !== 'function' ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 20000 ||
      !Number.isInteger(pollMs) || pollMs < 1 || pollMs > 1000) fail('LOCAL_RUNTIME_SCHEMA_INVALID_CONFIG');
  const controller = new AbortController();
  let timer;
  const live = () => { if (controller.signal.aborted) fail('LOCAL_RUNTIME_SCHEMA_NOT_READY'); };
  const readJson = async response => {
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) fail('LOCAL_RUNTIME_SCHEMA_INVALID_RESPONSE');
    const reader = response.body?.getReader();
    if (!reader) fail('LOCAL_RUNTIME_SCHEMA_INVALID_RESPONSE');
    const chunks = []; let size = 0;
    const onAbort = () => cancel(reader);
    controller.signal.addEventListener('abort', onAbort, { once: true });
    try {
      while (true) {
        live();
        const { done, value } = await reader.read();
        live();
        if (done) break;
        size += value.byteLength;
        if (size > 16384) fail('LOCAL_RUNTIME_SCHEMA_INVALID_RESPONSE');
        chunks.push(value);
      }
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    } catch {
      cancel(reader);
      live();
      fail('LOCAL_RUNTIME_SCHEMA_INVALID_RESPONSE');
    } finally {
      controller.signal.removeEventListener('abort', onAbort);
      try { reader.releaseLock(); } catch { /* A still-pending read must not delay the deadline. */ }
    }
  };
  const probe = async signature => {
    live();
    const url = new URL(`/rest/v1/rpc/${signature.name}`, api);
    for (const argument of signature.args) url.searchParams.set(argument.name, argument.value);
    let response;
    try {
      response = await fetchImpl(url, { method: 'GET', redirect: 'error', signal: controller.signal,
        headers: { apikey: publishableKey, Accept: 'application/json', 'Accept-Profile': 'public' } });
    } catch {
      live();
      fail('LOCAL_RUNTIME_SCHEMA_PROBE_FAILED');
    }
    if (controller.signal.aborted) { cancel(response?.body); live(); }
    if (response.redirected || ![401, 404].includes(response.status)) {
      cancel(response.body);
      fail('LOCAL_RUNTIME_SCHEMA_UNEXPECTED_RESPONSE');
    }
    const body = await readJson(response);
    if (response.status === 401 && body?.code === '42501' &&
        body.message === `permission denied for function ${signature.name}`) return true;
    if (response.status === 404 && body?.code === 'PGRST202') return false;
    fail('LOCAL_RUNTIME_SCHEMA_UNEXPECTED_RESPONSE');
  };
  const work = async () => {
    let pending = [...runtimeRpcSignatures];
    while (pending.length) {
      const missing = [];
      for (const signature of pending) if (!await probe(signature)) missing.push(signature);
      pending = missing;
      if (pending.length) await delay(pollMs, undefined, { signal: controller.signal });
    }
    live();
  };
  try {
    await Promise.race([
      work(),
      new Promise((_, reject) => { timer = setTimeout(() => {
        reject(new Error('LOCAL_RUNTIME_SCHEMA_NOT_READY'));
        controller.abort();
      }, timeoutMs); }),
    ]);
  } catch (error) {
    if (/^LOCAL_RUNTIME_SCHEMA_(NOT_READY|INVALID_RESPONSE|UNEXPECTED_RESPONSE|PROBE_FAILED)$/.test(error?.message)) throw error;
    fail(controller.signal.aborted ? 'LOCAL_RUNTIME_SCHEMA_NOT_READY' : 'LOCAL_RUNTIME_SCHEMA_PROBE_FAILED');
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
