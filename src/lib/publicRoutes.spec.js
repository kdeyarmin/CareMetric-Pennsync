import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { isPublicTokenPath, PUBLIC_TOKEN_SEGMENTS } from './publicRoutes.js';

describe('isPublicTokenPath', () => {
  it('accepts the capability-link and pre-auth routes, with and without a tail', () => {
    for (const segment of PUBLIC_TOKEN_SEGMENTS) {
      expect(isPublicTokenPath(`/${segment}`)).toBe(true);
      expect(isPublicTokenPath(`/${segment}/`)).toBe(true);
      expect(isPublicTokenPath(`/${segment}/abc123`)).toBe(true);
    }
  });

  it('is case-insensitive, matching the router', () => {
    expect(isPublicTokenPath('/Join/abc')).toBe(true);
    expect(isPublicTokenPath('/SIGNER')).toBe(true);
  });

  it('does NOT treat a longer look-alike segment as public', () => {
    // The previous startsWith() test sent these into the public branch, where no
    // inner route matches — the user got a blank screen instead of a 404.
    expect(isPublicTokenPath('/joinsomething')).toBe(false);
    expect(isPublicTokenPath('/privacypolicy')).toBe(false);
    expect(isPublicTokenPath('/signerportal')).toBe(false);
    expect(isPublicTokenPath('/followups')).toBe(false);
  });

  it('does not let a public segment deeper in the path open the gate', () => {
    // Authenticated pages must never be reachable by burying "join" in the path.
    expect(isPublicTokenPath('/Patients/join')).toBe(false);
    expect(isPublicTokenPath('/admin/signer/abc')).toBe(false);
  });

  it('handles the root and malformed input without throwing', () => {
    expect(isPublicTokenPath('/')).toBe(false);
    expect(isPublicTokenPath('')).toBe(false);
    expect(isPublicTokenPath(undefined)).toBe(false);
    expect(isPublicTokenPath(null)).toBe(false);
  });

  it('is the single source of truth for the auth gate in App.jsx', () => {
    // A second, drifting copy of this list in App.jsx is exactly how the prefix
    // bug survived — keep the gate calling this helper.
    const app = readFileSync(`${process.cwd()}/src/App.jsx`, 'utf8');
    expect(app).toContain('isPublicTokenPath(location.pathname)');
    expect(app).not.toContain("startsWith('/join')");
  });
});
