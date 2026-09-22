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
import {
  HANDOUT_COLOR_SCHEMES, HANDOUT_FONTS, HANDOUT_LAYOUTS, buildPatientHandout, handoutDate,
  handoutFilename, selectedHandoutSections,
} from '../../services/pennsync-api/document-patient-handout.mjs';
import {
  HANDOUT_CHECKLISTS, HANDOUT_RESOURCES, HANDOUT_TEMPLATES,
} from '../../services/pennsync-api/patient-handout-templates.mjs';
import { handoutRequest } from '../../services/pennsync-api/patient-handout.mjs';

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
    'setFontSize', 'setFont', 'text', 'setLineWidth', 'setDrawColor', 'setPage',
    'setProperties', 'circle', 'line', 'textWithLink']) {
    surface[name] = (...args) => { calls.push([name, ...args]); };
  }
  // A measurement the geometry depends on (the handout rules a line after a
  // subheading's measured width), so it answers a number both sides agree on.
  surface.getTextWidth = (text) => { calls.push(['getTextWidth', text]); return String(text).length * 1.75; };
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
    + `const Deno = { serve: capture, env: { get: (name) => globalThis.__documentParity.env?.[name] } };\n`;
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

/**
 * The patient education handout, the first ported document that takes a
 * request: twenty templates, five colour schemes, four layouts, three
 * typefaces, section and bullet selection, free-text notes and a footer. So
 * the original is driven with a JSON body, and the comparison runs across the
 * whole space the published client can reach rather than one default page.
 */
const HANDOUT_ENTRY = new URL('../functions/generatePatientHandout/entry.ts', import.meta.url);
const HANDOUT_PORT = new URL('../../services/pennsync-api/patient-handout-templates.mjs', import.meta.url);

async function runHandoutOriginal(handler, body, { logo = false, surface = recorder() } = {}) {
  globalThis.__documentParity.surface = surface;
  const realFetch = globalThis.fetch;
  const realError = console.error;
  globalThis.fetch = async () => {
    if (!logo) throw new Error('logo unavailable');
    return { blob: async () => ({ arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer }) };
  };
  // The original logs every caught failure; the failure tests cause some on
  // purpose, and what they assert is the document, not the log.
  console.error = () => {};
  let response;
  try {
    response = await handler(new Request('https://example.test/', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }));
  } finally { globalThis.fetch = realFetch; console.error = realError; }
  return { calls: surface.calls, status: response.status, answer: await response.json() };
}

/** The day the original stamped on its card: the text drawn after the label. */
function handoutDay(calls) {
  const label = calls.findIndex(call => call[0] === 'text' && call[1] === 'DATE PROVIDED');
  assert.ok(label > 0, 'the original should label the date');
  const stamped = calls.slice(label + 1).find(call => call[0] === 'text');
  assert.match(String(stamped[1]), /^[A-Z][a-z]+ \d{1,2}, \d{4}$/);
  return stamped[1];
}

/** Drive the port with what the original was sent, on the day it stamped. */
function portCalls(body, calls, { logoDataUrl = null, surface = recorder() } = {}) {
  buildPatientHandout(surface, handoutRequest(body), { logoDataUrl, generatedOn: handoutDay(calls) });
  return surface.calls;
}

test('every handout template is the original s source, byte for byte', async () => {
  // Retyping would be the transcription D12 settled against, and this text is
  // a patient's instructions. The block is compared as SOURCE, so a change to a
  // line nothing renders by default — a deselectable bullet, a resource URL —
  // fails here too.
  const block = (source) => {
    const start = source.indexOf('const interactiveResources = {');
    const templates = source.indexOf('const handoutTemplates = {');
    const end = source.indexOf('\n};\n', templates);
    assert.ok(start >= 0 && templates > start && end > templates, 'the template block should be found');
    return source.slice(start, end + 3);
  };
  const original = block(await readFile(HANDOUT_ENTRY, 'utf8'));
  const carried = block(await readFile(HANDOUT_PORT, 'utf8'));
  assert.equal(carried, original);
  assert.equal(Object.keys(HANDOUT_TEMPLATES).length, 20);
});

test('generatePatientHandout is ported call for call, for every condition', async () => {
  const handler = await loadOriginalHandler(HANDOUT_ENTRY);
  for (const condition of Object.keys(HANDOUT_TEMPLATES)) {
    const body = { condition, action: 'download' };
    const { calls, status, answer } = await runHandoutOriginal(handler, body);
    assert.equal(status, 200, condition);
    const original = drawn(calls);
    assert.deepEqual(portCalls(body, original), original, condition);
    assert.ok(original.length > 150, `${condition} should draw a real document`);
    // The answer beside the bytes is the original's too.
    const template = HANDOUT_TEMPLATES[condition];
    assert.equal(answer.filename, handoutFilename(condition));
    assert.deepEqual(answer.diagnostics, { stage: 'complete',
      sectionsProcessed: selectedHandoutSections(template, undefined).length,
      totalSections: template.sections.length });
  }
});

/** Every branch a section, and the page after the sections, can take. */
const HANDOUT_BRANCHES = ['highlight', 'paragraph', 'bullets', 'subsections', 'emergency', 'important',
  'checklist', 'resources'];

/** The branches a condition reaches once a selection has been applied. */
function reachedBranches(condition, selectedSections) {
  const reached = new Set();
  for (const section of selectedHandoutSections(HANDOUT_TEMPLATES[condition], selectedSections)) {
    if (section.content) reached.add(section.highlight ? 'highlight' : 'paragraph');
    if (section.subsections) reached.add('subsections');
    if (section.emergency) reached.add('emergency');
    else if (section.important) reached.add('important');
    else if (Array.isArray(section.bullets)) reached.add('bullets');
  }
  if (HANDOUT_CHECKLISTS[condition]) reached.add('checklist');
  if (HANDOUT_RESOURCES[condition]) reached.add('resources');
  return reached;
}

test('generatePatientHandout is ported call for call, for every style the client offers', async () => {
  const handler = await loadOriginalHandler(HANDOUT_ENTRY);
  // No single condition reaches every branch, so three do between them — and
  // that is ASSERTED below from the templates rather than claimed here, since
  // a selection that happened to drop the only important section would leave
  // the style matrix never drawing one.
  const conditions = ['copd_oxygen', 'ckd', 'chf'];
  const selectionFor = (condition) => {
    const ordinary = HANDOUT_TEMPLATES[condition].sections
      .filter(section => Array.isArray(section.bullets) && !section.emergency && !section.important);
    assert.ok(ordinary.length >= 2, `${condition} needs two ordinary sections to select from`);
    // One section thinned, with a hole where the client's toggle never touched
    // an index (as JSON sends it), and another dropped.
    return {
      [ordinary[0].heading]: { included: true, bullets: [true, false, null, false] },
      [ordinary.at(-1).heading]: { included: false },
    };
  };
  const reached = new Set(conditions.flatMap(condition => [...reachedBranches(condition, selectionFor(condition))]));
  assert.deepEqual([...reached].sort(), [...HANDOUT_BRANCHES].sort());
  let compared = 0;
  for (const condition of conditions) {
    const selectedSections = selectionFor(condition);
    for (const colorScheme of Object.keys(HANDOUT_COLOR_SCHEMES)) {
      for (const layout of Object.keys(HANDOUT_LAYOUTS)) {
        for (const fontFamily of HANDOUT_FONTS) {
          const body = {
            condition, action: 'download',
            patientName: 'José Núñez-O’Brien',
            customNotes: `Walk twice a day. ${'Keep the tubing clear. '.repeat(6)}`,
            selectedSections, readingLevel: '5th-6th', format: 'comprehensive',
            styleOptions: { colorScheme, fontFamily, layout, customHeader: 'Never drawn',
              customFooter: 'Synthetic footer', agencyName: 'Synthetic Home Health', agencyPhone: '555-0100' },
          };
          const { calls, answer } = await runHandoutOriginal(handler, body);
          const original = drawn(calls);
          assert.deepEqual(portCalls(body, original), original, `${condition} ${colorScheme}/${layout}/${fontFamily}`);
          assert.equal(answer.diagnostics.sectionsProcessed, HANDOUT_TEMPLATES[condition].sections.length - 1);
          // The deselected bullet is really absent, so the selection was applied.
          const thinned = HANDOUT_TEMPLATES[condition].sections.find(section =>
            section.heading === Object.keys(selectedSections)[0]);
          assert.equal(original.some(call => call[0] === 'splitTextToSize' && call[1] === thinned.bullets[1]), false);
          compared += 1;
        }
      }
    }
  }
  assert.equal(compared, 180);
  // The defaults: an empty form, and no style at all.
  for (const styleOptions of [{ colorScheme: '', fontFamily: '', layout: '', customHeader: '',
    customFooter: '', agencyName: '', agencyPhone: '' }, null, undefined]) {
    const body = { condition: 'wound_care', patientName: null, customNotes: null, selectedSections: null, styleOptions };
    const { calls } = await runHandoutOriginal(handler, body);
    const original = drawn(calls);
    assert.deepEqual(portCalls(body, original), original);
    assert.ok(original.some(call => call[0] === 'text' && call[1] === 'PennSync'), 'the default agency is drawn');
  }
});

test('the handout draws its logo on every page when one is configured', async () => {
  const handler = await loadOriginalHandler(HANDOUT_ENTRY);
  const body = { condition: 'dementia_care', action: 'download' };
  const { calls } = await runHandoutOriginal(handler, body, { logo: true });
  const original = drawn(calls);
  const images = original.flatMap((call, index) => call[0] === 'addImage' ? [index] : []);
  // One banner per page, so a multi-page guide carries the logo more than once.
  assert.ok(images.length > 1, 'the original should paint the logo on every page');
  for (const index of images) {
    assert.match(String(original[index][1]), /^data:image\/png;base64,/);
    assert.deepEqual(original[index].slice(2), ['PNG', 18, 5.5, 40, 15]);
    original[index] = ['addImage', LOGO, ...original[index].slice(2)];
  }
  assert.deepEqual(portCalls(body, original, { logoDataUrl: LOGO }), original);
});

test('a block that fails mid-render leaves the same marks in both', async () => {
  // The original catches per block — a section, a subsection, the nurse's
  // notes, the checklist, the tracker, the links — and the catches differ: a
  // failed section leaves a red "[Could not render: …]" line, a failed
  // subsection skips to the next, and the rest drop their block and carry on.
  // Both sides are handed a surface that fails while drawing the SAME line.
  //
  // A failure is chosen by the line it hits rather than by counting calls,
  // and what each case asserts after the comparison is that the ORIGINAL took
  // the branch that line was chosen for. A first draft counted calls, and its
  // comment named four blocks while every failure landed in a section catch —
  // an injected failure in the wrong place still compares equal, so only the
  // branch checks make this test about the branches.
  const failingOn = (lines) => {
    const surface = recorder();
    for (const name of ['text', 'textWithLink']) {
      const record = surface[name];
      surface[name] = (...args) => {
        record(...args);
        if (lines.includes(args[0])) throw new Error(`synthetic failure drawing ${args[0]}`);
      };
    }
    return surface;
  };
  const handler = await loadOriginalHandler(HANDOUT_ENTRY);
  const drewText = (calls, line) => calls.some(call => call[0] === 'text' && call[1] === line);
  const cases = [
    {
      condition: 'copd_oxygen',
      lines: ['Takes oxygen from room air', 'Wear during sleep if prescribed',
        'Special Instructions from Your Nurse', 'Daily Symptom Tracker'],
      branches(calls) {
        // The subsection catch: the rest of that subsection is gone, the next
        // subsection still prints, and the section is NOT marked failed.
        assert.equal(drewText(calls, 'Most common for home use'), false);
        assert.ok(drewText(calls, 'Portable Oxygen Concentrator (POC)'));
        assert.equal(drewText(calls, '[Could not render: Types of Oxygen Equipment]'), false);
        // The section catch: marked, and the section's next bullet is gone.
        assert.ok(drewText(calls, '[Could not render: Daily Oxygen Use]'));
        assert.equal(drewText(calls, 'Use during activities and exercise'), false);
        assert.ok(drewText(calls, 'Contact oxygen supplier 2 weeks before travel'), 'the next section prints');
        // The notes and the tracker drop their blocks.
        assert.equal(drewText(calls, 'A synthetic note.'), false);
        assert.equal(drewText(calls, 'Record daily symptoms and bring this log to your appointments.'), false);
      },
    },
    {
      condition: 'chf',
      lines: ['Daily Self-Care Checklist', 'Heart Failure Society Patient Resources'],
      branches(calls) {
        assert.equal(drewText(calls, 'I weigh myself daily at the same time'), false);
        assert.equal(drewText(calls, 'Check off each item as you complete it daily.'), false);
        // The tracker between them is untouched.
        assert.ok(drewText(calls, 'Record daily symptoms and bring this log to your appointments.'));
        assert.equal(calls.some(call => call[0] === 'textWithLink'
          && call[1] === 'American Heart Association - Heart Failure'), false);
        assert.equal(drewText(calls, 'Tap the blue links above to visit these trusted websites.'), false);
        assert.ok(drewText(calls, 'A synthetic note.'), 'the notes print');
      },
    },
  ];
  for (const { condition, lines, branches } of cases) {
    // Not the default typeface: the original draws its failure marker in
    // Helvetica whatever the document's face, and under the default the two
    // are the same, so a port that followed the document instead would pass.
    const body = { condition, customNotes: 'A synthetic note.',
      styleOptions: { colorScheme: 'serene_green', fontFamily: 'times', layout: 'large_print' } };
    const { calls, status } = await runHandoutOriginal(handler, body, { surface: failingOn(lines) });
    assert.equal(status, 200);
    const original = drawn(calls);
    assert.deepEqual(portCalls(body, original, { surface: failingOn(lines) }), original, condition);
    branches(original);
    // Every chosen line really was reached, so none of the failures is idle.
    for (const line of lines) {
      assert.ok(original.some(call => ['text', 'textWithLink'].includes(call[0]) && call[1] === line), line);
    }
  }
});

test('the email action is refused with the answer the original gives while delivery is paused', async () => {
  const handler = await loadOriginalHandler(HANDOUT_ENTRY);
  const refusal = (body) => {
    try { handoutRequest(body); } catch (error) { return { status: error.status, code: error.code }; }
    return null;
  };
  // Without an address the original asks for one, before anything else.
  let run = await runHandoutOriginal(handler, { condition: 'chf', action: 'email' });
  assert.equal(run.status, 400);
  assert.equal(run.answer.error, 'patientEmail is required to email the handout');
  assert.deepEqual(refusal({ condition: 'chf', action: 'email' }), { status: 400, code: 'PATIENT_EMAIL_REQUIRED' });
  // With one, and `OUTBOUND_DELIVERY_RELEASE` unset, it refuses by code — and
  // draws nothing, so the refusal really is before the work.
  run = await runHandoutOriginal(handler, { condition: 'chf', action: 'email', patientEmail: 'p@example.invalid' });
  assert.equal(run.status, 503);
  assert.equal(run.answer.code, 'OUTBOUND_DELIVERY_RELEASE_PAUSED');
  assert.equal(run.answer.retryable, false);
  assert.deepEqual(run.calls, []);
  assert.deepEqual(refusal({ condition: 'chf', action: 'email', patientEmail: 'p@example.invalid' }),
    { status: 503, code: 'OUTBOUND_DELIVERY_RELEASE_PAUSED' });
  // A style the port would refuse does not outrank the paused send, in either.
  assert.deepEqual(refusal({ condition: 'chf', action: 'email', patientEmail: 'p@example.invalid',
    styleOptions: { colorScheme: 'invented' } }), { status: 503, code: 'OUTBOUND_DELIVERY_RELEASE_PAUSED' });
  // The original's own condition checks come first, and keep their order.
  assert.deepEqual(refusal({ action: 'email' }), { status: 400, code: 'CONDITION_REQUIRED' });
  run = await runHandoutOriginal(handler, { action: 'email' });
  assert.equal(run.answer.error, 'Condition is required');
});

test('the three narrowings are inputs the original really could not render', async () => {
  // Driven through the original rather than read from it (D69), because each
  // one is a claim about what the original DID.
  const handler = await loadOriginalHandler(HANDOUT_ENTRY);
  const refused = (body) => {
    try { handoutRequest(body); } catch (error) { return error.code; }
    return null;
  };
  // An unknown scheme threw on the first fill, and the catch answered SUCCESS
  // with a generic page the client downloads as though it were the guide.
  let run = await runHandoutOriginal(handler, { condition: 'chf', styleOptions: { colorScheme: 'invented' } });
  assert.equal(run.status, 200);
  assert.equal(run.answer.success, true);
  assert.equal(run.answer.filename, 'education_guide.pdf');
  assert.ok(run.calls.some(call => call[0] === 'text' && call[1] === 'We could not generate the full guide right now.'));
  assert.equal(refused({ condition: 'chf', styleOptions: { colorScheme: 'invented' } }), 'INVALID_STYLE_OPTIONS');
  // An inherited name passed the template check and drew a page with no title
  // and no sections, under the inherited name.
  run = await runHandoutOriginal(handler, { condition: 'constructor' });
  assert.equal(run.status, 200);
  assert.equal(run.answer.filename, 'constructor_handout.pdf');
  assert.equal(run.answer.diagnostics.totalSections, 0);
  assert.equal(refused({ condition: 'constructor' }), 'INVALID_CONDITION');
  // An object where text belongs was printed on the patient's handout.
  run = await runHandoutOriginal(handler, { condition: 'chf', patientName: { first: 'Ada' } });
  assert.ok(run.calls.some(call => call[0] === 'text' && call[1] === '[object Object]'));
  assert.equal(refused({ condition: 'chf', patientName: { first: 'Ada' } }), 'INVALID_PARAMS');
  // And the published client's own request passes all three.
  assert.equal(refused({ condition: 'chf', patientName: 'Jane Doe', action: 'download', selectedSections: null,
    customNotes: null, readingLevel: '5th-6th', format: 'comprehensive',
    styleOptions: { colorScheme: 'penn_health', fontFamily: 'helvetica', layout: 'standard',
      customHeader: '', customFooter: '', agencyName: '', agencyPhone: '' } }), null);
});

test('the handout refuses to invent a day, and names the one it is given', () => {
  for (const value of [undefined, null, '', 0, new Date()]) {
    assert.throws(() => buildPatientHandout(recorder(), { condition: 'chf' }, { generatedOn: value }), TypeError);
  }
  // The original's format, from a supplied instant rather than the clock.
  assert.equal(handoutDate(new Date('2026-09-22T12:00:00Z')), 'September 22, 2026');
});
