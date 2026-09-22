import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTHORITY_CONTRACT } from './authority.mjs';
import { createHandler } from './app.mjs';
import { HANDLERS, HANDLER_NAMES } from './handlers.mjs';
import { loadConfig } from './runtime.mjs';
import {
  HANDOUT_COLOR_SCHEMES, HANDOUT_FONTS, HANDOUT_LAYOUTS, handoutDate,
} from './document-patient-handout.mjs';
import { HANDOUT_TEMPLATES } from './patient-handout-templates.mjs';
import { HANDOUT_FIELDS, HANDOUT_STYLE_FIELDS, generatePatientHandout } from './patient-handout.mjs';

/**
 * The handout end to end: dispatch, authority, render, response.
 *
 * `base44/functionTests/pennsyncApiDocumentParity.test.js` proves the builder
 * draws what the original drew, for every condition and style, against the
 * original itself. This proves the path a caller travels and that a REAL
 * jsPDF renders every combination — the parity surface records calls and
 * cannot tell whether jsPDF accepts them.
 */
const KEY = 'sb_publishable_synthetic-acceptance-key';
const TARGET = 'https://xxtyweswohkvgkprimwa.supabase.co';
const env = (patch = {}) => ({
  PENNSYNC_API_RELEASE: 'enabled-v1',
  PENNSYNC_API_APP_ID: '694ec16e72e01b60d22f7cbf',
  PENNSYNC_API_FUNCTIONS: 'generatePatientHandout',
  PENNSYNC_API_AUTHORITY_URL: TARGET,
  PENNSYNC_API_AUTHORITY_PUBLISHABLE_KEY: KEY,
  RAILWAY_GIT_COMMIT_SHA: 'e'.repeat(40),
  ...patch,
});
const context = () => ({
  contract: AUTHORITY_CONTRACT, app_id: '694ec16e72e01b60d22f7cbf',
  auth_user_id: '99999999-8888-4777-8666-555555555555', staging: true, synthetic: true,
  user_id: 'user-a', user_email: 'synthetic@example.test', identity_version: 1,
  is_platform_owner: false, agency_id: 'agency-a', membership_id: 'member-a',
  membership_key: 'agency-a:user-a', membership_version: 1, membership_status: 'active',
  tenant_role: 'office_staff', agency: { id: 'agency-a', name: 'Synthetic Agency A', status: 'active' },
});
const post = (params) =>
  new Request('https://api.example.test/v1/functions/generatePatientHandout', {
    method: 'POST',
    headers: { authorization: 'Bearer synthetic-native-session-token', 'content-type': 'application/json' },
    body: JSON.stringify({ agency_id: 'agency-a', params }),
  });
/**
 * Every capability a handler could reach, each failing loudly if used: the
 * handout reads no record, asks no model, audits nothing and sends nothing.
 * The app calls each factory per request and hands the handler its result.
 */
const untouchable = (name) => () => () => { throw new Error(`${name} must not be reached`); };
const serve = (patch = {}) => createHandler(loadConfig(env(patch)), {
  fetcher: async () => Response.json(context()),
  integration: untouchable('integration'), records: untouchable('records'),
  contract: untouchable('contract'), audit: untouchable('audit'),
});
/** A 1x1 PNG, inline, as `PENNSYNC_API_DOCUMENT_LOGO` requires. */
const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
/** What `src/pages/PatientEducationHub.jsx` sends for a download, key for key. */
const clientDownload = (patch = {}) => ({
  condition: 'chf',
  patientName: 'Jane Doe',
  action: 'download',
  selectedSections: null,
  customNotes: null,
  readingLevel: '5th-6th',
  format: 'comprehensive',
  styleOptions: { colorScheme: 'penn_health', fontFamily: 'helvetica', layout: 'standard',
    customHeader: '', customFooter: '', agencyName: '', agencyPhone: '' },
  ...patch,
});
const pdfText = (base64) => Buffer.from(base64, 'base64').toString('latin1');

test('the handout is registered as a JSON handler that needs no integration', () => {
  assert.ok(HANDLER_NAMES.includes('generatePatientHandout'));
  // The original answered JSON carrying base64, so the port does too; and its
  // one integration — the send — is the half that is paused, so a deployment
  // releasing the handout does not need the runtime to report ready.
  assert.notEqual(HANDLERS.generatePatientHandout.binary, true);
  assert.notEqual(HANDLERS.generatePatientHandout.needsIntegration, true);
});

test('the published client s own request renders the guide, and reaches nothing else', async () => {
  const before = handoutDate(new Date());
  const response = await serve()(post(clientDownload()));
  const after = handoutDate(new Date());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.result.filename, 'chf_handout.pdf');
  assert.deepEqual(body.result.diagnostics, { stage: 'complete', sectionsProcessed: 5, totalSections: 5 });
  const text = pdfText(body.result.pdf);
  assert.equal(text.slice(0, 5), '%PDF-');
  // jsPDF writes the page uncompressed, so what a patient reads is visible.
  assert.ok(text.includes('(Jane Doe)'), 'the patient is named');
  assert.ok(text.includes('(Congestive Heart Failure \\(CHF\\))'), 'the guide is titled');
  // The page is dated from the service's clock, in the original's format —
  // either side of the request, so a run across midnight cannot flake.
  assert.ok(text.includes(`(${before})`) || text.includes(`(${after})`), 'the page is dated today');
  // The client sends every field it has, and the port accepts every one.
  assert.deepEqual(Object.keys(clientDownload()).sort(), [...HANDOUT_FIELDS].filter(field => field !== 'patientEmail').sort());
  assert.deepEqual(Object.keys(clientDownload().styleOptions).sort(), [...HANDOUT_STYLE_FIELDS].sort());
});

test('a real jsPDF renders every condition in every style', async () => {
  // 240 documents. The parity surface cannot fail on an argument jsPDF would
  // reject, so this is the half of the proof that only a real render gives.
  const now = new Date('2026-09-22T12:00:00Z');
  let rendered = 0;
  for (const condition of Object.keys(HANDOUT_TEMPLATES)) {
    for (const layout of Object.keys(HANDOUT_LAYOUTS)) {
      for (const fontFamily of HANDOUT_FONTS) {
        const colorScheme = Object.keys(HANDOUT_COLOR_SCHEMES)[rendered % 5];
        const answer = await generatePatientHandout({ now, config: {}, params: {
          condition, patientName: 'José Núñez', customNotes: 'Rest.\nCall if dizzy.',
          styleOptions: { colorScheme, fontFamily, layout, agencyName: 'Synthetic', agencyPhone: '555-0100' },
        } });
        const text = pdfText(answer.pdf);
        assert.equal(text.slice(0, 5), '%PDF-', `${condition}/${layout}/${fontFamily}`);
        // The original's `clean` strips the accents rather than dropping the name.
        assert.ok(text.includes('(Jose Nunez)'), `${condition}/${layout}/${fontFamily}`);
        assert.ok(text.includes('(September 22, 2026)'));
        rendered += 1;
      }
    }
  }
  assert.equal(rendered, 240);
});

test('a configured logo is drawn, and nothing is fetched to draw it', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('the handout must not fetch'); };
  try {
    // Through the same config loader a deployment uses, so the value is one
    // an operator could actually set.
    const withLogo = await generatePatientHandout({ params: { condition: 'copd' },
      config: loadConfig(env({ PENNSYNC_API_DOCUMENT_LOGO: LOGO })) });
    const without = await generatePatientHandout({ params: { condition: 'copd' }, config: {} });
    assert.ok(pdfText(withLogo.pdf).includes('/Subtype /Image'), 'the logo is embedded');
    assert.equal(pdfText(without.pdf).includes('/Subtype /Image'), false);
    // Without one, the banner names the agency instead — the original's branch
    // for a failed fetch.
    assert.ok(pdfText(without.pdf).includes('(PennSync)'));
  } finally { globalThis.fetch = realFetch; }
});

test('the email action is refused with the original s paused answer, before any render', async () => {
  const handler = serve();
  let response = await handler(post(clientDownload({ action: 'email', patientEmail: 'patient@example.invalid' })));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { success: false, error: 'OUTBOUND_DELIVERY_RELEASE_PAUSED', retryable: false });
  response = await handler(post(clientDownload({ action: 'email' })));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'PATIENT_EMAIL_REQUIRED');
});

test('what the original could not render is refused by name', async () => {
  const handler = serve();
  const refusal = async (params) => {
    const response = await handler(post(params));
    return [response.status, (await response.json()).error];
  };
  assert.deepEqual(await refusal(clientDownload({ condition: '' })), [400, 'CONDITION_REQUIRED']);
  for (const condition of ['constructor', '__proto__', 'toString', 'CHF', ['chf'], 7]) {
    assert.deepEqual(await refusal(clientDownload({ condition })), [400, 'INVALID_CONDITION'], String(condition));
  }
  for (const styleOptions of [{ colorScheme: 'invented' }, { fontFamily: 'comic' }, { layout: 'three_column' },
    { layout: 'constructor' }, { agencyName: { name: 'x' } }, { unexpected: 'x' }, 'penn_health', ['penn_health']]) {
    assert.deepEqual(await refusal(clientDownload({ styleOptions })), [400, 'INVALID_STYLE_OPTIONS'],
      JSON.stringify(styleOptions));
  }
  for (const patch of [{ patientName: { first: 'Ada' } }, { customNotes: ['a'] }, { selectedSections: ['x'] },
    { selectedSections: 'all' }, { readingLevel: 5 }, { patient_id: 'patient-a' }]) {
    assert.deepEqual(await refusal(clientDownload(patch)), [400, 'INVALID_PARAMS'], JSON.stringify(patch));
  }
});

test('a handout is released like any other handler', async () => {
  const unreleased = serve({ PENNSYNC_API_FUNCTIONS: 'validatePatientData' });
  const response = await unreleased(post(clientDownload()));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'FUNCTION_NOT_RELEASED');
});
