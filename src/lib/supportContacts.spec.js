import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import { CENTRAL_SUPPORT_EMAIL, accountDeletionEmailHref } from './supportContacts.js';

describe('accountDeletionEmailHref', () => {
  it('addresses central support with a subject and the account to delete', () => {
    const href = accountDeletionEmailHref('nurse@agency.test', '2026-10-08T12:00:00.000Z');
    const url = new URL(href);
    expect(url.protocol).toBe('mailto:');
    expect(url.pathname).toBe(CENTRAL_SUPPORT_EMAIL);
    expect(url.searchParams.get('subject')).toBe('PennSync account deletion request');
    const body = url.searchParams.get('body');
    expect(body).toContain('Account email: nurse@agency.test');
    expect(body).toContain('Requested in the app: 2026-10-08T12:00:00.000Z');
  });

  it('encodes what a mail client would otherwise split on', () => {
    const href = accountDeletionEmailHref('a&b=c?d@agency.test', 'x');
    expect(href.split('?')).toHaveLength(2);
    expect(new URL(href).searchParams.get('body')).toContain('a&b=c?d@agency.test');
  });
});

describe('the account deletion flow says only what it does', () => {
  // Until 2026-10-08 the flow told every user their request was "submitted"
  // and "recorded in the security audit log". The audit helper records
  // nothing, and a non-admin cannot see an administrator to notify, so for
  // almost everyone nothing happened. These are the claims that made it false.
  // Comments are stripped first: the handler's own comment quotes the old
  // claims to explain their removal, and this asserts they are absent from
  // what the user sees and what runs, not from the explanation.
  const settings = readFileSync(path.join(process.cwd(), 'src/pages/UserSettings.jsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('does not claim an audit record or a completed submission', () => {
    expect(settings).not.toMatch(/recorded in the security audit log/i);
    expect(settings).not.toMatch(/deletion request has been submitted/i);
    expect(settings).not.toMatch(/Permanently delete your account and all associated data/);
    expect(settings).not.toMatch(/logSecurityEvent\(\s*['"]ACCOUNT_DELETION/);
  });

  it('hands the user the support email that completes the request', () => {
    expect(settings).toMatch(/accountDeletionEmailHref\(/);
  });
});
