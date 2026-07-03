import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NARRATION_CHAR_LIMIT,
  truncateAtSentence,
  sanitizeForSpeech,
  speakableList,
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
    { heading: 'Assessment tools', body: 'Use the agency fall-risk scale on admission.' },
    { heading: 'Reporting.', body: 'Report every fall the same day.' },
  ],
  key_takeaways: ['Assess risk on every visit', 'Clear walking paths.', 'Document hazards!'],
  clinical_pearl: 'Ask about near-falls — patients rarely volunteer them.',
  summary: 'Prevention starts with observation.',
};

test('buildNarrationScript follows the lesson order with an overview and varied transitions', () => {
  const script = buildNarrationScript('Falls Prevention', CONTENT);
  assert.ok(script.startsWith('Welcome to this module: Falls Prevention.'));
  const order = [
    CONTENT.intro,
    "In this module, we'll cover Why falls happen, Assessment tools, and Reporting.",
    "First, let's talk about Why falls happen.",
    "Here's a pro tip: Scan the walking path",
    'Important warning: Never leave',
    "Next, let's turn to Assessment tools.",
    "Finally, let's cover Reporting.",
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

test('a single-section module gets a plain lead-in and no overview', () => {
  const script = buildNarrationScript('Short', { sections: [{ heading: 'Hand hygiene', body: 'Wash often.' }] });
  assert.ok(script.includes("Let's talk about Hand hygiene."));
  assert.ok(!script.includes("we'll cover"));
  assert.ok(!script.includes('First,'));
});

test('buildNarrationScript tolerates missing/empty content', () => {
  const script = buildNarrationScript('Empty Module', undefined);
  assert.equal(script, "Welcome to this module: Empty Module. That wraps up this module. Let's move on.");
  const partial = buildNarrationScript('Partial', { sections: [null, 'bogus', {}], key_takeaways: ['  ', ''] });
  assert.ok(!partial.includes('key takeaways'));
  assert.ok(!partial.includes('undefined'));
});

test('narration is sanitized for speech (symbols, abbreviations, markdown)', () => {
  const script = buildNarrationScript('Regs', {
    sections: [{ heading: 'CoPs', body: 'Per CMS CoP §484.60(a), document visits promptly, e.g. before end of shift, i.e. same day. Safety & quality **matter**.' }],
  });
  assert.ok(script.includes('CMS CoP section 484.60(a)'));
  assert.ok(script.includes('for example, before end of shift'));
  assert.ok(script.includes('that is, same day'));
  assert.ok(script.includes('Safety and quality matter.'));
  assert.ok(!/[§*]/.test(script));
});

test('a purpose-written video_narration script is used verbatim (sanitized) over the mechanical build', () => {
  const authored =
    'Picture your first visit of the day. Before you knock, you are already assessing fall risk. ' +
    'Today we walk through what to look for, per §484.60, and how to document it, e.g. same day.';
  const script = buildNarrationScript('Falls Prevention', { ...CONTENT, video_narration: authored });
  assert.ok(script.startsWith('Picture your first visit of the day.'));
  assert.ok(script.includes('per section 484.60'));
  assert.ok(script.includes('for example, same day'));
  // The mechanical scaffolding is absent — the authored script stands alone.
  assert.ok(!script.includes('Welcome to this module'));
  assert.ok(!script.includes("we'll cover"));
});

test('a too-short or non-string video_narration falls back to the mechanical build', () => {
  for (const bad of ['Too short.', '   ', 42, null]) {
    const script = buildNarrationScript('Falls Prevention', { ...CONTENT, video_narration: bad });
    assert.ok(script.startsWith('Welcome to this module: Falls Prevention.'), `fell through for ${JSON.stringify(bad)}`);
  }
});

test('speakableList speaks one, two, and many items naturally', () => {
  assert.equal(speakableList([]), '');
  assert.equal(speakableList(['One.']), 'One');
  assert.equal(speakableList(['One', 'Two:']), 'One and Two');
  assert.equal(speakableList(['One', 'Two', 'Three']), 'One, Two, and Three');
});

test('sanitizeForSpeech handles vs. and collapses whitespace', () => {
  assert.equal(sanitizeForSpeech('Sterile vs. clean   technique'), 'Sterile versus clean technique');
});

test('sanitizeForSpeech decodes HTML-encoded ampersands and non-breaking spaces', () => {
  assert.equal(sanitizeForSpeech('Policies &amp; procedures'), 'Policies and procedures');
  assert.equal(sanitizeForSpeech('P&amp;P review'), 'P and P review');
  assert.equal(sanitizeForSpeech('same&nbsp;day'), 'same day');
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

test('normalizeHeyGenVoices lists English voices first, caps the total, and reads both v2/v3 preview fields', () => {
  const raw = [
    { voice_id: 'fr1', name: 'Zoe', language: 'French' },
    { voice_id: 'en2', name: 'Beth', language: 'English (US)', gender: 'female', preview_audio: 'https://x/beth.mp3' },
    { voice_id: 'en1', name: 'Adam', language: 'english', preview_audio_url: 'https://x/adam.mp3' },
    { voice_id: 'en2', name: 'Beth dupe', language: 'English' },
    { name: 'No id', language: 'English' },
  ];
  const voices = normalizeHeyGenVoices(raw);
  assert.deepEqual(voices.map((v) => v.name), ['Adam', 'Beth', 'Zoe']);
  // v3 rows use preview_audio_url; v2 rows use preview_audio — both normalize.
  assert.equal(voices[0].preview_audio_url, 'https://x/adam.mp3');
  assert.equal(voices[1].preview_audio_url, 'https://x/beth.mp3');
  assert.deepEqual(normalizeHeyGenVoices(raw, 1).map((v) => v.name), ['Adam']);
});
