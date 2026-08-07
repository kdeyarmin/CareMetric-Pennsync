import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


// ───────────────────────────────────────────────────────────────────────────
// Admin tool to make / enhance AI presenter videos (HeyGen) for course modules.
//
// Generation is ASYNC so a UI request never blocks: `start`/`regenerate` kick
// off a HeyGen job and stamp the module video_status='processing' + video_job_id,
// then return immediately. `status` polls each processing job ONCE (no waiting
// loop) and finalizes finished modules. The admin UI calls `status` on an
// interval to watch progress. `options` lists the account's avatars/voices so
// the UIs can offer pickers instead of raw HeyGen IDs.
//
// buildNarrationScript / truncateAtSentence / normalizeHeyGenAvatars /
// normalizeHeyGenVoices are inline copies of the unit-tested source in
// src/components/training/videoNarration.js — keep them identical
// (base44/functions/trainingVideosInlineParity.test.js guards against drift).
// ───────────────────────────────────────────────────────────────────────────

const HEYGEN_BASE = 'https://api.heygen.com';
const DEFAULT_AVATAR_ID = 'Daisy-inskirt-20220818';
const DEFAULT_VOICE_ID = '55f8c0f546884f9cbdefa113f5e7b682'; // Elizabeth - Friendly English
const getHeyGenApiKey = () => Deno.env.get('HEYGEN_API_KEY') || '';

const isAdmin = (u) =>
  u?.role === 'admin' || u?.account_type === 'agency_admin' || u?.account_type === 'super_admin';

async function heygen(path, method, body, apiKey) {
  const res = await fetch(`${HEYGEN_BASE}${path}`, {
    method,
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HeyGen API error ${res.status}: ${text}`);
  }
  return res.json();
}

// HeyGen's /v2/video/generate rejects input_text over 5000 characters.
const NARRATION_CHAR_LIMIT = 5000;

const TRUNCATION_SUFFIX = ' That covers the key points for this module.';

// Cut a too-long script at the last sentence boundary that leaves room for the
// wrap-up suffix, so the narration never stops mid-word or mid-sentence.
function truncateAtSentence(script, limit = NARRATION_CHAR_LIMIT) {
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
function sanitizeForSpeech(text) {
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
function speakableList(items) {
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
const MIN_AUTHORED_NARRATION_CHARS = 80;

// Turn a lesson module's content_json into a spoken narration script. Prefers
// a purpose-written script (content.video_narration, authored by the course
// LLM for the ear) when present; otherwise assembles one from the on-screen
// lesson order: intro, an overview of what's coming, sections (with pro tips
// and warnings), key takeaways, clinical pearl, summary.
function buildNarrationScript(moduleTitle, content) {
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
function normalizeHeyGenAvatars(rawAvatars, cap = 150) {
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
function normalizeHeyGenVoices(rawVoices, cap = 150) {
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

async function createVideo(script, title, avatarId, voiceId, apiKey) {
  const result = await heygen('/v2/video/generate', 'POST', {
    video_inputs: [{
      character: { type: 'avatar', avatar_id: avatarId || DEFAULT_AVATAR_ID, avatar_style: 'normal' },
      voice: { type: 'text', voice_id: voiceId || DEFAULT_VOICE_ID, input_text: script, speed: 1.0, emotion: 'Friendly' },
      // Brand navy-50 (tailwind.config.js) — a soft brand-tinted backdrop that
      // keeps the presenter and captions legible, instead of stark white.
      background: { type: 'color', value: '#EEF3FC' },
    }],
    dimension: { width: 1920, height: 1080 },
    caption: true,
    title,
  }, apiKey);
  return result.data?.video_id;
}

// Run async work with bounded concurrency so starting/polling many jobs stays
// fast and predictable without flooding the provider.
async function runChunked(items, size, fn) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

// A module with a real video_url has a usable video regardless of how it was
// produced (e.g. the older generateTrainingVideo path that didn't stamp
// video_status, which schema-defaults to the truthy string "none"). An
// in-flight job still reports "processing".
function effectiveStatus(m) {
  if (m.video_status === 'processing') return 'processing';
  if (m.video_url) return 'completed';
  if (m.video_status === 'failed') return 'failed';
  return 'none';
}

const view = (m) => ({
  module_id: m.id,
  title: m.title,
  order_index: Number(m.order_index) || 0,
  video_status: effectiveStatus(m),
  video_url: m.video_url || null,
  video_thumbnail_url: m.video_thumbnail_url || null,
  video_duration_seconds: m.video_duration_seconds || null,
  video_error: m.video_error || null,
});

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (!isAdmin(user)) {
      return Response.json({ error: 'Unauthorized - admin access required' }, { status: 403 });
    }

    const { action = 'status', course_id, module_id, avatar_id, voice_id } = await req.json();
    const heygenApiKey = getHeyGenApiKey();
    const svc = base44.asServiceRole.entities;

    // ── OPTIONS: list the account's avatars & voices for the UI pickers ─────
    // Needs no course/module. Missing key is a normal state (feature not
    // configured), not an error — the UIs use heygen_configured to explain it.
    if (action === 'options') {
      if (!heygenApiKey) {
        return Response.json({
          heygen_configured: false, avatars: [], voices: [],
          default_avatar_id: DEFAULT_AVATAR_ID, default_voice_id: DEFAULT_VOICE_ID,
        });
      }
      // Voices: /v3/voices is the current documented catalog (array directly
      // under data); /v2/voices (data.voices) is queried too as a fallback for
      // older accounts. The normalizer dedupes by voice_id across both.
      const [avatarsRes, voicesV3Res, voicesV2Res] = await Promise.all([
        heygen('/v2/avatars', 'GET', null, heygenApiKey).catch(() => null),
        heygen('/v3/voices', 'GET', null, heygenApiKey).catch(() => null),
        heygen('/v2/voices', 'GET', null, heygenApiKey).catch(() => null),
      ]);
      const rawVoices = [
        ...(Array.isArray(voicesV3Res?.data) ? voicesV3Res.data : []),
        ...(Array.isArray(voicesV2Res?.data?.voices) ? voicesV2Res.data.voices : []),
      ];
      return Response.json({
        heygen_configured: true,
        avatars: normalizeHeyGenAvatars(avatarsRes?.data?.avatars),
        voices: normalizeHeyGenVoices(rawVoices),
        default_avatar_id: DEFAULT_AVATAR_ID,
        default_voice_id: DEFAULT_VOICE_ID,
      });
    }

    let modules = [];
    if (module_id) {
      modules = await svc.TrainingModule.filter({ id: module_id });
    } else if (course_id) {
      modules = await svc.TrainingModule.filter({ course_id }, 'order_index', 200);
    } else {
      return Response.json({ error: 'course_id or module_id is required' }, { status: 400 });
    }
    modules.sort((a, b) => (Number(a.order_index) || 0) - (Number(b.order_index) || 0));

    // ── STATUS: poll each in-flight job once, finalize finished modules ──────
    if (action === 'status') {
      if (heygenApiKey) {
        const processing = modules.filter((m) => m.video_status === 'processing' && m.video_job_id);
        await runChunked(processing, 5, async (m) => {
          try {
            const r = await heygen(`/v1/video_status.get?video_id=${encodeURIComponent(String(m.video_job_id))}`, 'GET', null, heygenApiKey);
            const d = r.data || {};
            if (d.status === 'completed') {
              const patch = {
                video_url: d.video_url, video_thumbnail_url: d.thumbnail_url,
                video_duration_seconds: d.duration, video_status: 'completed',
                video_generated_at: new Date().toISOString(), video_error: '', type: 'video',
              };
              await svc.TrainingModule.update(m.id, patch);
              Object.assign(m, patch);
            } else if (d.status === 'failed') {
              const err = (d.error && (d.error.message || d.error)) || 'Generation failed';
              await svc.TrainingModule.update(m.id, { video_status: 'failed', video_error: String(err) });
              m.video_status = 'failed';
              m.video_error = String(err);
            }
            // pending / processing / waiting → leave as processing
          } catch (_e) {
            // transient poll error — keep processing, try again next poll
          }
        });
      }
      return Response.json({ heygen_configured: !!heygenApiKey, modules: modules.map(view) });
    }

    // ── START / REGENERATE: kick off jobs, return immediately ───────────────
    if (action === 'start' || action === 'regenerate') {
      if (!heygenApiKey) {
        return Response.json({ error: 'HeyGen API key not configured', heygen_configured: false }, { status: 400 });
      }
      // Course-level "start" only fills in lessons that don't already have a
      // video — so the UI's "Generate N missing" never burns credits or pushes
      // ready lessons back to processing. "regenerate" (or an explicit single
      // module) rebuilds regardless.
      const targets = (action === 'start' && !module_id)
        ? modules.filter((m) => effectiveStatus(m) !== 'completed')
        : modules;

      let started = 0;
      await runChunked(targets, 4, async (m) => {
        try {
          const script = buildNarrationScript(String(m.title), m.content_json || {});
          const videoId = await createVideo(script, `${m.title} - Training Video`, avatar_id, voice_id, heygenApiKey);
          if (!videoId) throw new Error('HeyGen did not return a video id');
          const patch = {
            video_job_id: videoId, video_status: 'processing', video_error: '',
            video_avatar_id: avatar_id || DEFAULT_AVATAR_ID, video_voice_id: voice_id || DEFAULT_VOICE_ID,
          };
          await svc.TrainingModule.update(m.id, patch);
          Object.assign(m, patch);
          started += 1;
        } catch (e) {
          await svc.TrainingModule.update(m.id, { video_status: 'failed', video_error: e.message });
          m.video_status = 'failed';
          m.video_error = e.message;
        }
      });

      await svc.TrainingAuditLog.create({
        actor_id: user.email,
        actor_name: user.full_name,
        action: 'videos_generated',
        entity_type: course_id ? 'TrainingCourse' : 'TrainingModule',
        entity_id: course_id || module_id,
        after_json: { mode: action, started, targeted: targets.length },
        severity: 'info',
      });

      return Response.json({ heygen_configured: true, started, modules: modules.map(view) });
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    console.error('manageTrainingVideos failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});