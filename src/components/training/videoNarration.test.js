import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NARRATION_CHAR_LIMIT,
  truncateAtSentence,
  buildNarrationScript,
  normalizeHeyGenAvatars,
  normalizeHeyGenVoices,
} from './videoNarration.js';

const CONTENT = {
  intro: 'Every year, falls injure thousands of home health patients.',
  sections: [
    {
      heading: 'Why falls happen',
      body: 'Most falls trace back to preventable environmental hazards.',
      pro_tip: 'Scan the walking path the moment you enter the home.',
      warning: 'Never leave a high-risk patient standing unattended.',
    },
    { heading: 'Reporting', body: 'Report every fall the same day.' },
  ],
  key_takeaways: ['Assess risk on every visit', 'Clear walking paths.', 'Document hazards!'],
  clinical_pearl: 'Ask about near-falls — patients rarely volunteer them.',
  summary: 'Prevention starts with observation.',
};

test('buildNarrationScript follows the lesson order and narrates takeaways', () => {
  const script = buildNarrationScript('Falls Prevention', CONTENT);
  assert.ok(script.startsWith('Welcome to this module: Falls Prevention.'));
  const order = [
    CONTENT.intro,
    "Let's talk about: Why falls happen.",
    "Here's a pro tip: Scan the walking path",
    'Important warning: Never leave',
    'remember these key takeaways. Assess risk on every visit. Clear walking paths. Document hazards!',
    'Clinical pearl: Ask about near-falls',
    CONTENT.summary,
    "That wraps up this module. Let's move on.",
  ];
  let cursor = -1;
  for (const fragment of order) {
    const at = script.indexOf(fragment);
    assert.ok(at > cursor, `expected "${fragment}" after position ${cursor}, got ${at}`);
    cursor = at;
  }
});

test('buildNarrationScript tolerates missing/empty content', () => {
  const script = buildNarrationScript('Empty Module', undefined);
  assert.equal(script, "Welcome to this module: Empty Module. That wraps up this module. Let's move on.");
  const partial = buildNarrationScript('Partial', { sections: [null, 'bogus', {}], key_takeaways: ['  ', ''] });
  assert.ok(!partial.includes('key takeaways'));
  assert.ok(!partial.includes('undefined'));
});

test('long scripts truncate at a sentence boundary under the HeyGen limit', () => {
  const sentence = 'This sentence pads the script toward the provider character limit. ';
  const script = buildNarrationScript('Long', { intro: sentence.repeat(200) });
  assert.ok(script.length <= NARRATION_CHAR_LIMIT, `length ${script.length}`);
  assert.ok(script.endsWith('. That covers the key points for this module.'));
  // The cut lands between sentences, never mid-word.
  assert.ok(!/limi\.? That covers/.test(script));
});

test('truncateAtSentence hard-cuts a boundary-free run-on and leaves short text alone', () => {
  assert.equal(truncateAtSentence('short script'), 'short script');
  const runOn = 'x'.repeat(NARRATION_CHAR_LIMIT + 500);
  const cut = truncateAtSentence(runOn);
  assert.ok(cut.length <= NARRATION_CHAR_LIMIT);
  assert.ok(cut.includes('...'));
  assert.ok(cut.endsWith('That covers the key points for this module.'));
});

test('normalizeHeyGenAvatars dedupes, drops idless rows, caps, and sorts by name', () => {
  const raw = [
    { avatar_id: 'b', avatar_name: 'Bravo', gender: 'male', preview_image_url: 'https://x/b.png' },
    { avatar_id: 'b', avatar_name: 'Bravo dupe' },
    { avatar_name: 'No id' },
    null,
    { avatar_id: 'a', avatar_name: 'Alpha' },
    { avatar_id: 'c' },
  ];
  const avatars = normalizeHeyGenAvatars(raw);
  assert.deepEqual(avatars.map((a) => a.name), ['Alpha', 'Bravo', 'c']);
  assert.equal(avatars[1].preview_image_url, 'https://x/b.png');
  assert.equal(normalizeHeyGenAvatars(raw, 2).length, 2);
  assert.deepEqual(normalizeHeyGenAvatars(undefined), []);
});

test('normalizeHeyGenVoices lists English voices first and caps the total', () => {
  const raw = [
    { voice_id: 'fr1', name: 'Zoe', language: 'French' },
    { voice_id: 'en2', name: 'Beth', language: 'English (US)', gender: 'female', preview_audio: 'https://x/beth.mp3' },
    { voice_id: 'en1', name: 'Adam', language: 'english' },
    { voice_id: 'en2', name: 'Beth dupe', language: 'English' },
    { name: 'No id', language: 'English' },
  ];
  const voices = normalizeHeyGenVoices(raw);
  assert.deepEqual(voices.map((v) => v.name), ['Adam', 'Beth', 'Zoe']);
  assert.equal(voices[1].preview_audio_url, 'https://x/beth.mp3');
  assert.deepEqual(normalizeHeyGenVoices(raw, 1).map((v) => v.name), ['Adam']);
});
