import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTHORITY_CONTRACT } from './authority.mjs';
import { createHandler } from './app.mjs';
import { HANDLER_NAMES } from './handlers.mjs';
import {
  BAG_TECHNIQUE_FILENAME, SMART_NOTE_GUIDE_FILENAME, USER_MANUAL_FILENAME,
  buildBagTechniqueChecklist, documentDate,
} from './documents.mjs';
import { fail } from './contracts.mjs';
import { loadConfig } from './runtime.mjs';

/**
 * End to end for a ported document: dispatch, authority, render, response.
 *
 * `base44/functionTests/pennsyncApiDocumentParity.test.js` proves the builder
 * issues its Base44 original's exact drawing calls. This proves the rest of the
 * path a caller actually travels — that the release gate still applies, that
 * the bytes come back as a PDF attachment rather than wrapped in the JSON
 * envelope every other handler uses, and that a malformed render is refused
 * rather than served.
 */
const KEY = 'sb_publishable_synthetic-acceptance-key';
const TARGET = 'https://xxtyweswohkvgkprimwa.supabase.co';
const LOGO = `data:image/png;base64,${'iVBORw0KGgoAAAANSUhEUg'.repeat(2)}==`;
const env = (patch = {}) => ({
  PENNSYNC_API_RELEASE: 'enabled-v1',
  PENNSYNC_API_APP_ID: '694ec16e72e01b60d22f7cbf',
  PENNSYNC_API_FUNCTIONS: 'generateBagTechniquePDF',
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
  tenant_role: 'clinician', agency: { id: 'agency-a', name: 'Synthetic Agency A', status: 'active' },
});
const post = (params = {}, name = 'generateBagTechniquePDF') =>
  new Request(`https://api.example.test/v1/functions/${name}`, {
    method: 'POST',
    headers: { authorization: 'Bearer synthetic-native-session-token', 'content-type': 'application/json' },
    body: JSON.stringify({ agency_id: 'agency-a', params }),
  });
const serve = (patch = {}) => createHandler(loadConfig(env(patch)), { fetcher: async () => Response.json(context()) });

test('the ported checklist is registered and released like any other handler', () => {
  assert.ok(HANDLER_NAMES.includes('generateBagTechniquePDF'));
  // A name that is implemented but not released must still be refused.
  const paused = createHandler(loadConfig(env({ PENNSYNC_API_FUNCTIONS: 'validatePatientData' })),
    { fetcher: async () => Response.json(context()) });
  return paused(post()).then(async response => {
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, 'FUNCTION_NOT_RELEASED');
  });
});

test('a released call answers with the PDF itself, not a JSON envelope', async () => {
  const response = await serve()(post());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/pdf');
  assert.equal(response.headers.get('content-disposition'), `attachment; filename="${BAG_TECHNIQUE_FILENAME}"`);
  // The security headers every other response carries are still set.
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.ok(bytes.length > 4096, 'a real document, not an empty page');
});

test('every ported document is registered, and each answers the way its original did', async () => {
  for (const name of ['generateBagTechniquePDF', 'generateSmartNoteGuide', 'generateUserManual']) {
    assert.ok(HANDLER_NAMES.includes(name), `${name} should be registered`);
  }
  const serveAll = serve({ PENNSYNC_API_FUNCTIONS: 'generateSmartNoteGuide,generateUserManual' });

  // The guide's original answered with JSON carrying base64, not with bytes.
  const guide = await serveAll(post({}, 'generateSmartNoteGuide'));
  assert.equal(guide.status, 200);
  assert.equal(guide.headers.get('content-type'), 'application/json');
  const body = await guide.json();
  assert.equal(body.success, true);
  assert.equal(body.result.filename, SMART_NOTE_GUIDE_FILENAME);
  const decoded = Buffer.from(body.result.pdf, 'base64');
  assert.equal(decoded.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.ok(decoded.length > 4096);

  // The manual's original answered with the bytes.
  const manual = await serveAll(post({}, 'generateUserManual'));
  assert.equal(manual.status, 200);
  assert.equal(manual.headers.get('content-type'), 'application/pdf');
  assert.equal(manual.headers.get('content-disposition'),
    `attachment; filename="${USER_MANUAL_FILENAME}"`);
  const bytes = Buffer.from(await manual.arrayBuffer());
  assert.equal(bytes.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.ok(bytes.length > 20000, 'the manual is a long document');
});

test('an unknown parameter is refused rather than ignored', async () => {
  const response = await serve()(post({ patient_id: 'patient-a' }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'INVALID_PARAMS');
});

test('a configured logo must be an inline PNG, never a remote address', () => {
  assert.equal(loadConfig(env()).documentLogoDataUrl, '');
  assert.equal(loadConfig(env({ PENNSYNC_API_DOCUMENT_LOGO: LOGO })).documentLogoDataUrl, LOGO);
  for (const value of ['https://qtrypzzcjebvfcihiynt.supabase.co/logo.png', 'data:image/svg+xml;base64,AAAA',
    'data:image/png;base64,', 'data:image/png,AAAA', 'javascript:alert(1)']) {
    assert.throws(() => loadConfig(env({ PENNSYNC_API_DOCUMENT_LOGO: value })), /INVALID_DOCUMENT_LOGO/, value);
  }
});

test('a render that returns the wrong shape is refused, not forwarded', async () => {
  // The binary path trusts nothing it is handed: a handler bug must not put an
  // arbitrary body or filename into a response with a PDF content type.
  for (const result of [null, { binary: false, body: new ArrayBuffer(8), contentType: 'application/pdf', filename: 'a.pdf' },
    { binary: true, body: 'not-bytes', contentType: 'application/pdf', filename: 'a.pdf' },
    { binary: true, body: new ArrayBuffer(8), contentType: 'text/html', filename: 'a.pdf' },
    { binary: true, body: new ArrayBuffer(8), contentType: 'application/pdf', filename: '../../etc/passwd.pdf' },
    { binary: true, body: new ArrayBuffer(8), contentType: 'application/pdf', filename: 'a"; drop.pdf' }]) {
    const handler = createHandler(loadConfig(env()), {
      fetcher: async () => Response.json(context()),
      handlers: { generateBagTechniquePDF: { binary: true, handle: () => result } },
    });
    const response = await handler(post());
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('content-type'), 'application/json');
    assert.equal((await response.json()).error, 'PENNSYNC_API_UNAVAILABLE');
  }
});

test('the same day renders the same document, so a diff is a real change', async () => {
  const { jsPDF } = await import('jspdf');
  const day = documentDate(new Date('2026-09-19T12:00:00Z'));
  const render = () => Buffer.from(buildBagTechniqueChecklist(new jsPDF(), { generatedOn: day }).output('arraybuffer'));
  const first = render();
  const second = render();
  // jsPDF stamps a creation time and a document id, so the bytes differ; the
  // page count and length are what a content change would move.
  assert.equal(first.length, second.length);
  assert.ok(first.length > 4096);
});

test('the roster report walks the whole roster and counts it once', async () => {
  // The first document whose content comes from a CONTRACT, so the walk is
  // this handler's own behaviour and is proved here rather than in the parity
  // test: the summary is the contract's (counted over the agency) and the
  // table is every page, so a handler that took only the first page would
  // render a report contradicting its own total.
  const page = (from, to, next) => ({
    entries: Array.from({ length: to - from }, (unused, index) => ({
      email: `person${from + index}@example.invalid`, credential_type: 'RN',
      tenant_role: 'clinician', care_scope: 'both', is_approved: true,
    })),
    next,
    summary: { total: 1200, approved: 1100, pending: 100, rn: 700, lpn: 500 },
  });
  const asked = [];
  const pages = [page(0, 500, 'cursor-a'), page(500, 1000, 'cursor-b'), page(1000, 1200, null)];
  const handler = createHandler(loadConfig(env({ PENNSYNC_API_FUNCTIONS: 'generateUserRosterPDF' })), {
    fetcher: async () => Response.json({ ...context(), tenant_role: 'agency_admin' }),
    contract: () => async (name, args) => { asked.push([name, args]); return pages[asked.length - 1]; },
  });
  const response = await handler(post({}, 'generateUserRosterPDF'));
  assert.equal(response.status, 200, await response.clone().text().catch(() => ''));
  assert.equal(response.headers.get('content-type'), 'application/pdf');
  assert.match(response.headers.get('content-disposition'),
    /attachment; filename="User_Roster_\d{4}-\d{2}-\d{2}\.pdf"/);
  // Three pages, each asking for the next by the cursor the last one gave.
  assert.deepEqual(asked, [['readRosterReport', {}],
    ['readRosterReport', { after: 'cursor-a' }], ['readRosterReport', { after: 'cursor-b' }]]);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.ok(bytes.length > 20000, '1,200 people is a long document');
});

test('a contract that never stops paging is bounded rather than trusted', async () => {
  // A cursor equal to its own input would spin forever; one that always
  // differs would spin until memory ran out. Neither is this handler's to
  // trust, so both end.
  for (const [label, next] of [['repeated', () => 'same'], ['endless', count => `cursor-${count}`]]) {
    let count = 0;
    const handler = createHandler(loadConfig(env({ PENNSYNC_API_FUNCTIONS: 'generateUserRosterPDF' })), {
      fetcher: async () => Response.json({ ...context(), tenant_role: 'agency_admin' }),
      contract: () => async () => {
        count += 1;
        return { entries: [{ email: `a${count}@example.invalid`, is_approved: true }],
          next: next(count), summary: { total: 1, approved: 1, pending: 0, rn: 0, lpn: 0 } };
      },
    });
    const response = await handler(post({}, 'generateUserRosterPDF'));
    assert.equal(response.status, 200, label);
    assert.ok(count <= 200, `${label}: ${count} pages`);
    assert.equal(count, label === 'repeated' ? 2 : 200, label);
  }
});

test('the roster report takes no parameters, and its refusals are the contract\'s', async () => {
  const handler = createHandler(loadConfig(env({ PENNSYNC_API_FUNCTIONS: 'generateUserRosterPDF' })), {
    fetcher: async () => Response.json({ ...context(), tenant_role: 'agency_admin' }),
    contract: () => async () => fail(409, 'PENNSYNC_ROSTER_REPORT_FORBIDDEN'),
  });
  // A caller cannot ask for a page, a limit or another agency's roster: the
  // agency is the envelope's and the walk is the handler's.
  for (const params of [{ limit: 5 }, { after: 'cursor' }, { agency_id: 'agency-b' }]) {
    const refused = createHandler(loadConfig(env({ PENNSYNC_API_FUNCTIONS: 'generateUserRosterPDF' })), {
      fetcher: async () => Response.json({ ...context(), tenant_role: 'agency_admin' }),
    });
    const response = await refused(post(params, 'generateUserRosterPDF'));
    assert.equal(response.status, 400, JSON.stringify(params));
    assert.equal((await response.json()).error, 'INVALID_PARAMS');
  }
  // And the contract's refusal crosses back as itself rather than as an outage.
  const response = await handler(post({}, 'generateUserRosterPDF'));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'PENNSYNC_ROSTER_REPORT_FORBIDDEN');
});

/**
 * The handout, whose port is PARTIAL: the document action is served and the
 * email action is refused with the original's own code.
 *
 * D79 measured why that split was invisible. The port queue counted the whole
 * capability `core_integration` because its module reaches `Core.SendEmail`,
 * and never asked that the reach sits inside an `action === 'email'` branch
 * the module's own release gate refuses before any work is done. So the half
 * that needs no integration at all was counted as blocked on an owner
 * decision. `pennsyncApiDocumentParity` proves the served half renders the
 * original's page; these prove the refused half is refused.
 */
const handout = (params) => post(params, 'generatePatientHandout');
const serveHandout = () => serve({ PENNSYNC_API_FUNCTIONS: 'generatePatientHandout' });

test('the handout is registered, and serves the action that reaches no integration', async () => {
  assert.ok(HANDLER_NAMES.includes('generatePatientHandout'));
  const response = await serveHandout()(handout({ condition: 'chf', patientName: 'Jane Doe' }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.result.filename, 'chf_handout.pdf');
  assert.equal(typeof body.result.pdf, 'string');
  // Really a PDF, not an empty string that would satisfy a typeof check.
  assert.equal(Buffer.from(body.result.pdf, 'base64').subarray(0, 4).toString(), '%PDF');
});

test('the handout refuses the emailed action with the original\'s own code', async () => {
  const response = await serveHandout()(handout({
    condition: 'chf', patientName: 'Jane Doe', action: 'email', patientEmail: 'j@example.test',
  }));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'OUTBOUND_DELIVERY_RELEASE_PAUSED');
});

test('the handout tells a caller which of the two things is wrong', async () => {
  const serving = serveHandout();
  // Order is the original's: a request to email with no address is a bad
  // request whether or not delivery is released, and saying "paused" to it
  // would send the caller to an owner decision over a typo.
  for (const [params, status, error] of [
    [{ patientName: 'J' }, 400, 'CONDITION_REQUIRED'],
    [{ condition: 'not_a_condition' }, 400, 'INVALID_CONDITION'],
    [{ condition: 'chf', action: 'email' }, 400, 'PATIENT_EMAIL_REQUIRED'],
    [{ condition: 'chf', unexpected: 1 }, 400, 'INVALID_PARAMS'],
  ]) {
    const response = await serving(handout(params));
    assert.equal(response.status, status, error);
    assert.equal((await response.json()).error, error);
  }
});

