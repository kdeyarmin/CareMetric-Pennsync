import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import { resolvePlatformAuthBaseUrl } from './platformAuthBaseUrl.js';

const BACKEND = 'https://base44.app';

describe('resolvePlatformAuthBaseUrl', () => {
  it('uses the origin the app is served from, not the shared backend host', () => {
    expect(resolvePlatformAuthBaseUrl({ origin: 'https://app.caremetricai.com' }, BACKEND))
      .toBe('https://app.caremetricai.com');
    expect(resolvePlatformAuthBaseUrl({ origin: 'https://caremetricai.base44.app' }, BACKEND))
      .toBe('https://caremetricai.base44.app');
    expect(resolvePlatformAuthBaseUrl({ origin: 'http://127.0.0.1:5173' }, BACKEND))
      .toBe('http://127.0.0.1:5173');
  });

  it('falls back to the backend URL when there is no http(s) origin', () => {
    // A `file:` document reports the literal string "null" as its origin.
    expect(resolvePlatformAuthBaseUrl({ origin: 'null' }, BACKEND)).toBe(BACKEND);
    expect(resolvePlatformAuthBaseUrl(undefined, BACKEND)).toBe(BACKEND);
    expect(resolvePlatformAuthBaseUrl({}, BACKEND)).toBe(BACKEND);
    expect(resolvePlatformAuthBaseUrl({ origin: 'blob:https://app.caremetricai.com' }, BACKEND)).toBe(BACKEND);
  });

  it('is what the SDK client is constructed with', () => {
    // The defect this replaces was one property: `appBaseUrl: serverUrl`. A
    // source check is the only thing that sees the constructor argument without
    // standing up the whole authority membrane around the client.
    const client = readFileSync(path.join(process.cwd(), 'src/api/base44Client.js'), 'utf8');
    expect(client).toMatch(/appBaseUrl:\s*resolvePlatformAuthBaseUrl\(/);
    expect(client).not.toMatch(/appBaseUrl:\s*serverUrl\b/);
  });
});
