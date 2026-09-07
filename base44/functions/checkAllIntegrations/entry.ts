import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';

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

// btoa only accepts Latin-1 input. Encode credentials as UTF-8 first so a
// malformed or non-ASCII secret cannot crash the entire integration report.
function basicAuth(username, password) {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

// A provider is healthy only when the probe returns 2xx. A generic non-2xx does
// not prove authentication: 404, 429, and 5xx were previously mislabeled as
// "Working", which made this dashboard unsafe as a release check.
async function probe(url, options, okDetail, failLabel) {
  try {
    const res = await fetch(url, options);
    if (res.ok) return { status: 'ok', detail: okDetail };
    if (res.status === 401 || res.status === 403) {
      return { status: 'fail', detail: `${failLabel} rejected the key (HTTP ${res.status}). Check the key value.` };
    }
    if (res.status === 429) {
      return { status: 'warn', detail: `${failLabel} rate-limited the health check (HTTP 429); authentication was not confirmed.` };
    }
    if (res.status >= 500) {
      return { status: 'warn', detail: `${failLabel} is currently unavailable (HTTP ${res.status}); authentication was not confirmed.` };
    }
    return { status: 'fail', detail: `${failLabel} health check failed (HTTP ${res.status}); authentication was not confirmed.` };
  } catch (e) {
    return { status: 'warn', detail: `Could not reach ${failLabel}; authentication was not confirmed.` };
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const isAdmin = user.role === 'admin';
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
    // There is no harmless, stable auth endpoint pinned in this repository.
    // Presence is configuration evidence only and must never render as Working.
    const heygenKey = env('HEYGEN_API_KEY');
    integrations.push({
      id: 'heygen',
      label: 'HeyGen (training videos)',
      category: 'Media',
      configured: Boolean(heygenKey),
      editable_in_app: false,
      status: 'warn',
      detail: heygenKey
        ? 'HEYGEN_API_KEY is configured, but this dashboard has not authenticated it with HeyGen.'
        : 'HEYGEN_API_KEY is not set (AI training video generation disabled).',
    });

    // ---- Notifyre (fax fallback) ----
    const notifyreKey = env('NOTIFYRE_API_KEY');
    integrations.push({
      id: 'notifyre',
      label: 'Notifyre (fax fallback)',
      category: 'Fax',
      configured: Boolean(notifyreKey),
      editable_in_app: false,
      status: 'warn',
      detail: notifyreKey
        ? 'NOTIFYRE_API_KEY is configured, but this dashboard has not authenticated it with Notifyre.'
        : 'NOTIFYRE_API_KEY is not set (optional fax fallback).',
    });

    // ---- Twilio (legacy SMS / voice) ----
    const twilioSid = env('TWILIO_ACCOUNT_SID');
    const twilioToken = env('TWILIO_AUTH_TOKEN');
    if (twilioSid && twilioToken) {
      const r = await probe(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(twilioSid)}.json`,
        { headers: { Authorization: basicAuth(twilioSid, twilioToken) } },
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
      const validResult = data?.success === true && checks.length > 0;
      const hasFail = !validResult || checks.some((c) => c.status === 'fail');
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
            ? validResult
              ? 'One or more Telnyx checks failed — see the Telnyx setup section.'
              : 'Telnyx health check returned an invalid or empty result; authentication was not confirmed.'
            : 'Telnyx credentials configured and authenticated.',
      });
    } catch (e) {
      integrations.push({ id: 'telnyx', label: 'Telnyx (SMS / voice / fax)', category: 'Telephony', configured: false, editable_in_app: true, status: 'warn', detail: `Telnyx test could not run: ${e.message}` });
    }

    const internalSecret = env('INTERNAL_FN_SECRET');
    integrations.push({
      id: 'workflow_internal_auth',
      label: 'Workflow internal authentication',
      category: 'Automation',
      configured: Boolean(internalSecret && internalSecret.length >= 32),
      editable_in_app: false,
      status: internalSecret && internalSecret.length >= 32 ? 'ok' : 'fail',
      detail: internalSecret && internalSecret.length >= 32
        ? 'INTERNAL_FN_SECRET is configured for scheduler-to-function authentication.'
        : 'INTERNAL_FN_SECRET is missing or too short; protected scheduled functions cannot run.',
    });

    const signatureSecret = env('SIGNATURE_HMAC_SECRET');
    integrations.push({
      id: 'signature_hmac',
      label: 'E-signature token authentication',
      category: 'Security',
      configured: Boolean(signatureSecret && signatureSecret.length >= 32),
      editable_in_app: false,
      status: signatureSecret && signatureSecret.length >= 32 ? 'ok' : 'fail',
      detail: signatureSecret && signatureSecret.length >= 32
        ? 'SIGNATURE_HMAC_SECRET is configured for signed capability tokens.'
        : 'SIGNATURE_HMAC_SECRET is missing or too short; secure signer tokens cannot be issued.',
    });

    const outcomeRelease = env('OUTCOME_PIPELINE_RELEASE');
    integrations.push({
      id: 'outcome_pipeline_release',
      label: 'Outcome workflow release gate',
      category: 'Automation',
      configured: Boolean(outcomeRelease),
      editable_in_app: false,
      status: outcomeRelease === 'enabled-v1' ? 'ok' : 'warn',
      detail: outcomeRelease === 'enabled-v1'
        ? 'Outcome workflow release gate is enabled-v1.'
        : 'Outcome workflow is intentionally paused until hosted tenant and atomicity validation is approved.',
    });

    const report = {
      success: true,
      generated_at: new Date().toISOString(),
      integrations,
    };
    // Workflow run details currently omit backend-function output. Emit only
    // the sanitized report (never credential values) so hosted release checks
    // remain diagnosable from Base44 function logs.
    console.info('checkAllIntegrations result:', JSON.stringify(report));
    return Response.json(report);
  } catch (error) {
    console.error('checkAllIntegrations error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
