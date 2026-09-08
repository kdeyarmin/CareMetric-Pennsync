import assert from 'node:assert/strict';
import { access, readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import JSON5 from 'json5';

const ROOT = new URL('./', import.meta.url);

test('all PennSync2 legacy workflows remain explicitly reviewed and undeployed', async () => {
  const manifest = JSON5.parse(await readFile(
    new URL('workflow-quarantine/pennsync2-main-2026-09-07.jsonc', ROOT),
    'utf8',
  ));
  assert.equal(manifest.source_commit, 'cb5bc42efeab1764685bedfb5dc2497afbfb4b13');
  assert.equal(manifest.decision, 'do_not_import_or_activate');
  assert.equal(manifest.workflows.length, 22);

  const names = new Set();
  const deployed = new Set((await readdir(new URL('workflows/', ROOT)))
    .filter((name) => name.endsWith('.jsonc'))
    .map((name) => name.replace(/\.jsonc$/, '')));

  for (const workflow of manifest.workflows) {
    assert.match(workflow.name, /\S/);
    assert.match(workflow.target, /^[A-Za-z][A-Za-z0-9]*$/);
    assert.match(workflow.reason, /^[a-z0-9_]+$/);
    assert.ok(!names.has(workflow.name), `${workflow.name} is duplicated`);
    assert.ok(!deployed.has(workflow.name), `${workflow.name} must not be deployed`);
    names.add(workflow.name);

    const entry = new URL(`functions/${workflow.target}/entry.ts`, ROOT);
    if (workflow.state === 'missing_target') {
      await assert.rejects(access(entry));
      continue;
    }

    const source = await readFile(entry, 'utf8');
    if (workflow.state === 'source_disabled') {
      assert.match(source, /temporarily unavailable|Legacy Patient service-role writer is temporarily unavailable/);
      if (workflow.target === 'notifyUrgentMessage') {
        assert.match(source, /const SECURE_MESSAGE_DOMAIN_PAUSED = true;/);
        assert.match(source, /const secureMessageUnavailable = \(\) => json\(\{[\s\S]*?temporarily unavailable[\s\S]*?\},\s*503\);/);
        const handlerIndex = source.indexOf('Deno.serve(async (req) =>');
        const guardIndex = source.indexOf('if (SECURE_MESSAGE_DOMAIN_PAUSED) return secureMessageUnavailable();', handlerIndex);
        const clientIndex = source.indexOf('createClientFromRequest(req)', handlerIndex);
        assert.ok(handlerIndex !== -1 && handlerIndex < guardIndex && guardIndex < clientIndex,
          'notifyUrgentMessage must return its HTTP 503 helper before SDK construction');
      } else {
        assert.match(source, /status:\s*503/);
      }
    } else if (workflow.state === 'safe_noop') {
      assert.match(source, /automatic patient assignment disabled/);
      assert.doesNotMatch(source, /createClientFromRequest/);
    } else {
      assert.equal(workflow.state, 'quarantined');
      assert.match(source, /Deno\.serve\s*\(/);
    }
  }
});
