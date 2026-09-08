import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('automatic session timeout contract', () => {
  it('never waits for security telemetry before provider logout', () => {
    const source = readFileSync('src/components/security/SessionTimeoutManager.jsx', 'utf8');
    const handler = source.slice(
      source.indexOf('const handleLogout'),
      source.indexOf('const handleExtendSession'),
    );

    expect(handler).toMatch(/void logSecurityEvent\('SESSION_TIMEOUT'/);
    expect(handler).not.toMatch(/await logSecurityEvent/);
    expect(handler).toMatch(/await logout\(\)/);
    expect(handler.indexOf("void logSecurityEvent('SESSION_TIMEOUT'"))
      .toBeLessThan(handler.indexOf('await logout()'));
  });
});
