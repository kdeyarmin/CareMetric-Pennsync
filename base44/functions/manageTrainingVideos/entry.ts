import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ───────────────────────────────────────────────────────────────────────────
// Admin tool to make / enhance AI presenter videos (HeyGen) for course modules.
//
// Generation is ASYNC so a UI request never blocks: `start`/`regenerate` kick
// off a HeyGen job and stamp the module video_status='processing' + video_job_id,
// then return immediately. `status` polls each processing job ONCE (no waiting
// loop) and finalizes finished modules. The admin UI calls `status` on an
// interval to watch progress.
// ───────────────────────────────────────────────────────────────────────────

const HEYGEN_API_KEY = Deno.env.get('HEYGEN_API_KEY') || '';
const HEYGEN_BASE = 'https://api.heygen.com';
const DEFAULT_AVATAR_ID = 'Daisy-inskirt-20220818';
const DEFAULT_VOICE_ID = '55f8c0f546884f9cbdefa113f5e7b682'; // Elizabeth - Friendly English

const isAdmin = (u) =>
  u?.role === 'admin' || u?.account_type === 'agency_admin' || u?.account_type === 'super_admin';

async function heygen(path, method, body) {
  const res = await fetch(`${HEYGEN_BASE}${path}`, {
    method,
    headers: { 'x-api-key': HEYGEN_API_KEY, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HeyGen API error ${res.status}: ${text}`);
  }
  return res.json();
}

function buildNarrationScript(moduleTitle, content) {
  const parts = [`Welcome to this module: ${moduleTitle}.`];
  if (content.intro) parts.push(String(content.intro));
  const sections = content.sections || [];
  for (const section of sections) {
    if (section.heading) parts.push(`Let's talk about: ${section.heading}.`);
    if (section.body) parts.push(String(section.body));
    if (section.pro_tip) parts.push(`Here's a pro tip: ${section.pro_tip}`);
    if (section.warning) parts.push(`Important warning: ${section.warning}`);
  }
  if (content.clinical_pearl) parts.push(`Clinical pearl: ${content.clinical_pearl}`);
  if (content.summary) parts.push(String(content.summary));
  parts.push("That wraps up this module. Let's move on.");
  const script = parts.join(' ');
  return script.length > 5000 ? script.slice(0, 4950) + '... That covers the key points for this module.' : script;
}

async function createVideo(script, title, avatarId, voiceId) {
  const result = await heygen('/v2/video/generate', 'POST', {
    video_inputs: [{
      character: { type: 'avatar', avatar_id: avatarId || DEFAULT_AVATAR_ID, avatar_style: 'normal' },
      voice: { type: 'text', voice_id: voiceId || DEFAULT_VOICE_ID, input_text: script, speed: 1.0, emotion: 'Friendly' },
      background: { type: 'color', value: '#FFFFFF' },
    }],
    dimension: { width: 1920, height: 1080 },
    caption: true,
    title,
  });
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
    if (!isAdmin(user)) {
      return Response.json({ error: 'Unauthorized - admin access required' }, { status: 403 });
    }

    const { action = 'status', course_id, module_id, avatar_id, voice_id } = await req.json();
    const svc = base44.asServiceRole.entities;

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
      if (HEYGEN_API_KEY) {
        const processing = modules.filter((m) => m.video_status === 'processing' && m.video_job_id);
        await runChunked(processing, 5, async (m) => {
          try {
            const r = await heygen(`/v1/video_status.get?video_id=${encodeURIComponent(String(m.video_job_id))}`, 'GET');
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
      return Response.json({ heygen_configured: !!HEYGEN_API_KEY, modules: modules.map(view) });
    }

    // ── START / REGENERATE: kick off jobs, return immediately ───────────────
    if (action === 'start' || action === 'regenerate') {
      if (!HEYGEN_API_KEY) {
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
          const videoId = await createVideo(script, `${m.title} - Training Video`, avatar_id, voice_id);
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
    return Response.json({ error: error.message }, { status: 500 });
  }
});