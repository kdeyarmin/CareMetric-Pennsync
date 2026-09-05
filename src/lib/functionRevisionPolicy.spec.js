import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createClient } from '@base44/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BASE44_FUNCTIONS_VERSION_HEADER,
  FunctionsVersionOverrideError,
  lockBase44FunctionRevision,
  normalizeBuildPinnedFunctionsVersion,
} from '@/lib/functionRevisionPolicy';

describe('Base44 function revision policy', () => {
  it.each([
    '0123456789abcdef0123456789abcdef01234567',
    '8d75d253-8125-46c5-a14d-ef6bdf61892d',
    'release_2026-09-05.3',
  ])('accepts the exact build-safe revision %s', (revision) => {
    expect(normalizeBuildPinnedFunctionsVersion(revision)).toBe(revision);
  });

  it.each([
    undefined,
    null,
    '',
    ' old-revision',
    'old-revision ',
    'old/revision',
    'old revision',
    'old\nrevision',
    'latest',
    'DRAFT',
    'production',
    'a'.repeat(201),
  ])('rejects missing, floating, or header-unsafe build value %j', (revision) => {
    expect(normalizeBuildPinnedFunctionsVersion(revision)).toBeNull();
  });

  it('forces direct SDK fetches to the immutable build revision', async () => {
    const rawFetch = vi.fn(async (_path, init) => init.headers);
    const client = { functions: { fetch: rawFetch } };

    lockBase44FunctionRevision(client, 'release_2026-09-05.3');
    const headers = await client.functions.fetch('/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    expect(headers).toBeInstanceOf(Headers);
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get(BASE44_FUNCTIONS_VERSION_HEADER)).toBe('release_2026-09-05.3');
    expect(Object.getOwnPropertyDescriptor(client.functions, 'fetch')).toMatchObject({
      configurable: false,
      writable: false,
    });
  });

  it('locks the installed SDK direct-fetch transport before it issues a request', async () => {
    const transport = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', transport);
    const client = createClient({
      appId: 'revision-policy-test',
      serverUrl: 'https://api.base44.com',
      functionsVersion: 'approved-sdk-revision',
      requiresAuth: false,
      analytics: { enabled: false },
    });

    try {
      lockBase44FunctionRevision(client, 'approved-sdk-revision');
      await client.functions.fetch('/binary-report', { method: 'POST' });

      expect(transport).toHaveBeenCalledTimes(1);
      const [url, init] = transport.mock.calls[0];
      expect(url).toBe('https://api.base44.com/api/functions/binary-report');
      expect(new Headers(init.headers).get(BASE44_FUNCTIONS_VERSION_HEADER))
        .toBe('approved-sdk-revision');
    } finally {
      client.cleanup();
      vi.unstubAllGlobals();
    }
  });

  it('rejects a caller-supplied revision that differs from the build pin', async () => {
    const rawFetch = vi.fn();
    const client = { functions: { fetch: rawFetch } };
    lockBase44FunctionRevision(client, 'approved-revision');

    await expect(client.functions.fetch('/report', {
      headers: { 'base44-functions-version': 'older-revision' },
    })).rejects.toBeInstanceOf(FunctionsVersionOverrideError);
    expect(rawFetch).not.toHaveBeenCalled();
  });

  it('rejects every caller revision when the build uses the published default', async () => {
    const rawFetch = vi.fn(async (_path, init) => init.headers);
    const client = { functions: { fetch: rawFetch } };
    lockBase44FunctionRevision(client, null);

    await expect(client.functions.fetch('/report', {
      headers: { [BASE44_FUNCTIONS_VERSION_HEADER]: 'older-revision' },
    })).rejects.toBeInstanceOf(FunctionsVersionOverrideError);
    expect(rawFetch).not.toHaveBeenCalled();

    const headers = await client.functions.fetch('/report');
    expect(headers.has(BASE44_FUNCTIONS_VERSION_HEADER)).toBe(false);
  });

  it('keeps all runtime revision inputs out of the SDK constructor', () => {
    const root = process.cwd();
    const appParams = readFileSync(path.join(root, 'src/lib/app-params.js'), 'utf8');
    const client = readFileSync(path.join(root, 'src/api/base44Client.js'), 'utf8');

    expect(appParams).toContain('import.meta.env.VITE_BASE44_FUNCTIONS_VERSION');
    expect(appParams).toContain("storage.removeItem('base44_functions_version')");
    expect(appParams).toContain("'functions_version',");
    expect(appParams).not.toMatch(/getAppParamValue\('functions_version'/);
    expect(appParams).toMatch(/functionsVersion:\s*buildFunctionsVersion/);
    expect(client).toMatch(/lockBase44FunctionRevision\(createClient\(\{/);
    expect(client).toMatch(/functionsVersion,/);
  });
});

describe('app parameter function revision selection', () => {
  const loadAppParams = async ({ buildRevision = '', search = '', storedRevision = null } = {}) => {
    vi.resetModules();
    vi.stubEnv('VITE_BASE44_APP_ID', 'build-app-id');
    vi.stubEnv('VITE_BASE44_BACKEND_URL', 'https://api.base44.com');
    vi.stubEnv('VITE_BASE44_FUNCTIONS_VERSION', buildRevision);
    localStorage.clear();
    if (storedRevision !== null) {
      localStorage.setItem('base44_functions_version', storedRevision);
    }
    window.history.replaceState(null, '', `/workspace${search}#section`);
    return import('@/lib/app-params');
  };

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses only the immutable build pin and scrubs URL and stored overrides', async () => {
    const { appParams } = await loadAppParams({
      buildRevision: 'approved-revision-42',
      search: '?functions_version=older-revision&functionsVersion=other&kept=yes',
      storedRevision: 'persisted-old-revision',
    });

    expect(appParams.functionsVersion).toBe('approved-revision-42');
    expect(localStorage.getItem('base44_functions_version')).toBeNull();
    expect(window.location.pathname).toBe('/workspace');
    expect(window.location.search).toBe('?kept=yes');
    expect(window.location.hash).toBe('#section');
    expect(Object.getOwnPropertyDescriptor(appParams, 'functionsVersion')).toMatchObject({
      configurable: false,
      writable: false,
    });
    expect(Reflect.set(appParams, 'functionsVersion', 'older-revision')).toBe(false);
    expect(appParams.functionsVersion).toBe('approved-revision-42');
  });

  it('omits revision selection when the build is unpinned', async () => {
    const { appParams } = await loadAppParams({
      search: '?base44_functions_version=attacker-selected',
      storedRevision: 'persisted-old-revision',
    });

    expect(appParams.functionsVersion).toBeNull();
    expect(localStorage.getItem('base44_functions_version')).toBeNull();
    expect(window.location.search).toBe('');
  });

  it('fails closed to the published default for a floating build selector', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { appParams } = await loadAppParams({ buildRevision: 'latest' });

    expect(appParams.functionsVersion).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      '[app-params] Ignoring invalid or floating build function revision.',
    );
    warn.mockRestore();
  });
});
