// HeyGen presenter-video helpers shared (via inline copies) with the
// manageTrainingVideos backend function. This file is the unit-tested source
// of truth; base44/functions/trainingVideosInlineParity.test.js guards the
// inline copies in base44/functions/manageTrainingVideos/entry.ts against drift.

// HeyGen's /v2/video/generate rejects input_text over 5000 characters.
export const NARRATION_CHAR_LIMIT = 5000;

const TRUNCATION_SUFFIX = ' That covers the key points for this module.';

// Cut a too-long script at the last sentence boundary that leaves room for the
// wrap-up suffix, so the narration never stops mid-word or mid-sentence.
export function truncateAtSentence(script, limit = NARRATION_CHAR_LIMIT) {
  if (script.length <= limit) return script;
  const budget = limit - TRUNCATION_SUFFIX.length;
  const head = script.slice(0, budget);
  const lastStop = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
  // No usable sentence boundary (one giant run-on) — fall back to a hard cut.
  const kept = lastStop > 0 ? head.slice(0, lastStop + 1) : `${head.slice(0, budget - 3)}...`;
  return kept + TRUNCATION_SUFFIX;
}

// Rewrite text so a TTS voice reads it naturally: written-only symbols and
// Latin abbreviations are spoken forms, markdown markers are dropped.
export function sanitizeForSpeech(text) {
  return String(text)
    // HTML-encoded content first, so "&amp;" never reaches the voice as "amp".
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s*&amp;\s*/gi, ' & ')
    .replace(/§+\s*/g, 'section ')
    .replace(/\be\.g\.,?\s*/gi, 'for example, ')
    .replace(/\bi\.e\.,?\s*/gi, 'that is, ')
    .replace(/\bvs\.\s*/gi, 'versus ')
    .replace(/\s&\s/g, ' and ')
    .replace(/[*_#`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const stripTrailingPunctuation = (s) => String(s).trim().replace(/[.:;,!?]+$/, '');

// "A", "A and B", or "A, B, and C" — for speaking a list of headings.
export function speakableList(items) {
  const list = items.map(stripTrailingPunctuation).filter(Boolean);
  if (list.length <= 1) return list[0] || '';
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`;
}

// Presenter-style section lead-in: numbered transitions when there are several
// sections, so the narration doesn't repeat the same phrase for every one.
const sectionLead = (heading, index, total) => {
  const h = stripTrailingPunctuation(heading);
  if (total <= 1) return `Let's talk about ${h}.`;
  if (index === 0) return `First, let's talk about ${h}.`;
  if (index === total - 1) return `Finally, let's cover ${h}.`;
  return `Next, let's turn to ${h}.`;
};

// A purpose-written spoken script must be long enough to be a real script —
// anything shorter is treated as absent and the mechanical builder runs.
export const MIN_AUTHORED_NARRATION_CHARS = 80;

// Turn a lesson module's content_json into a spoken narration script. Prefers
// a purpose-written script (content.video_narration, authored by the course
// LLM for the ear) when present; otherwise assembles one from the on-screen
// lesson order: intro, an overview of what's coming, sections (with pro tips
// and warnings), key takeaways, clinical pearl, summary.
export function buildNarrationScript(moduleTitle, content) {
  const c = content || {};
  const authored = typeof c.video_narration === 'string' ? c.video_narration.trim() : '';
  if (authored.length >= MIN_AUTHORED_NARRATION_CHARS) {
    return truncateAtSentence(sanitizeForSpeech(authored));
  }
  const parts = [`Welcome to this module: ${moduleTitle}.`];
  if (c.intro) parts.push(String(c.intro));
  const sections = (Array.isArray(c.sections) ? c.sections : []).filter((s) => s && typeof s === 'object');
  const headings = sections.map((s) => s.heading).filter(Boolean);
  if (headings.length >= 2) {
    parts.push(`In this module, we'll cover ${speakableList(headings)}.`);
  }
  let headingIndex = 0;
  for (const section of sections) {
    if (section.heading) parts.push(sectionLead(section.heading, headingIndex++, headings.length));
    if (section.body) parts.push(String(section.body));
    if (section.pro_tip) parts.push(`Here's a pro tip: ${section.pro_tip}`);
    if (section.warning) parts.push(`Important warning: ${section.warning}`);
  }
  const takeaways = (Array.isArray(c.key_takeaways) ? c.key_takeaways : [])
    .map((t) => String(t).trim())
    .filter(Boolean);
  if (takeaways.length) {
    parts.push(`Before we wrap up, remember these key takeaways. ${takeaways.map((t) => (/[.!?]$/.test(t) ? t : `${t}.`)).join(' ')}`);
  }
  if (c.clinical_pearl) parts.push(`Clinical pearl: ${c.clinical_pearl}`);
  if (c.summary) parts.push(String(c.summary));
  parts.push("That wraps up this module. Let's move on.");
  return truncateAtSentence(sanitizeForSpeech(parts.join(' ')));
}

// Bounded, UI-ready avatar list from HeyGen GET /v2/avatars. Drops entries
// without an id, dedupes, and caps the list so the response (and the dropdown)
// stays a manageable size.
export function normalizeHeyGenAvatars(rawAvatars, cap = 150) {
  const seen = new Set();
  const out = [];
  for (const a of Array.isArray(rawAvatars) ? rawAvatars : []) {
    const id = a && typeof a === 'object' ? String(a.avatar_id || '').trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      avatar_id: id,
      name: String(a.avatar_name || id),
      gender: a.gender ? String(a.gender) : '',
      preview_image_url: a.preview_image_url ? String(a.preview_image_url) : '',
    });
    if (out.length >= cap) break;
  }
  return out.sort((x, y) => x.name.localeCompare(y.name));
}

// Bounded, UI-ready voice list from HeyGen's voice catalog. Accepts both the
// current v3 row shape (preview_audio_url) and the older v2 shape
// (preview_audio) so merged/legacy responses normalize identically. The full
// catalog is 1000+ voices across dozens of languages; English voices are
// listed first (this app's learners are US healthcare staff), then others,
// capped.
export function normalizeHeyGenVoices(rawVoices, cap = 150) {
  const seen = new Set();
  const all = [];
  for (const v of Array.isArray(rawVoices) ? rawVoices : []) {
    const id = v && typeof v === 'object' ? String(v.voice_id || '').trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const preview = v.preview_audio_url || v.preview_audio;
    all.push({
      voice_id: id,
      name: String(v.name || id),
      language: v.language ? String(v.language) : '',
      gender: v.gender ? String(v.gender) : '',
      preview_audio_url: preview ? String(preview) : '',
    });
  }
  const isEnglish = (v) => /english/i.test(v.language);
  const byName = (x, y) => x.name.localeCompare(y.name);
  const english = all.filter(isEnglish).sort(byName);
  const other = all.filter((v) => !isEnglish(v)).sort(byName);
  return [...english, ...other].slice(0, cap);
}
