import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('../functions/checkAllIntegrations/entry.ts', import.meta.url),
  'utf8',
);

test('integration probes never report a non-2xx response as working', () => {
  assert.match(source, /if \(res\.ok\) return \{ status: 'ok'/);
  assert.doesNotMatch(source, /Other non-2xx[\s\S]*status: 'ok'/);
  for (const status of ['401', '403', '429', '500']) {
    assert.ok(source.includes(status), `missing explicit ${status} handling`);
  }
});

test('secret presence alone is not presented as authenticated provider health', () => {
  assert.doesNotMatch(source, /status: heygenKey \? 'ok'/);
  assert.doesNotMatch(source, /status: notifyreKey \? 'ok'/);
  assert.match(source, /has not authenticated it with HeyGen/);
  assert.match(source, /has not authenticated it with Notifyre/);
});

test('workflow-critical configuration appears in the health response', () => {
  assert.match(source, /id: 'workflow_internal_auth'/);
  assert.match(source, /INTERNAL_FN_SECRET is missing or too short/);
  assert.match(source, /id: 'outcome_pipeline_release'/);
  assert.match(source, /OUTCOME_PIPELINE_RELEASE/);
});

test('an empty or malformed Telnyx check cannot become Working', () => {
  assert.match(source, /validResult = data\?\.success === true && checks\.length > 0/);
  assert.match(source, /hasFail = !validResult/);
});
