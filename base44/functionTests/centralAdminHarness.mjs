import { readFile } from 'node:fs/promises';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const source = await readFile(new URL('../functions/centralAdminRead/entry.ts', import.meta.url), 'utf8');
const transformed = source
  .replace(/import \{ createClientFromRequest \} from 'npm:[^']+';/, 'const createClientFromRequest = () => { throw new Error("Native factory required"); };')
  .replace(/Deno\.serve\(createCentralAdminHandler\(\{ getEnv: \(name\) => Deno\.env\.get\(name\) \}\)\);/, '');
export const nativeModule = await import(`data:text/javascript;base64,${Buffer.from(transpileTs(transformed).outputText).toString('base64')}`);

export const ACTOR = '11111111-1111-4111-8111-111111111111';
export const NATIVE = '1a'.padEnd(24, '0');
export const STAFF = '2a'.padEnd(24, '0');
export const UNBOUND = '2b'.padEnd(24, '0');
export const AGENCY = '3a'.padEnd(24, '0');
export const TOKEN = 'Bearer fixture.header.signature';
const date = '2026-09-11T00:00:00.000Z';
export function makeFixture(options = {}) {
  const env = {
    CAREMETRIC_ADMIN_ENABLED: 'true',
    HUB_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture',
    CAREMETRIC_ADMIN_IDENTITY_MAP_JSON: JSON.stringify({ [ACTOR]: NATIVE }),
    CAREMETRIC_ADMIN_SOURCE_REVISION: 'a'.repeat(40),
    ...options.env,
  };
  const data = {
    User: [
      { id: NATIVE, role: 'admin', is_active: true, full_name: 'Administrator', email: 'admin@example.test', created_date: date, favorited_patients: ['private-patient'], saved_signature: 'private-signature' },
      { id: STAFF, role: 'user', is_active: true, full_name: 'Registered staff', email: 'staff@example.test', created_date: date },
      { id: UNBOUND, role: 'user', account_type: 'super_admin', agency_id: AGENCY, staff_role: 'nurse', email: 'unbound-private@example.test' },
    ],
    Agency: [{ id: AGENCY, agency_name: 'Fixture agency', agency_code: 'private-join-code', status: 'active', created_date: date, notes: 'private-notes', contact_email: 'private-contact@example.test' }],
    AgencyMembership: [{ id: '6aa200000000000000000001', user_id: STAFF, agency_id: AGENCY, membership_key: `${AGENCY}:${STAFF}`, tenant_role: 'clinician', status: 'revoked' }],
    Subscription: [{ id: '4a'.padEnd(24, '0'), status: 'active', plan_name: 'Recorded plan', stripe_customer_id: 'cus_fixture', stripe_subscription_id: 'sub_fixture', current_period_end: date, updated_date: date, user_email: 'private-billing@example.test', webhook_events: [{ private: 'body' }], monthly_amount: 99 }],
    ...options.data,
  };
  const calls = [];
  const requests = [];
  const hubs = [];
  let cleanups = 0;
  const fetcher = async (url, init) => {
    hubs.push({ url, init });
    if (options.fetcher) return options.fetcher(url, init);
    return Response.json(options.actor ?? { user_id: ACTOR, role: 'platform_admin', aal: 'aal2' }, { status: options.hubStatus ?? 200 });
  };
  const createClient = request => {
    requests.push(request);
    const entities = Object.fromEntries(['User', 'Agency', 'AgencyMembership', 'Subscription'].map(entity => [entity, {
      filter: async (query, sort, limit, offset, fields) => {
        const call = { entity, query, sort, limit, offset, fields };
        calls.push(call);
        if (options.read) {
          const override = await options.read(call);
          if (override !== undefined) return override;
        }
        const result = data[entity].filter(row => Object.entries(query).every(([key, value]) =>
          value && typeof value === 'object' ? value.$in.includes(row[key]) : row[key] === value))
          .sort((a, b) => a.id.localeCompare(b.id)).slice(offset, offset + limit);
        if (options.extraFields) return structuredClone(result);
        return result.map(row => Object.fromEntries(fields.filter(field => row[field] !== undefined).map(field => [field, row[field]])));
      },
    }]));
    return { asServiceRole: { entities }, cleanup: () => { cleanups += 1; } };
  };
  return {
    handler: nativeModule.createCentralAdminHandler({ getEnv: name => env[name], createClient, fetcher, now: () => new Date(date) }),
    calls, requests, hubs, data, env, cleanups: () => cleanups,
  };
}
export function nativeRequest(body = { operation: 'overview' }, options = {}) {
  const headers = new Headers({
    'Content-Type': 'application/json',
    'X-CareMetric-Hub-Authorization': TOKEN,
    'Base44-App-Id': '694ec16e72e01b60d22f7cbf',
    'Base44-Service-Authorization': 'Bearer native-hosted-fixture',
  });
  for (const [key, value] of Object.entries(options.headers ?? {})) {
    if (value === null) headers.delete(key);
    else headers.set(key, value);
  }
  return new Request('https://caremetricai.base44.app/functions/centralAdminRead', {
    method: options.method ?? 'POST', headers,
    ...((options.method ?? 'POST') === 'GET' ? {} : { body: options.rawBody ?? JSON.stringify(body) }),
    ...(options.signal ? { signal: options.signal } : {}),
  });
}
