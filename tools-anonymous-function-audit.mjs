#!/usr/bin/env node
// Executes repository function source against a deliberately inert SDK in an
// isolated VM. This never imports provider packages, reads credentials, sends
// network requests or connects to a hosted entity store. It is a no-session
// negative test, not evidence of valid-user behavior or hosted authorization.
import { readdirSync, readFileSync, lstatSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { dirname, resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { webcrypto } from 'node:crypto';

// Reviewed exact unavailable responses, not a blanket exception for 5xx.
// These identify deliberate quarantine/configuration states, NOT working features.
const unavailableExpectations = JSON.parse(readFileSync(
  new URL('./tools-anonymous-function-expectations.json', import.meta.url), 'utf8',
));

// A bodyless method may not carry one: `new Request` throws rather than dropping
// it, which would turn a method sweep into an execution_error.
const bodyless = (method) => method === 'GET' || method === 'HEAD';

export async function auditAnonymousSource(source, name, payload = {}, { method = 'POST', resolveImport = null } = {}) {
  const operations = [];
  const environmentKeys = [];
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
  // The newer Base44 function format reads secrets from `base44:runtime`. They
  // go through the same recorded accessor as `Deno.env.get`, so the set of
  // environment reads stays complete whichever format a function uses.
  const runtime = {
    secrets: { get: key => context.Deno.env.get(key) },
    waitUntil: () => rejectOperation('runtime.waitUntil'),
  };
  // A relative import (the CLI bundles `base44/shared/` into each function) is
  // evaluated as real code in this same sandbox when the caller can resolve it;
  // otherwise it gets the trapping provider, as any other package does.
  const evaluate = (code, filename, requireFrom) => {
    const scope = { ...context, exports: {}, module: { exports: {} }, require: requireFrom };
    runInNewContext(code, scope, { timeout: 1000, filename });
    return scope.module.exports;
  };
  const requireFrom = (from) => (specifier) => {
    if (/^base44:runtime(?:\/|$)/.test(specifier)) { importNames.push(specifier); return runtime; }
    if (/^\.{1,2}\//.test(specifier) && resolveImport) {
      const dependency = resolveImport(specifier, from);
      if (dependency) {
        const code = transformSync(dependency.source, { loader: 'ts', format: 'cjs', target: 'es2022', logLevel: 'silent' }).code;
        importNames.push(specifier);
        return evaluate(code, dependency.name, requireFrom(dependency.from));
      }
    }
    return trappingRequire(specifier);
  };
  // Anything else: the SDK gets the inert client, every other package a trap.
  function trappingRequire(specifier) {
    importNames.push(specifier);
    if (/^(?:npm:)?@base44\/sdk(?:@|$)/.test(specifier)) return { createClientFromRequest: () => client };
    const provider = new Proxy(function () { return rejectOperation('provider.construct'); }, {
      get: (_, property) => property === '__esModule' ? true : () => rejectOperation(`provider.${String(property)}`),
    });
    return provider;
  }
  const context = {
    exports: {}, module: { exports: {} },
    require: specifier => requireFrom(null)(specifier),
    // Every environment read goes through this one accessor, at module scope as
    // well as inside the handler, so recording the key here is the complete set
    // of values whose answer could differ in a deployed environment. A consumer
    // comparing this result with a running deployment needs that: a refusal a
    // release variable can open is not evidence about the deployed code.
    Deno: {
      env: {
        get: key => {
          environmentKeys.push(String(key));
          return key === 'INTERNAL_FN_SECRET' ? 'synthetic-audit-secret-never-sent' : undefined;
        },
      },
      serve: callback => { handler = callback; },
    },
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
    // The newer format exports the handler as the module default instead of
    // passing it to Deno.serve.
    if (typeof handler !== 'function' && typeof context.module.exports?.default === 'function') {
      handler = context.module.exports.default;
    }
    if (typeof handler !== 'function') return { name, status, outcome: 'handler_not_captured', operations, unexpectedOperations: operations, interceptedNetworkAttempts, safeNegativeResult: false, importNames, environmentKeys: [...new Set(environmentKeys)] };
    const req = new Request(`https://audit.invalid/functions/${name}`, bodyless(method)
      ? { method }
      : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
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
    environmentKeys: [...new Set(environmentKeys)],
    interceptedNetworkAttempts, unexpectedOperations: [...new Set(unexpectedOperations)],
    safeNegativeResult: (outcome === 'rejected' || retirementNoop || expectedUnavailable) && !unexpectedOperations.length,
    importNames: [...new Set(importNames)] };
}

export async function auditAnonymousFunctions(root = process.cwd(), payload = {}, { readSource = readFileSync, method = 'POST' } = {}) {
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
      // Relative imports resolve from the function's own directory and must
      // stay inside base44/, as the CLI's bundle of base44/shared/ does.
      const backend = join(root, 'base44');
      const resolveImport = (specifier, from) => {
        const path = resolve(from ?? parent, specifier);
        if (!path.startsWith(`${backend}/`) || !lstatSync(path).isFile()) return null;
        return { source: readSource(path, 'utf8'), name: path.slice(root.length + 1), from: dirname(path) };
      };
      results.push(await auditAnonymousSource(source, name, payload, { method, resolveImport }));
    } catch {
      // Never silently skip an entry. Return a named failing result without
      // printing filesystem errors that could contain private paths/source.
      discoveryErrors.push({ name, code: 'FUNCTION_ENTRY_UNREADABLE' });
      results.push({ name, status: null, outcome: 'entry_unreadable', operations: [],
        unexpectedOperations: [], interceptedNetworkAttempts: 0, safeNegativeResult: false,
        environmentKeys: [] });
    }
  }
  // The method and whether a payload was sent are both part of what was asked,
  // so neither is described from a constant: a GET carries no body at all, and
  // a scope line claiming a synthetic payload for one would be false.
  return { scope: `isolated no-session ${method} ${bodyless(method) ? 'with no body' : 'with synthetic payload'}`
      + '; SDK and fetch calls intercepted',
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
