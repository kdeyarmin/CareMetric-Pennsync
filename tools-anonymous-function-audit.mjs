#!/usr/bin/env node
// Executes repository function source against a deliberately inert SDK in an
// isolated VM. This never imports provider packages, reads credentials, sends
// network requests or connects to a hosted entity store. It is a no-session
// negative test, not evidence of valid-user behavior or hosted authorization.
import { readdirSync, readFileSync, lstatSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { webcrypto } from 'node:crypto';

// Reviewed exact unavailable responses, not a blanket exception for 5xx.
// These identify deliberate quarantine/configuration states, NOT working features.
const unavailableExpectations = JSON.parse(readFileSync(
  new URL('./tools-anonymous-function-expectations.json', import.meta.url), 'utf8',
));

export async function auditAnonymousSource(source, name, payload = {}) {
  const operations = [];
  let interceptedNetworkAttempts = 0;
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
    fetch: () => { interceptedNetworkAttempts += 1; return rejectOperation('network.fetch'); },
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    setTimeout: () => rejectOperation('timer.schedule'),
    setInterval: () => rejectOperation('timer.repeat'),
    clearTimeout() {}, clearInterval() {},
  };
  let status = null;
  let outcome = 'unexecuted';
  let responseCode = null;
  let observedBody = null;
  try {
    const code = transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022', logLevel: 'silent' }).code;
    runInNewContext(code, context, { timeout: 1000, filename: `${name}.ts` });
    if (typeof handler !== 'function') return { name, status, outcome: 'handler_not_captured', operations, unexpectedOperations: operations, interceptedNetworkAttempts, safeNegativeResult: false, importNames };
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
      outcome = status >= 400 && status < 500 ? 'rejected'
        : status >= 500 && status < 600 ? 'server_error'
          : status >= 200 && status < 300 ? 'success_without_session' : 'unexpected_response';
      if (response instanceof Response) {
        const data = await response.json().catch(() => null);
        responseCode = typeof data?.code === 'string' ? data.code.slice(0, 120) : null;
        observedBody = data;
      }
    } finally { clearTimeout(timeout); }
  } catch (error) {
    outcome = error?.message === 'AUDIT_TIMEOUT' ? 'timeout' : operations.length ? 'blocked_io' : 'execution_error';
  }
  const retirementNoop = name === 'autoAssignNurseToPatient' && status === 200
    && isDeepStrictEqual(observedBody, { success: true, skipped: 'automatic patient assignment disabled' })
    && operations.length === 0;
  const expectation = Object.hasOwn(unavailableExpectations, name) ? unavailableExpectations[name] : null;
  const expectedUnavailable = status === 503 && expectation?.status === status
    && isDeepStrictEqual(observedBody, expectation.body);
  if (retirementNoop) outcome = 'retired_noop';
  else if (expectedUnavailable) outcome = 'expected_unavailable';
  // Only the exact known missing-verification-config response may accompany
  // this attempted, trapped webhook credential lookup. Never any business read.
  const unexpectedOperations = operations.filter(path => !(name === 'handleTelnyxStatusWebhook'
    && path === 'entities.IntegrationSecret.filter' && expectedUnavailable));
  return { name, status, outcome, responseCode, authChecks, operations: [...new Set(operations)],
    interceptedNetworkAttempts, unexpectedOperations: [...new Set(unexpectedOperations)],
    safeNegativeResult: (outcome === 'rejected' || retirementNoop || expectedUnavailable) && !unexpectedOperations.length,
    importNames: [...new Set(importNames)] };
}

export async function auditAnonymousFunctions(root = process.cwd(), payload = {}, { readSource = readFileSync } = {}) {
  const directory = join(root, 'base44/functions');
  const results = [];
  const discoveryErrors = [];
  let discoveredFunctionNames = [];
  try {
    discoveredFunctionNames = readdirSync(directory, { withFileTypes: true })
      .filter(entry => entry.isDirectory() || entry.isSymbolicLink()).map(entry => entry.name).sort();
  } catch {
    discoveryErrors.push({ code: 'FUNCTION_DIRECTORY_UNREADABLE' });
  }
  for (const name of discoveredFunctionNames) {
    try {
      const parent = join(directory, name);
      const entry = join(parent, 'entry.ts');
      if (!lstatSync(parent).isDirectory() || !lstatSync(entry).isFile()) throw new Error('ENTRY_NOT_REGULAR_FILE');
      const source = readSource(entry, 'utf8');
      if (typeof source !== 'string' || !source.trim()) throw new Error('ENTRY_EMPTY_OR_INVALID');
      results.push(await auditAnonymousSource(source, name, payload));
    } catch {
      // Never silently skip an entry. Return a named failing result without
      // printing filesystem errors that could contain private paths/source.
      discoveryErrors.push({ name, code: 'FUNCTION_ENTRY_UNREADABLE' });
      results.push({ name, status: null, outcome: 'entry_unreadable', operations: [],
        unexpectedOperations: [], interceptedNetworkAttempts: 0, safeNegativeResult: false });
    }
  }
  return { scope: 'isolated no-session POST with synthetic payload; SDK and fetch calls intercepted',
    measurementBoundary: 'Intercepted calls in this cooperative repository-source test harness; not a process/network security boundary or hosted traffic measurement.',
    discoveredFunctionNames, discoveryErrors, total: results.length,
    byOutcome: Object.fromEntries([...new Set(results.map(row => row.outcome))].map(key => [key, results.filter(row => row.outcome === key).length])),
    interceptedNetworkAttempts: results.reduce((total, row) => total + row.interceptedNetworkAttempts, 0),
    attemptedIoCount: results.filter(row => row.operations.length).length,
    unexpectedIoCount: results.filter(row => row.unexpectedOperations?.length).length,
    passed: results.length > 0 && !discoveryErrors.length && results.every(row => row.safeNegativeResult === true), results };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const report = await auditAnonymousFunctions();
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}
