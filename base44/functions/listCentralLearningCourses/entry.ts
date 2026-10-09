import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

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

const HUB = 'https://support-hub-web-production.up.railway.app';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function hubRead(path, post = false) {
  const response = await fetch(`${HUB}/api/${path}`, {
    method: post ? 'POST' : 'GET',
    headers: post ? { 'Content-Type': 'application/json', Origin: HUB } : {},
    body: post ? '{}' : undefined,
    redirect: 'manual', signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Hub catalog endpoint ${path} returned ${response.status}.`);
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error('The Support Hub returned an invalid catalog.');
  return data;
}

Deno.serve(async (req) => {
  const headers = { 'Cache-Control': 'no-store' };
  let phase = 'authentication';
  try {
    if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers });
    let client;
    try {
      // The shared helper pins the production app id and drops every inbound
      // header but the caller's credential; it refuses a different app id.
      client = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    } catch {
      return Response.json({ error: 'Forbidden' }, { status: 403, headers });
    }
    const user = await client.auth.me();
    if (!user?.id || user.is_active === false || user.disabled === true) return Response.json({ error: 'Unauthorized' }, { status: 401, headers });
    phase = 'request';
    const body = await req.json().catch(() => null);
    const input = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const search = typeof input.search === 'string' ? input.search.trim().slice(0, 120).toLowerCase() : '';
    const category = typeof input.category === 'string' ? input.category.slice(0, 100) : '';
    const offset = Number.isInteger(input.offset) && input.offset >= 0 ? Math.min(input.offset, 10000) : 0;
    // These calls return anonymous public metadata only. No PennSync identity,
    // credentials, private course documents, or learner records are sent to the Hub.
    phase = 'hub_catalog';
    const [products, central, published] = await Promise.all([
      hubRead('rows/products'), hubRead('rpc/list_learning_catalog', true), hubRead('rpc/list_published_content', true),
    ]);
    const product = products.find(row => row.slug === 'pennsync');
    if (!product?.id) throw new Error('PennSync is not registered in the Support Hub catalog.');
    const courses = new Map();
    for (const row of published) {
      if (row.kind !== 'course' || row.status !== 'published' || row.access_level !== 'public' || !row.product_ids?.includes(product.id)) continue;
      const centralCourse = row.source_system === 'support_hub' && UUID.test(row.id);
      const sourcePath = typeof row.course_launch_path === 'string' && /^\/app\/courses\/[0-9a-f-]{36}$/i.test(row.course_launch_path)
        && UUID.test(row.course_launch_path.split('/').pop()) ? row.course_launch_path : null;
      courses.set(row.id, { id: row.id, title: String(row.title || ''), summary: String(row.summary || ''), category: String(row.content_category || ''), duration_minutes: row.course_duration_minutes || null,
        delivery: centralCourse ? 'Support Hub' : 'CareBase', url: centralCourse ? `${HUB}/learn/courses/${row.id}` : sourcePath ? `https://cmcarebase.com${sourcePath}` : null });
    }
    for (const row of central) {
      if (!UUID.test(row.itemId) || !row.productIds?.includes(product.id)) continue;
      courses.set(row.itemId, { id: row.itemId, title: String(row.title || ''), summary: String(row.summary || ''), category: String(row.category || ''), duration_minutes: row.durationMinutes || null,
        delivery: 'Support Hub', url: `${HUB}/learn/courses/${row.itemId}` });
    }
    const all = [...courses.values()].sort((a, b) => a.title.localeCompare(b.title));
    const categories = [...new Set(all.map(row => row.category).filter(Boolean))].sort();
    const matched = all.filter(row => (!category || row.category === category) && (!search || `${row.title} ${row.summary} ${row.category}`.toLowerCase().includes(search)));
    return Response.json({ items: matched.slice(offset, offset + 12), total: matched.length, categories, next_offset: offset + 12 < matched.length ? offset + 12 : null }, { headers });
  } catch (error) {
    console.error('Central catalog request failed:', error?.message);
    const status = error?.status === 401 || error?.response?.status === 401 ? 401 : 502;
    return Response.json({ error: status === 401 ? 'Unauthorized' : 'The Support Hub catalog could not be loaded. Please try again.', code: phase }, { status, headers });
  }
});
