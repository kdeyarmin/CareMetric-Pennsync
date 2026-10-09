// In-memory runtime for the e-signature Deno functions. It loads the real
// entry.ts source, swaps only the SDK import, the pdf-lib import, Deno and
// fetch, and serves entity reads/writes from plain arrays with the query
// operators the functions use ($in, $or, $exists, null-as-missing). Private
// storage is a Map; "signed URLs" resolve back into it through the fake fetch.
// No network, no provider, no hosted store.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { transpileTs } from '../../tools-transpile-ts.mjs';

export const APP_ID = '694ec16e72e01b60d22f7cbf';
export const AGREEMENT_TEXT = 'Synthetic test consent only. This is not the production consent policy text.';
export const sha256Hex = (value) => createHash('sha256').update(value).digest('hex');

const clone = (value) => (value === undefined ? undefined : structuredClone(value));

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function matchValue(actual, expected) {
  if (expected === null || expected === undefined) return actual === null || actual === undefined;
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    if (Object.hasOwn(expected, '$in')) return expected.$in.some((value) => sameJson(value, actual));
    if (Object.hasOwn(expected, '$exists')) return expected.$exists ? actual !== undefined : actual === undefined;
    if (Object.hasOwn(expected, '$ne')) return !sameJson(actual, expected.$ne);
  }
  return sameJson(actual, expected);
}

export function matches(row, query) {
  return Object.entries(query || {}).every(([key, value]) => {
    if (key === '$or') return value.some((part) => matches(row, part));
    if (key === '$and') return value.every((part) => matches(row, part));
    return matchValue(row[key], value);
  });
}

// ---- pdf-lib stand-in --------------------------------------------------
// Records every drawing operation and serializes them into deterministic
// "%PDF-" bytes, so tests can assert what was stamped and hash what was sealed.
class FakeFont {
  constructor(name) { this.name = name; }
  widthOfTextAtSize(text, size) { return String(text).length * size * 0.5; }
}
class FakeImage {
  constructor(id, kind) { this.id = id; this.kind = kind; this.width = 300; this.height = 100; }
}
class FakePage {
  constructor(doc, size) { this.doc = doc; this.width = size[0]; this.height = size[1]; }
  getMediaBox() { return { x: 0, y: 0, width: this.width, height: this.height }; }
  getSize() { return { width: this.width, height: this.height }; }
  drawText(text, options) {
    if (/[^\x20-\x7e\xa0-\xff]/.test(text)) throw new Error('WinAnsi cannot encode text');
    this.doc.ops.push(['text', this.doc.pages.indexOf(this) + 1, String(text), Math.round(options.size)]);
  }
  drawImage(image, options) {
    this.doc.ops.push(['image', this.doc.pages.indexOf(this) + 1, image.id,
      Math.round(options.x), Math.round(options.y), Math.round(options.width), Math.round(options.height)]);
  }
  drawRectangle() { this.doc.ops.push(['rect', this.doc.pages.indexOf(this) + 1]); }
  drawLine() { this.doc.ops.push(['line', this.doc.pages.indexOf(this) + 1]); }
}
class FakePDFDocument {
  constructor(sourcePages) {
    this.pages = [];
    this.ops = [];
    this.meta = {};
    this.images = 0;
    for (let index = 0; index < sourcePages; index += 1) this.pages.push(new FakePage(this, [612, 792]));
  }
  static async load(bytes) {
    const text = new TextDecoder().decode(bytes);
    if (!text.startsWith('%PDF-')) throw new Error('Not a PDF');
    if (text.includes('/Encrypt')) throw new Error('EncryptedPDFError');
    const pages = Number((text.match(/PAGES:(\d+)/) || [])[1] || 1);
    const doc = new FakePDFDocument(pages);
    doc.ops.push(['source', sha256Hex(bytes)]);
    return doc;
  }
  static async create() { return new FakePDFDocument(0); }
  async embedFont(name) { return new FakeFont(name); }
  async embedPng(bytes) {
    if (bytes[0] !== 0x89 || bytes[1] !== 0x50) throw new Error('Not a PNG');
    this.images += 1;
    return new FakeImage('png-' + sha256Hex(bytes).slice(0, 12), 'png');
  }
  async embedJpg(bytes) {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('Not a JPEG');
    this.images += 1;
    return new FakeImage('jpg-' + sha256Hex(bytes).slice(0, 12), 'jpg');
  }
  addPage(size) { const page = new FakePage(this, size || [612, 792]); this.pages.push(page); return page; }
  getPages() { return this.pages; }
  setTitle(value) { this.meta.title = value; }
  setSubject(value) { this.meta.subject = value; }
  setProducer(value) { this.meta.producer = value; }
  setCreator(value) { this.meta.creator = value; }
  setCreationDate(value) { this.meta.created = value.toISOString(); }
  setModificationDate(value) { this.meta.modified = value.toISOString(); }
  async save() {
    return new TextEncoder().encode('%PDF-1.7\n%fake-sealed\nPAGES:' + this.pages.length + '\n'
      + JSON.stringify({ meta: this.meta, ops: this.ops }));
  }
}
export const fakePdfLib = {
  PDFDocument: FakePDFDocument,
  StandardFonts: { Helvetica: 'Helvetica', HelveticaBold: 'Helvetica-Bold' },
  rgb: (r, g, b) => ({ r, g, b }),
};

// A minimal real PNG (signature + IHDR + IEND) of at least 100 bytes.
export function pngBytes(seed = 1) {
  const bytes = new Uint8Array(120);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  for (let index = 8; index < 112; index += 1) bytes[index] = (index * 7 + seed) % 251;
  bytes.set([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82], 112);
  return bytes;
}

export function pdfBytes(label = 'source', pages = 2) {
  return new TextEncoder().encode('%PDF-1.4\n%synthetic ' + label + '\nPAGES:' + pages + '\n%%EOF\n');
}

const ENTITY_NAMES = [
  'Agency', 'AgencyMembership', 'Patient', 'PatientCareTeamAssignment', 'Document', 'DocumentTenantBinding',
  'DocumentSignature', 'DocumentPackage', 'DocumentPackageToken', 'SignerReviewGrant', 'SignatureArtifactBinding',
  'SignatureAuditEvent', 'ScheduledSignatureReminder', 'Notification', 'DocumentTemplate', 'DischargeSummary', 'User',
];

export function createHarness(options = {}) {
  let clock = Date.parse('2026-10-08T12:00:00.000Z');
  const stamp = () => new Date(clock++).toISOString();
  const db = Object.fromEntries(ENTITY_NAMES.map((name) => [name, []]));
  const storage = new Map();
  const emails = [];
  const calls = { uploads: 0, signedUrls: 0, invokes: [] };
  const users = new Map();
  const handlers = new Map();
  const env = {
    APP_PUBLIC_URL: 'https://app.pennsync.test',
    OUTBOUND_DELIVERY_RELEASE: 'enabled-v1',
    SIGNATURE_AGREEMENT_TEXT: AGREEMENT_TEXT,
    SIGNATURE_AGREEMENT_SHA256: sha256Hex(AGREEMENT_TEXT),
    SIGNATURE_HMAC_SECRET: 'synthetic-hmac-key-not-for-production-123456',
    INTERNAL_FN_SECRET: 'synthetic-internal-secret',
    ...options.env,
  };
  let rowCounter = 0;

  const entity = (name) => ({
    filter: async (query, sort, limit) => {
      if (options.beforeFilter) await options.beforeFilter(name, query);
      let rows = db[name].filter((row) => matches(row, query));
      if (typeof sort === 'string' && sort) {
        const descending = sort.startsWith('-');
        const field = descending ? sort.slice(1) : sort;
        rows = rows.slice().sort((left, right) => {
          const compared = String(left[field] ?? '').localeCompare(String(right[field] ?? ''));
          return descending ? -compared : compared;
        });
      }
      return clone(Number.isFinite(limit) ? rows.slice(0, limit) : rows);
    },
    list: async (sort, limit) => entity(name).filter({}, sort, limit),
    create: async (data) => {
      if (options.beforeCreate) await options.beforeCreate(name, data, db);
      rowCounter += 1;
      const now = stamp();
      const row = { ...clone(data), id: `${name}-${rowCounter}`, created_date: now, updated_date: now };
      db[name].push(row);
      return clone(row);
    },
    updateMany: async (query, change) => {
      if (options.beforeUpdate) {
        const override = await options.beforeUpdate(name, query, change, db);
        if (override !== undefined) return override;
      }
      const targets = db[name].filter((row) => matches(row, query));
      for (const row of targets) Object.assign(row, clone(change.$set), { updated_date: stamp() });
      return { success: true, updated: targets.length, has_more: false };
    },
  });
  const entities = Object.fromEntries(ENTITY_NAMES.map((name) => [name, entity(name)]));

  const Core = {
    UploadPrivateFile: async ({ file }) => {
      calls.uploads += 1;
      if (options.onUpload) await options.onUpload(file);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const uri = `mp/private/${APP_ID}/obj-${calls.uploads}`;
      storage.set(uri, bytes);
      return { file_uri: uri };
    },
    CreateFileSignedUrl: async ({ file_uri: uri }) => {
      calls.signedUrls += 1;
      if (!storage.has(uri)) throw new Error('No such private file');
      return { signed_url: `https://storage.test/${encodeURIComponent(uri)}` };
    },
    SendEmail: async (payload) => {
      if (options.onEmail) await options.onEmail(payload);
      emails.push(clone(payload));
      return {};
    },
  };

  const fakeFetch = async (url) => {
    const text = String(url);
    if (!text.startsWith('https://storage.test/')) throw new Error('Network disabled in the harness');
    const uri = decodeURIComponent(text.slice('https://storage.test/'.length));
    const bytes = storage.get(uri);
    if (!bytes) return new Response('missing', { status: 404 });
    return new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.byteLength) } });
  };

  async function invoke(name, payload, authorization) {
    calls.invokes.push(name);
    const handler = await load(name);
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (authorization) headers.set('Authorization', authorization);
    const response = await handler(new Request(`https://functions.test/${name}`,
      { method: 'POST', headers, body: JSON.stringify(payload || {}) }));
    const data = await response.json();
    if (response.status >= 400) {
      const error = new Error(data?.error || 'Function failed');
      error.response = { status: response.status, data };
      throw error;
    }
    return { status: response.status, data };
  }

  function createClientFromRequest(req) {
    const authorization = req?.headers?.get?.('Authorization') || null;
    const key = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;
    const user = key ? users.get(key) || null : null;
    return {
      auth: { me: async () => (user ? clone(user) : null) },
      entities,
      functions: { invoke: (name, payload) => invoke(name, payload, authorization) },
      asServiceRole: {
        entities,
        integrations: { Core },
        functions: { invoke: (name, payload) => invoke(name, payload, null) },
      },
    };
  }

  const Deno = { env: { get: (key) => env[key] } };

  async function load(name) {
    if (handlers.has(name)) return handlers.get(name);
    let source = await readFile(new URL(`../functions/${name}/entry.ts`, import.meta.url), 'utf8');
    const binding = `__esignHarness_${Math.random().toString(36).slice(2)}`;
    globalThis[binding] = {
      createClientFromRequest,
      Deno: { ...Deno, serve: (handler) => { handlers.set(name, handler); } },
      fetch: fakeFetch,
      pdfLib: options.pdfLib || fakePdfLib,
    };
    source = source
      .replace(/import \{ createClientFromRequest \} from 'npm:[^']+';/,
        `const createClientFromRequest = globalThis.${binding}.createClientFromRequest; `
        + `const Deno = globalThis.${binding}.Deno; const fetch = globalThis.${binding}.fetch;`)
      .replace(/import \{ PDFDocument, StandardFonts, rgb \} from 'npm:pdf-lib@[^']+';/,
        `const { PDFDocument, StandardFonts, rgb } = globalThis.${binding}.pdfLib;`);
    if (/^import /m.test(source)) throw new Error(`${name} has an import the harness does not provide`);
    const compiled = transpileTs(source, { fileName: `${name}/entry.ts` }).outputText;
    await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}#${binding}`);
    if (!handlers.has(name)) throw new Error(`${name} did not register a handler`);
    return handlers.get(name);
  }

  async function call(name, { user = null, body, form, headers = {} } = {}) {
    const handler = await load(name);
    const requestHeaders = new Headers(headers);
    if (user) requestHeaders.set('Authorization', `Bearer ${user}`);
    let init;
    if (form) {
      const data = new FormData();
      for (const [key, value] of Object.entries(form)) data.set(key, value);
      init = { method: 'POST', headers: requestHeaders, body: data };
    } else {
      requestHeaders.set('Content-Type', 'application/json');
      init = { method: 'POST', headers: requestHeaders, body: JSON.stringify(body ?? {}) };
    }
    const response = await handler(new Request(`https://functions.test/${name}`, init));
    const data = await response.json().catch(() => null);
    return { status: response.status, data };
  }

  function addUser(key, user) {
    users.set(key, { id: key, email: `${key}@agency.test`, role: 'user', is_active: true, full_name: key, ...user });
    return users.get(key);
  }

  function seed(name, row) {
    const now = stamp();
    const full = { created_date: now, updated_date: now, ...clone(row) };
    db[name].push(full);
    return full;
  }

  function membership(userKey, agencyId, tenantRole, extra = {}) {
    const user = users.get(userKey);
    return seed('AgencyMembership', {
      id: `membership-${userKey}-${agencyId}`, agency_id: agencyId, user_id: user.id,
      user_email_normalized: user.email, membership_key: `${agencyId}:${user.id}`,
      tenant_role: tenantRole, status: 'active', version: 1, activated_at: '2026-01-01T00:00:00.000Z',
      created_by_user_id: 'owner', last_transition_by_user_id: 'owner',
      last_transition_by_email_normalized: 'owner@agency.test',
      last_transition_at: '2026-01-01T00:00:00.000Z', last_transition_reason: 'seed', ...extra,
    });
  }

  function chartDocument({ id, agencyId, patientId, creatorKey, bytes = pdfBytes(id), fileType = 'application/pdf', fileName = `${id}.pdf` }) {
    const uri = `mp/private/${APP_ID}/${id}`;
    storage.set(uri, bytes);
    const creator = users.get(creatorKey);
    seed('Document', { id, title: fileName, file_name: fileName, file_type: fileType, file_size: bytes.byteLength,
      category: 'other', patient_id: patientId, tags: ['patient_document'], is_sensitive: true,
      uploaded_by: creator.email, created_by: creator.email });
    seed('DocumentTenantBinding', { id: `binding-${id}`, binding_key: sha256Hex(`${agencyId}\0${creator.id}\0req-${id}`),
      document_id: id, agency_id: agencyId, patient_id: patientId, created_by_user_id: creator.id,
      created_by_user_email_normalized: creator.email, membership_id: `membership-${creatorKey}-${agencyId}`,
      membership_version: 1, document_created_by_email_normalized: creator.email, storage_mode: 'private',
      file_uri: uri, file_name: fileName, file_type: fileType, file_size: bytes.byteLength,
      content_sha256: sha256Hex(bytes), client_request_id: `req-${id}`, purpose: 'patient_document', version: 2,
      created_at: '2026-10-01T00:00:00.000Z', last_verified_at: '2026-10-01T00:00:00.000Z' });
    return { uri, bytes };
  }

  return { db, storage, emails, calls, env, entities, load, call, addUser, seed, membership, chartDocument, users };
}

export function linkTokenFrom(email) {
  const match = String(email?.body || '').match(/signer\?token=([A-Za-z0-9_-]{43})/);
  return match ? decodeURIComponent(match[1]) : null;
}
