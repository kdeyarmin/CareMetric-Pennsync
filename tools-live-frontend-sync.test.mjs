import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBuildInventory, htmlReferences, main, PRODUCTION_ORIGINS, validateOrigin, verifyOrigin } from './tools-live-frontend-sync.mjs';

const ORIGIN = PRODUCTION_ORIGINS[0];
const HTML = '<html><head><script src="./assets/index-good.js" crossorigin type="module"></script>'
  + '<link href="./assets/site.css" rel="stylesheet"></head><body></body></html>';
function build(t) {
  const dir = mkdtempSync(join(tmpdir(), 'pennsync-publication-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), HTML);
  writeFileSync(join(dir, 'assets/index-good.js'), "import('./lazy.js'); // Confirm sign-in link");
  writeFileSync(join(dir, 'assets/lazy.js'), 'export const feature = "new-version";');
  writeFileSync(join(dir, 'assets/site.css'), 'body{margin:0}');
  writeFileSync(join(dir, 'manifest.json'), '{"name":"PennSync"}');
  return { dir, inventory: createBuildInventory(dir) };
}
function serving(dir, override = () => null) {
  const calls = [];
  const fetchImpl = async (value, options) => {
    const url = new URL(value);
    calls.push({ url, options });
    const altered = await override(url, calls.length);
    if (altered) return altered;
    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    const bytes = readFileSync(join(dir, path));
    return new Response(bytes, { headers: { 'Content-Type': path.endsWith('.js') ? 'text/javascript'
      : path.endsWith('.css') ? 'text/css' : path.endsWith('.html') ? 'text/html' : 'application/json' } });
  };
  return { fetchImpl, calls };
}

test('only intended HTTPS site roots are accepted, never credentials or arbitrary hosts', () => {
  assert.equal(validateOrigin(ORIGIN + '/'), ORIGIN);
  for (const input of ['http://app.caremetricai.com', 'https://user:password@app.caremetricai.com',
    'https://app.caremetricai.com/?access_token=TEST', 'https://app.caremetricai.com/#TEST',
    'https://app.caremetricai.com/assets/', 'https://localhost', 'https://another.base44.app', 'bad']) {
    assert.throws(() => validateOrigin(input));
  }
});

test('HTML parser accepts single quotes and attributes in any order', () => {
  assert.equal(htmlReferences(HTML.replaceAll('"', "'"), ORIGIN).entry, '/assets/index-good.js');
});

test('entry text inside an HTML comment cannot prove publication', () => {
  assert.throws(() => htmlReferences('<!--' + HTML + '-->', ORIGIN));
});

for (const [name, html] of [
  ['ambiguous entry', HTML.replace('</head>', '<script type="module" src="assets/index-other.js"></script></head>')],
  ['foreign entry', HTML.replace('./assets/index-good.js', 'https://foreign.example/assets/index-good.js')],
  ['non-module entry', HTML.replace('type="module"', 'type="text/plain"')],
  ['duplicate attributes', HTML.replace('crossorigin', 'src="./assets/index-other.js"')],
  ['base rewriting', HTML.replace('<head>', '<head><base href="https://foreign.example/">')],
  ['query on stylesheet', HTML.replace('./assets/site.css', './assets/site.css?token=TEST')],
  ['encoded asset', HTML.replace('./assets/site.css', './assets/s%69te.css')],
]) {
  test(`${name} fails closed`, () => { assert.throws(() => htmlReferences(html, ORIGIN)); });
}

test('build inventory includes lazy scripts, styles and public manifest', (t) => {
  const { inventory } = build(t);
  assert.equal(inventory.assets.length, 4);
  assert.ok(inventory.assets.some((a) => a.path === '/assets/lazy.js'));
  assert.match(inventory.entry_sha256, /^[a-f0-9]{64}$/);
});

test('symlinks and hidden files cannot pull private material into verification', (t) => {
  const { dir } = build(t);
  symlinkSync(join(dir, 'manifest.json'), join(dir, 'assets/link.json'));
  assert.throws(() => createBuildInventory(dir), /UNSAFE_BUILD_FILE/);
  rmSync(join(dir, 'assets/link.json'));
  writeFileSync(join(dir, '.env'), 'PRIVATE_TEST_VALUE');
  assert.throws(() => createBuildInventory(dir), /HIDDEN_BUILD_FILE/);
});

test('a missing local root dependency fails before network access', (t) => {
  const { dir } = build(t);
  rmSync(join(dir, 'assets/site.css'));
  assert.throws(() => createBuildInventory(dir), /INCOMPLETE_LOCAL_BUILD/);
});

test('matching ALL emitted assets and stable root verifies static publication only', async (t) => {
  const { dir, inventory } = build(t);
  const remote = serving(dir);
  const report = await verifyOrigin(ORIGIN, inventory, remote);
  assert.equal(report.publication_verified, true);
  assert.equal(report.matched_assets, 4);
  assert.equal(remote.calls.filter((r) => r.url.pathname === '/').length, 2);
  for (const call of remote.calls) {
    assert.equal(call.options.method, 'GET');
    assert.equal(call.options.credentials, 'omit');
    assert.equal(call.options.redirect, 'error');
    assert.equal(call.options.headers.Authorization, undefined);
    assert.ok(call.options.signal instanceof AbortSignal);
  }
});

test('old root fails immediately even when historical markers are present', async (t) => {
  const { dir, inventory } = build(t);
  const remote = serving(dir, (url) => url.pathname === '/' ? new Response(
    HTML.replace('index-good', 'index-old') + '<!-- Confirm sign-in link -->') : null);
  const report = await verifyOrigin(ORIGIN, inventory, remote);
  assert.equal(report.status, 'drift');
  assert.equal(report.publication_verified, false);
  assert.equal(remote.calls.length, 1);
});

test('same filename but different entry bytes fails', async (t) => {
  const { dir, inventory } = build(t);
  const report = await verifyOrigin(ORIGIN, inventory, serving(dir, (url) =>
    url.pathname.endsWith('index-good.js') ? new Response('old entry bytes') : null));
  assert.equal(report.publication_verified, false);
  assert.ok(report.failures.some((f) => f.code === 'ASSET_HASH_MISMATCH'));
});

test('matching entry cannot hide stale lazy-loaded code', async (t) => {
  const { dir, inventory } = build(t);
  const report = await verifyOrigin(ORIGIN, inventory, serving(dir, (url) =>
    url.pathname.endsWith('lazy.js') ? new Response('export const feature = "old-version";') : null));
  assert.equal(report.publication_verified, false);
  assert.ok(report.failures.some((f) => f.path === '/assets/lazy.js'));
});

test('a missing lazy chunk is drift rather than a passing homepage test', async (t) => {
  const { dir, inventory } = build(t);
  const report = await verifyOrigin(ORIGIN, inventory, serving(dir, (url) =>
    url.pathname.endsWith('lazy.js') ? new Response('not found', { status: 404 }) : null));
  assert.equal(report.status, 'drift');
  assert.ok(report.failures.some((f) => f.code === 'ASSET_MISSING'));
});

test('an HTML fallback with HTTP 200 is not a valid JavaScript chunk', async (t) => {
  const { dir, inventory } = build(t);
  const report = await verifyOrigin(ORIGIN, inventory, serving(dir, (url) =>
    url.pathname.endsWith('lazy.js') ? new Response(HTML) : null));
  assert.equal(report.publication_verified, false);
});

test('transport failure cannot masquerade as passed verification', async (t) => {
  const { inventory } = build(t);
  const report = await verifyOrigin(ORIGIN, inventory, { fetchImpl: async () => { throw new Error('PRIVATE_TEST_VALUE'); } });
  assert.equal(report.status, 'unverified');
  assert.equal(report.publication_verified, false);
  assert.equal(JSON.stringify(report).includes('PRIVATE_TEST_VALUE'), false);
});

test('oversized response is rejected without reading its body', async (t) => {
  const { inventory } = build(t);
  const report = await verifyOrigin(ORIGIN, inventory, { fetchImpl: async () =>
    new Response('', { headers: { 'Content-Length': String(3 * 1024 * 1024) } }) });
  assert.equal(report.status, 'unverified');
  assert.ok(report.failures.some((f) => f.code === 'RESPONSE_LIMIT_EXCEEDED'));
});

test('a release changing during the check is not declared published', async (t) => {
  const { dir, inventory } = build(t);
  let roots = 0;
  const report = await verifyOrigin(ORIGIN, inventory, serving(dir, (url) => {
    if (url.pathname === '/' && ++roots > 1) return new Response(HTML.replace('index-good', 'index-other'));
    return null;
  }));
  assert.equal(report.status, 'drift');
  assert.ok(report.failures.some((f) => f.code === 'RELEASE_CHANGED_DURING_CHECK'));
});

test('default command requires BOTH production addresses and never claims full readiness', async (t) => {
  const { dir } = build(t);
  const remote = serving(dir);
  const output = [];
  const code = await main(['--dist', dir, '--json'], { ...remote, log: (s) => output.push(JSON.parse(s)) });
  assert.equal(code, 0);
  assert.deepEqual([...new Set(remote.calls.map((c) => c.url.origin))].sort(), [...PRODUCTION_ORIGINS].sort());
  assert.equal(output[0].publication_verified, true);
  assert.equal(output[0].authenticated_workflows_verified, false);
  assert.equal(output[0].full_release_complete, false);
});

test('one current domain cannot hide stale publication on the other', async (t) => {
  const { dir } = build(t);
  const remote = serving(dir, (url) => url.origin === PRODUCTION_ORIGINS[1] && url.pathname === '/'
    ? new Response(HTML.replace('index-good', 'index-old')) : null);
  assert.equal(await main(['--dist', dir], { ...remote, log() {} }), 1);
});

test('invalid arguments or missing build return 2 without network access or exposing input', async () => {
  for (const args of [['--unknown'], ['https://user:PRIVATE_TEST_VALUE@app.caremetricai.com'],
    ['--dist'], ['--dist', '/missing-pennsync-test-dist']]) {
    const output = [];
    const result = await main(args, { fetchImpl() { assert.fail('network must not run'); }, log: (s) => output.push(s) });
    assert.equal(result, 2);
    assert.equal(output.join('').includes('PRIVATE_TEST_VALUE'), false);
  }
});
