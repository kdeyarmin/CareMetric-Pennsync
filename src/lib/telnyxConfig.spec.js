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
    const functionsDir = path.join(repoRoot, 'base44/functions');
    const offenders = fs.readdirSync(functionsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(functionsDir, entry.name, 'entry.ts'))
      .filter((entryPath) => fs.existsSync(entryPath))
      .filter((entryPath) => /Deno\.env\.get\(['"]TELNYX_/.test(fs.readFileSync(entryPath, 'utf8')))
      .map((entryPath) => path.relative(repoRoot, entryPath));

    expect(offenders).toEqual([]);
  });
});
