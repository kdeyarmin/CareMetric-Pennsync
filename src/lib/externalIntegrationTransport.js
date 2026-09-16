import {
  MAX_FILE, MIME, OPERATIONS, UUID, conforms, exactObject, stable, text, validateSchema,
} from '../../services/integration-runtime/contracts.mjs';
import { BROWSER_CONTRACT, bindingFromContext } from '../../services/integration-runtime/caller-binding.mjs';

export const EXTERNAL_INTEGRATION_ORIGIN = 'https://pennsync-integrations-production.up.railway.app';
export const EXTERNAL_INTEGRATION_APP = '694ec16e72e01b60d22f7cbf';
const STORAGE_ORIGIN = 'https://xsqobvvreaovwibxwyvv.supabase.co';
const FILE_URI = /^cmfile:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const MESSAGES = Object.freeze({
  CONFIGURATION: 'The external integration configuration needs administrator review.',
  NOT_RELEASED: 'This external integration has not been released.',
  INVALID_INPUT: 'This request is not supported by the external integration.',
  AUTHORITY: 'Refresh your workspace before using this integration.',
  ACCESS_DENIED: 'Your current workspace access could not be verified.',
  LIMIT: 'The integration limit was reached. Contact your administrator.',
  RECONCILIATION: 'The earlier request needs reconciliation. Do not start a replacement request.',
  INVALID_RESULT: 'The integration returned an invalid or incomplete result.',
  EXPIRED_LINK: 'This private link has expired. Request a new link to the same file.',
  UNCERTAIN: 'The request may still be running. Reuse its request reference rather than starting another.',
});

export class ExternalIntegrationError extends Error {
  constructor(code, { status = 0, requestId = null, uncertain = false } = {}) {
    super(MESSAGES[code] || MESSAGES.INVALID_RESULT);
    this.name = 'ExternalIntegrationError';
    this.code = `EXTERNAL_${Object.hasOwn(MESSAGES, code) ? code : 'INVALID_RESULT'}`;
    this.status = status;
    this.requestId = requestId;
    this.retryable = false;
    this.operationMayHaveExecuted = uncertain;
  }
}
const deny = (code, details) => { throw new ExternalIntegrationError(code, details); };
const clone = value => JSON.parse(stable(value));

/** Configuration is build-owned. URL/local-storage toggles cannot select a host. */
export function readExternalIntegrationConfig(env = {}, appId = null) {
  const mode = env.VITE_EXTERNAL_INTEGRATIONS;
  if (mode === undefined || mode === '' || mode === 'disabled') {
    return Object.freeze({ enabled: false, appId, operations: Object.freeze([]) });
  }
  const operations = typeof env.VITE_EXTERNAL_INTEGRATION_OPERATIONS === 'string'
    ? env.VITE_EXTERNAL_INTEGRATION_OPERATIONS.split(',') : [];
  if (mode !== 'enabled-v2' || appId !== EXTERNAL_INTEGRATION_APP
    || env.VITE_EXTERNAL_INTEGRATION_ORIGIN !== EXTERNAL_INTEGRATION_ORIGIN
    || !/^[a-f0-9]{40}$/.test(env.VITE_EXTERNAL_INTEGRATION_REVISION || '')
    || !operations.length || new Set(operations).size !== operations.length
    || operations.some(operation => !OPERATIONS.includes(operation))) deny('CONFIGURATION');
  return Object.freeze({ enabled: true, appId, origin: EXTERNAL_INTEGRATION_ORIGIN,
    operations: Object.freeze(operations), revision: env.VITE_EXTERNAL_INTEGRATION_REVISION });
}

export function privateIntegrationFileId(reference) {
  return typeof reference === 'string' ? reference.match(FILE_URI)?.[1]?.toLowerCase() || null : null;
}
function privateFile(reference) {
  const id = privateIntegrationFileId(reference);
  if (!id) deny('INVALID_INPUT');
  return `cmfile:${id}`;
}
export function normalizeExternalIntegrationParams(operation, input) {
  // Clone before dispatch. In particular, defined-but-invalid AI options cannot
  // disappear during JSON serialization and silently select a different mode.
  if (['UploadFile', 'UploadPrivateFile'].includes(operation)) {
    exactObject(input, ['file']);
    if (!(input.file instanceof Blob) || !MIME.has(input.file.type)
      || input.file.size < 1 || input.file.size > MAX_FILE) deny('INVALID_INPUT');
    return { file: input.file };
  }
  const value = clone(input);
  if (operation === 'InvokeLLM') {
    exactObject(value, ['prompt', 'model', 'response_json_schema', 'file_urls', 'file_uris', 'add_context_from_internet']);
    text(value.prompt, 100000);
    if (Object.hasOwn(value, 'model') && !['automatic', 'claude-sonnet-4-6'].includes(value.model)) deny('INVALID_INPUT');
    if (Object.hasOwn(value, 'response_json_schema')) validateSchema(value.response_json_schema);
    if (Object.hasOwn(value, 'add_context_from_internet') && value.add_context_from_internet !== false) deny('INVALID_INPUT');
    if (Object.hasOwn(value, 'file_urls') && Object.hasOwn(value, 'file_uris')) deny('INVALID_INPUT');
    const files = Object.hasOwn(value, 'file_urls') ? value.file_urls : value.file_uris;
    if (files !== undefined) {
      if (!Array.isArray(files) || files.length > 3) deny('INVALID_INPUT');
      value.file_uris = files.map(privateFile);
    }
    delete value.file_urls;
  } else if (operation === 'ExtractDataFromUploadedFile') {
    exactObject(value, ['file_url', 'file_uri', 'json_schema']);
    if (Object.hasOwn(value, 'file_url') === Object.hasOwn(value, 'file_uri')) deny('INVALID_INPUT');
    value.file_uri = privateFile(value.file_uri ?? value.file_url);
    delete value.file_url;
    validateSchema(value.json_schema);
  } else if (operation === 'CreateFileSignedUrl') {
    exactObject(value, ['file_uri']); value.file_uri = privateFile(value.file_uri);
  } else if (operation === 'SendEmail') {
    exactObject(value, ['to', 'subject', 'body']);
    const recipients = Array.isArray(value.to) ? value.to : [value.to];
    if (!recipients.length || recipients.length > 10 || recipients.some(address => typeof address !== 'string'
      || address.length > 320 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address))) deny('INVALID_INPUT');
    text(value.subject, 500); text(value.body, 100000);
  } else deny('INVALID_INPUT');
  return value;
}
async function encodeFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length !== file.size || bytes.length < 1 || bytes.length > MAX_FILE) deny('INVALID_INPUT');
  // Encode bounded chunks directly from bytes. Avoid a complete intermediate
  // binary string and do not require Node's Buffer or a global btoa polyfill.
  const alphabet = Uint8Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', c => c.charCodeAt(0));
  const chunks = [], decoder = new TextDecoder();
  for (let offset = 0; offset < bytes.length; offset += 0x6000) {
    const end = Math.min(offset + 0x6000, bytes.length);
    const encoded = new Uint8Array(Math.ceil((end - offset) / 3) * 4);
    let position = 0;
    for (let i = offset; i < end; i += 3) {
      const a = bytes[i], b = bytes[i + 1] ?? 0, c = bytes[i + 2] ?? 0;
      encoded[position++] = alphabet[a >>> 2];
      encoded[position++] = alphabet[((a & 3) << 4) | (b >>> 4)];
      encoded[position++] = i + 1 < end ? alphabet[((b & 15) << 2) | (c >>> 6)] : 61;
      encoded[position++] = i + 2 < end ? alphabet[c & 63] : 61;
    }
    chunks.push(decoder.decode(encoded));
  }
  return { base64: chunks.join(''), content_type: file.type };
}
async function readEnvelope(response) {
  const max = 2 * 1024 * 1024;
  if (!/^application\/json(?:\s*;.*)?$/i.test(response.headers.get('content-type') || '')) deny('INVALID_RESULT');
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^(0|[1-9]\d*)$/.test(declared) || Number(declared) > max)) deny('INVALID_RESULT');
  const reader = response.body?.getReader();
  if (!reader) deny('INVALID_RESULT');
  const chunks = []; let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > max) { await reader.cancel().catch(() => {}); deny('INVALID_RESULT'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { deny('INVALID_RESULT'); }
}
function checkedResult(operation, params, result, config, beganAt, now) {
  if (operation === 'InvokeLLM') {
    if (Object.hasOwn(params, 'response_json_schema') ? !conforms(result, params.response_json_schema)
      : typeof result !== 'string' || !result.trim()) deny('INVALID_RESULT');
  } else if (operation === 'ExtractDataFromUploadedFile') {
    if (result?.status !== 'success' || !conforms(result.output, params.json_schema)) deny('INVALID_RESULT');
  } else if (['UploadFile', 'UploadPrivateFile'].includes(operation)) {
    if (!privateIntegrationFileId(result?.file_uri) || result.private !== true
      || !Number.isSafeInteger(result.size_bytes) || result.size_bytes !== params.file.size
      || Object.hasOwn(result, 'file_url')) deny('INVALID_RESULT');
  } else if (operation === 'CreateFileSignedUrl') {
    let url;
    try { url = new URL(result?.signed_url); } catch { deny('INVALID_RESULT'); }
    const prefix = `/storage/v1/object/sign/pennsync-external-integrations/${config.appId}/`;
    const suffix = url.pathname.slice(prefix.length);
    const fileId = privateIntegrationFileId(params.file_uri);
    if (url.origin !== STORAGE_ORIGIN || !url.pathname.startsWith(prefix)
      || !new RegExp(`^[a-f0-9]{64}/${fileId}$`).test(suffix) || url.username || url.password || url.hash
      || url.searchParams.getAll('token').length !== 1 || !url.searchParams.get('token')
      || [...url.searchParams.keys()].some(key => key !== 'token') || result.expires_in !== 60
      || !Number.isSafeInteger(result.expires_at_ms)) deny('INVALID_RESULT');
    const expiresAt = Math.min(result.expires_at_ms, beganAt + 60000);
    if (expiresAt <= now) deny('EXPIRED_LINK');
    return { signed_url: url.href, expires_in: 60, expires_at_ms: expiresAt };
  } else if (result?.accepted !== true || result.delivered !== false || result.provider !== 'sendgrid') deny('INVALID_RESULT');
  return result;
}

/** Prepared operations retain one ID. execute() never creates a replacement job. */
export function createExternalIntegrationTransport(config, dependencies = {}) {
  const { fetcher = globalThis.fetch, getSession, captureLease, assertLeaseCurrent, getLeaseSignal,
    randomId = () => globalThis.crypto.randomUUID(), now = () => Date.now(), timeoutMs = 330000 } = dependencies;
  return Object.freeze({
    prepare(operation, params, options = {}) {
      if (!config.enabled || !config.operations.includes(operation)) deny('NOT_RELEASED');
      if (config.origin !== EXTERNAL_INTEGRATION_ORIGIN || config.appId !== EXTERNAL_INTEGRATION_APP
        || !/^[a-f0-9]{40}$/.test(config.revision || '')
        || ![fetcher, getSession, captureLease, assertLeaseCurrent, getLeaseSignal].every(fn => typeof fn === 'function')
        || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 360000) deny('CONFIGURATION');
      const lease = captureLease(); assertLeaseCurrent(lease);
      let copied, requestId;
      try {
        exactObject(options, ['requestId']);
        requestId = options.requestId === undefined ? randomId() : options.requestId;
        if (typeof requestId !== 'string' || !UUID.test(requestId)) deny('INVALID_INPUT');
        copied = normalizeExternalIntegrationParams(operation, params);
      } catch { deny('INVALID_INPUT'); }
      const readSession = () => {
        const session = getSession();
        if (!session || typeof session.token !== 'string' || !/^[A-Za-z0-9._~-]{20,16000}$/.test(session.token)) deny('AUTHORITY');
        try { return { token: session.token, binding: bindingFromContext(session.context) }; }
        catch { deny('AUTHORITY'); }
      };
      const initial = readSession();
      const expectedBinding = stable(initial.binding);
      const assertCurrent = () => {
        assertLeaseCurrent(lease);
        const current = readSession();
        if (current.token !== initial.token || stable(current.binding) !== expectedBinding) deny('AUTHORITY');
      };
      const endpoint = `${config.origin}/v2/integrations`;
      let pending = null, requestBody, completedResult, completedAt;
      const execute = () => {
        assertCurrent();
        if (completedAt !== undefined) return Promise.resolve(clone(checkedResult(operation, copied, completedResult, config, completedAt, now())));
        if (pending) return pending;
        const run = async () => {
          let dispatched = false, timer;
          const controller = new AbortController();
          const leaseSignal = getLeaseSignal(lease);
          const abort = () => controller.abort();
          try {
            if (leaseSignal.aborted) deny('AUTHORITY');
            leaseSignal.addEventListener('abort', abort, { once: true });
            timer = setTimeout(abort, timeoutMs);
            requestBody ||= Promise.resolve(copied.file ? encodeFile(copied.file) : copied)
              .then(normalized => JSON.stringify({ contract: BROWSER_CONTRACT, revision: config.revision, binding: initial.binding,
                agency_id: initial.binding.agency_id, request_id: requestId, operation, params: normalized }));
            const body = await requestBody;
            if (new TextEncoder().encode(body).byteLength > 12 * 1024 * 1024) deny('INVALID_INPUT');
            assertCurrent(); if (controller.signal.aborted) deny('AUTHORITY');
            const beganAt = now(); dispatched = true;
            const response = await fetcher(endpoint, { method: 'POST', mode: 'cors', credentials: 'omit', cache: 'no-store',
              referrerPolicy: 'no-referrer', redirect: 'error', signal: controller.signal,
              headers: { Authorization: `Bearer ${initial.token}`, 'Content-Type': 'application/json' }, body });
            assertCurrent();
            if (response.redirected || response.url !== endpoint) deny('INVALID_RESULT');
            const envelope = await readEnvelope(response); assertCurrent();
            if (!response.ok || envelope?.success !== true) {
              const code = [401, 403].includes(response.status) ? 'ACCESS_DENIED' : response.status === 429 ? 'LIMIT'
                : response.status === 409 ? 'RECONCILIATION' : 'UNCERTAIN';
              deny(code, { status: response.status, requestId, uncertain: true });
            }
            if (envelope.contract !== BROWSER_CONTRACT || envelope.app_id !== config.appId || envelope.execution !== 'external'
              || typeof envelope.base44ExecutionDependency !== 'boolean' || envelope.revision !== config.revision
              || envelope.request_id !== requestId || envelope.operation !== operation) deny('INVALID_RESULT');
            const result = checkedResult(operation, copied, envelope.result, config, beganAt, now());
            assertCurrent(); completedResult = clone(result); completedAt = beganAt;
            return clone(completedResult);
          } catch (error) {
            assertCurrent();
            if (error instanceof ExternalIntegrationError) {
              error.requestId = requestId; error.operationMayHaveExecuted ||= dispatched; throw error;
            }
            deny(dispatched ? 'UNCERTAIN' : 'INVALID_INPUT', { requestId, uncertain: dispatched });
          } finally {
            clearTimeout(timer); leaseSignal.removeEventListener('abort', abort);
          }
        };
        pending = run().finally(() => { pending = null; });
        return pending;
      };
      return Object.freeze({ requestId, execute });
    },
  });
}

/** The outer existing tenant membrane must wrap this facade, never the reverse. */
export function routeExternalCoreOperations(client, config, dependencies) {
  if (!config.enabled) return client;
  // UploadFile's public file_url contract is intentionally NOT silently replaced
  // by a private cmfile URI. Each legacy consumer needs an explicit migration.
  if (config.operations.includes('UploadFile')) deny('CONFIGURATION');
  const transport = createExternalIntegrationTransport(config, dependencies);
  const methods = new Map();
  const facade = (source, overrides) => new Proxy({}, {
    get: (_target, property) => Object.hasOwn(overrides, property) ? overrides[property]() : Reflect.get(source, property, source),
    has: (_target, property) => Object.hasOwn(overrides, property) || Reflect.has(source, property),
    ownKeys: () => Reflect.ownKeys(source),
    getOwnPropertyDescriptor(_target, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(source, property);
      if (!descriptor) return undefined;
      return { configurable: true, enumerable: descriptor.enumerable, writable: false,
        value: Object.hasOwn(overrides, property) ? overrides[property]() : Reflect.get(source, property, source) };
    },
    set: () => false, defineProperty: () => false, deleteProperty: () => false, setPrototypeOf: () => false,
    // A virtual SDK facade has no own keys on its empty proxy target. Freezing
    // that target would invalidate ownKeys/descriptor traps or expose stale raw
    // methods. Reject integrity-level mutation before any change, exactly as
    // the enclosing tenant SDK membrane already does; this is not a POJO.
    preventExtensions: () => false,
  });
  const overrides = Object.fromEntries(config.operations.map(operation => [operation, () => {
    if (!methods.has(operation)) methods.set(operation, (params, options) => {
      try { return transport.prepare(operation, params, options).execute(); }
      catch (error) { return Promise.reject(error); }
    });
    return methods.get(operation);
  }]));
  const core = facade(client.integrations.Core, overrides);
  const integrations = facade(client.integrations, { Core: () => core });
  return facade(client, { integrations: () => integrations });
}
