import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

// <<<BEGIN SHARED HELPER: outboundDeliveryGate — generated, edit base44/_shared/backendHelpers.mjs>>>
const OUTBOUND_DELIVERY_RELEASE_ENV = 'OUTBOUND_DELIVERY_RELEASE';
const OUTBOUND_DELIVERY_RELEASE_VALUE = 'enabled-v1';
function outboundDeliveryReleased() {
  return Deno.env.get(OUTBOUND_DELIVERY_RELEASE_ENV)
    === OUTBOUND_DELIVERY_RELEASE_VALUE;
}
function outboundDeliveryPausedResponse(channel = 'outbound') {
  return Response.json({
    error: 'Outbound delivery is disabled in this environment.',
    code: 'OUTBOUND_DELIVERY_RELEASE_PAUSED',
    channel,
    retryable: false,
  }, {
    status: 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
// <<<END SHARED HELPER: outboundDeliveryGate>>>

// <<<BEGIN SHARED HELPER: signatureAuditKeys — generated, edit base44/_shared/backendHelpers.mjs>>>
function signatureAuditKeyId(value) {
  if (value == null) return 'legacy';
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value)) throw new Error('Signature audit key identity is invalid');
  return value;
}

function signatureAuditKeyring() {
  const configured = Deno.env.get('SIGNATURE_HMAC_KEYRING');
  if (!configured) {
    if (Deno.env.get('SIGNATURE_HMAC_ACTIVE_KEY_ID')) throw new Error('Signature audit keyring is not configured');
    const secret = String(Deno.env.get('SIGNATURE_HMAC_SECRET') || '');
    if (secret.length < 32) throw new Error('Signature audit is not configured');
    return { activeId: 'legacy', keys: { legacy: secret } };
  }
  if (configured.length > 16384) throw new Error('Signature audit keyring is invalid');
  let keys;
  try {
    // Parse the flat string map without silently overwriting duplicate JSON keys.
    // JSON.parse on each string also normalizes escaped-equivalent key names.
    let offset = 0;
    const space = () => { while (/^[\t\r\n ]$/.test(configured[offset] || '')) offset += 1; };
    const take = (character) => { space(); if (configured[offset++] !== character) throw new Error('Invalid keyring'); };
    const string = () => {
      space();
      const start = offset;
      if (configured[offset++] !== '"') throw new Error('Invalid keyring string');
      while (offset < configured.length) {
        const character = configured[offset++];
        if (character === '"') return JSON.parse(configured.slice(start, offset));
        if (character.charCodeAt(0) === 92) offset += 1;
      }
      throw new Error('Unterminated keyring string');
    };
    keys = Object.create(null);
    take('{');
    space();
    if (configured[offset] !== '}') {
      while (true) {
        const id = string();
        if (Object.hasOwn(keys, id)) throw new Error('Duplicate keyring identity');
        take(':');
        keys[id] = string();
        space();
        if (configured[offset] !== ',') break;
        offset += 1;
      }
    }
    take('}');
    space();
    if (offset !== configured.length) throw new Error('Invalid keyring suffix');
  } catch { throw new Error('Signature audit keyring is invalid'); }
  if (!keys || typeof keys !== 'object' || Array.isArray(keys) || Object.keys(keys).length < 1 || Object.keys(keys).length > 8) {
    throw new Error('Signature audit keyring is invalid');
  }
  for (const [id, secret] of Object.entries(keys)) {
    signatureAuditKeyId(id);
    if (typeof secret !== 'string' || secret.length < 32 || secret.length > 1024) throw new Error('Signature audit keyring is invalid');
  }
  const activeId = Deno.env.get('SIGNATURE_HMAC_ACTIVE_KEY_ID');
  if (!activeId || !Object.hasOwn(keys, signatureAuditKeyId(activeId))) throw new Error('Signature audit active key is unavailable');
  return { activeId, keys };
}

function retainedSignatureAuditKey(keyring, id) {
  const keyId = signatureAuditKeyId(id);
  if (!Object.hasOwn(keyring.keys, keyId)) throw new Error('Signature audit verification key is unavailable');
  return keyring.keys[keyId];
}
// <<<END SHARED HELPER: signatureAuditKeys>>>

/**
 * Read-only capability report for integrations the current source tree uses.
 *
 * This function never sends email/SMS/fax, places calls, creates media, or
 * invokes a billable model. Provider checks are authenticated GET requests
 * bounded by a short timeout. A successful credential probe is authentication
 * evidence only; it is not an outbound-delivery release decision.
 */

const PROBE_TIMEOUT_MS = 5_000;
const TELNYX_CHECK_TIMEOUT_MS = 8_000;
const isSet = (value) => typeof value === 'string' && value.trim() !== '';
const TELNYX_CHECK_STATUSES = new Set(['ok', 'warn', 'fail']);
const TELNYX_REQUIRED_CHECK_IDS = new Set(['telnyx_api_key', 'telnyx_api_live']);
const WORKFLOW_RELEASE_GATES = [
  {
    id: 'release_auto_retry_failed_faxes',
    env: 'WORKFLOW_RELEASE_AUTO_RETRY_FAILED_FAXES',
    label: 'Automatic failed-fax retry',
    capability: 'fax_retry_automation',
    requiresFaxRelease: true,
  },
  {
    id: 'release_check_stale_follow_up_requests',
    env: 'WORKFLOW_RELEASE_CHECK_STALE_FOLLOW_UP_REQUESTS',
    label: 'Stale follow-up request checks',
    capability: 'follow_up_request_automation',
  },
  {
    id: 'release_poll_fax_statuses',
    env: 'WORKFLOW_RELEASE_POLL_FAX_STATUSES',
    label: 'Fax status polling',
    capability: 'fax_status_polling',
  },
  {
    id: 'release_process_inbound_faxes',
    env: 'WORKFLOW_RELEASE_PROCESS_INBOUND_FAXES',
    label: 'Inbound fax processing',
    capability: 'inbound_fax_automation',
  },
  {
    id: 'release_process_scheduled_faxes',
    env: 'WORKFLOW_RELEASE_PROCESS_SCHEDULED_FAXES',
    label: 'Scheduled fax processing',
    capability: 'scheduled_fax_automation',
    requiresFaxRelease: true,
  },
];

function publicAppOrigin(value) {
  const configured = String(value || '').trim();
  if (!configured) return null;
  try {
    const parsed = new URL(configured);
    if (
      parsed.protocol !== 'https:' || parsed.username || parsed.password
      || parsed.pathname !== '/' || parsed.search || parsed.hash
    ) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

// A provider is healthy only when its bounded, read-only probe returns 2xx.
// Response bodies and thrown provider details are deliberately not returned or
// logged because they are unnecessary for classifying authentication.
async function probe(url, options, okDetail, failLabel) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    // Credential-bearing diagnostics must never follow a redirect. Fetch can
    // otherwise forward non-standard auth headers (for example x-api-key) to a
    // redirected host. Use the 'manual' mode and refuse any redirect below:
    // Base44's function runtime rejects the 'error' redirect mode outright, so
    // every probe threw before a request was sent and each provider was
    // reported as "could not complete" regardless of its credential.
    const res = await fetch(url, {
      ...options,
      redirect: 'manual',
      signal: controller.signal,
    });
    const status = res.status;
    try { await res.body?.cancel(); } catch { /* no body to discard */ }
    if (res.type === 'opaqueredirect' || (status >= 300 && status < 400)) {
      return {
        status: 'fail',
        detail: `${failLabel} answered the read-only probe with a redirect (HTTP ${status}); it was not followed, so authentication was not confirmed.`,
        probe: 'authenticated-read',
      };
    }
    if (res.ok) return { status: 'ok', detail: okDetail, probe: 'authenticated-read' };
    if (status === 401 || status === 403) {
      return {
        status: 'fail',
        detail: `${failLabel} rejected the configured credential (HTTP ${status}).`,
        probe: 'authenticated-read',
      };
    }
    if (status === 429) {
      return {
        status: 'warn',
        detail: `${failLabel} rate-limited the read-only probe; authentication was not confirmed.`,
        probe: 'authenticated-read',
      };
    }
    if (status >= 500) {
      return {
        status: 'warn',
        detail: `${failLabel} was unavailable during the read-only probe; authentication was not confirmed.`,
        probe: 'authenticated-read',
      };
    }
    return {
      status: 'fail',
      detail: `${failLabel} rejected the read-only probe (HTTP ${status}); authentication was not confirmed.`,
      probe: 'authenticated-read',
    };
  } catch (error) {
    // Only the error class is inspected; provider/runtime messages are never
    // returned or logged.
    const timedOut = error?.name === 'AbortError';
    return {
      status: 'warn',
      detail: timedOut
        ? `${failLabel} did not answer the read-only probe within ${PROBE_TIMEOUT_MS / 1000} seconds; authentication was not confirmed.`
        : `Could not complete the bounded ${failLabel} read-only probe; authentication was not confirmed.`,
      probe: 'authenticated-read',
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function withTimeout(promise, milliseconds) {
  let timeout;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error('health-check-timeout')), milliseconds);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timeout);
  }
}

async function checkTelnyx(base44) {
  try {
    const res = await withTimeout(
      base44.functions.invoke('testTelnyxConnection', {}),
      TELNYX_CHECK_TIMEOUT_MS,
    );
    const data = res?.data || res;
    const checks = Array.isArray(data?.checks) ? data.checks : [];
    const checkIds = new Set();
    const wellFormedChecks = checks.length > 0 && checks.every((check) => {
      const id = typeof check?.id === 'string' ? check.id : '';
      const status = typeof check?.status === 'string' ? check.status : '';
      if (!id || checkIds.has(id) || !TELNYX_CHECK_STATUSES.has(status)) return false;
      checkIds.add(id);
      return true;
    });
    const hasRequiredChecks = [...TELNYX_REQUIRED_CHECK_IDS].every((id) => checkIds.has(id));
    const stats = data?.stats;
    const validStats = !!stats && typeof stats === 'object' && !Array.isArray(stats)
      && ['messaging_ready', 'voice_ready', 'fax_ready']
        .every((key) => typeof stats[key] === 'boolean');
    const validResult = data?.success === true && wellFormedChecks && hasRequiredChecks && validStats;
    const hasFail = !validResult || checks.some((check) => check?.status === 'fail');
    const hasWarn = checks.some((check) => check?.status === 'warn');
    const configured = validResult && Boolean(
      stats.messaging_ready || stats.voice_ready || stats.fax_ready,
    );
    return {
      id: 'telnyx',
      label: 'Telnyx telecom',
      category: 'Telecom',
      capability: 'sms_voice_fax',
      configured,
      editable_in_app: true,
      status: hasFail ? 'fail' : hasWarn ? 'warn' : 'ok',
      probe: 'delegated-read-only',
      delivery_verified: false,
      detail: hasFail
        ? validResult
          ? 'One or more Telnyx configuration/authentication checks failed; no traffic was sent.'
          : 'Telnyx returned an invalid or empty health result; authentication was not confirmed.'
        : hasWarn
          ? 'Telnyx returned one or more warnings; no traffic was sent.'
          : 'Telnyx configuration passed its read-only checks; delivery is not verified or released.',
    };
  } catch {
    return {
      id: 'telnyx',
      label: 'Telnyx telecom',
      category: 'Telecom',
      capability: 'sms_voice_fax',
      configured: false,
      editable_in_app: true,
      status: 'warn',
      probe: 'delegated-read-only',
      delivery_verified: false,
      detail: 'The bounded Telnyx read-only check did not complete; authentication was not confirmed.',
    };
  }
}

Deno.serve(async (req) => {
  try {
    if (req?.method && req.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { Allow: 'POST' } });
    }
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const isAdmin = user?.role === 'admin'
      && user.disabled !== true
      && user.is_service !== true
      && user.is_verified !== false;
    if (!isAdmin) {
      return Response.json({ error: 'Administrator access required.' }, { status: 403 });
    }

    const env = (name) => {
      const value = Deno.env.get(name);
      return isSet(value) ? value : null;
    };

    const openaiKey = env('OPENAI_API_KEY');
    const anthropicKey = env('ANTHROPIC_API_KEY');
    const centralLearningReleased = env('CENTRAL_LEARNING_RELEASE') === 'hub-runtime-v1';
    const heygenKey = centralLearningReleased ? null : env('HEYGEN_API_KEY');

    // Independent provider checks run concurrently, each with its own timeout.
    // Missing optional feature keys cause no request.
    const [openaiHealth, anthropicHealth, heygenHealth, telnyxHealth] = await Promise.all([
      openaiKey
        ? probe(
          'https://api.openai.com/v1/models',
          { headers: { Authorization: `Bearer ${openaiKey}` } },
          'The OpenAI credential authenticated; transcription-model entitlement and audio processing are not proven.',
          'OpenAI',
        )
        : Promise.resolve(null),
      anthropicKey
        ? probe(
          'https://api.anthropic.com/v1/models',
          { headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' } },
          'The Anthropic credential authenticated; required-model entitlement and SOAP structuring are not proven.',
          'Anthropic',
        )
        : Promise.resolve(null),
      heygenKey
        ? probe(
          // The lightweight quota read answers well inside the probe timeout;
          // the full /v2/avatars catalog routinely takes longer than 5 s.
          'https://api.heygen.com/v2/user/remaining_quota',
          { headers: { 'x-api-key': heygenKey } },
          'The HeyGen credential authenticated against its read-only quota endpoint; video generation is not proven.',
          'HeyGen',
        )
        : Promise.resolve(null),
      checkTelnyx(base44),
    ]);

    const integrations = [
      {
        id: 'base44_llm',
        label: 'Base44 Core LLM',
        category: 'AI',
        capability: 'application_ai_generation',
        configured: true,
        editable_in_app: false,
        status: 'warn',
        probe: 'not-run',
        delivery_verified: false,
        detail: 'Application AI uses the platform-managed Core.InvokeLLM capability. This health check does not spend credits, invoke a model, or prove end-to-end generation.',
      },
      openaiKey
        ? {
          id: 'openai_transcription',
          label: 'OpenAI audio transcription',
          category: 'Transcription',
          capability: 'direct_audio_transcription',
          configured: true,
          editable_in_app: false,
          delivery_verified: false,
          ...openaiHealth,
        }
        : {
          id: 'openai_transcription',
          label: 'OpenAI audio transcription',
          category: 'Transcription',
          capability: 'direct_audio_transcription',
          configured: false,
          editable_in_app: false,
          status: 'warn',
          probe: 'not-run',
          delivery_verified: false,
          detail: 'OPENAI_API_KEY is not set; direct audio transcription is unavailable, but platform-managed application AI is unaffected.',
        },
      anthropicKey
        ? {
          id: 'anthropic_soap',
          label: 'Anthropic SOAP-note structuring',
          category: 'AI',
          capability: 'soap_note_structuring',
          configured: true,
          editable_in_app: false,
          delivery_verified: false,
          ...anthropicHealth,
        }
        : {
          id: 'anthropic_soap',
          label: 'Anthropic SOAP-note structuring',
          category: 'AI',
          capability: 'soap_note_structuring',
          configured: false,
          editable_in_app: false,
          status: 'warn',
          probe: 'not-run',
          delivery_verified: false,
          detail: 'ANTHROPIC_API_KEY is not set; direct SOAP-note structuring is unavailable. Fax-cover formatting does not require this key.',
        },
      centralLearningReleased
        ? {
          id: 'central_learning',
          label: 'CareMetric Support Hub learning',
          category: 'Learning',
          capability: 'central_course_delivery',
          configured: true,
          editable_in_app: false,
          status: 'ok',
          probe: 'local-validation',
          delivery_verified: false,
          detail: 'The central learning cutover is configured. PennSync does not require a HeyGen key after cutover; Hub course delivery must be verified separately.',
        }
        : heygenKey
        ? {
          id: 'heygen',
          label: 'HeyGen training videos',
          category: 'Media',
          capability: 'training_video_generation',
          configured: true,
          editable_in_app: false,
          delivery_verified: false,
          ...heygenHealth,
        }
        : {
          id: 'heygen',
          label: 'HeyGen training videos',
          category: 'Media',
          capability: 'training_video_generation',
          configured: false,
          editable_in_app: false,
          status: 'warn',
          probe: 'not-run',
          delivery_verified: false,
          detail: 'HEYGEN_API_KEY is not set; optional training-video generation is unavailable.',
        },
      {
        id: 'base44_email',
        label: 'Base44 Core email',
        category: 'Email',
        capability: 'transactional_email',
        configured: true,
        editable_in_app: false,
        status: 'warn',
        probe: 'not-run',
        delivery_verified: false,
        detail: 'Email uses platform-managed Core.SendEmail; no Resend credential is consumed. This check sends no email, so recipient delivery remains unverified.',
      },
      telnyxHealth,
    ];

    const appOrigin = publicAppOrigin(env('APP_PUBLIC_URL'));
    integrations.push({
      id: 'app_public_url',
      label: 'Public app-link origin',
      category: 'Configuration',
      capability: 'outbound_link_generation',
      configured: Boolean(appOrigin),
      editable_in_app: false,
      status: appOrigin ? 'ok' : 'fail',
      probe: 'local-validation',
      delivery_verified: false,
      detail: appOrigin
        ? 'APP_PUBLIC_URL is a valid HTTPS origin for outbound app links.'
        : 'APP_PUBLIC_URL is missing or is not an exact HTTPS origin; outbound app-link generation fails closed.',
    });

    const outboundDeliveryReleaseConfigured = isSet(env(OUTBOUND_DELIVERY_RELEASE_ENV));
    const outboundDeliveryIsReleased = outboundDeliveryReleased();
    integrations.push({
      id: 'outbound_delivery_release',
      label: 'General outbound delivery gate',
      category: 'Release gate',
      capability: 'outbound_delivery_control',
      configured: outboundDeliveryReleaseConfigured,
      editable_in_app: false,
      status: outboundDeliveryIsReleased ? 'ok' : 'warn',
      probe: 'local-validation',
      release_state: outboundDeliveryIsReleased ? 'released' : 'paused',
      delivery_verified: false,
      excluded_actions: [
        'createUserWithTempPassword', 'resendInvitation',
        'userManagement.invite_user', 'userManagement.resend_invitation',
      ],
      detail: outboundDeliveryIsReleased
        ? 'OUTBOUND_DELIVERY_RELEASE is enabled-v1. Manual account invitations operate independently. Provider health is not delivery proof; this check performed no delivery.'
        : 'General outbound delivery is paused; authorized manual account invitations remain available. Password resets, OTP resends, activation notices, and other delivery still require enabled-v1. This check performed no delivery.',
    });

    const faxWorkflowRelease = env('OUTBOUND_FAX_WORKFLOW_RELEASE');
    const faxWorkflowReleased = faxWorkflowRelease === 'enabled-v1' || outboundDeliveryIsReleased;
    integrations.push({
      id: 'fax_workflow_delivery_release', label: 'Fax queue delivery gate',
      category: 'Release gate', capability: 'fax_workflow_delivery_control',
      configured: Boolean(faxWorkflowRelease), editable_in_app: false,
      status: faxWorkflowReleased ? 'ok' : 'warn', probe: 'local-validation',
      release_state: faxWorkflowReleased ? 'released' : 'paused', delivery_verified: false,
      detail: faxWorkflowReleased
        ? 'Fax queue delivery is released; individual worker flags and provider authority remain required. This check performed no delivery.'
        : 'OUTBOUND_FAX_WORKFLOW_RELEASE is not enabled-v1 and general delivery is paused; scheduled and retry fax dispatch remain paused.',
    });
    for (const gate of WORKFLOW_RELEASE_GATES) {
      const releaseValue = env(gate.env);
      const released = releaseValue === 'enabled-v1' && (!gate.requiresFaxRelease || faxWorkflowReleased);
      integrations.push({
        id: gate.id,
        label: gate.label,
        category: 'Release gate',
        capability: gate.capability,
        configured: Boolean(releaseValue),
        editable_in_app: false,
        status: released ? 'ok' : 'warn',
        probe: 'local-validation',
        release_state: released ? 'released' : 'paused',
        delivery_verified: false,
        detail: released
          ? `${gate.env} is enabled-v1. This report did not invoke the workflow or perform delivery.`
          : gate.requiresFaxRelease && !faxWorkflowReleased
            ? `${gate.env} cannot release fax dispatch while both outbound fax queue and general delivery gates are paused.`
            : `${gate.env} is not enabled-v1; the workflow remains fail-closed before SDK construction.`,
      });
    }

    const internalSecret = env('INTERNAL_FN_SECRET');
    integrations.push({
      id: 'workflow_internal_auth',
      label: 'Workflow internal authentication',
      category: 'Automation',
      capability: 'scheduler_authentication',
      configured: Boolean(internalSecret && internalSecret.length >= 32),
      editable_in_app: false,
      status: internalSecret && internalSecret.length >= 32 ? 'ok' : 'fail',
      probe: 'local-validation',
      delivery_verified: false,
      detail: internalSecret && internalSecret.length >= 32
        ? 'INTERNAL_FN_SECRET is configured for scheduler-to-function authentication.'
        : 'INTERNAL_FN_SECRET is missing or too short; protected scheduled functions cannot run.',
    });

    let signatureKeysConfigured = false;
    try { signatureAuditKeyring(); signatureKeysConfigured = true; } catch { /* Report only configuration validity, never secret values. */ }
    integrations.push({
      id: 'signature_hmac',
      label: 'E-signature audit authentication',
      category: 'Security',
      capability: 'signature_audit_integrity',
      configured: signatureKeysConfigured,
      editable_in_app: false,
      status: signatureKeysConfigured ? 'ok' : 'fail',
      probe: 'local-validation',
      delivery_verified: false,
      detail: signatureKeysConfigured
        ? 'Signature audit key configuration is valid. This does not verify retained historical keys or release public signing.'
        : 'Signature audit key configuration is missing or invalid. Check the keyring and active key ID, or the legacy secret.',
    });

    const outcomeRelease = env('OUTCOME_PIPELINE_RELEASE');
    integrations.push({
      id: 'outcome_pipeline_release',
      label: 'Outcome workflow release gate',
      category: 'Release gate',
      capability: 'outcome_workflow_delivery',
      configured: Boolean(outcomeRelease),
      editable_in_app: false,
      status: outcomeRelease === 'enabled-v1' ? 'ok' : 'warn',
      probe: 'local-validation',
      release_state: outcomeRelease === 'enabled-v1' ? 'released' : 'paused',
      delivery_verified: false,
      detail: outcomeRelease === 'enabled-v1'
        ? 'Outcome workflow release gate is enabled-v1; this health check still performs no delivery.'
        : 'Outcome workflow is intentionally paused until hosted tenant and atomicity validation is approved.',
    });

    const report = {
      success: true,
      generated_at: new Date().toISOString(),
      probe_policy: {
        outbound_actions_performed: false,
        credential_values_exposed: false,
        provider_timeout_ms: PROBE_TIMEOUT_MS,
      },
      integrations,
    };
    console.info('checkAllIntegrations result:', JSON.stringify(report));
    return Response.json(report);
  } catch (error) {
    console.error('checkAllIntegrations error:', {
      name: typeof error?.name === 'string' ? error.name : 'Error',
    });
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
