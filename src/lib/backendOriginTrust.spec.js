import { describe, expect, it } from 'vitest';
import { isTrustedBase44BackendHost } from '@/lib/backendOriginTrust';

describe('Base44 backend origin trust', () => {
  it.each([
    'app.base44.com',
    'api.base44.com',
    'base44.app',
  ])('accepts the known shared backend host %s', (host) => {
    expect(isTrustedBase44BackendHost(host)).toBe(true);
  });

  it('accepts only the exact build-pinned custom backend', () => {
    expect(isTrustedBase44BackendHost('pennsync.example.test', 'pennsync.example.test')).toBe(true);
    expect(isTrustedBase44BackendHost('other.example.test', 'pennsync.example.test')).toBe(false);
  });

  it.each([
    'attacker.base44.app',
    'tenant.base44.com',
    'base44.app.attacker.test',
    '.base44.app',
    '',
  ])('rejects customer-controlled or malformed host %j', (host) => {
    expect(isTrustedBase44BackendHost(host)).toBe(false);
  });
});
