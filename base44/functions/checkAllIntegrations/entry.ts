import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


/**
 * checkAllIntegrations — admin/super-admin read-only health probe across every
 * external integration the app relies on. It NEVER sends a text, places a call,
 * or emails anyone; each check either confirms a secret is present or makes the
 * lightest possible authenticated read against the provider.
 *
 * Most AI / transcription / email keys are PLATFORM secrets (Deno.env), injected
 * by Base44 and not editable from app code — so for those we report presence and,
 * where cheap, a live auth probe. Telnyx credentials live in the IntegrationSecret
 * entity and are delegated to the existing testTelnyxConnection function.
 *
 * Returns: { success, generated_at, integrations: [{ id, label, category,
 *   configured, status: 'ok'|'warn'|'fail', detail, editable_in_app }] }
 */

const isSet = (v) => typeof v === 'string' && v.trim() !== '';

// Light auth probe against a provider. Returns { status, detail }.
async function probe(url, options, okDetail, failLabel) {
  try {
    const res = await fetch(url, options);
    if (res.ok || res.status === 200) return { status: 'ok', detail: okDetail };
    if (res.status === 401 || res.status === 403) {
      return { status: 'fail', detail: `${failLabel} rejected the key (HTTP ${res.status}). Check the key value.` };
    }
    // Other non-2xx (e.g. 400 for a probe endpoint) still proves the key authenticated.
    return { status: 'ok', detail: okDetail };
  } catch (e) {
    return { status: 'warn', detail: `Could not reach ${failLabel}: ${e.message}` };
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const isAdmin = user.role === 'admin' || user.account_type === 'agency_admin' || user.account_type === 'super_admin';
    if (!isAdmin) {
      return Response.json({ error: 'Administrator access required.' }, { status: 403 });
    }

    const env = (k) => {
      const v = Deno.env.get(k);
      return isSet(v) ? v : null;
    };

    const integrations = [];

    // ---- OpenAI (Whisper transcription + LLM) ----
    const openaiKey = env('OPENAI_API_KEY');
    if (openaiKey) {
      const r = await probe(
        'https://api.openai.com/v1/models',
        { headers: { Authorization: `Bearer ${openaiKey}` } },
        'Authenticated with OpenAI.',
        'OpenAI',
      );
      integrations.push({ id: 'openai', label: 'OpenAI (LLM / Whisper)', category: 'AI', configured: true, editable_in_app: false, ...r });
    } else {
      integrations.push({ id: 'openai', label: 'OpenAI (LLM / Whisper)', category: 'AI', configured: false, editable_in_app: false, status: 'fail', detail: 'OPENAI_API_KEY is not set.' });
    }

    // ---- Anthropic (Claude) ----
    const anthropicKey = env('ANTHROPIC_API_KEY');
    if (anthropicKey) {
      const r = await probe(
        'https://api.anthropic.com/v1/models',
        { headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' } },
        'Authenticated with Anthropic.',
        'Anthropic',
      );
      integrations.push({ id: 'anthropic', label: 'Anthropic (Claude)', category: 'AI', configured: true, editable_in_app: false, ...r });
    } else {
      integrations.push({ id: 'anthropic', label: 'Anthropic (Claude)', category: 'AI', configured: false, editable_in_app: false, status: 'fail', detail: 'ANTHROPIC_API_KEY is not set.' });
    }

    // ---- Google Gemini ----
    const geminiKey = env('GOOGLE_GEMINI_API_KEY');
    if (geminiKey) {
      const r = await probe(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(geminiKey)}`,
        {},
        'Authenticated with Google Gemini.',
        'Google Gemini',
      );
      integrations.push({ id: 'gemini', label: 'Google Gemini', category: 'AI', configured: true, editable_in_app: false, ...r });
    } else {
      integrations.push({ id: 'gemini', label: 'Google Gemini', category: 'AI', configured: false, editable_in_app: false, status: 'warn', detail: 'GOOGLE_GEMINI_API_KEY is not set (optional web-context model).' });
    }

    // ---- Deepgram (live dictation) ----
    const deepgramKey = env('DEEPGRAM_API_KEY');
    if (deepgramKey) {
      const r = await probe(
        'https://api.deepgram.com/v1/projects',
        { headers: { Authorization: `Token ${deepgramKey}` } },
        'Authenticated with Deepgram.',
        'Deepgram',
      );
      integrations.push({ id: 'deepgram', label: 'Deepgram (dictation)', category: 'Transcription', configured: true, editable_in_app: false, ...r });
    } else {
      integrations.push({ id: 'deepgram', label: 'Deepgram (dictation)', category: 'Transcription', configured: false, editable_in_app: false, status: 'warn', detail: 'DEEPGRAM_API_KEY is not set (live dictation disabled).' });
    }

    // ---- Resend (transactional email) ----
    const resendKey = env('RESEND_API_KEY');
    if (resendKey) {
      const r = await probe(
        'https://api.resend.com/domains',
        { headers: { Authorization: `Bearer ${resendKey}` } },
        'Authenticated with Resend.',
        'Resend',
      );
      integrations.push({ id: 'resend', label: 'Resend (email)', category: 'Email', configured: true, editable_in_app: false, ...r });
    } else {
      integrations.push({ id: 'resend', label: 'Resend (email)', category: 'Email', configured: false, editable_in_app: false, status: 'warn', detail: 'RESEND_API_KEY is not set (falls back to platform email).' });
    }

    // ---- HeyGen (training video avatars) ----
    const heygenKey = env('HEYGEN_API_KEY');
    integrations.push({
      id: 'heygen',
      label: 'HeyGen (training videos)',
      category: 'Media',
      configured: Boolean(heygenKey),
      editable_in_app: false,
      status: heygenKey ? 'ok' : 'warn',
      detail: heygenKey ? 'HEYGEN_API_KEY is set.' : 'HEYGEN_API_KEY is not set (AI training video generation disabled).',
    });

    // ---- Notifyre (fax fallback) ----
    const notifyreKey = env('NOTIFYRE_API_KEY');
    integrations.push({
      id: 'notifyre',
      label: 'Notifyre (fax fallback)',
      category: 'Fax',
      configured: Boolean(notifyreKey),
      editable_in_app: false,
      status: notifyreKey ? 'ok' : 'warn',
      detail: notifyreKey ? 'NOTIFYRE_API_KEY is set.' : 'NOTIFYRE_API_KEY is not set (optional fax fallback).',
    });

    // ---- Twilio (legacy SMS / voice) ----
    const twilioSid = env('TWILIO_ACCOUNT_SID');
    const twilioToken = env('TWILIO_AUTH_TOKEN');
    if (twilioSid && twilioToken) {
      const r = await probe(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(twilioSid)}.json`,
        { headers: { Authorization: `Basic ${btoa(`${twilioSid}:${twilioToken}`)}` } },
        'Authenticated with Twilio.',
        'Twilio',
      );
      integrations.push({ id: 'twilio', label: 'Twilio (SMS / voice)', category: 'Telephony', configured: true, editable_in_app: false, ...r });
    } else {
      integrations.push({ id: 'twilio', label: 'Twilio (SMS / voice)', category: 'Telephony', configured: false, editable_in_app: false, status: 'warn', detail: 'Twilio credentials are not fully set (optional — Telnyx is the primary provider).' });
    }

    // ---- Telnyx (SMS / voice / fax) — delegate to the dedicated live test ----
    try {
      const res = await base44.functions.invoke('testTelnyxConnection', {});
      const data = res?.data || res;
      const checks = Array.isArray(data?.checks) ? data.checks : [];
      const hasFail = checks.some((c) => c.status === 'fail');
      const hasWarn = checks.some((c) => c.status === 'warn');
      const apiLive = checks.find((c) => c.id === 'telnyx_api_live');
      integrations.push({
        id: 'telnyx',
        label: 'Telnyx (SMS / voice / fax)',
        category: 'Telephony',
        configured: Boolean(data?.stats?.messaging_ready || data?.stats?.voice_ready || data?.stats?.fax_ready),
        editable_in_app: true,
        status: hasFail ? 'fail' : hasWarn ? 'warn' : 'ok',
        detail: apiLive && apiLive.status === 'fail'
          ? apiLive.detail
          : hasFail
            ? 'One or more Telnyx checks failed — see the Telnyx setup section.'
            : 'Telnyx credentials configured and authenticated.',
      });
    } catch (e) {
      integrations.push({ id: 'telnyx', label: 'Telnyx (SMS / voice / fax)', category: 'Telephony', configured: false, editable_in_app: true, status: 'warn', detail: `Telnyx test could not run: ${e.message}` });
    }

    return Response.json({
      success: true,
      generated_at: new Date().toISOString(),
      integrations,
    });
  } catch (error) {
    console.error('checkAllIntegrations error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});