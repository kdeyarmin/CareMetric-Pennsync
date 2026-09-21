import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTHORITY_CONTRACT, AUTHORITY_RPC, resolveAuthority, validAuthorityKey, validAuthorityTarget } from './authority.mjs';
import { createHandler } from './app.mjs';
import { HANDLER_NAMES, validatePatientData } from './handlers.mjs';
import { loadConfig, publicReadiness } from './runtime.mjs';

// Invented identities and injected transports only. No network, no customer
// record, no provider credential and no Base44 request exists here.
const revision = 'd'.repeat(40);
const KEY = 'sb_publishable_synthetic-acceptance-key';
const TARGET = 'https://xxtyweswohkvgkprimwa.supabase.co';
const AUTH_USER = '99999999-8888-4777-8666-555555555555';
// Replayed to the owned store, which admits exactly the app its deployment was
// pinned to, so a released fixture states it outright rather than defaulting.
const APP = '694ec16e72e01b60d22f7cbf';
const env = (patch = {}) => ({
  PENNSYNC_API_RELEASE: 'enabled-v1',
  PENNSYNC_API_APP_ID: APP,
  PENNSYNC_API_FUNCTIONS: 'validatePatientData',
  PENNSYNC_API_AUTHORITY_URL: TARGET,
  PENNSYNC_API_AUTHORITY_PUBLISHABLE_KEY: KEY,
  RAILWAY_GIT_COMMIT_SHA: revision,
  ...patch,
});
const config = (patch = {}) => loadConfig(env(patch));

const context = (patch = {}) => ({
  contract: AUTHORITY_CONTRACT, app_id: APP, auth_user_id: AUTH_USER,
  staging: true, synthetic: true, user_id: 'user-a', user_email: 'synthetic@example.test',
  identity_version: 1, is_platform_owner: false, agency_id: 'agency-a', membership_id: 'member-a',
  membership_key: 'agency-a:user-a', membership_version: 1, membership_status: 'active',
  tenant_role: 'clinician', agency: { id: 'agency-a', name: 'Synthetic Agency A', status: 'active' },
  ...patch,
});
const patient = (patch = {}) => ({ first_name: 'Synthetic', last_name: 'Patient', date_of_birth: '1950-04-02', ...patch });
const post = (body, { path = '/v1/functions/validatePatientData', auth = 'Bearer synthetic-native-session-token' } = {}) =>
  new Request(`https://api.example.test${path}`, {
    method: 'POST',
    headers: { ...(auth ? { authorization: auth } : {}), 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
const serveContext = (patch = {}) => async () => Response.json(context(patch));
const handlerFor = (patch = {}, fetcher = serveContext()) => createHandler(config(patch), { fetcher });

test('nothing in this directory reaches out of it, because the image is built from it', async () => {
  // The Dockerfile copies this directory as its build context and runs
  // `node --test *.test.mjs` during the build. Anything reaching `../` is
  // unresolvable there, so a single such import fails the image build — which
  // is exactly what `parity.test.mjs` did until it was moved to
  // `base44/functionTests/`, where both services are visible and neither ships
  // it. Test files count: they are copied and executed too.
  //
  // **An import is not the only shape, and a pattern is not the check.** This
  // measured import specifiers alone until five suites here had been written
  // that READ a file outside this directory by path to compare a port against
  // its original — which breaks the build exactly as an import does, and which
  // nothing saw. Two successive patterns then each missed a case the others
  // caught. So the rule is not a pattern at all: a quoted literal is a finding
  // when it RESOLVES TO A FILE that exists outside this directory. A fixture
  // like `'../../etc/passwd.pdf'` names nothing and is not a finding; a bare
  // `'../../'` is a directory and is not one either. That is D47's lesson a
  // second time — re-derive the shapes from the tree rather than from the
  // check — and the five moved to
  // `base44/functionTests/pennsyncApiOriginalParity.test.js`.
  const { readdir, readFile } = await import('node:fs/promises');
  const { statSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { resolve } = await import('node:path');
  const here = new URL('./', import.meta.url);
  const directory = fileURLToPath(here);
  const repository = resolve(directory, '../../');
  const files = (await readdir(here)).filter(name => name.endsWith('.mjs'));
  assert.ok(files.length >= 8, 'the directory scan found nothing to scan');
  const SPECIFIER = /(?:^|\s)(?:import|export)[^'"\n]*?from\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
  const LITERAL = /['"`]([^'"`\n${}]+)['"`]/g;
  const isFile = path => { try { return statSync(path).isFile(); } catch { return false; } };
  // A path named in PROSE is not one the build resolves, so comments go first —
  // including this file's own explanation above.
  const code = text => text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map(line => {
      const index = line.search(/(?<!:)\/\//);
      return index === -1 ? line : line.slice(0, index);
    }).join('\n');
  for (const name of files) {
    const source = await readFile(new URL(name, here), 'utf8');
    for (const match of source.matchAll(SPECIFIER)) {
      const specifier = match[1] ?? match[2];
      assert.ok(!specifier.startsWith('../'),
        `${name} imports ${specifier}, which does not exist in the Docker build context`);
    }
    for (const [, literal] of code(source).matchAll(LITERAL)) {
      // Either walked up out of the directory, or named from the repository
      // root the way a `resolve(repository, ...)` call does.
      const candidates = literal.startsWith('../') ? [resolve(directory, literal)]
        : literal.includes('/') && !literal.includes(':') ? [resolve(repository, literal)] : [];
      for (const candidate of candidates) {
        if (candidate.startsWith(directory) || !isFile(candidate)) continue;
        assert.fail(`${name} names ${literal}, which resolves to a file outside `
          + 'the Docker build context');
      }
    }
  }
});

test('configuration defaults closed and refuses unusable release combinations', () => {
  const bare = loadConfig({});
  assert.equal(bare.released, false);
  assert.deepEqual(bare.functions, []);
  assert.equal(bare.authorityConfigured, false);
  assert.equal(publicReadiness(bare).ready, false);
  // Release without a usable authority would serve unauthorized work.
  assert.throws(() => loadConfig({ PENNSYNC_API_RELEASE: 'enabled-v1' }));
  // A released name must exist in the registry.
  assert.throws(() => loadConfig(env({ PENNSYNC_API_FUNCTIONS: 'notARealFunction' })));
  assert.throws(() => loadConfig(env({ PENNSYNC_API_FUNCTIONS: 'validatePatientData,validatePatientData' })));
  assert.throws(() => loadConfig(env({ PENNSYNC_API_AUTHORITY_URL: 'https://foreign.supabase.co' })));
  assert.throws(() => loadConfig(env({ PENNSYNC_API_AUTHORITY_PUBLISHABLE_KEY: 'sb_secret_synthetic-acceptance-key' })));
  assert.throws(() => loadConfig(env({ PENNSYNC_API_ALLOWED_ORIGINS: 'http://app.example.test' })));
  assert.throws(() => loadConfig(env({ PENNSYNC_API_APP_ID: '000000000000000000000000' })));
  assert.equal(validAuthorityTarget(TARGET) && validAuthorityKey(KEY), true);
});

test('a released service refuses an app binding the operator did not choose', () => {
  // The store's pin defaults to STAGING; this service's app id defaults to
  // PRODUCTION. Defaulting both is the one combination that reports ready and is
  // refused by every authorization call, so a release must not inherit it.
  const { PENNSYNC_API_APP_ID: _omitted, ...withoutApp } = env();
  assert.throws(() => loadConfig(withoutApp), /IMPLICIT_APP_BINDING/);
  assert.throws(() => loadConfig(env({ PENNSYNC_API_APP_ID: '' })), /IMPLICIT_APP_BINDING/);

  // Stating it is all that is asked, and either reviewed app may be stated.
  for (const app of ['694ec16e72e01b60d22f7cbf', '6a9881683dc68a0bd54f1ef7']) {
    assert.equal(loadConfig(env({ PENNSYNC_API_APP_ID: app })).appId, app);
  }

  // Unreleased, the service serves nothing, so the default is harmless and the
  // bare config must still load — this guard closes a release, not a startup.
  const bare = loadConfig({});
  assert.equal(bare.released, false);
  assert.equal(bare.appId, '694ec16e72e01b60d22f7cbf');
  assert.equal(publicReadiness(bare).ready, false);
});

test('readiness reports no Base44 dependency and never claims a cutover', async () => {
  const readiness = publicReadiness(config());
  assert.equal(readiness.base44ExecutionDependency, false);
  assert.equal(readiness.authorityMode, 'independent');
  assert.equal(readiness.trafficCutoverVerified, false);
  assert.equal(readiness.portedFunctionCoverageComplete, false);
  assert.deepEqual(readiness.implemented, HANDLER_NAMES);
  assert.equal(readiness.ready, true);
  const response = await handlerFor()(new Request('https://api.example.test/readyz'));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).base44ExecutionDependency, false);
  const paused = await createHandler(loadConfig({}), {})(new Request('https://api.example.test/readyz'));
  assert.equal(paused.status, 503);
});

test('health is available while the service is paused', async () => {
  const response = await createHandler(loadConfig({}), {})(new Request('https://api.example.test/healthz'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'alive', release: 'paused', revision: 'unbound' });
});

test('a released function runs under current authority and answers the ported contract', async () => {
  const seen = [];
  const handler = handlerFor({}, async (url, options) => { seen.push({ url: String(url), options }); return Response.json(context()); });
  const response = await handler(post({ agency_id: 'agency-a', params: { patient: patient() } }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true, result: { valid: true, message: 'Patient data is valid' },
    execution: 'pennsync-api', base44ExecutionDependency: false,
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, `${TARGET}/rest/v1/rpc/${AUTHORITY_RPC}`);
  assert.equal(seen[0].url.includes('base44'), false);
  assert.equal(seen[0].options.headers.Authorization, 'Bearer synthetic-native-session-token');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-credentials'), null);
});

test('invalid patient data returns the preserved field-level errors', async () => {
  const response = await handlerFor()(post({
    agency_id: 'agency-a',
    params: { patient: { first_name: '', last_name: 'Patient', date_of_birth: '02-04-1950', email: 'not-an-email', caregiver_phone: '123' } },
  }));
  assert.equal(response.status, 200);
  const { result } = await response.json();
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, [
    { field: 'first_name', message: 'First name is required' },
    { field: 'date_of_birth', message: 'date_of_birth must be in YYYY-MM-DD format (e.g., 2024-12-18)' },
    { field: 'email', message: 'Invalid email format. Must be in format: user@domain.com' },
    { field: 'caregiver_phone', message: 'Caregiver phone: Phone number must be 10 digits (or 11 with country code)' },
  ]);
});

test('the ported validation preserves the original rules exactly', () => {
  assert.deepEqual(validatePatientData(patient()), []);
  assert.deepEqual(validatePatientData(patient({ date_of_birth: '2999-01-01' })),
    [{ field: 'date_of_birth', message: 'Date of birth cannot be in the future' }]);
  assert.deepEqual(validatePatientData(patient({ phone: '15551234567' })), []);
  assert.deepEqual(validatePatientData(patient({ phone: '25551234567' })),
    [{ field: 'phone', message: '11-digit phone numbers must start with 1' }]);
  assert.deepEqual(validatePatientData(patient({ date_of_birth: '2024-13-45' })),
    [{ field: 'date_of_birth', message: 'Invalid date_of_birth' }]);
  assert.deepEqual(validatePatientData({ date_of_birth: '1950-04-02' }), [
    { field: 'first_name', message: 'First name is required' },
    { field: 'last_name', message: 'Last name is required' },
  ]);
  // Absent optional fields are not validated into errors.
  assert.deepEqual(validatePatientData(patient({ email: '', physician_phone: null })), []);
});

test('a paused deployment or unreleased function never reaches a handler', async () => {
  const paused = await createHandler(loadConfig({}), { authority: () => assert.fail('authority must not run') })(
    post({ agency_id: 'agency-a', params: { patient: patient() } }));
  assert.equal(paused.status, 503);
  assert.equal((await paused.json()).error, 'PENNSYNC_API_NOT_RELEASED');

  const unreleased = createHandler(config({ PENNSYNC_API_FUNCTIONS: '' }), { authority: () => assert.fail('authority must not run') });
  const response = await unreleased(post({ agency_id: 'agency-a', params: { patient: patient() } }));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'FUNCTION_NOT_RELEASED');
});

test('unknown routes, methods, query strings and function names are refused', async () => {
  const handler = handlerFor();
  for (const [request, status] of [
    [new Request('https://api.example.test/v1/functions/validatePatientData', { method: 'GET' }), 404],
    [post({}, { path: '/v1/functions/notARealFunction' }), 404],
    [post({}, { path: '/v1/entities/Patient' }), 404],
    [new Request('https://api.example.test/v1/functions/validatePatientData?debug=1', { method: 'POST' }), 404],
  ]) {
    assert.equal((await handler(request)).status, status);
  }
});

test('malformed envelopes are refused before authority is consulted', async () => {
  let authorityCalls = 0;
  const handler = createHandler(config(), { authority: async () => { authorityCalls++; return {}; } });
  for (const body of [
    { agency_id: 'agency-a' , params: {}, extra: true },
    { params: {} },
    { agency_id: '', params: {} },
    { agency_id: ['agency-a'], params: {} },
  ]) {
    assert.equal((await handler(post(body))).status, 400);
  }
  assert.equal((await handler(post('{not json'))).status, 400);
  assert.equal(authorityCalls, 0);
  // A body is only read once the content type is right.
  const wrongType = new Request('https://api.example.test/v1/functions/validatePatientData', {
    method: 'POST', headers: { authorization: 'Bearer synthetic-native-session-token' }, body: '{}',
  });
  assert.equal((await handler(wrongType)).status, 415);
});

test('unknown handler parameters are refused rather than ignored', async () => {
  const handler = handlerFor();
  const response = await handler(post({ agency_id: 'agency-a', params: { patient: patient(), skipValidation: true } }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'INVALID_PARAMS');
  const missing = await handler(post({ agency_id: 'agency-a', params: { patient: 'text' } }));
  assert.equal((await missing.json()).error, 'PATIENT_REQUIRED');
});

test('missing credentials, rejected callers and drifted authority all deny', async () => {
  const handler = handlerFor();
  const anonymous = await handler(post({ agency_id: 'agency-a', params: { patient: patient() } }, { auth: null }));
  assert.equal(anonymous.status, 401);

  const rejected = handlerFor({}, async () => Response.json({}, { status: 403 }));
  assert.equal((await rejected(post({ agency_id: 'agency-a', params: { patient: patient() } }))).status, 403);

  for (const patch of [{ agency_id: 'agency-b' }, { is_platform_owner: true }, { membership_status: 'revoked' },
    { tenant_role: 'platform_owner' }, { agency: { id: 'agency-a', name: 'Synthetic Agency A', status: 'suspended' } }]) {
    const drifted = handlerFor({}, serveContext(patch));
    const response = await drifted(post({ agency_id: 'agency-a', params: { patient: patient() } }));
    assert.equal(response.status, 403, `expected denial for ${Object.keys(patch)[0]}`);
  }
});

test('handlers receive a frozen authority projection and no credential', async () => {
  let received = null;
  const handlers = { probe: { handle(input) { received = input; return { ok: true }; } } };
  const handler = createHandler({ ...config(), functions: ['probe'] }, { fetcher: serveContext(), handlers });
  const response = await handler(post({ agency_id: 'agency-a', params: {} }, { path: '/v1/functions/probe' }));
  assert.equal(response.status, 200);
  assert.equal(Object.isFrozen(received.actor), true);
  assert.deepEqual(Object.keys(received.actor).sort(),
    ['agencyId', 'authUserId', 'membershipId', 'membershipVersion', 'tenantRole', 'userEmail', 'userId']);
  // No token, publishable key or raw response reaches a handler.
  assert.equal(JSON.stringify(received.actor).includes('Bearer'), false);
  assert.equal(JSON.stringify(received.actor).includes(KEY), false);
});

test('an unexpected handler failure is reported opaquely', async () => {
  const handlers = { probe: { handle() { throw new Error('synthetic secret handler text'); } } };
  const handler = createHandler({ ...config(), functions: ['probe'] }, { fetcher: serveContext(), handlers });
  const response = await handler(post({ agency_id: 'agency-a', params: {} }, { path: '/v1/functions/probe' }));
  assert.equal(response.status, 503);
  const value = await response.json();
  assert.deepEqual(value, { success: false, error: 'PENNSYNC_API_UNAVAILABLE', retryable: false });
  assert.equal(JSON.stringify(value).includes('secret'), false);
});

test('cross-origin access is limited to the reviewed origins', async () => {
  const handler = handlerFor();
  const allowed = new Request('https://api.example.test/v1/functions/validatePatientData', {
    method: 'OPTIONS',
    headers: { origin: 'https://app.caremetricai.com', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization, content-type' },
  });
  const preflight = await handler(allowed);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://app.caremetricai.com');
  const foreign = new Request('https://api.example.test/healthz', { headers: { origin: 'https://evil.example.test' } });
  assert.equal((await handler(foreign)).status, 403);
});

test('authority is never resolved without a configured target', async () => {
  await assert.rejects(
    () => resolveAuthority({ ...config(), authorityUrl: '', authorityKey: '' }, post({}), 'agency-a', async () => Response.json(context())),
    error => error.status === 503 && error.code === 'AUTHORITY_NOT_CONFIGURED',
  );
});

test('the smart-note seed maps only fields the extractor actually produces', async () => {
  const { buildSmartNoteData } = await import('./transforms.mjs');
  const referral = {
    patient_id: 'patient-a1',
    extracted_data: {
      admission_details: { admission_date: '2026-03-02', referral_reason: 'Wound care' },
      diagnoses: {
        primary_diagnosis: 'Cellulitis', primary_icd10: 'L03.115',
        secondary_diagnoses: ['Diabetes'], comorbidity_adjustments: ['low'], allergies: 'Sulfa',
      },
      clinical_info: { vital_signs: 'BP 130/82' },
      skilled_needs: { services_ordered: ['SN'], specific_interventions: ['dressing'], goals_of_care: 'Closure' },
      medications: [{ name: 'Lasix' }],
      demographics: { full_name: 'Synthetic Patient', date_of_birth: '1950-04-02' },
    },
  };
  const seed = buildSmartNoteData(referral);
  assert.equal(seed.patient_id, 'patient-a1');
  assert.equal(seed.visit_type, 'admission');
  assert.equal(seed.visit_date, '2026-03-02');
  assert.equal(seed.diagnosis, 'Cellulitis');
  assert.equal(seed.vital_signs_text, 'BP 130/82');
  assert.equal(seed.clinical_summary.primary_icd10, 'L03.115');
  assert.equal(seed.clinical_summary.instructions_from_referral, 'Closure');
  assert.equal(seed.patient_demographics.name, 'Synthetic Patient');
  assert.match(seed.admission_note_template, /REASON FOR ADMISSION:\nWound care/);
});

test('the smart-note seed invents nothing when the extraction is empty', async () => {
  const { buildSmartNoteData } = await import('./transforms.mjs');
  const seed = buildSmartNoteData({ patient_id: 'p1' }, { today: new Date('2026-03-02T11:00:00Z') });
  // A missing admission date falls back to the injected clock, never to a
  // guessed value, and absent clinical fields stay empty rather than invented.
  assert.equal(seed.visit_date, '2026-03-02');
  assert.equal(seed.diagnosis, '');
  assert.deepEqual(seed.secondary_diagnoses, []);
  assert.equal(seed.vital_signs_text, '');
  assert.equal(seed.clinical_summary.allergies, 'NKDA');
  assert.equal(seed.clinical_summary.primary_diagnosis, undefined);
  assert.equal(seed.patient_demographics.name, undefined);
  assert.equal(seed.clinical_summary.instructions_from_referral, '');
});

// The referral this capability seeds a note from, as `contract_referral_get`
// answers: `referral_row` drops null-valued keys, so an unprocessed referral
// arrives with no `extracted_data` key rather than a null one.
const referralAnswer = (patch = {}) => ({
  referral: {
    id: 'referral-a1', agency_id: 'agency-a', version: 3, patient_id: 'patient-a1',
    extracted_data: { admission_details: { admission_date: '2026-03-02' } },
    ...patch,
  },
  scope: {
    agency_id: 'agency-a', membership_id: 'm1', membership_version: 1,
    tenant_role: 'office_staff',
  },
});

test('the smart-note seed is read through the referral contract, never supplied', async () => {
  // This assertion used to read `false`, and its comment said why: "it needs an
  // authorized referral read that this service does not yet have; exposing it
  // would let a caller supply its own referral payload". D68 built that read.
  assert.equal(HANDLER_NAMES.includes('extractReferralDataForSmartNote'), true);
  const { HANDLERS } = await import('./handlers.mjs');
  const asked = [];
  const answer = await HANDLERS.extractReferralDataForSmartNote.handle({
    params: { referral_id: 'referral-a1' },
    contract: (name, args) => { asked.push([name, args]); return referralAnswer(); },
  });
  // The referral comes from the contract and from nothing else, and the id the
  // caller named is the only thing that reaches it.
  assert.deepEqual(asked, [['getAuthorizedReferral', { referral_id: 'referral-a1' }]]);
  assert.equal(answer.smartNoteData.patient_id, 'patient-a1');
  assert.equal(answer.smartNoteData.visit_date, '2026-03-02');
  assert.deepEqual(answer.scope,
    { agency_id: 'agency-a', referral_id: 'referral-a1', referral_version: 3 });
  // The original's `success: true` envelope is not carried; no ported handler
  // returns one.
  assert.equal(Object.hasOwn(answer, 'success'), false);
});

test('the smart-note seed refuses a caller-supplied referral payload', async () => {
  const { HANDLERS } = await import('./handlers.mjs');
  // A referral body, an agency, a version to trust — every one of them is the
  // thing the contract decides, so none of them is a parameter.
  for (const params of [
    { referral_id: 'referral-a1', referral: { extracted_data: { diagnoses: {} } } },
    { referral_id: 'referral-a1', agency_id: 'agency-b' },
    { extracted_data: { diagnoses: {} } },
  ]) {
    await assert.rejects(
      async () => HANDLERS.extractReferralDataForSmartNote.handle({
        params, contract: () => referralAnswer(),
      }),
      error => error.status === 400 && error.code === 'INVALID_PARAMS',
      JSON.stringify(params),
    );
  }
  // An EMPTY body is not one of them, and the difference is worth stating:
  // `exactObject` refuses an unknown key and does not require a known one, so
  // `{}` reaches the contract with no id and `PENNSYNC_REFERRAL_ID_INVALID` is
  // the answer. That refusal is inherited (D69), and `contract-referral`
  // proves it — nothing did until this handler depended on it.
  const asked = [];
  await assert.rejects(
    async () => HANDLERS.extractReferralDataForSmartNote.handle({
      params: {},
      contract: (name, args) => {
        asked.push(args);
        const error = new Error('PENNSYNC_REFERRAL_ID_INVALID');
        error.status = 400; error.code = 'PENNSYNC_REFERRAL_ID_INVALID';
        throw error;
      },
    }),
    error => error.code === 'PENNSYNC_REFERRAL_ID_INVALID',
  );
  assert.deepEqual(asked, [{}]);
});

test('a referral nobody has run the extractor over seeds no note', async () => {
  const { HANDLERS } = await import('./handlers.mjs');
  // Not machinery: the wire checks around it are, but a referral with no
  // extraction has nothing to seed a note with, and the original says so with
  // its own 404.
  for (const referral of [{ extracted_data: undefined }, { extracted_data: [] },
    { extracted_data: 'pending' }, { extracted_data: null }]) {
    await assert.rejects(
      async () => HANDLERS.extractReferralDataForSmartNote.handle({
        params: { referral_id: 'referral-a1' },
        contract: () => referralAnswer(referral),
      }),
      error => error.status === 404 && error.code === 'REFERRAL_NOT_PROCESSED',
      JSON.stringify(referral),
    );
  }
});

test('readiness accounts for the runtime a released handler actually needs', async () => {
  // `/readyz` answered 200 while every call failed INTEGRATIONS_NOT_CONFIGURED,
  // because readiness only asked about release, authority and a non-empty
  // function list. A service that reports healthy and serves nothing is the
  // exact failure readiness exists to prevent.
  const base = {
    released: true, authorityConfigured: true, revision: 'test',
    functions: [], integrationsConfigured: false,
  };
  const ready = config => publicReadiness({ ...base, ...config });

  // A handler that needs no integration is ready without one.
  assert.equal(ready({ functions: ['validatePatientData'] }).ready, true);
  assert.equal(ready({ functions: ['validatePatientData'] }).integrationsRequired, false);

  // One that does is not, and the readiness body says which dependency is missing.
  for (const name of ['analyzeReferral', 'analyzeReferralIntake', 'analyzeReferralPriority',
    'generateReferralTasks', 'matchPatientWithAI', 'generateUserGuidePDF']) {
    const report = ready({ functions: [name] });
    assert.equal(report.ready, false, `${name} must not report ready without its runtime`);
    assert.equal(report.integrationsRequired, true);
    assert.equal(report.integrationsConfigured, false);
    assert.equal(publicReadiness({ ...base, functions: [name], integrationsConfigured: true }).ready, true);
  }
  // Mixed release: one handler needing it is enough to require it.
  assert.equal(ready({ functions: ['validatePatientData', 'analyzeReferral'] }).ready, false);
  assert.equal(publicReadiness({
    ...base, functions: ['validatePatientData', 'analyzeReferral'], integrationsConfigured: true,
  }).ready, true);
  // And the other preconditions still gate it.
  assert.equal(publicReadiness({
    ...base, released: false, functions: ['validatePatientData'], integrationsConfigured: true,
  }).ready, false);
});

test('a handler may declare a request larger than the service default, and one does', async () => {
  /*
   * `importProvidersCsv` and its Base44 original both advertise a 10 MiB CSV,
   * while `app.mjs` read every body at the 1 MiB service default — so every
   * import between those figures was refused `BODY_TOO_LARGE` before the
   * parser ran. An accidental narrowing of the original, found by review.
   *
   * Driven through the real request path rather than asserted on the
   * registry, because what was broken was the path and not the declaration.
   */
  const { HANDLERS } = await import('./handlers.mjs');
  const { MAX_CSV_BYTES } = await import('./provider-import.mjs');
  assert.equal(HANDLERS.importProvidersCsv.maxBody, 2 * MAX_CSV_BYTES);
  // Every other handler keeps the default, so this is one exception and not a
  // service-wide loosening.
  const declared = Object.entries(HANDLERS).filter(([, entry]) => entry.maxBody !== undefined);
  assert.deepEqual(declared.map(([name]) => name), ['importProvidersCsv']);

  const send = (name, params) => handlerFor({ PENNSYNC_API_FUNCTIONS: name })(
    new Request('https://api.example.test/v1/functions/' + name, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer token' },
      body: JSON.stringify({ agency_id: 'agency-a', params }),
    }));

  // Two megabytes of CSV: over the old ceiling, under the new one. It must get
  // past the body boundary — whatever it then answers, it is not BODY_TOO_LARGE.
  const big = `name,npi\n${'Somebody,1234567890\n'.repeat(100000)}`;
  assert.ok(big.length > 1024 * 1024 && big.length < MAX_CSV_BYTES);
  const allowed = await send('importProvidersCsv', { csv_text: big });
  assert.notEqual(allowed.status, 413);
  assert.notEqual((await allowed.clone().json()).error, 'BODY_TOO_LARGE');

  // A handler that declared nothing still refuses the same payload at 1 MiB.
  const refused = await send('validatePatientData', { csv_text: big });
  assert.equal(refused.status, 413);
});
