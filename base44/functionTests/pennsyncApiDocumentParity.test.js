import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { transpileTs } from '../../tools-transpile-ts.mjs';
import {
  BAG_TECHNIQUE_FILENAME, SMART_NOTE_GUIDE_FILENAME, USER_MANUAL_FILENAME,
  buildBagTechniqueChecklist, buildSmartNoteGuide, buildUserManual,
} from '../../services/pennsync-api/documents.mjs';
import {
  buildUserRoster, careScopeLabel, rosterFilename,
} from '../../services/pennsync-api/document-user-roster.mjs';

/**
 * Drift guard for documents ported out of Base44.
 *
 * A rendered PDF cannot be compared byte for byte — jsPDF embeds a creation
 * timestamp and a document id, so two runs of the *same* code differ. What can
 * be compared exactly is the sequence of drawing calls, which is the document:
 * same calls in the same order with the same arguments means the same page.
 *
 * So both sides are driven by one recording surface. The Base44 original runs
 * for real — transpiled, its `Deno.serve` handler captured and invoked — rather
 * than being read or paraphrased, so this fails if either implementation
 * changes. The surface answers page geometry with the numbers real jsPDF
 * answers, so the coordinates recorded here are the coordinates a real render
 * computes.
 */
const LOGO = 'data:image/png;base64,iVBORw0KGgo=';
/** What a real `new jsPDF()` reports, so recorded geometry is not invented. */
const PAGE_WIDTH = 210.0015555555555;
const PAGE_HEIGHT = 297.0000833333333;

/** Records every call in order. Both implementations draw on one of these. */
function recorder() {
  const calls = [];
  // Real jsPDF keeps a dummy at index 0, so `pages.length` is pages + 1.
  const pages = [null, {}];
  const surface = {
    calls,
    internal: {
      pages,
      pageSize: { getWidth: () => PAGE_WIDTH, getHeight: () => PAGE_HEIGHT },
    },
    // jsPDF wraps at a width the stub cannot know, so it splits deterministically
    // instead. Both sides see the same split, which is what parity needs; the
    // real wrapping is jsPDF's own and identical on both sides at render time.
    splitTextToSize(text, width) {
      calls.push(['splitTextToSize', text, width]);
      return String(text).length > 64 ? [String(text).slice(0, 64), String(text).slice(64)] : [String(text)];
    },
    addPage(...args) { pages.push({}); calls.push(['addPage', ...args]); },
    getNumberOfPages() { calls.push(['getNumberOfPages']); return pages.length - 1; },
    output(...args) { calls.push(['output', ...args]); return new ArrayBuffer(8); },
  };
  for (const name of ['setFillColor', 'rect', 'roundedRect', 'addImage', 'setTextColor',
    'setFontSize', 'setFont', 'text', 'setLineWidth', 'setDrawColor', 'setPage']) {
    surface[name] = (...args) => { calls.push([name, ...args]); };
  }
  return surface;
}

/**
 * Transpile the Deno original, stub what it imports and reaches for, and return
 * its captured request handler.
 */
async function loadOriginalHandler(entry, client = null) {
  const source = await readFile(entry, 'utf8');
  assert.match(source, /Deno\.serve\(/, 'the original should register a Deno handler');
  const stripped = source.replace(/^import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?\s*$/gm, '');
  assert.doesNotMatch(stripped, /from 'npm:/, 'every npm import should be stubbed');
  const preamble = `const { createClientFromRequest, jsPDF, capture } = globalThis.__documentParity;\n`
    + `const Deno = { serve: capture };\n`;
  const js = transpileTs(preamble + stripped).outputText;
  const temporary = join(tmpdir(), `docparity_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(temporary, js);
  let handler = null;
  // The preamble DESTRUCTURES these at import time, so a caller that needs a
  // different client has to supply it before the module is loaded — replacing
  // the property afterwards leaves the original bound to the default.
  globalThis.__documentParity = {
    createClientFromRequest: client
      ?? (() => ({ auth: { me: async () => ({ id: 'u1', is_active: true }) } })),
    jsPDF: function jsPDF() { return globalThis.__documentParity.surface; },
    capture: (fn) => { handler = fn; },
    surface: null,
  };
  try {
    await import(pathToFileURL(temporary).href);
  } finally { await unlink(temporary).catch(() => {}); }
  assert.ok(typeof handler === 'function', 'the handler should have been captured');
  return handler;
}

/** Run the original, with the logo fetch either succeeding or failing. */
async function runOriginal(handler, { logo = false } = {}) {
  const surface = recorder();
  globalThis.__documentParity.surface = surface;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    if (!logo) throw new Error('logo unavailable');
    return { blob: async () => ({ arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer }) };
  };
  let response;
  try {
    response = await handler(new Request('https://example.test/', { method: 'POST' }));
  } finally { globalThis.fetch = realFetch; }
  assert.equal(response.status, 200);
  return { calls: surface.calls, response };
}

/** The date the original stamped, so the port is asked for the same document. */
function generatedOn(calls) {
  const stamped = calls.find(call => call[0] === 'text' && /^Generated: /.test(String(call[1])));
  assert.ok(stamped, 'the original should stamp a generated date');
  return String(stamped[1]).replace(/^Generated: /, '');
}

/** Everything the original drew, without the trailing request for the bytes. */
function drawn(calls) {
  assert.deepEqual(calls.at(-1), ['output', 'arraybuffer'], 'the original should ask for the bytes last');
  return calls.slice(0, -1);
}

const DOCUMENTS = [
  {
    name: 'generateBagTechniquePDF',
    filename: BAG_TECHNIQUE_FILENAME,
    dated: true,
    build: (doc, options) => buildBagTechniqueChecklist(doc, options),
    async assertResponse(response) {
      assert.equal(response.headers.get('content-type'), 'application/pdf');
      assert.match(response.headers.get('content-disposition'), new RegExp(BAG_TECHNIQUE_FILENAME));
    },
  },
  {
    name: 'generateSmartNoteGuide',
    filename: SMART_NOTE_GUIDE_FILENAME,
    dated: true,
    build: (doc, options) => buildSmartNoteGuide(doc, options),
    async assertResponse(response) {
      // This original answered with JSON carrying a base64 payload rather than
      // the bytes, which is why its handler is not a binary one.
      const body = await response.json();
      assert.equal(body.success, true);
      assert.equal(body.filename, SMART_NOTE_GUIDE_FILENAME);
      assert.equal(typeof body.pdf, 'string');
    },
  },
  {
    name: 'generateUserManual',
    filename: USER_MANUAL_FILENAME,
    dated: false,
    build: doc => buildUserManual(doc),
    async assertResponse(response) {
      assert.equal(response.headers.get('content-type'), 'application/pdf');
      assert.match(response.headers.get('content-disposition'), new RegExp(USER_MANUAL_FILENAME));
    },
  },
];

for (const document of DOCUMENTS) {
  test(`${document.name} is ported call for call`, async () => {
    const handler = await loadOriginalHandler(
      new URL(`../functions/${document.name}/entry.ts`, import.meta.url));
    const { calls, response } = await runOriginal(handler);
    await document.assertResponse(response);
    const original = drawn(calls);
    const surface = recorder();
    document.build(surface, document.dated ? { generatedOn: generatedOn(original) } : undefined);
    assert.deepEqual(surface.calls, original);
    // A document that drew nothing would pass a naive comparison.
    assert.ok(original.length > 40, 'the original should have drawn a real document');
  });
}

test('the checklist draws its logo when one is configured, and the original\'s fallback when not', async () => {
  const handler = await loadOriginalHandler(
    new URL('../functions/generateBagTechniquePDF/entry.ts', import.meta.url));
  const { calls } = await runOriginal(handler, { logo: true });
  const original = drawn(calls);
  const surface = recorder();
  buildBagTechniqueChecklist(surface, { logoDataUrl: LOGO, generatedOn: generatedOn(original) });
  // The logo differs only in the data URL the caller supplied, which is the
  // point of the change; every other argument must match exactly.
  const image = original.findIndex(call => call[0] === 'addImage');
  assert.ok(image >= 0, 'the original should add the logo image');
  assert.deepEqual(original[image].slice(2), ['PNG', 15, 8, 20, 20]);
  assert.match(String(original[image][1]), /^data:image\/png;base64,/);
  original[image] = ['addImage', LOGO, 'PNG', 15, 8, 20, 20];
  assert.deepEqual(surface.calls, original);
  // And the no-logo case really is the branch without the image, so a reader
  // can see that removing the Base44 fetch removed a fetch and nothing else.
  const without = recorder();
  buildBagTechniqueChecklist(without, { generatedOn: 'x' });
  assert.equal(without.calls.some(call => call[0] === 'addImage'), false);
});

test('the clinical checklist content is carried verbatim, because a surveyor reads it', async () => {
  const handler = await loadOriginalHandler(
    new URL('../functions/generateBagTechniquePDF/entry.ts', import.meta.url));
  const { calls } = await runOriginal(handler);
  const surface = recorder();
  buildBagTechniqueChecklist(surface, { generatedOn: generatedOn(drawn(calls)) });
  const lines = value => value.filter(call => call[0] === 'splitTextToSize').map(call => call[1]);
  const carried = lines(surface.calls);
  assert.deepEqual(carried, lines(drawn(calls)));
  assert.equal(carried.length, 36, 'the number of checklist items changed');
  assert.ok(carried.includes('Perform hand hygiene'));
  assert.ok(carried.includes('Doff used gloves using Aseptic Non Touch Technique'));
});

test('a document that cannot be dated is refused rather than stamped with today', () => {
  // Two originals called `new Date()` inside the builder, which makes the same
  // request produce a different document on either side of midnight. Those
  // ports take the day from their caller and will not invent one.
  for (const build of [buildBagTechniqueChecklist, buildSmartNoteGuide]) {
    for (const value of [undefined, null, '', 0, new Date()]) {
      assert.throws(() => build(recorder(), { generatedOn: value }), TypeError);
    }
  }
  // The manual never read a clock, so it needs no day and invents none.
  assert.doesNotThrow(() => buildUserManual(recorder()));
});

/**
 * The roster report, which is the first document whose port DIVERGES.
 *
 * It draws the original's page minus one column: the carried `user` table has
 * no name field (D38, D46), so `full_name || 'N/A'` has no source here, and
 * printing 'N/A' down the page or repeating the address beside the Email
 * column are both worse than dropping it. That is exactly one transform of the
 * original's recorded calls — remove the Name draws, shift the five that
 * remain left by the 60mm that frees — so it is expressed as one transform and
 * compared, rather than described.
 */
const ROSTER_USERS = [
  { full_name: 'Ada Lovelace', email: 'ada@example.invalid', credential_type: 'RN',
    role: 'agency_admin', care_scope: 'home_health', is_approved: true, agency_name: 'Synthetic A' },
  { full_name: 'Grace Hopper', email: 'grace@example.invalid', credential_type: 'LPN',
    role: 'clinician', care_scope: 'hospice', is_approved: false, agency_name: 'Synthetic A' },
  { full_name: 'Katherine Johnson', email: 'kj@example.invalid', credential_type: null,
    role: 'manager', care_scope: 'both', is_approved: true, agency_name: 'Synthetic A' },
  { full_name: 'Mary Jackson', email: 'mj@example.invalid', credential_type: 'RN',
    role: 'office_staff', care_scope: null, is_approved: false, agency_name: 'Synthetic A' },
];
/** The column x's the original uses, in order, and the 60mm the Name frees. */
const ROSTER_COLUMN_X = [15, 75, 135, 170, 200, 250];
const ROSTER_SHIFT = 60;

async function runRosterOriginal() {
  // The gate has to be reached the way a real caller reaches it, and that
  // turned out to be worth measuring: `withTrustedClaims` STRIPS a claimed
  // `account_type` of `agency_admin` or `super_admin` back to `'user'` unless
  // a canonical active `AgencyMembership` says otherwise. So the original's
  // `account_type === 'super_admin'` test can never be true, and its
  // `account_type === 'agency_admin'` test means "holds an agency_admin
  // membership" — which is what the contract gates on. The membership is built
  // to the shape `canonicalClaimMembership` demands, including an exact ISO
  // instant, so this really takes the trusted path rather than a fallback.
  const now = new Date().toISOString();
  const membership = {
    id: 'membership-1', agency_id: 'agency-a', user_id: 'u1',
    membership_key: 'agency-a:u1', user_email_normalized: 'ada@example.invalid',
    tenant_role: 'agency_admin', status: 'active', version: 1, invitation_id: null,
    created_by_user_id: 'u1', last_transition_by_user_id: 'u1',
    last_transition_by_email_normalized: 'ada@example.invalid',
    last_transition_at: now, last_transition_reason: 'seeded',
    activated_at: now, revoked_at: null, revocation_reason: null,
  };
  const entities = {
    AgencyMembership: { filter: async () => [membership] },
    Agency: { filter: async () => [{ id: 'agency-a', agency_name: 'Synthetic A', status: 'active' }] },
    User: { list: async () => ROSTER_USERS.map(user => ({ ...user })) },
  };
  const handler = await loadOriginalHandler(
    new URL('../functions/generateUserRosterPDF/entry.ts', import.meta.url),
    () => ({
      auth: { me: async () => ({ id: 'u1', email: 'ada@example.invalid', is_active: true,
        role: 'user', account_type: 'agency_admin', agency_name: 'claimed-and-ignored' }) },
      asServiceRole: { entities },
    }));
  const surface = recorder();
  globalThis.__documentParity.surface = surface;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('logo unavailable'); };
  let response;
  try {
    response = await handler(new Request('https://example.test/', { method: 'POST' }));
  } finally { globalThis.fetch = realFetch; }
  assert.equal(response.status, 200, await response.clone().text().catch(() => ''));
  return { calls: surface.calls, response };
}

/**
 * The original's page with the Name column removed and the rest shifted.
 *
 * Scoped to the TABLE, which ends where the Summary block begins: the summary
 * draws `Total Users:` at x=15 and `LPN:` at x=250 — the same coordinates the
 * Name and Status columns use — so an x-only rule would delete the total and
 * move the LPN count. The summary and the footer are identical on both sides
 * and are carried through untouched.
 */
function withoutNameColumn(calls) {
  const summary = calls.findIndex(call => call[0] === 'text' && call[1] === 'Summary');
  assert.ok(summary > 0, 'the original should draw a summary block');
  const table = calls.slice(0, summary).flatMap(call => {
    if (call[0] !== 'text' || typeof call[2] !== 'number') return [call];
    const column = ROSTER_COLUMN_X.indexOf(call[2]);
    // A `text` at one of the six column x's is a header cell or a row cell.
    // The first column is the name and goes; the other five move left.
    if (column === 0) return [];
    if (column > 0) return [['text', call[1], call[2] - ROSTER_SHIFT, ...call.slice(3)]];
    return [call];
  });
  return [...table, ...calls.slice(summary)];
}

test('the roster report is the original s page minus the column that has no source', async () => {
  const { calls, response } = await runRosterOriginal();
  assert.equal(response.headers.get('content-type'), 'application/pdf');
  assert.match(response.headers.get('content-disposition'),
    new RegExp(rosterFilename(new Date().toISOString().split('T')[0])));
  const original = drawn(calls);
  assert.ok(original.length > 60, 'the original should have drawn a real document');
  // The entries the contract would supply for these four people. `tenant_role`
  // is set to the original's `role` and `is_approved` to its stored flag ONLY
  // so the geometry can be compared; that both values come from somewhere else
  // now is the point of the port and is asserted in its own test below.
  const entries = ROSTER_USERS.map(user => ({
    email: user.email, credential_type: user.credential_type,
    tenant_role: user.role, care_scope: user.care_scope, is_approved: user.is_approved,
  }));
  const summary = { total: 4, approved: 2, pending: 2, rn: 2, lpn: 1 };
  const surface = recorder();
  buildUserRoster(surface, { entries, summary }, { generatedOn: 'unused-without-a-logo' });
  assert.deepEqual(surface.calls, withoutNameColumn(original));
  // And the transform really removed something, so a mistake in it cannot make
  // the comparison vacuous: one header cell plus one per person.
  assert.equal(original.length - withoutNameColumn(original).length, ROSTER_USERS.length + 1);
  assert.equal(surface.calls.some(call => call[0] === 'text'
    && ROSTER_USERS.some(user => call[1] === user.full_name)), false, 'no name is drawn');
});

test('the roster report draws its logo, its subtitle and its scope labels as the original does', async () => {
  const { calls } = await runRosterOriginal();
  // Without a logo the original's catch branch draws the header and NO
  // subtitle, which is the branch compared above. With one, the subtitle
  // returns and carries the total.
  const withLogo = recorder();
  buildUserRoster(withLogo, { entries: [], summary: { total: 7, approved: 7, pending: 0, rn: 0, lpn: 0 } },
    { logoDataUrl: LOGO, generatedOn: '1/2/2026' });
  assert.deepEqual(withLogo.calls.find(call => call[0] === 'addImage'),
    ['addImage', LOGO, 'PNG', 15, 8, 20, 20]);
  assert.ok(withLogo.calls.some(call => call[0] === 'text'
    && call[1] === 'Generated: 1/2/2026 | Total Users: 7'));
  assert.equal(drawn(calls).some(call => call[0] === 'addImage'), false,
    'the original drew no image when its fetch failed');
  // The scope labels are the original's ternary, including its default.
  for (const [value, label] of [['home_health', 'Home Health'], ['hospice', 'Hospice'],
    ['both', 'Both'], [null, 'Not Set'], [undefined, 'Not Set'], ['invented', 'Not Set']]) {
    assert.equal(careScopeLabel(value), label);
  }
  // A roster with nobody in it still draws its summary rather than throwing.
  assert.ok(withLogo.calls.some(call => call[0] === 'text' && call[1] === 'Summary'));
  // And the document refuses to invent a day, like the two before it.
  for (const value of [undefined, null, '', 0]) {
    assert.throws(() => buildUserRoster(recorder(), { entries: [], summary: {} },
      { generatedOn: value }), TypeError);
  }
  assert.throws(() => buildUserRoster(recorder(), { entries: null, summary: {} },
    { generatedOn: 'x' }), TypeError);
  assert.throws(() => buildUserRoster(recorder(), { entries: [], summary: null },
    { generatedOn: 'x' }), TypeError);
});
