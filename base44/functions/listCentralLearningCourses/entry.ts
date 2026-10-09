import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

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

export default async function(req) {
  const headers = { 'Cache-Control': 'no-store' };
  let phase = 'authentication';
  try {
    if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers });
    const pinnedHeaders = new Headers(req.headers);
    const appId = pinnedHeaders.get('Base44-App-Id');
    if (appId && appId !== '694ec16e72e01b60d22f7cbf') return Response.json({ error: 'Forbidden' }, { status: 403, headers });
    pinnedHeaders.set('Base44-App-Id', '694ec16e72e01b60d22f7cbf');
    pinnedHeaders.delete('Base44-Api-Url');
    const client = createClientFromRequest(new Request(req.url, { headers: pinnedHeaders }));
    const user = await client.auth.me();
    if (!user?.id || user.is_active === false || user.disabled === true) return Response.json({ error: 'Unauthorized' }, { status: 401, headers });
    phase = 'request';
    const input = await req.json();
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
}