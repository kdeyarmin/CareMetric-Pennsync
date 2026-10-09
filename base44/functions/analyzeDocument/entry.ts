import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: pennsyncProductionAppId — generated, edit base44/_shared/backendHelpers.mjs>>>
const PENNSYNC_PRODUCTION_APP_ID = '694ec16e72e01b60d22f7cbf';
// <<<END SHARED HELPER: pennsyncProductionAppId>>>

// <<<BEGIN SHARED HELPER: base44ClientRequest — generated, edit base44/_shared/backendHelpers.mjs>>>
function pinnedBase44Request(req, expectedAppId, forwardUserCredential) {
  if (typeof expectedAppId !== 'string' || expectedAppId === '') {
    throw new Error('pinned Base44 request requires an expected Base44-App-Id');
  }
  // Read the inbound headers without ever throwing on the SHAPE of req. A production
  // request is always a real Request with a Headers bag; a bare object with no usable
  // headers (a test fixture, a malformed direct call) carries no inbound header, which
  // is the absent case handled below. Only a PRESENT, different app id throws, and that
  // requires a real header an attacker would have to set — so a real Request always
  // reaches this read and the refusal is never skipped by the tolerance.
  const inbound =
    req && req.headers && typeof req.headers.get === 'function' ? req.headers : null;
  const read = (name) => (inbound ? inbound.get(name) : null);
  const received = read('Base44-App-Id');
  // Refuse only an ACTIVE mismatch: a caller presenting a DIFFERENT app id is the
  // tenant-redirect attack, and that is the case the refusal exists for. An ABSENT
  // header is not a mismatch and selects no other tenant — it only means the request
  // did not arrive through the platform, which always injects this header. We SET the
  // pinned constant below either way, so absent falls back to the correct app exactly
  // as the dropped Base44-Api-Url falls back to the default serverUrl. Throwing on
  // absent would turn every anonymous denial into a 500 instead of a clean 403.
  if (received !== null && received !== expectedAppId) {
    throw new Error(
      'Base44-App-Id mismatch: expected ' + expectedAppId + ', received ' + received
    );
  }
  const headers = new Headers();
  // Load-bearing: SET the constant (never forward the inbound value). The SDK reads
  // appId from this header and throws of its own accord when it is absent, so pinning
  // requires setting it here — dropping the inbound header alone would not suffice.
  headers.set('Base44-App-Id', expectedAppId);
  const serviceAuth = read('Base44-Service-Authorization');
  if (serviceAuth !== null) headers.set('Base44-Service-Authorization', serviceAuth);
  if (forwardUserCredential) {
    const authorization = read('Authorization');
    if (authorization !== null) headers.set('Authorization', authorization);
    const dataEnv = read('X-Data-Env');
    if (dataEnv === 'dev' || dataEnv === 'prod') headers.set('X-Data-Env', dataEnv);
  }
  // Cosmetic URL: serverUrl comes from the dropped Base44-Api-Url, not from here.
  // No method: the SDK request factory reads only headers.get(...), never the
  // method, so the request defaults to GET. An explicit POST would be inert for the
  // SDK and would read as an outbound delivery primitive to the inventory scanner
  // once this block is inlined into the fax status pollers.
  return new Request('https://base44.app', { headers });
}
function userScopedClientRequest(req, expectedAppId) {
  return pinnedBase44Request(req, expectedAppId, true);
}
function serviceRoleClientRequest(req, expectedAppId) {
  return pinnedBase44Request(req, expectedAppId, false);
}
// <<<END SHARED HELPER: base44ClientRequest>>>

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

/**
 * analyzeDocument — AI review of one stored document (owner decision,
 * 2026-10-08).
 *
 * Authorization is not re-derived here. The caller's own client asks the
 * reviewed Document read broker (getAuthorizedDocument) for the document: the
 * `download` purpose before an analysis, which also yields the short-lived
 * signed link the model reads, and the `metadata` purpose before a stored
 * analysis is returned. That broker roots access in the immutable
 * DocumentTenantBinding and applies the chart's creator/care-team rule, so no
 * legacy nurse-list or agency-label check survives here. Only after the
 * broker admits the caller is the Document row read or written with
 * service-role authority (Document has no client RLS at all), and the write
 * touches ai_analysis alone.
 *
 * Body: { agency_id, document_id, action?: 'analyze' | 'get' }
 */

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };
const MAX_BODY_BYTES = 10_000;
const MAX_IDENTIFIER_LENGTH = 200;
const MAX_TEXT = 4000;
const MAX_FLAGS = 20;
const MAX_EXTRACTED_KEYS = 40;
const ACTIONS = new Set(['analyze', 'get']);
const SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);
const CATEGORIES = new Set([
  'lab_results', 'imaging_report', 'pathology', 'consent_form', 'insurance_card', 'prior_auth',
  'referral_letter', 'progress_note', 'admission_note', 'discharge_summary', 'medication_list',
  'prescription', 'physician_orders', 'wound_care', 'vital_signs', 'assessment', 'care_plan', 'other',
]);

class PublicError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'PublicError';
    this.status = status;
  }
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, {
  status,
  headers: { ...NO_STORE_HEADERS, ...headers },
});

const plainObject = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

function exactIdentifier(value: unknown) {
  if (typeof value !== 'string') return null;
  if (!value || value.length > MAX_IDENTIFIER_LENGTH || value.trim() !== value) return null;
  if (value.startsWith('$')) return null;
  return value;
}

function exactHttpsUrl(value: unknown) {
  if (typeof value !== 'string' || !value || value.length > 4096 || value.trim() !== value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.href !== value) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

async function parseInput(req: Request) {
  const statedLength = Number(req.headers.get('content-length'));
  if (Number.isFinite(statedLength) && statedLength > MAX_BODY_BYTES) {
    throw new PublicError(413, 'Document request is too large');
  }
  let raw = '';
  try {
    raw = await req.text();
  } catch {
    throw new PublicError(400, 'Invalid JSON body');
  }
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    throw new PublicError(413, 'Document request is too large');
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new PublicError(400, 'Invalid JSON body');
  }
  if (!plainObject(body)) throw new PublicError(400, 'Request body must be an object');
  if (Object.keys(body).some((key) => !['agency_id', 'document_id', 'action'].includes(key))) {
    throw new PublicError(400, 'Request contains unsupported fields');
  }
  const agencyId = exactIdentifier(body.agency_id);
  const documentId = exactIdentifier(body.document_id);
  const action = body.action === undefined ? 'analyze' : body.action;
  if (!agencyId) throw new PublicError(400, 'agency_id is invalid');
  if (!documentId) throw new PublicError(400, 'document_id is invalid');
  if (typeof action !== 'string' || !ACTIONS.has(action)) throw new PublicError(400, 'action is invalid');
  return { agencyId, documentId, action };
}

/**
 * Ask the Document read broker, as the caller, whether they may read this
 * document for the given purpose. Any refusal reads as one answer so a probe
 * cannot tell an absent document from one it may not see.
 */
async function authorizeThroughBroker(
  base44: Record<string, any>,
  input: { agencyId: string; documentId: string },
  purpose: 'download' | 'metadata',
) {
  let response: unknown;
  try {
    response = await base44.functions.invoke('getAuthorizedDocument', {
      agency_id: input.agencyId,
      document_id: input.documentId,
      purpose,
    });
  } catch (error) {
    const status = Number((error as any)?.response?.status ?? (error as any)?.status);
    if ([400, 401, 403, 404, 409].includes(status)) {
      throw new PublicError(403, 'Document is unavailable');
    }
    throw error;
  }
  const result = plainObject(response) && Object.hasOwn(response, 'data') ? response.data : response;
  if (
    !plainObject(result)
    || result.success !== true
    || result.purpose !== purpose
    || !plainObject(result.document)
    || result.document.id !== input.documentId
    || !plainObject(result.scope)
    || result.scope.agency_id !== input.agencyId
  ) {
    throw new PublicError(403, 'Document is unavailable');
  }
  if (purpose === 'download') {
    const downloadUrl = exactHttpsUrl(result.delivery?.download_url);
    if (!downloadUrl) throw new Error('Document broker returned no usable download link');
    return { document: result.document, downloadUrl };
  }
  return { document: result.document, downloadUrl: null };
}

async function loadDocumentRow(entities: Record<string, any>, documentId: string) {
  const rows = await entities.Document.filter({ id: documentId }, undefined, 2);
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.id !== documentId) {
    throw new PublicError(403, 'Document is unavailable');
  }
  return rows[0];
}

const boundedText = (value: unknown, limit = MAX_TEXT) =>
  typeof value === 'string' ? value.trim().slice(0, limit) : '';

function boundedExtracted(value: unknown) {
  if (!plainObject(value)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value).slice(0, MAX_EXTRACTED_KEYS)) {
    if (!/^[A-Za-z0-9_ -]{1,80}$/.test(key)) continue;
    if (typeof entry === 'string') out[key] = entry.slice(0, MAX_TEXT);
    else if (typeof entry === 'number' && Number.isFinite(entry)) out[key] = entry;
    else if (Array.isArray(entry)) {
      out[key] = entry
        .slice(0, 50)
        .filter((item) => typeof item === 'string' || (typeof item === 'number' && Number.isFinite(item)))
        .map((item) => (typeof item === 'string' ? item.slice(0, 500) : item));
    }
  }
  return out;
}

/** Validate the model's answer before anything is stored or shown. */
function normalizeAnalysis(raw: unknown) {
  if (!plainObject(raw)) return null;
  const summary = boundedText(raw.summary);
  if (!summary) return null;
  const confidence = Number(raw.confidence_score);
  const suggested = typeof raw.suggested_category === 'string' ? raw.suggested_category.trim().toLowerCase() : '';
  const flags = Array.isArray(raw.critical_flags) ? raw.critical_flags : [];
  return {
    analyzed: true,
    summary,
    extracted_data: boundedExtracted(raw.extracted_data),
    suggested_category: CATEGORIES.has(suggested) ? suggested : null,
    critical_flags: flags
      .filter((flag) => plainObject(flag) && boundedText(flag.finding, 500))
      .slice(0, MAX_FLAGS)
      .map((flag) => ({
        severity: SEVERITIES.has(String(flag.severity || '').toLowerCase())
          ? String(flag.severity).toLowerCase()
          : 'medium',
        finding: boundedText(flag.finding, 500),
        details: boundedText(flag.details, 2000),
      })),
    confidence_score: Number.isFinite(confidence) ? Math.max(0, Math.min(100, Math.round(confidence))) : null,
    analyzed_date: new Date().toISOString(),
  };
}

function storedAnalysis(document: Record<string, any>) {
  const stored = document?.ai_analysis;
  if (!plainObject(stored) || stored.analyzed !== true) return null;
  const normalized = normalizeAnalysis(stored);
  if (!normalized) return null;
  return { ...normalized, analyzed_date: typeof stored.analyzed_date === 'string' ? stored.analyzed_date : null };
}

export default async function(req) {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, { Allow: 'POST' });
  }
  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    const user = await base44.auth.me().catch(() => null);
    if (!user) return json({ error: 'Unauthorized' }, 401);
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (user.disabled === true || user.is_service === true || user.is_verified === false) {
      return json({ error: 'Forbidden' }, 403);
    }

    const input = await parseInput(req);
    const entities = base44.asServiceRole.entities;

    if (input.action === 'get') {
      await authorizeThroughBroker(base44, input, 'metadata');
      const row = await loadDocumentRow(entities, input.documentId);
      return json({ success: true, analysis: storedAnalysis(row) });
    }

    const authorized = await authorizeThroughBroker(base44, input, 'download');
    const row = await loadDocumentRow(entities, input.documentId);

    const analysisPrompt = `Analyze this medical document and provide:

1. A concise summary (2-3 sentences)
2. Extracted key data points (lab values, diagnoses, medications, vital signs, dates)
3. A more specific category (choose from: ${[...CATEGORIES].join(', ')})
4. Critical findings that need immediate attention (severity: critical/high/medium/low)
5. Confidence score (0-100)

Document title: ${boundedText(row.title, 200) || 'Untitled'}
Current category: ${boundedText(row.category, 50) || 'other'}

Return a JSON object with summary, extracted_data, suggested_category, critical_flags, and confidence_score.`;

    const aiResponse = await base44.asServiceRole.integrations.Core.InvokeLLM({
      model: 'automatic',
      prompt: analysisPrompt,
      file_urls: [authorized.downloadUrl],
      response_json_schema: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          extracted_data: { type: 'object' },
          suggested_category: { type: 'string' },
          critical_flags: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                severity: { type: 'string' },
                finding: { type: 'string' },
                details: { type: 'string' },
              },
            },
          },
          confidence_score: { type: 'number' },
        },
      },
    });
    const analysis = normalizeAnalysis(aiResponse);
    if (!analysis) {
      return json({ error: 'The model returned no usable analysis. Try again.' }, 502);
    }

    // Re-ask the broker after the slow model call: if the caller lost access
    // meanwhile (membership, assignment or binding changed), nothing is stored.
    await authorizeThroughBroker(base44, input, 'metadata');
    await entities.Document.update(input.documentId, { ai_analysis: analysis });

    return json({ success: true, analysis });
  } catch (error) {
    if (error instanceof PublicError) {
      return json({ error: error.message }, error.status);
    }
    console.error('Document analysis error:', (error as any)?.message);
    return json({ error: 'Internal server error' }, 500);
  }
}