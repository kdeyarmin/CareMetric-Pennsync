// Runs inside the image build (`node --test *.test.mjs` in the Dockerfile), so
// it builds its own fixture tree and never reads the real `dist`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CONTENT_TYPES, RELEASE_VALUE, RELEASE_VARIABLE, SECURITY_HEADERS, SiteError,
  createRequestHandler, createSiteInventory, isReleased, normalizePath, routeFor,
} from './server.mjs';

const INDEX = '<!DOCTYPE html><html><head><script type="module" src="./assets/index-abc123-def.js"></script></head><body></body></html>';

function fixture(extra = () => {}) {
  const root = mkdtempSync(join(tmpdir(), 'pennsync-site-'));
  mkdirSync(join(root, 'assets'));
  mkdirSync(join(root, 'icons'));
  mkdirSync(join(root, 'manuals'));
  writeFileSync(join(root, 'index.html'), INDEX);
  writeFileSync(join(root, 'assets', 'index-abc123-def.js'), 'export default 1;\n');
  writeFileSync(join(root, 'assets', 'index-abc123-def.css'), 'body{color:#1f3261}\n');
  writeFileSync(join(root, 'manifest.json'), '{"id":"."}\n');
  writeFileSync(join(root, 'icons', 'icon-192.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeFileSync(join(root, 'manuals', 'PennSync-User-Manual.pdf'), '%PDF-1.4\n');
  extra(root);
  return root;
}

async function withServer(root, env, run) {
  const inventory = createSiteInventory(root);
  const server = createServer(createRequestHandler({ inventory, released: isReleased(env) }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    return await run(origin, inventory);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(root, { recursive: true, force: true });
  }
}

const released = { [RELEASE_VARIABLE]: RELEASE_VALUE };

test('the boot walk refuses what must never be served', () => {
  const cases = [
    ['HIDDEN_BUILD_FILE', (root) => writeFileSync(join(root, '.env'), 'SECRET=1')],
    ['UNSAFE_BUILD_FILE', (root) => symlinkSync('/etc/hostname', join(root, 'leak.txt'))],
    ['UNKNOWN_BUILD_FILE_TYPE', (root) => writeFileSync(join(root, 'notes.bak'), 'x')],
    // A sourcemap would publish the unminified source of a clinical app.
    ['REFUSED_BUILD_FILE', (root) => writeFileSync(join(root, 'assets', 'index-abc123-def.js.map'), '{}')],
  ];
  for (const [code, extra] of cases) {
    const root = fixture(extra);
    try {
      assert.throws(() => createSiteInventory(root), (error) => error instanceof SiteError && error.code === code, code);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
  const root = mkdtempSync(join(tmpdir(), 'pennsync-site-'));
  writeFileSync(join(root, 'manifest.json'), '{}');
  try {
    assert.throws(() => createSiteInventory(root), (error) => error.code === 'MISSING_INDEX_HTML');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a request path is refused rather than normalised', () => {
  // `/%2e%2e/...` is the case that drove the implementation away from
  // `new URL`: that resolves the escape and collapses the segment, handing back
  // a path with nothing suspicious left in it.
  for (const target of ['/%2e%2e/etc/passwd', '/..%2fetc', '/a/../../etc', '/caf%C3%A9',
    '/assets/%2f', '/a\\b', '//evil.example/x', '/./assets', 'assets/x.js']) {
    assert.equal(normalizePath(target), null, target);
  }
  assert.equal(normalizePath('/'), '/');
  assert.equal(normalizePath('/patients/123?tab=chart'), '/patients/123');
  assert.equal(normalizePath('/assets/index-abc123-def.js'), '/assets/index-abc123-def.js');
});

test('a missing hashed asset is a 404 and never the app shell', async () => {
  const root = fixture();
  const inventory = createSiteInventory(root);
  try {
    // The reason this is not the fallback: a browser that asked for a script
    // and received an HTML document reports a syntax error, which reads as a
    // broken build rather than as the one missing file it is.
    assert.equal(routeFor(inventory, '/assets/index-gone-000.js').kind, 'missing');
    assert.equal(routeFor(inventory, '/manifest.webmanifest').kind, 'missing');
    // The case only the /assets/ branch answers: no extension, so the test
    // below it does not fire, and nothing under /assets/ is a client route.
    assert.equal(routeFor(inventory, '/assets/forgotten').kind, 'missing');
    assert.equal(routeFor(inventory, '/').kind, 'app');
    assert.equal(routeFor(inventory, '/patients/123').kind, 'app');
    assert.equal(routeFor(inventory, '/assets/index-abc123-def.js').kind, 'file');
    assert.equal(routeFor(inventory, '/manuals/PennSync-User-Manual.pdf').kind, 'file');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('nothing but /healthz answers while the release is paused', async () => {
  await withServer(fixture(), {}, async (origin) => {
    for (const path of ['/', '/patients/1', '/assets/index-abc123-def.js', '/manifest.json']) {
      const response = await fetch(origin + path);
      assert.equal(response.status, 503, path);
      assert.equal((await response.json()).error, 'PENNSYNC_SITE_RELEASE_PAUSED');
    }
    const health = await fetch(origin + '/healthz');
    assert.equal(health.status, 200);
    const body = await health.json();
    assert.equal(body.released, false);
    assert.equal(body.assets, 6);
  });
});

test('the release gate reads one exact string', () => {
  for (const value of ['true', '1', 'on', 'enabled', 'ENABLED-V1', 'enabled-v1 ', '']) {
    assert.equal(isReleased({ [RELEASE_VARIABLE]: value }), false, value);
  }
  assert.equal(isReleased({}), false);
  assert.equal(isReleased(released), true);
});

test('a released site serves the shell uncached and its hashed assets forever', async () => {
  await withServer(fixture(), released, async (origin, inventory) => {
    const shell = await fetch(origin + '/');
    assert.equal(shell.status, 200);
    assert.equal(shell.headers.get('content-type'), CONTENT_TYPES['.html']);
    assert.equal(shell.headers.get('cache-control'), 'no-store');
    assert.equal(await shell.text(), INDEX);

    // Any client route resolves to the same shell with the same status, which
    // is what makes a refreshed deep link work without server-side routing.
    const deep = await fetch(origin + '/patients/123');
    assert.equal(deep.status, 200);
    assert.equal(await deep.text(), INDEX);

    const asset = await fetch(origin + '/assets/index-abc123-def.js');
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal(asset.headers.get('content-type'), CONTENT_TYPES['.js']);

    const manifest = await fetch(origin + '/manifest.json');
    assert.equal(manifest.headers.get('cache-control'), 'public, max-age=0, must-revalidate');
    const etag = manifest.headers.get('etag');
    assert.equal(etag, inventory.files.get('/manifest.json').etag);
    const revalidated = await fetch(origin + '/manifest.json', { headers: { 'if-none-match': etag } });
    assert.equal(revalidated.status, 304);

    for (const path of ['/assets/index-gone-000.js', '/assets/forgotten']) {
      assert.equal((await fetch(origin + path)).status, 404, path);
    }
  });
});

test('every answer carries the measured production header set', async () => {
  await withServer(fixture(), released, async (origin) => {
    const responses = [
      await fetch(origin + '/'),
      await fetch(origin + '/assets/index-gone-000.js'),
      await fetch(origin + '/healthz'),
      await fetch(origin + '/caf%C3%A9'),
      await fetch(origin + '/', { method: 'POST' }),
    ];
    assert.deepEqual(responses.map((r) => r.status), [200, 404, 200, 400, 405]);
    for (const response of responses) {
      for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
        assert.equal(response.headers.get(header), value, `${response.status} ${header}`);
      }
    }
    assert.equal(responses[4].headers.get('allow'), 'GET, HEAD');
  });
});

test('HEAD answers the GET headers with no body', async () => {
  await withServer(fixture(), released, async (origin) => {
    const head = await fetch(origin + '/assets/index-abc123-def.css', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-type'), CONTENT_TYPES['.css']);
    assert.equal(head.headers.get('content-length'), '20');
    assert.equal(await head.text(), '');
  });
});
