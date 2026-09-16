#!/usr/bin/env node
// Executes repository function source against a deliberately inert SDK in an
// isolated VM. This never imports provider packages, reads credentials, sends
// network requests or connects to a hosted entity store. It is a no-session
// negative test, not evidence of valid-user behavior or hosted authorization.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { webcrypto } from 'node:crypto';

export async function auditAnonymousSource(source, name, payload = {}) {
  const operations = [];
  const rejectOperation = path => {
    operations.push(path);
    throw new Error('AUDIT_IO_BLOCKED');
  };
  const entityStore = new Proxy({}, { get: (_, entity) => new Proxy({}, {
    get: (_, operation) => (..._args) => rejectOperation(`entities.${String(entity)}.${String(operation)}`),
  }) });
  const integrationStore = new Proxy({}, { get: (_, integration) => new Proxy({}, {
    get: (_, operation) => (..._args) => rejectOperation(`integrations.${String(integration)}.${String(operation)}`),
  }) });
  let authChecks = 0;
  const auth = { me: async () => { authChecks += 1; return null; }, isAuthenticated: async () => { authChecks += 1; return false; } };
  const client = { auth, entities: entityStore, integrations: integrationStore,
    functions: { invoke: () => rejectOperation('functions.invoke') } };
  client.asServiceRole = { entities: entityStore, integrations: integrationStore, functions: client.functions };
  let handler;
  const importNames = [];
  const context = {
    exports: {}, module: { exports: {} },
    require(specifier) {
      importNames.push(specifier);
      if (/^(?:npm:)?@base44\/sdk(?:@|$)/.test(specifier)) return { createClientFromRequest: () => client };
      const provider = new Proxy(function () { return rejectOperation('provider.construct'); }, {
        get: (_, property) => property === '__esModule' ? true : () => rejectOperation(`provider.${String(property)}`),
      });
      return provider;
    },
    Deno: { env: { get: key => key === 'INTERNAL_FN_SECRET' ? 'synthetic-audit-secret-never-sent' : undefined }, serve: callback => { handler = callback; } },
    Request, Response, Headers, URL, URLSearchParams, TextEncoder, TextDecoder,
    AbortController, AbortSignal, Blob, FormData, crypto: webcrypto, atob, btoa,
    fetch: () => rejectOperation('network.fetch'),
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    setTimeout: () => rejectOperation('timer.schedule'),
    setInterval: () => rejectOperation('timer.repeat'),
    clearTimeout() {}, clearInterval() {},
  };
  let status = null;
  let outcome = 'unexecuted';
  let responseCode = null;
  let skipped = null;
  try {
    const code = transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022', logLevel: 'silent' }).code;
    runInNewContext(code, context, { timeout: 1000, filename: `${name}.ts` });
    if (typeof handler !== 'function') return { name, status, outcome: 'handler_not_captured', operations, importNames };
    const req = new Request(`https://audit.invalid/functions/${name}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    let timeout;
    try {
      const response = await Promise.race([
        Promise.resolve(handler(req)),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('AUDIT_TIMEOUT')), 1500); }),
      ]);
      status = response?.status ?? null;
      outcome = status >= 400 ? 'rejected' : status >= 200 && status < 300 ? 'success_without_session' : 'unexpected_response';
      if (response instanceof Response) {
        const data = await response.json().catch(() => null);
        responseCode = typeof data?.code === 'string' ? data.code.slice(0, 120) : null;
        skipped = data?.skipped;
      }
    } finally { clearTimeout(timeout); }
  } catch (error) {
    outcome = error?.message === 'AUDIT_TIMEOUT' ? 'timeout' : operations.length ? 'blocked_io' : 'execution_error';
  }
  const retirementNoop = name === 'autoAssignNurseToPatient' && status === 200
    && skipped === 'automatic patient assignment disabled' && operations.length === 0;
  if (retirementNoop) outcome = 'retired_noop';
  // The signed Telnyx webhook must load its verification configuration before
  // checking a signature. Permit only that exact attempted read, never a write
  // or arbitrary business-record read, and only with a rejected response.
  const unexpectedOperations = operations.filter(path => !(name === 'handleTelnyxStatusWebhook'
    && path === 'entities.IntegrationSecret.filter' && status >= 400));
  return { name, status, outcome, responseCode, authChecks, operations: [...new Set(operations)],
    unexpectedOperations: [...new Set(unexpectedOperations)],
    safeNegativeResult: (outcome === 'rejected' || retirementNoop) && !unexpectedOperations.length,
    importNames: [...new Set(importNames)] };
}

export async function auditAnonymousFunctions(root = process.cwd(), payload = {}) {
  const directory = join(root, 'base44/functions');
  const results = [];
  for (const name of readdirSync(directory).sort()) {
    let source;
    try { source = readFileSync(join(directory, name, 'entry.ts'), 'utf8'); } catch { continue; }
    results.push(await auditAnonymousSource(source, name, payload));
  }
  return { scope: 'isolated no-session POST with empty JSON and all side effects blocked',
    hostedRequests: 0, total: results.length,
    byOutcome: Object.fromEntries([...new Set(results.map(row => row.outcome))].map(key => [key, results.filter(row => row.outcome === key).length])),
    attemptedIoCount: results.filter(row => row.operations.length).length,
    unexpectedIoCount: results.filter(row => row.unexpectedOperations?.length).length,
    passed: results.every(row => row.safeNegativeResult === true), results };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const report = await auditAnonymousFunctions();
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}
