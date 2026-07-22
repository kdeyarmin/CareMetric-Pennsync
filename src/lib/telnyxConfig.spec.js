import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();
const readRepoFile = (filePath) => fs.readFileSync(path.join(repoRoot, filePath), 'utf8');

describe('Telnyx in-app configuration guardrails', () => {
  it('does not present retired dashboard-env Telnyx sources in admin UI', () => {
    const panel = readRepoFile('src/components/admin/TelnyxSecretPanel.jsx');
    const setup = readRepoFile('src/components/admin/twilioSetup.js');

    expect(panel).not.toContain('Base44 dashboard env');
    expect(panel).not.toContain('source === "env"');
    expect(setup).not.toContain('source === "env"');
  });

  it('does not read retired TELNYX_* env vars from Base44 functions', () => {
    // The three SCHEDULED fax functions intentionally fall back to app-level
    // secrets (TELNYX_API_KEY / TELNYX_CONNECTION_ID) so cron jobs keep running
    // before an admin has saved Telnyx config in-app. The in-app
    // IntegrationSecret row still wins whenever it exists. Everything else must
    // stay IntegrationSecret-only.
    const scheduledFaxAllowlist = [
      'base44/functions/autoRetryFailedFaxes/entry.ts',
      'base44/functions/sendBatchFax/entry.ts',
      'base44/functions/syncFaxStatuses/entry.ts',
    ];
    const functionsDir = path.join(repoRoot, 'base44/functions');
    const offenders = fs.readdirSync(functionsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(functionsDir, entry.name, 'entry.ts'))
      .filter((entryPath) => fs.existsSync(entryPath))
      .filter((entryPath) => /Deno\.env\.get\(['"]TELNYX_/.test(fs.readFileSync(entryPath, 'utf8')))
      .map((entryPath) => path.relative(repoRoot, entryPath))
      .filter((relPath) => !scheduledFaxAllowlist.includes(relPath));

    expect(offenders).toEqual([]);
  });
});
