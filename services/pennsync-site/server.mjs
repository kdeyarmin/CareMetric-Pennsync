#!/usr/bin/env node
// The owned static host for the built PennSync frontend.
//
// Base44 serves the static shell today (D3, `business_backend_exit`), and under
// `complete_hosting_exit` this service serves it instead. It holds no
// credential, reaches no database and runs no business logic: it reads a
// directory of built files once at boot and answers requests from that
// inventory. Nothing here decides authorization — the bundle it serves still
// talks to `services/pennsync-api` and the authority store.
//
// Two properties are load-bearing rather than stylistic.
//
// It is PAUSED unless released. `PENNSYNC_SITE_RELEASED` must read exactly
// `enabled-v1` or every route but `/healthz` answers 503. Deploying this
// service therefore changes nothing a visitor can see, which is what lets the
// hosting move be built and observed before the DNS record is touched. The
// shape is `PENNSYNC_ENROLL_NEW_STAFF`'s: an exact string, never a truthiness
// test, so `false`, `0` and `off` are all off.
//
// The inventory is built ONCE and a request can only name a member of it. There
// is no path arithmetic per request and so no traversal surface: a decoded
// pathname is either a key of the map or it is not. The boot walk refuses a
// symlink, a hidden file, an unknown extension and `.map` outright, which also
// means a build that accidentally emitted a sourcemap fails to start rather
// than publishing one.
import { createReadStream, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

export const RELEASE_VARIABLE = 'PENNSYNC_SITE_RELEASED';
export const RELEASE_VALUE = 'enabled-v1';
export const MAX_FILES = 2000;
export const MAX_FILE_BYTES = 32 * 1024 * 1024;

// Extensions the build and `public/` actually emit, measured from `git ls-files
// public` plus Vite's own output. An unknown extension refuses at boot instead
// of being served as a guessed type: adding one is a reviewed act, and
// `nosniff` means a wrong type is a broken page rather than a sniffed one.
export const CONTENT_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/vnd.microsoft.icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
});

// A sourcemap exposes the unminified source of a clinical application. The
// build does not emit one today; if it ever starts, this refuses to boot rather
// than quietly serving it.
export const REFUSED_EXTENSIONS = Object.freeze(['.map']);

// Copied from the measured response headers of both production addresses on
// 2026-10-01 (`curl -D -`), so the owned origin answers with the same set
// rather than a wider or narrower one. `content-security-policy` is NOT here:
// the SPA carries its own in a `<meta http-equiv>` in `index.html`, and a
// second one at the header level would intersect with it.
export const SECURITY_HEADERS = Object.freeze({
  'referrer-policy': 'strict-origin-when-cross-origin',
  'strict-transport-security': 'max-age=31536000',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
});

export class SiteError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'SiteError';
    this.code = code;
  }
}

const extensionOf = (name) => {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot).toLowerCase();
};

export function isReleased(env = process.env) {
  return env[RELEASE_VARIABLE] === RELEASE_VALUE;
}

// Walks the built directory once. Mirrors `createBuildInventory` in
// tools-live-frontend-sync.mjs deliberately: the same refusals, so a build this
// service agrees to serve is a build that tool agrees to verify.
export function createSiteInventory(root) {
  const base = resolve(root);
  if (lstatSync(base).isSymbolicLink() || !lstatSync(base).isDirectory()) {
    throw new SiteError('INVALID_BUILD_DIRECTORY', base);
  }
  const resolvedBase = realpathSync(base);
  const files = new Map();
  const walk = (directory) => {
    for (const item of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const filename = join(directory, item.name);
      const stat = lstatSync(filename);
      if (item.name.startsWith('.')) throw new SiteError('HIDDEN_BUILD_FILE', filename);
      if (stat.isSymbolicLink() || !realpathSync(filename).startsWith(resolvedBase + sep)) {
        throw new SiteError('UNSAFE_BUILD_FILE', filename);
      }
      if (stat.isDirectory()) { walk(filename); continue; }
      if (!stat.isFile()) throw new SiteError('INVALID_BUILD_FILE', filename);
      if (stat.size > MAX_FILE_BYTES) throw new SiteError('BUILD_FILE_TOO_LARGE', filename);
      const path = '/' + relative(base, filename).split(sep).join('/');
      if (!/^\/[A-Za-z0-9_./-]+$/.test(path)) throw new SiteError('INVALID_BUILD_FILENAME', path);
      const extension = extensionOf(item.name);
      if (REFUSED_EXTENSIONS.includes(extension)) throw new SiteError('REFUSED_BUILD_FILE', path);
      if (!Object.hasOwn(CONTENT_TYPES, extension)) throw new SiteError('UNKNOWN_BUILD_FILE_TYPE', path);
      if (files.size >= MAX_FILES) throw new SiteError('BUILD_LIMIT_EXCEEDED', path);
      files.set(path, {
        path,
        file: filename,
        type: CONTENT_TYPES[extension],
        bytes: stat.size,
        // A hashed asset under /assets/ is content-addressed by Vite's
        // `[hash]-[revision]` naming, so it can be cached forever. Everything
        // else keeps a stable URL across releases and must revalidate.
        immutable: path.startsWith('/assets/'),
        etag: `"${createHash('sha256').update(readFileSync(filename)).digest('hex').slice(0, 32)}"`,
      });
    }
  };
  walk(base);
  const index = files.get('/index.html');
  if (!index) throw new SiteError('MISSING_INDEX_HTML', base);
  return Object.freeze({ root: base, files, index });
}

// Validates a request path WITHOUT normalising it, and deliberately without
// `new URL`. WHATWG URL resolves `%2e%2e` to `..` and then collapses it, so
// `/%2e%2e/etc/passwd` arrives as `/etc/passwd` with nothing left to refuse —
// measured, and the reason this function reads the raw target instead. Refusing
// every `%` is what makes that safe to reason about: no escape is ever
// accepted, so no sequence can decode into a segment, and that costs nothing
// because the boot walk already proved every servable path is plain ASCII.
export function normalizePath(target) {
  if (typeof target !== 'string' || target.length > 2048) return null;
  const query = target.search(/[?#]/);
  const path = query === -1 ? target : target.slice(0, query);
  if (!path.startsWith('/')) return null;
  if (/[\\%]/.test(path)) return null;
  if (path.includes('//')) return null;
  if (path.split('/').some((segment) => segment === '.' || segment === '..')) return null;
  if (path !== '/' && !/^\/[A-Za-z0-9_./-]+$/.test(path)) return null;
  return path;
}

// The single-page fallback, and the one place it must NOT apply. A missing
// hashed asset answers 404; falling back to `index.html` there would hand the
// browser an HTML document where it asked for a script, which surfaces as a
// syntax error in the console rather than as the missing file it is.
export function routeFor(inventory, pathname) {
  if (pathname === '/' ) return { kind: 'app', entry: inventory.index };
  const exact = inventory.files.get(pathname);
  if (exact) return { kind: 'file', entry: exact };
  // Both of these refuse, and they refuse different things. The extension test
  // below covers a missing hashed asset; this one covers an EXTENSIONLESS path
  // under /assets/, which is the only case it answers alone — sabotage proved
  // the extension test absorbs everything else.
  if (pathname.startsWith('/assets/')) return { kind: 'missing' };
  const last = pathname.slice(pathname.lastIndexOf('/') + 1);
  if (extensionOf(last)) return { kind: 'missing' };
  return { kind: 'app', entry: inventory.index };
}

function send(response, status, headers, body) {
  response.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  if (body === undefined) response.end();
  else response.end(body);
}

export function createRequestHandler({ inventory, released, now = () => new Date() }) {
  return function handle(request, response) {
    const method = request.method === undefined ? '' : request.method.toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      send(response, 405, { allow: 'GET, HEAD', 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' },
        method === 'HEAD' ? undefined : JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }));
      return;
    }
    const pathname = normalizePath(request.url || '/');
    if (pathname === null) {
      send(response, 400, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' },
        method === 'HEAD' ? undefined : JSON.stringify({ error: 'INVALID_REQUEST_PATH' }));
      return;
    }
    // Answered whether or not the site is released, so a deployment can be
    // observed to be up and paused rather than up or down.
    if (pathname === '/healthz') {
      const body = JSON.stringify({
        status: 'ok',
        released,
        assets: inventory.files.size,
        checked_at: now().toISOString(),
      });
      send(response, 200, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' },
        method === 'HEAD' ? undefined : body);
      return;
    }
    if (!released) {
      send(response, 503, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' },
        method === 'HEAD' ? undefined : JSON.stringify({ error: 'PENNSYNC_SITE_RELEASE_PAUSED' }));
      return;
    }
    const route = routeFor(inventory, pathname);
    if (route.kind === 'missing') {
      send(response, 404, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' },
        method === 'HEAD' ? undefined : JSON.stringify({ error: 'NOT_FOUND' }));
      return;
    }
    const { entry } = route;
    // The app shell carries no cache lifetime of its own: it names the hashed
    // assets of one release, so a cached copy is how a client ends up asking
    // for assets a later release has replaced.
    const cache = route.kind === 'app'
      ? 'no-store'
      : (entry.immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate');
    const headers = { 'cache-control': cache, 'content-type': entry.type };
    if (cache !== 'no-store') headers.etag = entry.etag;
    const inm = request.headers?.['if-none-match'];
    if (cache !== 'no-store' && inm && inm.split(',').some((value) => value.trim() === entry.etag)) {
      send(response, 304, headers);
      return;
    }
    headers['content-length'] = String(entry.bytes);
    if (method === 'HEAD') { send(response, 200, headers); return; }
    response.writeHead(200, { ...SECURITY_HEADERS, ...headers });
    createReadStream(entry.file).on('error', () => response.destroy()).pipe(response);
  };
}

export function createSiteServer({ dist = 'dist', env = process.env } = {}) {
  const inventory = createSiteInventory(dist);
  const released = isReleased(env);
  return { inventory, released, server: createServer(createRequestHandler({ inventory, released })) };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const dist = process.env.PENNSYNC_SITE_DIST || 'dist';
  const { inventory, released, server } = createSiteServer({ dist });
  const port = Number(process.env.PORT || 8080);
  server.listen(port, () => {
    // Printed rather than asserted: whether this deployment is released is a
    // reading an operator takes from the log or from `/healthz`, not something
    // the image can decide for itself.
    process.stdout.write(`pennsync-site listening on ${port}; files=${inventory.files.size} released=${released}\n`);
  });
}
