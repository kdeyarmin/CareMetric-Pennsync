import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();
const readRepoFile = (filePath) => fs.readFileSync(path.join(repoRoot, filePath), 'utf8');

describe('Telnyx in-app configuration guardrails', () => {
  it('does not present retired dashboard-env Telnyx sources in admin UI', () => {
    const panel = readRepoFile('src/components/admin/TelnyxSecretPanel.jsx');
    const setup = readRepoFile('src/components/admin/telnyxSetup.js');

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

  it('does not read retired TELNYX_* env vars from the canonical shared helper', () => {
    // The inline copies are now generated from this file, so it is the single
    // place a future env fallback would be added — and a change here would
    // silently propagate to every consumer on the next sync. Guard the source,
    // not just the generated output.
    const helpers = readRepoFile('base44/_shared/backendHelpers.mjs');
    const resolver = helpers.slice(helpers.indexOf('resolveTelnyxCreds:'));
    expect(/Deno\.env\.get\(['"`]TELNYX_/.test(resolver)).toBe(false);
  });

  it('keeps the in-helper retirement note that is the only guardrail the Base44 builder bot reads', () => {
    // The bot edits the hosted function source directly and syncs afterwards, so
    // it never sees docs/, AGENTS.md or CI. The comment inside the helper body is
    // the only warning that reaches it — and it has re-added this fallback twice.
    const helpers = readRepoFile('base44/_shared/backendHelpers.mjs');
    expect(helpers).toContain('READ THIS BEFORE ADDING');
    expect(helpers).toContain('TELNYX_* environment variables are not read');
  });

  it('does not instruct operators to set TELNYX_* function secrets in the admin UI', () => {
    // PhoneProvisioningPanel used to tell super admins to set a TELNYX_WEBHOOK_DEBUG
    // function secret that no backend function reads, two cards away from a panel
    // saying env vars are ignored.
    const panel = readRepoFile('src/components/admin/PhoneProvisioningPanel.jsx');
    expect(panel).not.toMatch(/TELNYX_[A-Z_]+/);
  });
});
