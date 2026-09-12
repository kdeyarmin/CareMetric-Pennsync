import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';

// Public HTTP transport, authenticated independently by the fixed live Hub RPC.
// Native service credentials stay inside Base44; this never creates a session.
const HUB_ORIGIN = 'https://xgauehtwksmnoqhgqegm.supabase.co';
const SMS_AUTHORIZATION_URL = 'https://support-hub-web-production.up.railway.app/api/internal/admin/pennsync/authorize';
const APP_ID = '694ec16e72e01b60d22f7cbf';
const APP_ORIGIN = 'https://caremetricai.base44.app';
const TOKEN_HEADER = 'X-CareMetric-Hub-Authorization';
const SOURCE = 'application_database';
const SCAN_PAGE = 500;
const MAX_SCAN = 10000;
export const centralAdminOperations = [
  'capabilities', 'overview', 'organizations.list', 'users.list',
  'billing.overview', 'billing.subscriptions.list',
  'support.identity.resolve',
  'learning.source.snapshot',
] as const;
type OperationName = typeof centralAdminOperations[number];
type Operation = { operation: OperationName; search: string; limit: number; offset: number; sourceUserId?:string;sourceAccountId?:string };
type Row = Record<string, unknown>;
type Env = (name: string) => string | undefined;
type Entity = { filter: (query: Row, sort: string, limit: number, offset: number, fields: string[]) => Promise<unknown> };
type Client = { asServiceRole: { entities: Record<string, Entity> }; cleanup?: () => void };
type TransportDiagnostic = Readonly<{
  event: 'central_admin_transport_rejected';
  origin: 'absent' | 'empty' | 'app_origin' | 'platform_origin' | 'other';
  cookie: 'absent' | 'empty' | 'present';
  originMatchesRequest: boolean;
  literalNullOrigin: boolean;
}>;
type RequestStage = 'configuration' | 'transport' | 'request_body' | 'hub_authorization'
  | 'hub_identity' | 'native_transport' | 'native_factory' | 'native_identity' | 'native_read' | 'response';
type FailureDiagnostic = Readonly<{
  event: 'central_admin_request_failed'; stage: RequestStage; status: number;
  hubStatus: number | null; nativeStatus: number | null;
  failureKind: 'timeout' | 'aborted' | 'dns' | 'tls' | 'redirect' | 'permission' | 'connection'
    | 'invalid_fetch_receiver' | 'signal_option' | 'unsupported' | 'type_error' | 'other'; requestAborted: boolean;
  nativeApp: 'absent' | 'expected' | 'other'; dataEnvironment: 'absent' | 'empty' | 'prod' | 'other';
  serviceCredential: 'absent' | 'empty' | 'bearer' | 'other';
}>;
type Options = { getEnv: Env; createClient?: (request: Request) => Client; fetcher?: typeof fetch; now?: () => Date;
  reportTransport?: (event: TransportDiagnostic) => void; reportFailure?: (event: FailureDiagnostic) => void };

function httpStatus(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}

/** Numeric status only; exception text, headers, bodies and identities must never enter diagnostics. */
function nativeErrorStatus(error: unknown): number | null {
  try {
    if (!error || typeof error !== 'object') return null;
    const row = error as { status?: unknown; response?: { status?: unknown } };
    return httpStatus(row.status) ?? httpStatus(row.response?.status);
  } catch { return null; }
}

/** Match only known transport conditions; no exception text leaves this function. */
function failureKind(error: unknown): FailureDiagnostic['failureKind'] {
  try {
    if (!error || typeof error !== 'object') return 'other';
    const row = error as { name?: unknown; message?: unknown; cause?: { code?: unknown } };
    const message = typeof row.message === 'string' ? row.message.slice(0, 2048) : '';
    const code = typeof row.cause?.code === 'string' ? row.cause.code.slice(0, 80) : '';
    if (row.name === 'TimeoutError' || /ETIMEDOUT|timed? ?out/i.test(code + ' ' + message)) return 'timeout';
    if (row.name === 'AbortError') return 'aborted';
    if (/ENOTFOUND|EAI_AGAIN|dns|resolve.*host|name.*resolution/i.test(code + ' ' + message)) return 'dns';
    if (/certificate|tls|ssl|invalid peer|cert_|unknownissuer/i.test(code + ' ' + message)) return 'tls';
    if (/redirect/i.test(message)) return 'redirect';
    if (row.name === 'NotCapable' || row.name === 'PermissionDenied' || /permission|not allowed|denied/i.test(message)) return 'permission';
    if (/ECONN|connection (?:refused|reset|closed)|network.*unreachable/i.test(code + ' ' + message)) return 'connection';
    if (/illegal invocation|invalid receiver/i.test(message)) return 'invalid_fetch_receiver';
    if (/AbortSignal|signal/i.test(message)) return 'signal_option';
    if (/unsupported|not supported|not implemented/i.test(message)) return 'unsupported';
    return row.name === 'TypeError' ? 'type_error' : 'other';
  } catch { return 'other'; }
}

function failureDiagnostic(request: Request, stage: RequestStage, status: number, hubStatus: number | null, error: unknown): FailureDiagnostic {
  const app = request.headers.get('Base44-App-Id');
  const dataEnvironment = request.headers.get('X-Data-Env');
  const credential = request.headers.get('Base44-Service-Authorization');
  return Object.freeze({
    event: 'central_admin_request_failed', stage, status, hubStatus,
    nativeStatus: stage.startsWith('native_') ? nativeErrorStatus(error) : null,
    failureKind: failureKind(error), requestAborted: request.signal.aborted,
    nativeApp: app === null ? 'absent' : app === APP_ID ? 'expected' : 'other',
    dataEnvironment: dataEnvironment === null ? 'absent' : !dataEnvironment.trim() ? 'empty' : dataEnvironment === 'prod' ? 'prod' : 'other',
    serviceCredential: credential === null ? 'absent' : !credential.trim() ? 'empty'
      : /^Bearer [^\s,]+$/.test(credential) && credential.length <= 8192 ? 'bearer' : 'other',
  });
}

/** Fixed categories only: never retain or log raw headers, URLs, credentials or request bodies. */
function transportDiagnostic(request: Request): TransportDiagnostic {
  const origin = request.headers.get('Origin'), cookie = request.headers.get('Cookie');
  const normalized = origin?.trim();
  return Object.freeze({
    event: 'central_admin_transport_rejected',
    origin: origin === null ? 'absent' : !normalized ? 'empty' : normalized === APP_ORIGIN ? 'app_origin'
      : ['https://base44.app', 'https://app.base44.com', 'https://base44.com'].includes(normalized) ? 'platform_origin' : 'other',
    cookie: cookie === null ? 'absent' : !cookie.trim() ? 'empty' : 'present',
    originMatchesRequest: normalized === new URL(request.url).origin,
    literalNullOrigin: normalized === 'null',
  });
}

class AdminError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
function fail(status = 503, code = 'upstream'): never { throw new AdminError(status, code); }
function object(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : fail();
}
function text(value: unknown, max = 1000): string {
  return typeof value === 'string' && value.length <= max ? value : fail();
}
function optionalText(value: unknown, max = 1000): string | null {
  return value == null ? null : text(value, max);
}
function nativeId(value: unknown): string {
  const id = text(value, 24);
  return /^[0-9a-f]{24}$/.test(id) ? id : fail();
}
function hubId(value: unknown): string {
  const id = text(value, 36);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id.toLowerCase() : fail();
}
function timestamp(value: unknown): string | null {
  if (value == null) return null;
  const result = text(value, 100);
  return Number.isFinite(Date.parse(result)) ? result : fail();
}
function recordedStatus(value: unknown): string {
  return value == null || value === '' ? 'unknown' : text(value, 100);
}
function rows(value: unknown, limit: number): Row[] {
  return Array.isArray(value) && value.length <= limit ? value.map(object) : fail();
}

export function readCentralAdminConfig(getEnv: Env) {
  const enabled = getEnv('CAREMETRIC_ADMIN_ENABLED');
  if (!enabled || enabled === 'false') return null;
  try {
    if (enabled !== 'true') return fail();
    const hubKey = getEnv('HUB_SUPABASE_PUBLISHABLE_KEY') ?? '';
    if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(hubKey) || hubKey.length > 256) return fail();
    const entries = Object.entries(object(JSON.parse(getEnv('CAREMETRIC_ADMIN_IDENTITY_MAP_JSON') ?? '')));
    if (!entries.length || entries.length > 100) return fail();
    const identities = new Map(entries.map(([actor, native]) => [hubId(actor), nativeId(native)]));
    if (identities.size !== entries.length || new Set(identities.values()).size !== entries.length) return fail();
    const revision = getEnv('CAREMETRIC_ADMIN_SOURCE_REVISION');
    return { hubKey, identities, revision: revision && /^[a-f0-9]{40}$/i.test(revision) ? revision.toLowerCase() : null };
  } catch { return fail(503, 'unconfigured'); }
}

function parseOperation(value: unknown): Operation {
  try {
    const row = object(value);
    if (!centralAdminOperations.includes(row.operation as OperationName)) return fail();
    const operation = row.operation as OperationName;
    if(operation==='support.identity.resolve') {
      if(Object.keys(row).sort().join(',')!=='operation,sourceAccountId,sourceUserId')return fail();
      return {operation,sourceUserId:nativeId(row.sourceUserId),sourceAccountId:nativeId(row.sourceAccountId),search:'',limit:20,offset:0};
    }
    const allowed = operation.endsWith('.list') ? ['operation', 'limit', 'offset', 'search'] : ['operation'];
    if (Object.keys(row).some(key => !allowed.includes(key))) return fail();
    const limit = row.limit ?? 20;
    const offset = row.offset ?? 0;
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 50
      || typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0 || offset > MAX_SCAN) return fail();
    const search = row.search === undefined ? '' : text(row.search, 100).trim();
    if (/[\u0000-\u001f\u007f*]/.test(row.search === undefined ? '' : text(row.search, 100))) return fail();
    return { operation, search, limit, offset };
  } catch { return fail(400, 'invalid_request'); }
}

function matchesSmsOperation(value: unknown, operation: Operation): boolean {
  const expected: Row = operation.operation==='support.identity.resolve'
    ? {operation:operation.operation,sourceUserId:operation.sourceUserId,sourceAccountId:operation.sourceAccountId}
    : operation.operation.endsWith('.list')
    ? { operation: operation.operation, limit: operation.limit, offset: operation.offset, ...(operation.search ? { search: operation.search } : {}) }
    : { operation: operation.operation };
  const actual = object(value);
  return Object.keys(actual).length === Object.keys(expected).length
    && Object.entries(expected).every(([key, item]) => actual[key] === item);
}

async function readJson(source: Request | Response, max: number, signal: AbortSignal): Promise<unknown> {
  if (!source.body) return fail();
  const reader = source.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.length;
      if (size > max || chunks.length >= 64) { cancel(); return fail(); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder().decode(bytes));
  } finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
}

/** SDK calls have no AbortSignal parameter. Stop waiting at the shared request deadline. */
async function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort = () => {};
  const canceled = new Promise<never>((_, reject) => {
    abort = () => reject(new AdminError(503, 'upstream'));
    signal.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([promise, canceled]); }
  finally { signal.removeEventListener('abort', abort); }
}

/** Preserve only hosted credentials and app identity; pin the SDK's API origin/default data environment. */
function pinnedSdkRequest(request: Request) {
  if (request.headers.get('Base44-App-Id') !== APP_ID) return fail(403, 'forbidden');
  const dataEnv = request.headers.get('X-Data-Env');
  if (dataEnv !== null && dataEnv !== 'prod') return fail(403, 'forbidden');
  const serviceAuthorization = request.headers.get('Base44-Service-Authorization') ?? '';
  if (!/^Bearer [^\s,]+$/.test(serviceAuthorization) || serviceAuthorization.length > 8192) return fail(503, 'unconfigured');
  // Matches the existing preflightStagingReadinessFixture boundary. In particular
  // Base44-Api-Url, Base44-State, functions version and arbitrary headers cannot
  // redirect a service credential or select another app/data revision.
  return new Request(APP_ORIGIN, { method: 'POST', headers: {
    'Base44-App-Id': APP_ID,
    'Base44-Service-Authorization': serviceAuthorization,
  } });
}

export function createCentralAdminHandler({
  getEnv, createClient = createClientFromRequest, fetcher = fetch, now = () => new Date(),
  reportTransport = event => console.info(JSON.stringify(event)),
  reportFailure = event => console.info(JSON.stringify(event)),
}: Options) {
  // Deduplicate categories and bound logs for the lifetime of this function instance.
  const reportedTransport = new Set<string>();
  const reportedFailures = new Set<string>();
  const json = (payload: unknown, status = 200) => Response.json(payload, {
    status, headers: { 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' },
  });
  return async (request: Request): Promise<Response> => {
    let client: Client | undefined;
    let stage: RequestStage = 'configuration';
    let hubStatus: number | null = null;
    try {
      const config = readCentralAdminConfig(getEnv);
      if (!config) return fail(503, 'unconfigured');
      stage = 'transport';
      if (request.method !== 'POST') return fail(405, 'method_not_allowed');
      // Hosted Base44 adds a Cookie even to anonymous server requests. It is
      // never authorization and is never forwarded to the pinned native SDK.
      // Reject every nonempty browser origin, including the literal null origin.
      if (request.headers.get('Origin')?.trim()) {
        const diagnostic = transportDiagnostic(request);
        const key = JSON.stringify(diagnostic);
        if (reportedTransport.size < 10 && !reportedTransport.has(key)) {
          reportedTransport.add(key);
          try { reportTransport(diagnostic); } catch { /* Diagnostics must not change rejection behavior. */ }
        }
        return fail(403, 'forbidden');
      }
      if (request.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
        return fail(415, 'unsupported_content_type');
      }
      const authorization = request.headers.get(TOKEN_HEADER) ?? '';
      const sms = authorization.startsWith('Bearer cmh_');
      if (authorization.length > 8192 || !(sms
        ? /^Bearer cmh_[A-Za-z0-9_-]{43}$/.test(authorization)
        : /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(authorization))) {
        return fail(401, 'unauthenticated');
      }
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(12000)]);
      stage = 'request_body';
      let operation: Operation;
      try { operation = parseOperation(await readJson(request, 2048, signal)); }
      catch { return fail(400, 'invalid_request'); }
      stage = 'hub_authorization';
      if(['support.identity.resolve','learning.source.snapshot'].includes(operation.operation)&&!sms)return fail(401,'unauthenticated');
      const response = await fetcher(sms ? SMS_AUTHORIZATION_URL : `${HUB_ORIGIN}/rest/v1/rpc/authorize_platform_admin`, {
        // Hosted fetch fails at redirect:'error' before exposing a response.
        // Manual mode never follows Location; reject redirects below before any
        // authorization body can be trusted. The capability stays at this URL.
        method: 'POST', redirect: 'manual', signal,
        headers: {
          Authorization: authorization, 'Content-Type': 'application/json',
          ...(sms ? {} : { apikey: config.hubKey, 'Content-Profile': 'hub' }),
        },
        body: '{}',
      });
      hubStatus = httpStatus(response.status);
      if (response.redirected || (response.status >= 300 && response.status < 400)) return fail();
      if (!response.ok) return fail(
        response.status === 401 ? 401 : response.status === 403 ? 403 : 503,
        response.status === 401 ? 'unauthenticated' : response.status === 403 ? 'forbidden' : 'upstream',
      );
      stage = 'hub_identity';
      let native: string | undefined;
      try {
        const actor = object(await readJson(response, 4096, signal));
        if (actor.role !== 'platform_admin') return fail();
        if (sms) {
          if (actor.method !== 'sms' || Object.keys(actor).sort().join(',') !== 'method,operation,role,user_id'
            || !matchesSmsOperation(actor.operation, operation)) return fail();
        } else if (actor.aal !== 'aal2') return fail();
        native = config.identities.get(hubId(actor.user_id));
      } catch { return fail(403, 'forbidden'); }
      if (!native) return fail(403, 'forbidden');

      stage = 'native_transport';
      const sdkRequest = pinnedSdkRequest(request);
      stage = 'native_factory';
      client = createClient(sdkRequest);
      const entities = client.asServiceRole.entities;
      stage = 'native_identity';
      // A mapped id is necessary, but the CURRENT platform-protected role must
      // still be admin. Custom is_active is only an additional deny, never a grant.
      const actors = rows(await bounded(entities.User.filter(
        { id: native }, 'id', 2, 0, ['id', 'role', 'is_active'],
      ), signal), 2);
      if (actors.length !== 1 || actors[0].id !== native || actors[0].role !== 'admin' || actors[0].is_active === false) {
        return fail(403, 'forbidden');
      }
      stage = 'native_read';

      const scan = async (entity: 'Agency' | 'AgencyMembership' | 'User' | 'Subscription', query: Row, fields: string[]) => {
        const result: Row[] = [];
        let previous = '';
        for (let offset = 0; offset <= MAX_SCAN; offset += SCAN_PAGE) {
          signal.throwIfAborted();
          const limit = Math.min(SCAN_PAGE, MAX_SCAN - offset + 1);
          const page = rows(await bounded(entities[entity].filter(query, 'id', limit, offset, fields), signal), limit);
          for (const row of page) {
            const id = nativeId(row.id);
            if (id <= previous) return fail(); // Duplicate/unordered pages cannot produce a plausible count.
            previous = id;
            result.push(row);
          }
          if (result.length > MAX_SCAN) return fail();
          if (page.length < limit) return result;
        }
        return fail();
      };

      const staff = async (fields: string[]) => {
        const memberships = await scan('AgencyMembership', {}, ['id', 'user_id', 'agency_id', 'membership_key', 'tenant_role', 'status']);
        const ids = new Set<string>();
        const keys = new Set<string>();
        const roles = new Set(['agency_admin', 'manager', 'clinician', 'office_staff', 'social_worker', 'spiritual_care']);
        for (const membership of memberships) {
          const user = nativeId(membership.user_id);
          const agency = nativeId(membership.agency_id);
          if (membership.membership_key !== `${agency}:${user}` || keys.has(String(membership.membership_key))
            || !roles.has(String(membership.tenant_role)) || !['pending', 'active', 'suspended', 'revoked'].includes(String(membership.status))) return fail();
          keys.add(String(membership.membership_key));
          ids.add(user);
        }
        const admins = await scan('User', { role: 'admin' }, fields);
        const result = new Map<string, Row>();
        for (const admin of admins) {
          if (admin.role !== 'admin') return fail();
          result.set(nativeId(admin.id), admin);
        }
        const linked = [...ids].sort();
        for (let offset = 0; offset < linked.length; offset += SCAN_PAGE) {
          const batch = linked.slice(offset, offset + SCAN_PAGE);
          const profiles = rows(await bounded(entities.User.filter({ id: { $in: batch } }, 'id', batch.length, 0, fields), signal), batch.length);
          const seen = new Set<string>();
          for (const profile of profiles) {
            const id = nativeId(profile.id);
            if (!batch.includes(id) || seen.has(id) || !['user', 'admin'].includes(String(profile.role))) return fail();
            seen.add(id);
            result.set(id, profile);
          }
          if (result.size > MAX_SCAN) return fail();
        }
        return [...result.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));
      };
      const page = (items: Row[], matches: (row: Row) => unknown) => {
        const search = operation.search.toLowerCase();
        const filtered = items.filter(row => !search || String(matches(row) ?? '').toLowerCase().includes(search));
        return { items: filtered.slice(operation.offset, operation.offset + operation.limit), total: filtered.length, limit: operation.limit, offset: operation.offset };
      };
      let data: unknown;
      if (operation.operation === 'capabilities') {
        data = { apiVersion: 1, operations: [...centralAdminOperations], sourceRevision: config.revision };
      } else if (operation.operation === 'learning.source.snapshot') {
        data = await bounded(readPennsyncLearningSource(entities,signal),signal);
        const current = rows(await bounded(entities.User.filter({id:native},'id',2,0,['id','role','is_active']),signal),2);
        if(current.length!==1||current[0].id!==native||current[0].role!=='admin'||current[0].is_active===false)return fail(403,'forbidden');
      } else if (operation.operation === 'support.identity.resolve') {
        const sourceUserId=nativeId(operation.sourceUserId),sourceAccountId=nativeId(operation.sourceAccountId);
        const membershipKey=`${sourceAccountId}:${sourceUserId}`;
        const [targetRows,accountRows,membershipRows]=await Promise.all([
          bounded(entities.User.filter({id:sourceUserId},'id',2,0,['id','role','is_active','updated_date']),signal),
          bounded(entities.Agency.filter({id:sourceAccountId},'id',2,0,['id','status','updated_date']),signal),
          bounded(entities.AgencyMembership.filter({membership_key:membershipKey},'id',2,0,['id','user_id','agency_id','membership_key','tenant_role','status','version','revoked_at']),signal),
        ]);
        const targets=rows(targetRows,2),accounts=rows(accountRows,2),members=rows(membershipRows,2);
        const u=targets[0],a=accounts[0],m=members[0];
        if(targets.length!==1||accounts.length!==1||members.length!==1||u.id!==sourceUserId||!['admin','user'].includes(String(u.role))||u.is_active===false
          ||a.id!==sourceAccountId||!['active','trial'].includes(String(a.status))||m.user_id!==sourceUserId||m.agency_id!==sourceAccountId||m.membership_key!==membershipKey
          ||m.status!=='active'||m.revoked_at!=null||!['agency_admin','manager','clinician','office_staff','social_worker','spiritual_care'].includes(String(m.tenant_role))
          ||typeof m.version!=='number'||!Number.isSafeInteger(m.version)||m.version<1) return fail(403,'forbidden');
        const evidence=JSON.stringify(['pennsync',APP_ID,sourceUserId,sourceAccountId,u.role,timestamp(u.updated_date),a.status,timestamp(a.updated_date),nativeId(m.id),m.tenant_role,m.version]);
        const revision=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(evidence))),b=>b.toString(16).padStart(2,'0')).join('');
        data={product:'pennsync',sourceUserId,sourceAccountId,accountKind:'agency',relationship:'agency_member',revision};
      } else if (operation.operation === 'overview') {
        const [agencies, profiles, subscriptions] = await Promise.all([
          scan('Agency', {}, ['id']), staff(['id', 'role']), scan('Subscription', {}, ['id']),
        ]);
        data = { organizationCount: agencies.length, activeUserCount: null, registeredUserCount: profiles.length, subscriptionCount: subscriptions.length };
      } else if (operation.operation === 'organizations.list') {
        const agencies = await scan('Agency', {}, ['id', 'agency_name', 'status', 'created_date']);
        data = page(agencies.map(row => ({ id: nativeId(row.id), name: optionalText(row.agency_name), slug: null, status: recordedStatus(row.status), createdAt: timestamp(row.created_date) })), row => row.name);
      } else if (operation.operation === 'users.list') {
        const profiles = await staff(['id', 'role', 'full_name', 'email', 'created_date']);
        data = page(profiles.map(row => ({ id: nativeId(row.id), displayName: optionalText(row.full_name), email: optionalText(row.email, 500), role: text(row.role, 100), status: 'registered', createdAt: timestamp(row.created_date) })), row => row.email);
      } else if (operation.operation === 'billing.overview') {
        const subscriptions = await scan('Subscription', {}, ['id', 'status']);
        const counts = new Map<string, number>();
        for (const row of subscriptions) { const status = recordedStatus(row.status); counts.set(status, (counts.get(status) ?? 0) + 1); }
        if (counts.size > 100) return fail();
        data = { source: SOURCE, subscriptionCount: subscriptions.length, statusCounts: [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([status, count]) => ({ status, count })) };
      } else {
        const subscriptions = await scan('Subscription', {}, ['id', 'status', 'plan_name', 'stripe_customer_id', 'stripe_subscription_id', 'current_period_end', 'updated_date']);
        data = { ...page(subscriptions.map(row => ({
          id: nativeId(row.id), organizationId: null, organizationName: null, planCode: null, planName: optionalText(row.plan_name),
          status: recordedStatus(row.status), providerStatus: null, providerCustomerId: optionalText(row.stripe_customer_id, 255),
          providerSubscriptionId: optionalText(row.stripe_subscription_id, 255), currentPeriodEnd: timestamp(row.current_period_end), updatedAt: timestamp(row.updated_date),
        })), row => row.providerSubscriptionId), source: SOURCE };
      }
      signal.throwIfAborted();
      stage = 'response';
      return json({ contractVersion: 1, product: 'pennsync', operation: operation.operation, generatedAt: now().toISOString(), data });
    } catch (error) {
      const status = error instanceof AdminError ? error.status : 503;
      if (status >= 500 || !['configuration', 'transport', 'request_body'].includes(stage)) {
        const diagnostic = failureDiagnostic(request, stage, status, hubStatus, error);
        const key = JSON.stringify(diagnostic);
        if (reportedFailures.size < 20 && !reportedFailures.has(key)) {
          reportedFailures.add(key);
          try { reportFailure(diagnostic); } catch { /* Diagnostics cannot change the response. */ }
        }
      }
      return json({ error: { code: error instanceof AdminError ? error.code : 'upstream' } }, status);
    } finally { try { client?.cleanup?.(); } catch { /* Never log credential-bearing native errors. */ } }
  };
}

// BEGIN PENNSYNC LEARNING SOURCE
// Embedded into centralAdminRead by tools-sync-pennsync-learning-source.mjs.
// Only the current, mapped protected administrator can invoke this reader.
type LearningRow = Record<string, unknown>;
type LearningEntity = { filter: (query: LearningRow, sort: string, limit: number, offset: number, fields: string[]) => Promise<unknown> };
const pennsyncSourceFields: Record<string, string[]> = {"TrainingCourse":["id","created_date","updated_date","title","short_description","description","training_type","annual_cycle_year","category","business_line_scope","employee_audience","purpose","reading_level","role_targets","tags","estimated_minutes","status","version","created_by","published_by","published_date","approved_by","approved_at","learning_objectives","passing_score","certificate_valid_months","is_mandatory","recurrence_rule","ai_generated","needs_sme_review","policy_references","citation_count","enable_certificate","requires_attestation","attestation_text","ceu_hours","allow_answer_review","include_case_scenarios","include_key_takeaways","certificate_wording","references_json","ai_prompt_json","retake_settings_json","test_settings_json","attachment_urls","attachment_names","archived_status","real_world_relevance","regulatory_crosswalk_json","competency_skills_json","pre_assessment_json","brain_sparks_json"],"TrainingModule":["id","created_date","updated_date","title","description","category","module_type","content_type","content","related_diagnoses","related_skills","prerequisites","duration_minutes","difficulty_level","is_required","required_for_onboarding","recertification_months","passing_score","content_url","is_active","order","course_id","type","content_json","order_index","estimated_minutes","attachment_urls","attachment_names","video_url","video_thumbnail_url","video_duration_seconds","video_status","video_generated_at","video_error","video_job_id","video_avatar_id","video_voice_id"],"TrainingQuestion":["id","created_date","updated_date","course_id","type","prompt","options_json","correct_answer_json","rationale","rubric","difficulty","question_bank_tag","version","active","source_citations_json","order_index","points"],"TrainingCompletion":["id","created_date","updated_date","nurse_email","training_module_id","completion_date","score","status","due_date","expiration_date","certificate_url","feedback","effectiveness_rating","difficulty_rating","relevance_rating","would_recommend","improvement_suggestions","performance_metrics"],"TrainingAssignment":["id","created_date","updated_date","course_id","course_title","plan_id","assigned_to_user_id","assigned_to_role","assigned_to_department","assigned_to_location","assigned_to_business_line","assigned_by","assigned_date","due_date","annual_cycle_year","priority","status","required","passing_score_required","max_attempts","waiting_period_hours","regenerate_test_on_retake","retake_required","latest_attempt_number","score_percentage","pass_fail_result","recurrence_rule","renewal_frequency","renewal_due_date","certificate_id","attestation_required","acknowledgement_completed","reminder_sent","last_reminder_date","reminder_offsets_sent","training_due_offsets_sent","reminder_claimed_by","reminder_claimed_at","expiration_note_offsets_sent","expiration_note_claimed_by","completion_date","notes","remediation_message","progress_percentage","started_date","last_accessed","archived_status","submitted_at","certificate_issue_claimed_by"],"TrainingAttempt":["id","created_date","updated_date","assignment_id","course_id","user_id","started_at","submitted_at","score","objective_score","short_answer_score","passed","pass_fail_result","answers_json","grading_method","ai_grading_confidence","randomized_question_order","time_spent_minutes","attempt_number","remediation_message","ip_address","badges_processed_at","badges_claim_token","corrective_plan_claimed_by"],"TrainingAttestation":["id","created_date","updated_date","assignment_id","course_id","user_id","statement","acknowledged","signed_name","attestation_timestamp","device_metadata","ip_address"],"TrainingCertificate":["id","created_date","updated_date","user_id","user_name","assignment_id","course_id","course_title","training_category","business_line","annual_cycle_year","certificate_id","issued_at","completion_date","expiration_date","certificate_pdf_url","score","hours","verification_hash","revoked","revoked_by","revoked_reason","last_renewal_reminder_date","renewal_reminder_offsets_sent","renewal_assignment_claimed_by","renewal_assignment_claimed_at"],"LearningPlan":["id","created_date","updated_date","name","description","business_line_scope","year","start_date","end_date","plan_type","global_due_date","active","auto_enroll","auto_enroll_criteria","created_by","total_courses","estimated_hours"],"LearningPlanCourse":["id","created_date","updated_date","plan_id","course_id","course_title","order_index","due_date_offset_days","specific_due_date","is_required"],"User":["id","email","role","is_active","updated_date"],"Agency":["id","status","updated_date"],"AgencyMembership":["id","user_id","agency_id","membership_key","tenant_role","status","version","revoked_at"]};
const learningEncoder = new TextEncoder();
const learningIdPattern = /^[0-9a-f]{24}$/;
function sourceCanonical(value: unknown): string {
  if (value === null || ['string','boolean','number'].includes(typeof value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(sourceCanonical).join(',') + ']';
  if (!value || typeof value !== 'object') throw new Error('Invalid source value');
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + sourceCanonical((value as LearningRow)[key])).join(',') + '}';
}
async function sourceHash(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',learningEncoder.encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function readPennsyncLearningSource(entities: Record<string, LearningEntity>, signal: AbortSignal) {
  const read = async (name: string): Promise<LearningRow[]> => {
    const result: LearningRow[] = []; let previous = '';
    for (let offset=0;offset<=10000;offset+=250) {
      signal.throwIfAborted();
      const limit=Math.min(250,10001-offset);
      const page=await entities[name].filter({},'id',limit,offset,pennsyncSourceFields[name]);
      signal.throwIfAborted();
      if (!Array.isArray(page)||page.length>limit) throw new Error('Invalid source page');
      for(const row of page) {
        if(!row||typeof row!=='object'||Array.isArray(row)||typeof row.id!=='string'||!learningIdPattern.test(row.id)||row.id<=previous) throw new Error('Invalid source order');
        previous=row.id;
        const projected=Object.fromEntries(pennsyncSourceFields[name].filter(key=>row[key]!==undefined).map(key=>[key,row[key]]));
        if(learningEncoder.encode(sourceCanonical(projected)).length>750000) throw new Error('Oversized source record');
        result.push(projected);
      }
      if(result.length>10000)throw new Error('Source scan incomplete');
      if(page.length<limit)return result;
    }
    throw new Error('Source scan incomplete');
  };
  const scan = async () => {
    const result:Record<string,LearningRow[]>={}; const names=Object.keys(pennsyncSourceFields).sort();
    // Bound platform load while reading all pages, including empty entities.
    for(let index=0;index<names.length;index+=4) {
      const group=names.slice(index,index+4);
      const values=await Promise.all(group.map(read));
      group.forEach((name,i)=>{result[name]=values[i];});
    }
    if(learningEncoder.encode(sourceCanonical(result)).length>6000000)throw new Error('Oversized source cohort');
    return result;
  };
  const first=await scan(), second=await scan();
  // Base44 has no cross-entity snapshot transaction. Require two identical,
  // complete reads; the Hub re-reads the same source before committing it.
  if(sourceCanonical(first)!==sourceCanonical(second))throw new Error('Source changed during read');
  const references:Array<{entity:string;sourceId:string;path:string;sha256:string;kind:string}>=[];
  const scrub=async(value:unknown,entity:string,sourceId:string,path:string,depth=0):Promise<unknown>=>{
    if(depth>20)throw new Error('Source nesting exceeds limit');
    const key=path.split('/').at(-1)??'';
    const sensitiveKey=/(?:url|uri|token|secret|password|authorization|api_key|ai_prompt_json)$/i.test(key);
    if(value!=null&&value!==''&&(sensitiveKey||(typeof value==='string'&&/(?:https?:\/\/|Bearer\s+|[?&](?:token|signature|key|x-amz-[a-z-]+)=)/i.test(value)))) {
      if(references.length>=10000)throw new Error('Too many source references');
      const sha256=await sourceHash(sourceCanonical(value));
      references.push({entity,sourceId,path,sha256,kind:sensitiveKey?'source_reference':'embedded_reference'});
      return {sourceReferenceSha256:sha256};
    }
    if(Array.isArray(value))return Promise.all(value.map((item,i)=>scrub(item,entity,sourceId,path+'/'+i,depth+1)));
    if(value&&typeof value==='object') {
      const out:LearningRow={};
      for(const name of Object.keys(value).sort()) {
        if(['__proto__','prototype','constructor'].includes(name)||name.length>160)throw new Error('Invalid source key');
        out[name]=await scrub((value as LearningRow)[name],entity,sourceId,path+'/'+name.replace(/~/g,'~0').replace(/\//g,'~1'),depth+1);
      }
      return out;
    }
    return value;
  };
  const records:Record<string,Array<{id:string;revision:string;fields:unknown}>>={};
  for(const [name,values] of Object.entries(second)) {
    records[name]=[];
    for(const row of values) records[name].push({id:String(row.id),revision:await sourceHash(sourceCanonical(row)),fields:await scrub(row,name,String(row.id),'')});
  }
  const payload=sourceCanonical({contract:'pennsync.learning-source.v1',sourceAppId:'694ec16e72e01b60d22f7cbf',scope:'private-administrator-migration',records,references});
  if(learningEncoder.encode(payload).length>7000000)throw new Error('Oversized source payload');
  return {payload,sourceRevision:await sourceHash(payload)};
}
// END PENNSYNC LEARNING SOURCE

Deno.serve(createCentralAdminHandler({ getEnv: (name) => Deno.env.get(name) }));
