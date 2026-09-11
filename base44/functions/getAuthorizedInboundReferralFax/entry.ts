import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';

const MAX_BODY_BYTES = 10_000;
const MAX_IDENTIFIER_LENGTH = 300;
const EXACT_ROW_LIMIT = 10;
const INTAKE_ROLES = new Set(['agency_admin', 'manager', 'office_staff']);
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };

class PublicError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'PublicError';
    this.status = status;
  }
}

function plainObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function exactIdentifier(value: unknown) {
  if (
    typeof value !== 'string'
    || !value
    || value.length > MAX_IDENTIFIER_LENGTH
    || value.trim() !== value
    || value.startsWith('$')
    || /[\u0000-\u001f\u007f]/.test(value)
  ) return null;
  return value;
}

function canonicalEmail(value: unknown) {
  if (typeof value !== 'string' || value.length > 320) return null;
  const email = value.trim().toLowerCase();
  return email && email.includes('@') && !/\s/.test(email) ? email : null;
}

function validInstant(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function normalizeE164(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const digits = trimmed.replace(/[^\d]/g, '');
  if (trimmed.startsWith('+')) {
    return digits.length >= 8 && digits.length <= 15 && digits[0] !== '0'
      ? `+${digits}`
      : null;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

function exactHttpsUrl(value: unknown) {
  if (typeof value !== 'string' || !value || value.length > 8192 || value.trim() !== value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (plainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sameValue(left: unknown, right: unknown) {
  return canonicalJson(left) === canonicalJson(right);
}

function unwrapFunctionResult(value: unknown) {
  return plainObject(value) && Object.hasOwn(value, 'data') ? value.data : value;
}

async function parseInput(req: Request) {
  if (req.method !== 'POST') throw new PublicError(405, 'Method not allowed');
  const statedLength = Number(req.headers.get('content-length'));
  if (Number.isFinite(statedLength) && statedLength > MAX_BODY_BYTES) {
    throw new PublicError(413, 'Request body is too large');
  }
  let raw = '';
  try {
    raw = await req.text();
  } catch {
    throw new PublicError(400, 'Invalid request');
  }
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    throw new PublicError(413, 'Request body is too large');
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new PublicError(400, 'Invalid request');
  }
  if (!plainObject(body) || Object.keys(body).some((key) => ![
    'agency_id', 'referral_id', 'incoming_fax_id', 'relationship',
  ].includes(key))) throw new PublicError(400, 'Invalid request');
  const agencyId = exactIdentifier(body.agency_id);
  const referralId = exactIdentifier(body.referral_id);
  const incomingFaxId = exactIdentifier(body.incoming_fax_id);
  if (!agencyId || !referralId || !incomingFaxId) throw new PublicError(400, 'Invalid request');
  const relationship = body.relationship ?? 'attached';
  if (!['attached', 'suggested'].includes(relationship)) throw new PublicError(400, 'Invalid request');
  return { agencyId, referralId, incomingFaxId, relationship };
}

function validateReferralResult(value: unknown, input: Record<string, string>) {
  if (!plainObject(value) || value.success !== true || value.action !== 'get') {
    throw new PublicError(502, 'Referral authorization response was invalid');
  }
  const referral = value.referral;
  const scope = value.scope;
  const followUp = referral?.follow_up_requests;
  if (
    !plainObject(referral)
    || referral.id !== input.referralId
    || referral.agency_id !== input.agencyId
    || !Number.isSafeInteger(referral.version)
    || referral.version < 1
    || !validInstant(referral.updated_date)
    || !plainObject(followUp)
    || (input.relationship === 'attached' && (
      !['received', 'resolved'].includes(followUp.status)
      || !plainObject(followUp.fax_back)
      || followUp.fax_back.incoming_fax_id !== input.incomingFaxId
      || Object.hasOwn(followUp.fax_back, 'document_url')
    ))
    || !plainObject(scope)
    || scope.agency_id !== input.agencyId
    || !exactIdentifier(scope.membership_id)
    || !Number.isSafeInteger(scope.membership_version)
    || scope.membership_version < 1
    || !INTAKE_ROLES.has(scope.tenant_role)
  ) throw new PublicError(409, 'Referral fax authorization is unavailable');
  return { referral, scope };
}

async function loadReferral(base44: Record<string, any>, input: Record<string, string>) {
  const response = await base44.functions.invoke('manageAuthorizedReferral', {
    action: 'get',
    agency_id: input.agencyId,
    referral_id: input.referralId,
  });
  return validateReferralResult(unwrapFunctionResult(response), input);
}

function validateFax(
  row: Record<string, any>,
  input: Record<string, string>,
) {
  const url = exactHttpsUrl(row?.document_url);
  const destination = normalizeE164(row?.received_to_number);
  const expectedBindingKey = destination && exactIdentifier(row?.integration_secret_id)
    ? `telnyx:${row.integration_secret_id}:${destination}`
    : null;
  if (
    row?.id !== input.incomingFaxId
    || row?.agency_id !== input.agencyId
    || !exactIdentifier(row?.ingress_binding_id)
    || !exactIdentifier(row?.ingress_binding_key)
    || !exactIdentifier(row?.integration_secret_id)
    || !exactIdentifier(row?.telnyx_fax_id)
    || !Number.isSafeInteger(row?.ingress_binding_version)
    || row.ingress_binding_version < 1
    || !Number.isSafeInteger(row?.version)
    || row.version < 1
    || !destination
    || row.received_to_number !== destination
    || row.ingress_binding_key !== expectedBindingKey
    || !validInstant(row?.received_at)
    || !validInstant(row?.created_date)
    || !validInstant(row?.updated_date)
    || !url
    || row.document_url !== url
    || row.processing_status !== 'completed'
    || (input.relationship === 'attached' ? (
      row.status !== 'routed' || !validInstant(row.routed_at)
      || row.routed_to !== `ReferralFollowUp:${input.referralId}`
    ) : (
      row.status !== 'unread' || row.ai_category !== 'referral'
      || row.suggested_routing !== 'admin' || row.processing_notification_state !== 'completed'
    ))
    || row.suggested_referral_id !== input.referralId
  ) throw new PublicError(409, 'Referral fax document is unavailable');
  return { row, url };
}

async function loadFax(
  entities: Record<string, any>,
  input: Record<string, string>,
) {
  const rows = await entities.IncomingFax.filter(
    { id: input.incomingFaxId, agency_id: input.agencyId },
    undefined,
    EXACT_ROW_LIMIT,
  );
  if (!Array.isArray(rows)
    || rows.length !== 1
    || rows.some((row) => row?.id !== input.incomingFaxId || row?.agency_id !== input.agencyId)) {
    throw new PublicError(409, 'Referral fax document is unavailable');
  }
  return validateFax(rows[0], input);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    const userId = exactIdentifier(user?.id);
    const userEmail = canonicalEmail(user?.email);
    if (
      !userId
      || !userEmail
      || user?.role !== 'user'
      || user?.is_active === false
      || user?.disabled === true
      || user?.is_service === true
      || user?.is_verified === false
    ) throw new PublicError(user ? 403 : 401, user ? 'Forbidden' : 'Unauthorized');
    const input = await parseInput(req);
    const initialReferral = await loadReferral(base44, input);
    const initialFax = await loadFax(base44.asServiceRole.entities, input);
    const finalReferral = await loadReferral(base44, input);
    const finalFax = await loadFax(base44.asServiceRole.entities, input);
    if (!sameValue(initialReferral, finalReferral)
      || !sameValue(initialFax.row, finalFax.row)
      || initialFax.url !== finalFax.url) {
      throw new PublicError(409, 'Referral fax authority changed during retrieval');
    }
    return Response.json({
      success: true,
      referral_id: input.referralId,
      incoming_fax_id: input.incomingFaxId,
      delivery: { download_url: finalFax.url },
      scope: finalReferral.scope,
    }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof PublicError) {
      return Response.json(
        { success: false, error: error.message },
        {
          status: error.status,
          headers: {
            ...NO_STORE_HEADERS,
            ...(error.status === 405 ? { Allow: 'POST' } : {}),
          },
        },
      );
    }
    console.error('getAuthorizedInboundReferralFax failed');
    return Response.json(
      { success: false, error: 'Unable to retrieve referral fax document' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
});
