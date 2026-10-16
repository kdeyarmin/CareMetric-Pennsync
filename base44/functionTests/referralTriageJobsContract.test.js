// Runs the real referralTriageJobs entry.ts against an in-memory Base44, a
// pdf-lib stand-in and a stand-in for the Anthropic Messages API, the way
// esignRuntimeHarness.js runs the e-signature functions. No network.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const AGENCY = 'agency-a';
const PATIENT_NAME = 'Zelda Quartermaine';
const SIGNED_HOST = 'https://storage.test/signed/';

const clone = (value) => (value === undefined ? undefined : structuredClone(value));
const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function matchValue(actual, expected) {
  if (expected === null || expected === undefined) return actual === null || actual === undefined;
  if (expected && typeof expected === 'object' && !Array.isArray(expected) && Object.hasOwn(expected, '$in')) {
    return expected.$in.some((value) => sameJson(value, actual));
  }
  return sameJson(actual, expected);
}
const matches = (row, query) => Object.entries(query || {}).every(([key, value]) => matchValue(row[key], value));

// ---- pdf-lib stand-in -----------------------------------------------------
// A "PDF" is text: `%PDF-1.7 PAGES:n` for a source, and the saved range
// carries `RANGE:a-b` so the fake model can tell which pages it was handed.
// `bytesPerPage` lets a test make ranges heavy enough to be narrowed.
function fakePdfLib({ bytesPerPage = 10 } = {}) {
  class FakePDFDocument {
    constructor(pages, first = 1) {
      this.pages = Array.from({ length: pages }, (_, index) => ({ number: first + index }));
    }
    static async load(bytes) {
      const text = new TextDecoder().decode(bytes);
      if (!text.startsWith('%PDF-')) throw new Error('No PDF header');
      if (text.includes('/Encrypt')) {
        const error = new Error('Input document to `PDFDocument.load` is encrypted.');
        error.name = 'EncryptedPDFError';
        throw error;
      }
      return new FakePDFDocument(Number((text.match(/PAGES:(\d+)/) || [])[1] || 1));
    }
    static async create() { return new FakePDFDocument(0); }
    getPageCount() { return this.pages.length; }
    async copyPages(source, indices) { return indices.map((index) => source.pages[index]); }
    addPage(page) { this.pages.push(page); }
    async save() {
      const first = this.pages[0]?.number;
      const last = this.pages.at(-1)?.number;
      const head = `%PDF-1.7 PAGES:${this.pages.length} RANGE:${first}-${last} `;
      return new TextEncoder().encode(head.padEnd(head.length + this.pages.length * bytesPerPage, '.'));
    }
  }
  return { PDFDocument: FakePDFDocument };
}

// ---- Anthropic stand-in -----------------------------------------------------
function fakeModel({ failRanges = new Set(), analysis } = {}) {
  const calls = [];
  async function answer(body) {
    const content = body.messages[0].content;
    const document = content.find((block) => block.type === 'document');
    const prompt = content.find((block) => block.type === 'text').text;
    if (document) {
      const pdf = Buffer.from(document.source.data, 'base64').toString('utf8');
      const range = (pdf.match(/RANGE:(\d+-\d+)/) || [])[1];
      calls.push({ kind: 'pages', range, prompt });
      if (failRanges.has(range)) return new Response('{}', { status: 500 });
      return reply(`Patient: ${PATIENT_NAME} (p. ${range.split('-')[0]}). Notes for pages ${range}.`);
    }
    calls.push({ kind: 'summary', prompt });
    return reply(JSON.stringify(analysis ?? {
      patient_name: PATIENT_NAME,
      date_of_birth: '1940-01-02',
      primary_diagnosis: 'CHF',
      clinical_summary: 'Discharged after CHF exacerbation.',
      data_gaps: [],
      face_to_face_date: '2026-09-01',
      start_of_care_date: '2026-09-20',
      diagnosis_coding_review: {
        documented_primary: 'I50.9 heart failure',
        ordering_assessment: 'The documented primary is affirmed.',
        codes: [{
          code: 'I50.9', description: 'Heart failure, unspecified', position: 1,
          pdgm_role: 'primary_clinical_grouping',
          justification: 'The condition the nursing plan treats.',
          documentation_support: 'Discharge summary in the notes.',
          specificity_flag: null, suggested_more_specific: null, conflict: null,
        }],
        candidates: [],
        documentation_needs: [],
      },
      medicare_compliance: {
        homebound_status: { status: 'satisfied', evidence: 'Documented in the notes.' },
        referral_order: { status: 'missing', evidence: 'No order in the packet.' },
        // The rest are omitted on purpose: the stored checklist must still
        // carry all eight elements, and face-to-face timing must be computed
        // from the dates (19 days before the start of care = satisfied).
      },
    }));
  }
  const reply = (text) => new Response(JSON.stringify({
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 1, output_tokens: 1 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  return { calls, answer };
}

// ---- in-memory Base44 ---------------------------------------------------------
function createRuntime({ env = {}, pdfLib = fakePdfLib(), model = fakeModel(), files = {} } = {}) {
  const db = { ReferralTriageJob: [], Notification: [], AgencyMembership: [], Agency: [] };
  const users = new Map();
  const emails = [];
  const storage = new Map(Object.entries(files));
  let sequence = 0;
  const stamp = () => new Date(Date.now() + sequence).toISOString();

  function entity(name) {
    return {
      filter: async (query, sort, limit) => {
        assert.ok(Number.isInteger(limit), `${name}.filter needs a limit`);
        const rows = db[name].filter((row) => matches(row, query));
        if (sort) {
          const key = sort.replace(/^-/, '');
          rows.sort((a, b) => String(a[key]).localeCompare(String(b[key])) * (sort.startsWith('-') ? -1 : 1));
        }
        return clone(rows.slice(0, limit));
      },
      create: async (data) => {
        sequence += 1;
        const row = { id: `${name}-${sequence}`, created_date: stamp(), updated_date: stamp(), ...clone(data) };
        db[name].push(row);
        return clone(row);
      },
      updateMany: async (query, update) => {
        const hits = db[name].filter((row) => matches(row, query));
        for (const row of hits) {
          Object.assign(row, clone(update.$set || {}));
          for (const [key, by] of Object.entries(update.$inc || {})) row[key] = (row[key] || 0) + by;
          row.updated_date = stamp();
        }
        return { success: true, updated: hits.length, has_more: false };
      },
    };
  }
  const entities = Object.fromEntries(Object.keys(db).map((name) => [name, entity(name)]));
  const integrations = {
    Core: {
      CreateFileSignedUrl: async ({ file_uri }) => ({ signed_url: `${SIGNED_HOST}${encodeURIComponent(file_uri)}` }),
      SendEmail: async (message) => { emails.push(message); return { success: true }; },
    },
  };

  const fetch = async (url, init = {}) => {
    if (String(url).startsWith(SIGNED_HOST)) {
      const bytes = storage.get(decodeURIComponent(String(url).slice(SIGNED_HOST.length)));
      return bytes ? new Response(bytes, { status: 200 }) : new Response('', { status: 404 });
    }
    if (url === 'https://api.anthropic.com/v1/messages') return model.answer(JSON.parse(init.body));
    throw new Error(`unexpected fetch ${url}`);
  };
  const environment = { ANTHROPIC_API_KEY: 'test-key', INTERNAL_FN_SECRET: 'scheduler-secret', ...env };
  const Deno = { env: { get: (key) => environment[key] }, serve: () => {} };

  let handler;
  async function load() {
    if (handler) return handler;
    let source = await readFile(new URL('../functions/referralTriageJobs/entry.ts', import.meta.url), 'utf8');
    const binding = `__referralTriageHarness_${Math.random().toString(36).slice(2)}`;
    globalThis[binding] = {
      createClientFromRequest: (req) => ({
        auth: { me: async () => clone(users.get(String(req.headers.get('Authorization') || '').replace(/^Bearer /, '')) ?? null) },
        asServiceRole: { entities, integrations },
      }),
      Deno: { ...Deno, serve: (candidate) => { handler = candidate; } },
      fetch,
      pdfLib,
    };
    source = source
      .replace(/import \{ createClientFromRequest \} from 'npm:[^']+';/,
        `const createClientFromRequest = globalThis.${binding}.createClientFromRequest; `
        + `const Deno = globalThis.${binding}.Deno; const fetch = globalThis.${binding}.fetch;`)
      .replace(/import \{ PDFDocument \} from 'npm:pdf-lib@[^']+';/, `const { PDFDocument } = globalThis.${binding}.pdfLib;`);
    assert.doesNotMatch(source, /^import /m, 'the harness provides every import');
    const compiled = transpileTs(source, { fileName: 'referralTriageJobs/entry.ts' }).outputText;
    await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}#${binding}`);
    assert.ok(handler, 'entry registered a handler');
    return handler;
  }

  async function call({ user = null, body, headers = {} } = {}) {
    const run = await load();
    const requestHeaders = new Headers({ 'Content-Type': 'application/json', ...headers });
    if (user) requestHeaders.set('Authorization', `Bearer ${user}`);
    const response = await run(new Request('https://functions.test/referralTriageJobs', {
      method: 'POST', headers: requestHeaders, body: JSON.stringify(body ?? {}),
    }));
    return { status: response.status, data: await response.json().catch(() => null) };
  }

  function addIntakeUser(key, { role = 'office_staff', status = 'active' } = {}) {
    users.set(key, { id: key, email: `${key}@agency.test`, role: 'user', is_active: true });
    db.AgencyMembership.push({
      id: `membership-${key}`, agency_id: AGENCY, user_id: key, user_email_normalized: `${key}@agency.test`,
      status, tenant_role: role, version: 3,
    });
  }

  db.Agency.push({ id: AGENCY, status: 'active' });
  return { db, emails, storage, model, call, addIntakeUser };
}

const packet = (pages, extra = '') => new TextEncoder().encode(`%PDF-1.7 PAGES:${pages} ${extra}`);
const startBody = (overrides = {}) => ({
  action: 'start', agency_id: AGENCY, client_request_id: 'req-1',
  file_uri: 'private/694ec16e72e01b60d22f7cbf/packet.pdf', file_name: 'Zelda Q referral.pdf', ...overrides,
});

test('start plans the packet into page ranges for the uploader only', async () => {
  const runtime = createRuntime({ files: { 'private/694ec16e72e01b60d22f7cbf/packet.pdf': packet(40) } });
  runtime.addIntakeUser('nurse');

  const started = await runtime.call({ user: 'nurse', body: startBody() });
  assert.equal(started.status, 200);
  assert.equal(started.data.job.status, 'queued');
  assert.equal(started.data.job.page_count, 40);
  assert.equal(started.data.job.part_count, 3);
  const [job] = runtime.db.ReferralTriageJob;
  assert.deepEqual(job.chunks.map((chunk) => [chunk.start_page, chunk.end_page]), [[1, 15], [16, 30], [31, 40]]);
  assert.equal(job.created_by_user_id, 'nurse');
  assert.equal(job.created_by_membership_version, 3);

  // A retried start answers the same job.
  const again = await runtime.call({ user: 'nurse', body: startBody() });
  assert.equal(again.data.job.id, started.data.job.id);
  assert.equal(runtime.db.ReferralTriageJob.length, 1);

  // Nobody else can read it.
  runtime.addIntakeUser('colleague');
  const peek = await runtime.call({ user: 'colleague', body: { action: 'get', agency_id: AGENCY, job_id: job.id } });
  assert.equal(peek.status, 404);
  const list = await runtime.call({ user: 'colleague', body: { action: 'list', agency_id: AGENCY } });
  assert.deepEqual(list.data.jobs, []);
});

test('start refuses callers without intake access and files that are not private PDFs', async () => {
  const runtime = createRuntime({
    files: {
      'private/694ec16e72e01b60d22f7cbf/packet.pdf': packet(250),
      'private/694ec16e72e01b60d22f7cbf/locked.pdf': packet(3, '/Encrypt'),
      'private/694ec16e72e01b60d22f7cbf/note.txt': new TextEncoder().encode('hello'),
    },
  });
  runtime.addIntakeUser('nurse');
  runtime.addIntakeUser('clinician', { role: 'clinician' });

  assert.equal((await runtime.call({ body: startBody() })).status, 401);
  assert.equal((await runtime.call({ user: 'clinician', body: startBody() })).status, 403);
  const publicFile = await runtime.call({ user: 'nurse', body: startBody({ file_uri: 'https://example.com/packet.pdf' }) });
  assert.equal(publicFile.status, 400);
  const tooLong = await runtime.call({ user: 'nurse', body: startBody() });
  assert.equal(tooLong.data.code, 'TOO_MANY_PAGES');
  const locked = await runtime.call({ user: 'nurse', body: startBody({ client_request_id: 'r2', file_uri: 'private/694ec16e72e01b60d22f7cbf/locked.pdf' }) });
  assert.equal(locked.data.code, 'PDF_ENCRYPTED');
  const text = await runtime.call({ user: 'nurse', body: startBody({ client_request_id: 'r3', file_uri: 'private/694ec16e72e01b60d22f7cbf/note.txt' }) });
  assert.equal(text.data.code, 'NOT_A_PDF');
  assert.equal(runtime.db.ReferralTriageJob.length, 0);
});

test('a range heavier than the model file limit is narrowed until it fits', async () => {
  // Each page weighs 1 MB, so 15 pages (15 MB) cannot go in one call.
  const runtime = createRuntime({
    pdfLib: fakePdfLib({ bytesPerPage: 1024 * 1024 }),
    files: { 'private/694ec16e72e01b60d22f7cbf/packet.pdf': packet(20) },
  });
  runtime.addIntakeUser('nurse');
  assert.equal((await runtime.call({ user: 'nurse', body: startBody() })).status, 200);
  const ranges = runtime.db.ReferralTriageJob[0].chunks.map((chunk) => [chunk.start_page, chunk.end_page]);
  assert.equal(ranges[0][0], 1);
  assert.equal(ranges.at(-1)[1], 20);
  for (let index = 1; index < ranges.length; index += 1) assert.equal(ranges[index][0], ranges[index - 1][1] + 1);
  for (const [start, end] of ranges) assert.ok(end - start + 1 <= 7, `${start}-${end} fits under 7 MB`);
});

test('process reads every range as a PDF, writes the triage, and notifies the uploader without PHI', async () => {
  const model = fakeModel();
  const runtime = createRuntime({
    model,
    env: { OUTBOUND_DELIVERY_RELEASE: 'enabled-v1', APP_PUBLIC_URL: 'https://app.pennsync.test' },
    files: { 'private/694ec16e72e01b60d22f7cbf/packet.pdf': packet(40) },
  });
  runtime.addIntakeUser('nurse');
  const { data: { job } } = await runtime.call({ user: 'nurse', body: startBody() });

  const processed = await runtime.call({ user: 'nurse', body: { action: 'process', agency_id: AGENCY, job_id: job.id } });
  assert.equal(processed.status, 200);
  assert.equal(processed.data.job.status, 'ready');
  // D234: no urgency level anywhere — not on the job view, not on the stored
  // row, not in the analysis. The patient name rides the view instead, so
  // the packets list can label the packet by name.
  assert.equal('urgency_level' in processed.data.job, false);
  assert.equal(runtime.db.ReferralTriageJob[0].urgency_level, undefined);
  assert.equal('urgency_level' in processed.data.job.analysis, false);
  assert.equal('urgency_reason' in processed.data.job.analysis, false);
  assert.equal(processed.data.job.patient_name, PATIENT_NAME);
  assert.equal(processed.data.job.analysis.patient_name, PATIENT_NAME);
  assert.equal(processed.data.job.pages_read, 40);

  // The D234 review sections are stored with the analysis: the coding review
  // keeps its justification, and the compliance checklist carries all eight
  // elements — omitted ones filled as missing, F2F timing computed.
  const stored = processed.data.job.analysis;
  assert.equal(stored.diagnosis_coding_review.codes[0].code, 'I50.9');
  assert.match(stored.diagnosis_coding_review.codes[0].justification, /nursing plan/);
  assert.deepEqual(Object.keys(stored.medicare_compliance).sort(), [
    'certifying_provider', 'diagnoses_valid', 'face_to_face_documented', 'face_to_face_timing',
    'homebound_status', 'plan_of_care_elements', 'referral_order', 'skilled_need',
  ]);
  assert.equal(stored.medicare_compliance.face_to_face_timing.status, 'satisfied');
  assert.match(stored.medicare_compliance.face_to_face_timing.evidence, /19 days before/);
  assert.equal(stored.medicare_compliance.skilled_need.status, 'missing');
  assert.equal(stored.medicare_compliance.referral_order.status, 'missing');

  // The list view labels by patient name and carries no urgency either.
  const listed = await runtime.call({ user: 'nurse', body: { action: 'list', agency_id: AGENCY } });
  assert.equal(listed.data.jobs[0].patient_name, PATIENT_NAME);
  assert.equal('urgency_level' in listed.data.jobs[0], false);

  // Each range went to the model as its own PDF, then one summary call.
  assert.deepEqual(model.calls.filter((c) => c.kind === 'pages').map((c) => c.range).sort(), ['1-15', '16-30', '31-40']);
  const summary = model.calls.find((c) => c.kind === 'summary');
  assert.match(summary.prompt, /Notes for pages 16-30/);
  assert.match(summary.prompt, /40-page referral packet/);

  // One notice, with the recipient envelope, and no patient detail.
  assert.equal(runtime.db.Notification.length, 1);
  const [notice] = runtime.db.Notification;
  assert.deepEqual(
    [notice.agency_id, notice.recipient_user_id, notice.recipient_membership_id, notice.recipient_membership_version,
      notice.authority_version, notice.authority_state, notice.user_email, notice.type],
    [AGENCY, 'nurse', 'membership-nurse', 3, 1, 'active', 'nurse@agency.test', 'report_ready'],
  );
  assert.equal(notice.action_url, `/ReferralTriage?job=${encodeURIComponent(job.id)}`);
  // The completion notice's priority is the flat delivery constant now —
  // it used to be derived from the job's urgency level (D234).
  assert.equal(notice.priority, 'medium');
  assert.doesNotMatch(notice.message, /urgency/i);
  assert.equal(runtime.emails.length, 1);
  assert.equal(runtime.emails[0].to, 'nurse@agency.test');
  assert.match(runtime.emails[0].body, /https:\/\/app\.pennsync\.test\/ReferralTriage\?job=/);
  for (const phi of [PATIENT_NAME, 'Zelda', 'CHF', '1940']) {
    assert.equal(JSON.stringify(notice).includes(phi), false, `notice leaks ${phi}`);
    assert.equal(JSON.stringify(runtime.emails[0]).includes(phi), false, `email leaks ${phi}`);
  }
  assert.equal(runtime.db.ReferralTriageJob[0].email_state, 'sent');

  // A finished job is answered, not re-run.
  const again = await runtime.call({ user: 'nurse', body: { action: 'process', agency_id: AGENCY, job_id: job.id } });
  assert.equal(again.data.job.status, 'ready');
  assert.equal(model.calls.length, 4);
  assert.equal(runtime.db.Notification.length, 1);
});

test('a model answer carrying urgency fields, a document MRN and an SSN is stored without them', async () => {
  // The chunk notes quote the packet verbatim, so a synthesis answer can
  // echo the sending facility's MRN or an SSN into a summary field. The
  // stored analysis is the choke point (D233 + D234): urgency keys are
  // dropped, MRN mentions and SSN-shaped strings are masked, and an MRN
  // key never survives at any depth.
  const model = fakeModel({
    analysis: {
      patient_name: PATIENT_NAME,
      date_of_birth: '1940-01-02',
      primary_diagnosis: 'CHF',
      urgency_level: 'CRITICAL',
      urgency_reason: 'Readmission risk',
      clinical_summary: 'SSN 123-45-6789 appears on the face sheet; facility MRN 13383.',
      medical_record_number: '13383',
      data_gaps: [],
      admission_notes: 'Call about MRN: 13383 before the visit.',
    },
  });
  const runtime = createRuntime({
    model,
    files: { 'private/694ec16e72e01b60d22f7cbf/packet.pdf': packet(10) },
  });
  runtime.addIntakeUser('nurse');
  const { data: { job } } = await runtime.call({ user: 'nurse', body: startBody() });
  const processed = await runtime.call({ user: 'nurse', body: { action: 'process', agency_id: AGENCY, job_id: job.id } });
  assert.equal(processed.data.job.status, 'ready');
  const analysis = processed.data.job.analysis;
  assert.equal('urgency_level' in analysis, false);
  assert.equal('urgency_reason' in analysis, false);
  assert.equal('medical_record_number' in analysis, false);
  const storedJson = JSON.stringify(analysis);
  assert.equal(storedJson.includes('13383'), false, 'the document MRN is stored nowhere');
  assert.equal(storedJson.includes('123-45-6789'), false, 'the SSN is stored nowhere');
  assert.match(analysis.clinical_summary, /\[redacted\]/);
  assert.match(analysis.admission_notes, /MRN \[not recorded\]/);
  // A review the model omitted degrades to an absent key, not a failure:
  // the job still completes and the surface reports the review's own status.
  assert.equal('diagnosis_coding_review' in analysis, false);
  assert.equal(Object.keys(analysis.medicare_compliance).length, 8);
});

test('a range that keeps failing is reported as unread, and the email waits for the delivery release', async () => {
  const model = fakeModel({ failRanges: new Set(['16-30']) });
  const runtime = createRuntime({ model, files: { 'private/694ec16e72e01b60d22f7cbf/packet.pdf': packet(40) } });
  runtime.addIntakeUser('nurse');
  const { data: { job } } = await runtime.call({ user: 'nurse', body: startBody() });
  const process = () => runtime.call({ user: 'nurse', body: { action: 'process', agency_id: AGENCY, job_id: job.id } });

  let result = await process();
  assert.equal(result.data.job.status, 'processing');
  assert.equal(result.data.job.parts_done, 2);
  result = await process();
  assert.equal(result.data.job.status, 'processing');
  result = await process();
  assert.equal(result.data.job.status, 'ready');
  assert.deepEqual(result.data.job.unread_pages, [{ start_page: 16, end_page: 30 }]);
  assert.match(model.calls.find((c) => c.kind === 'summary').prompt, /Pages 16-30 could not be read/);
  assert.equal(runtime.emails.length, 0);
  assert.equal(runtime.db.ReferralTriageJob[0].email_state, 'paused');
  assert.equal(runtime.db.Notification.length, 1);
});

test('a job held by another run is not read twice', async () => {
  const model = fakeModel();
  const runtime = createRuntime({ model, files: { 'private/694ec16e72e01b60d22f7cbf/packet.pdf': packet(10) } });
  runtime.addIntakeUser('nurse');
  const { data: { job } } = await runtime.call({ user: 'nurse', body: startBody() });
  Object.assign(runtime.db.ReferralTriageJob[0], { claimed_by: 'other-run', claimed_at: new Date().toISOString() });

  const result = await runtime.call({ user: 'nurse', body: { action: 'process', agency_id: AGENCY, job_id: job.id } });
  assert.equal(result.status, 200);
  assert.equal(result.data.busy, true);
  assert.equal(model.calls.length, 0);
});

test('the scheduler sweep needs its secret, finishes unattended jobs, and closes jobs whose uploader lost access', async () => {
  const runtime = createRuntime({ files: { 'private/694ec16e72e01b60d22f7cbf/packet.pdf': packet(10) } });
  runtime.addIntakeUser('nurse');
  runtime.addIntakeUser('leaver');
  await runtime.call({ user: 'nurse', body: startBody() });
  await runtime.call({ user: 'leaver', body: startBody({ client_request_id: 'req-2' }) });
  runtime.db.AgencyMembership.find((row) => row.user_id === 'leaver').status = 'revoked';

  assert.equal((await runtime.call({ body: {} })).status, 401);
  const swept = await runtime.call({ body: {}, headers: { 'x-internal-secret': 'scheduler-secret' } });
  assert.equal(swept.status, 200);
  assert.equal(swept.data.worked, 1);
  const byUser = Object.fromEntries(runtime.db.ReferralTriageJob.map((row) => [row.created_by_user_id, row]));
  assert.equal(byUser.nurse.status, 'ready');
  assert.equal(byUser.leaver.status, 'failed');
  assert.equal(byUser.leaver.error_code, 'ACCESS_REVOKED');
  assert.deepEqual(runtime.db.Notification.map((row) => row.recipient_user_id), ['nurse']);
});
