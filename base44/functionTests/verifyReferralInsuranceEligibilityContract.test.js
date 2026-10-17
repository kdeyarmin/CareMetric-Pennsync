// Runs the real verifyReferralInsuranceEligibility entry.ts against an
// in-memory Base44 and a scripted Office Ally stand-in, the way
// referralTriageJobsContract.test.js and invokeDirectLLMContract.test.js
// run their functions. No network.
//
// Phase 1 (D235) pins: the authority shell (caller from `auth.me()` + one
// exact active intake membership, never from the body), the fail-closed
// configuration seam, the defensive insurance extraction (policy_number is
// the member ID; a document MRN is never read — D233), the payer directory,
// the once-per-fingerprint guard, the D232 redirect pin, and every 271
// fixture → its exact §4.4 outcome.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const AGENCY = 'agency-a';
const MEMBER_ID = 'SB1234563001';
const DOB = '1962-03-04';
const ENV = {
  OFFICE_ALLY_API_KEY: 'oa-test-key',
  OFFICE_ALLY_RECEIVER_NAME: 'Penn Home Health LLC',
  OFFICE_ALLY_RECEIVER_NPI: '1234567890',
};

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
const fingerprint = (payerId, memberId, dob) => createHash('sha256')
  .update(`${payerId}|${memberId}|${dob}`)
  .digest('hex');

// ---- referral + 271 fixtures ------------------------------------------------

function referralRow(overrides = {}) {
  return {
    id: 'referral-1',
    agency_id: AGENCY,
    version: 1,
    patient_name: 'Jane Sample',
    patient_dob: DOB,
    archived_at: null,
    extracted_data: {
      demographics: {
        full_name: 'Jane Sample',
        date_of_birth: DOB,
        insurance_primary: 'SecurityBlue',
        insurance_details: {
          primary: { provider: 'SecurityBlue', policy_number: MEMBER_ID, group_number: 'G1' },
        },
        // Sending-facility identifiers (D233): present in the packet, and
        // they must never reach the 270 or the outcome.
        mrn: 'MRN-998877',
        medical_record_number: 'MRN-998877',
      },
    },
    ...overrides,
  };
}

const ACTIVE_GENERIC_271 = {
  transactionSetIdentifierCode: '271',
  traceId: 'OA-TRACE-1001',
  informationSource: { payerId: 'SHCPAP', organizationName: 'Highmark Senior Health Company (PA)' },
  subscriber: {
    memberId: MEMBER_ID,
    benefits: [
      {
        eligibilityOrBenefitInformationCode: '1',
        serviceTypeCode: '30',
        coverageLevelCode: 'IND',
        planName: 'SecurityBlue HMO',
        planType: 'Medicare Advantage HMO',
        startDate: '2026-01-01',
        endDate: null,
        authorizationOrCertificationIndicator: 'N',
      },
    ],
  },
};

const ACTIVE_HOME_HEALTH_271 = {
  transactionSetIdentifierCode: '271',
  traceId: 'OA-TRACE-1002',
  informationSource: { payerId: 'SHCPAP', organizationName: 'Highmark Senior Health Company (PA)' },
  subscriber: {
    memberId: MEMBER_ID,
    benefits: [
      {
        eligibilityOrBenefitInformationCode: '1',
        serviceTypeCode: '30',
        coverageLevelCode: 'IND',
        planName: 'SecurityBlue HMO',
        planType: 'Medicare Advantage HMO',
        startDate: '2026-01-01',
        endDate: null,
      },
      {
        eligibilityOrBenefitInformationCode: 'C',
        serviceTypeCode: '30',
        coverageLevelCode: 'IND',
        amount: 250,
        remainingAmount: 75,
      },
      {
        eligibilityOrBenefitInformationCode: '1',
        serviceTypeCode: '42',
        coverageLevelCode: 'IND',
        startDate: '2026-01-01',
        authorizationOrCertificationIndicator: 'Y',
      },
      { eligibilityOrBenefitInformationCode: 'B', serviceTypeCode: '42', amount: 25 },
      { eligibilityOrBenefitInformationCode: 'A', serviceTypeCode: '42', percent: 0.2 },
      {
        eligibilityOrBenefitInformationCode: 'F',
        serviceTypeCode: '42',
        quantityQualifier: 'VS',
        quantity: 60,
        messages: ['Home health visits subject to plan limits.'],
      },
    ],
  },
};

const INACTIVE_271 = {
  transactionSetIdentifierCode: '271',
  traceId: 'OA-TRACE-1003',
  informationSource: { payerId: 'SHCPAP', organizationName: 'Highmark Senior Health Company (PA)' },
  subscriber: {
    memberId: MEMBER_ID,
    benefits: [
      {
        eligibilityOrBenefitInformationCode: '6',
        serviceTypeCode: '30',
        coverageLevelCode: 'IND',
        planName: 'SecurityBlue HMO',
        startDate: '2025-01-01',
        endDate: '2026-06-30',
      },
    ],
  },
};

const aaa271 = (level, actionCode, traceId) => ({
  transactionSetIdentifierCode: '271',
  traceId,
  informationSource: { payerId: 'SHCPAP', organizationName: 'Highmark Senior Health Company (PA)' },
  subscriber: {
    memberId: MEMBER_ID,
    aaa: [{ level, validRequestIndicator: 'N', actionCode, followUpActionCode: 'C' }],
  },
});

// ---- in-memory Base44 + Office Ally stand-in --------------------------------

function createRuntime({ env = ENV, respond = null } = {}) {
  const db = { AgencyMembership: [], Agency: [], Referral: [] };
  const users = new Map();
  const reads = { AgencyMembership: 0, Agency: 0, Referral: 0 };
  const oaCalls = [];

  function entity(name) {
    return {
      filter: async (query, sort, limit) => {
        assert.ok(Number.isInteger(limit), `${name}.filter needs a limit`);
        reads[name] += 1;
        return clone(db[name].filter((row) => matches(row, query)).slice(0, limit));
      },
    };
  }
  const entities = Object.fromEntries(Object.keys(db).map((name) => [name, entity(name)]));

  const fetch = async (url, init = {}) => {
    oaCalls.push({ url, init });
    if (respond) return respond({ url, init }, oaCalls.length);
    return new Response(JSON.stringify(ACTIVE_GENERIC_271), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const environment = { ...env };
  const Deno = { env: { get: (key) => environment[key] }, serve: () => {} };

  let handler;
  async function load() {
    if (handler) return handler;
    let source = await readFile(
      new URL('../functions/verifyReferralInsuranceEligibility/entry.ts', import.meta.url),
      'utf8',
    );
    const binding = `__verifyReferralInsuranceEligibilityHarness_${Math.random().toString(36).slice(2)}`;
    globalThis[binding] = {
      createClientFromRequest: () => ({
        auth: { me: async () => clone(users.get(currentToken) ?? null) },
        asServiceRole: { entities },
      }),
      Deno: { ...Deno, serve: (candidate) => { handler = candidate; } },
      fetch,
    };
    source = source.replace(/import \{ createClientFromRequest \} from 'npm:[^']+';/,
      `const createClientFromRequest = globalThis.${binding}.createClientFromRequest; `
      + `const Deno = globalThis.${binding}.Deno; const fetch = globalThis.${binding}.fetch;`);
    assert.doesNotMatch(source, /^import /m, 'the harness provides every import');
    const compiled = transpileTs(source, { fileName: 'verifyReferralInsuranceEligibility/entry.ts' }).outputText;
    await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}#${binding}`);
    assert.ok(handler, 'entry registered a handler');
    return handler;
  }

  let currentToken = null;
  async function call({ user = null, body, method = 'POST' } = {}) {
    const run = await load();
    currentToken = user;
    try {
      const response = await run(new Request('https://functions.test/verifyReferralInsuranceEligibility', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
      }));
      return { status: response.status, data: await response.json().catch(() => null) };
    } finally {
      currentToken = null;
    }
  }

  function addUser(key, { role = 'office_staff', active = true, withMembership = true, agencyId = AGENCY } = {}) {
    users.set(key, { id: key, email: `${key}@agency.test`, role: 'user', is_active: active });
    if (withMembership) {
      db.AgencyMembership.push({
        id: `membership-${key}`,
        membership_key: `${agencyId}:${key}`,
        agency_id: agencyId,
        user_id: key,
        user_email_normalized: `${key}@agency.test`,
        tenant_role: role,
        status: 'active',
        version: 3,
        created_by_user_id: 'platform-owner',
        activated_at: '2026-01-01T00:00:00.000Z',
        deactivated_at: null,
        revoked_at: null,
        revocation_reason: null,
        last_transition_by_user_id: 'platform-owner',
        last_transition_by_email_normalized: 'owner@agency.test',
        last_transition_at: '2026-01-01T00:00:00.000Z',
        last_transition_reason: 'invitation accepted',
      });
    }
  }

  db.Agency.push({ id: AGENCY, agency_name: 'Agency A', status: 'active' });
  db.Referral.push(referralRow());
  return { db, reads, oaCalls, call, addUser };
}

const verify = (runtime, overrides = {}) => runtime.call({
  user: 'nurse',
  body: { agency_id: AGENCY, referral_id: 'referral-1', trigger: 'referral_analysis', ...overrides },
});

// ---- authority ---------------------------------------------------------------

test('non-members are refused before any referral read or provider call', async () => {
  const runtime = createRuntime();
  runtime.addUser('outsider', { withMembership: false });
  runtime.addUser('otherAgency', { agencyId: 'agency-b' });
  runtime.addUser('clinician', { role: 'clinician' });

  const anonymous = await runtime.call({
    body: { agency_id: AGENCY, referral_id: 'referral-1', trigger: 'referral_analysis' },
  });
  assert.equal(anonymous.status, 401);

  const outsider = await runtime.call({
    user: 'outsider',
    body: { agency_id: AGENCY, referral_id: 'referral-1', trigger: 'referral_analysis' },
  });
  assert.equal(outsider.status, 403);
  assert.equal(outsider.data.error, 'No tenant membership for agency');

  const wrongAgency = await runtime.call({
    user: 'otherAgency',
    body: { agency_id: AGENCY, referral_id: 'referral-1', trigger: 'referral_analysis' },
  });
  assert.equal(wrongAgency.status, 403);

  const wrongRole = await runtime.call({
    user: 'clinician',
    body: { agency_id: AGENCY, referral_id: 'referral-1', trigger: 'referral_analysis' },
  });
  assert.equal(wrongRole.status, 403);
  assert.equal(wrongRole.data.error, 'Tenant role cannot use Referral intake');

  assert.equal(runtime.reads.Referral, 0, 'no referral read beyond membership checks');
  assert.equal(runtime.oaCalls.length, 0);
});

test('deactivated callers are refused and contract violations are 400s', async () => {
  const runtime = createRuntime();
  runtime.addUser('nurse');
  runtime.addUser('former', { active: false });

  const deactivated = await runtime.call({
    user: 'former',
    body: { agency_id: AGENCY, referral_id: 'referral-1', trigger: 'referral_analysis' },
  });
  assert.equal(deactivated.status, 403);
  assert.equal(deactivated.data.error, 'Unauthorized - account is deactivated');

  const extraKey = await runtime.call({
    user: 'nurse',
    body: {
      agency_id: AGENCY, referral_id: 'referral-1', trigger: 'referral_analysis', member_id: MEMBER_ID,
    },
  });
  assert.equal(extraKey.status, 400, 'caller-supplied demographics are refused');

  const badTrigger = await verify(runtime, { trigger: 'whenever' });
  assert.equal(badTrigger.status, 400);

  const wrongMethod = await runtime.call({ user: 'nurse', method: 'GET' });
  assert.equal(wrongMethod.status, 405);

  const missingReferral = await verify(runtime, { referral_id: 'referral-nope' });
  assert.equal(missingReferral.status, 404);

  assert.equal(runtime.oaCalls.length, 0);
});

// ---- fail-closed configuration seam ------------------------------------------

test('missing configuration answers not_configured with zero provider calls', async () => {
  for (const env of [
    {},
    { OFFICE_ALLY_RECEIVER_NAME: ENV.OFFICE_ALLY_RECEIVER_NAME, OFFICE_ALLY_RECEIVER_NPI: ENV.OFFICE_ALLY_RECEIVER_NPI },
    { OFFICE_ALLY_API_KEY: ENV.OFFICE_ALLY_API_KEY, OFFICE_ALLY_RECEIVER_NAME: ENV.OFFICE_ALLY_RECEIVER_NAME },
  ]) {
    const runtime = createRuntime({ env });
    runtime.addUser('nurse');
    const result = await verify(runtime);
    assert.equal(result.status, 200);
    assert.equal(result.data.success, true);
    assert.equal(result.data.verification.status, 'not_configured');
    assert.equal(result.data.verification.verified_at, null);
    assert.equal(result.data.verification.attempts, 0);
    assert.equal(runtime.oaCalls.length, 0);
  }
});

// ---- pre-call outcomes ---------------------------------------------------------

test('an unknown payer is payer_unsupported and never called', async () => {
  const runtime = createRuntime();
  runtime.addUser('nurse');
  runtime.db.Referral[0] = referralRow({
    extracted_data: {
      demographics: {
        full_name: 'Jane Sample',
        date_of_birth: DOB,
        insurance_primary: 'Aetna Better Health',
        insurance_details: { primary: { provider: 'Aetna Better Health', policy_number: MEMBER_ID } },
      },
    },
  });
  const result = await verify(runtime);
  assert.equal(result.status, 200);
  const verification = result.data.verification;
  assert.equal(verification.status, 'payer_unsupported');
  assert.equal(verification.payer_id, null);
  assert.equal(verification.payer_name, 'Aetna Better Health');
  assert.equal(verification.verified_at, null);
  assert.equal(runtime.oaCalls.length, 0);
});

test('missing search keys answer insufficient_data with the missing list and no call', async () => {
  const noMember = createRuntime();
  noMember.addUser('nurse');
  noMember.db.Referral[0] = referralRow({
    extracted_data: {
      demographics: {
        full_name: 'Jane Sample',
        date_of_birth: DOB,
        insurance_primary: 'SecurityBlue',
        insurance_details: { primary: { provider: 'SecurityBlue' } },
      },
    },
  });
  const noMemberResult = await verify(noMember);
  assert.equal(noMemberResult.data.verification.status, 'insufficient_data');
  assert.deepEqual(noMemberResult.data.verification.missing, ['member_id']);
  assert.equal(noMemberResult.data.verification.member_id_masked, null);
  assert.equal(noMember.oaCalls.length, 0);

  const noDob = createRuntime();
  noDob.addUser('nurse');
  noDob.db.Referral[0] = referralRow({
    patient_dob: null,
    extracted_data: {
      demographics: {
        full_name: 'Jane Sample',
        insurance_primary: 'SecurityBlue',
        insurance_details: { primary: { policy_number: MEMBER_ID } },
      },
    },
  });
  const noDobResult = await verify(noDob);
  assert.equal(noDobResult.data.verification.status, 'insufficient_data');
  assert.deepEqual(noDobResult.data.verification.missing, ['date_of_birth']);
  assert.equal(noDob.oaCalls.length, 0);
});

// ---- 271 fixtures → exact outcomes ---------------------------------------------

test('an active 271 with home-health lines yields the full verified_active outcome', async () => {
  const runtime = createRuntime({
    respond: async () => new Response(JSON.stringify(ACTIVE_HOME_HEALTH_271), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  });
  runtime.addUser('nurse');
  const result = await verify(runtime);
  assert.equal(result.status, 200);
  const v = result.data.verification;
  assert.equal(v.status, 'verified_active');
  assert.equal(v.provider, 'office_ally');
  assert.equal(v.trigger, 'referral_analysis');
  assert.ok(v.verified_at, 'a payer-answered outcome carries verified_at');
  assert.equal(v.payer_id, 'SHCPAP');
  assert.equal(v.payer_name, 'Highmark Senior Health Company (PA)');
  assert.equal(v.plan_name, 'SecurityBlue HMO');
  assert.equal(v.plan_type, 'Medicare Advantage HMO');
  assert.equal(v.member_id_masked, '…3001');
  assert.equal(v.input_fingerprint, fingerprint('SHCPAP', MEMBER_ID, DOB));
  assert.deepEqual(v.coverage, { active: true, effective_date: '2026-01-01', termination_date: null });
  assert.deepEqual(v.benefits.home_health, {
    copay: 25,
    coinsurance_percent: 20,
    visit_limit: 60,
    notes: 'Home health visits subject to plan limits.',
  });
  assert.deepEqual(v.benefits.deductible, { individual_total: 250, individual_remaining: 75 });
  assert.equal(v.benefits.prior_auth, 'required');
  assert.equal(v.trace_id, 'OA-TRACE-1002');
  assert.equal(v.aaa_code, null);
  assert.equal(v.attempts, 1);
  assert.deepEqual(v.missing, []);
  assert.match(v.message, /^Coverage active — SecurityBlue HMO\./);
});

test('an active generic-only 271 leaves home-health and deductible null, never fabricated', async () => {
  const runtime = createRuntime();
  runtime.addUser('nurse');
  const result = await verify(runtime);
  const v = result.data.verification;
  assert.equal(v.status, 'verified_active');
  assert.deepEqual(v.benefits.home_health, {
    copay: null, coinsurance_percent: null, visit_limit: null, notes: null,
  });
  assert.deepEqual(v.benefits.deductible, { individual_total: null, individual_remaining: null });
  assert.equal(v.benefits.prior_auth, 'not_required', 'an explicit EB11 N is the only not_required source');
});

test('an inactive 271 yields verified_inactive with the termination date', async () => {
  const runtime = createRuntime({
    respond: async () => new Response(JSON.stringify(INACTIVE_271), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  });
  runtime.addUser('nurse');
  const result = await verify(runtime);
  const v = result.data.verification;
  assert.equal(v.status, 'verified_inactive');
  assert.ok(v.verified_at);
  assert.deepEqual(v.coverage, { active: false, effective_date: '2025-01-01', termination_date: '2026-06-30' });
});

test('AAA fixtures map to the §4.5 taxonomy', async () => {
  const cases = [
    { fixture: aaa271('subscriber', '42', 'OA-TRACE-2001'), status: 'payer_unavailable', aaa: '42' },
    { fixture: aaa271('subscriber', '80', 'OA-TRACE-2002'), status: 'payer_unavailable', aaa: '80' },
    { fixture: aaa271('subscriber', '15', 'OA-TRACE-2003'), status: 'member_not_found', aaa: '15' },
    { fixture: aaa271('receiver', '50', 'OA-TRACE-2004'), status: 'provider_not_enrolled', aaa: '50' },
  ];
  for (const { fixture, status, aaa } of cases) {
    const runtime = createRuntime({
      respond: async () => new Response(JSON.stringify(fixture), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    });
    runtime.addUser('nurse');
    const result = await verify(runtime);
    const v = result.data.verification;
    assert.equal(v.status, status, JSON.stringify(fixture.subscriber.aaa));
    assert.equal(v.aaa_code, aaa);
    assert.ok(v.verified_at, 'an AAA 271 is a payer answer');
    assert.equal(v.trace_id, fixture.traceId);
    assert.equal(runtime.oaCalls.length, 1, 'no automatic resubmission');
  }
});

test('malformed, error-status, redirect, and oversized responses are error outcomes', async () => {
  const malformed = createRuntime({
    respond: async () => new Response('<html>not a 271</html>', { status: 200 }),
  });
  malformed.addUser('nurse');
  const malformedResult = await verify(malformed);
  assert.equal(malformedResult.data.verification.status, 'error');
  assert.equal(malformedResult.data.verification.verified_at, null);

  const http500 = createRuntime({
    respond: async () => new Response(JSON.stringify({ error: 'boom' }), { status: 500 }),
  });
  http500.addUser('nurse');
  const http500Result = await verify(http500);
  assert.equal(http500Result.data.verification.status, 'error');

  const redirect = createRuntime({
    respond: async () => new Response('{}', {
      status: 302,
      headers: { location: 'https://elsewhere.invalid/eligibility' },
    }),
  });
  redirect.addUser('nurse');
  const redirectResult = await verify(redirect);
  assert.equal(redirectResult.data.verification.status, 'error', 'a 3xx is refused, never followed');
  assert.equal(redirect.oaCalls.length, 1);
  assert.equal(redirect.oaCalls[0].init.redirect, 'manual', 'D232 pin');
  assert.equal(redirect.oaCalls[0].init.method, 'POST');

  const oversized = createRuntime({
    respond: async () => new Response(JSON.stringify({ pad: 'x'.repeat(300_000) }), { status: 200 }),
  });
  oversized.addUser('nurse');
  const oversizedResult = await verify(oversized);
  assert.equal(oversizedResult.data.verification.status, 'error');

  const ack999 = createRuntime({
    respond: async () => new Response(JSON.stringify({
      transactionSetIdentifierCode: '999', traceId: 'OA-TRACE-9999',
    }), { status: 200 }),
  });
  ack999.addUser('nurse');
  const ackResult = await verify(ack999);
  assert.equal(ackResult.data.verification.status, 'error');
  assert.equal(ackResult.data.verification.trace_id, 'OA-TRACE-9999');
});

test('a transport failure answers payer_unavailable without a verified_at', async () => {
  const runtime = createRuntime({
    respond: async () => { throw new DOMException('The operation timed out', 'TimeoutError'); },
  });
  runtime.addUser('nurse');
  const result = await verify(runtime);
  const v = result.data.verification;
  assert.equal(v.status, 'payer_unavailable');
  assert.equal(v.verified_at, null, 'no 271 was answered');
  assert.equal(v.aaa_code, null);
  assert.equal(runtime.oaCalls.length, 1, 'no automatic resubmission');
});

// ---- wire shape + PHI discipline -------------------------------------------------

test('the 270 carries the receiver identity, EQ 30+42, and the policy number — never an MRN', async () => {
  const runtime = createRuntime();
  runtime.addUser('nurse');
  const result = await verify(runtime);
  assert.equal(result.data.verification.status, 'verified_active');
  assert.equal(runtime.oaCalls.length, 1);
  const { url, init } = runtime.oaCalls[0];
  assert.equal(url, 'https://edi.officeally.io/api/eligibility');
  assert.equal(init.redirect, 'manual');
  assert.equal(init.headers['x-api-key'], 'oa-test-key');
  const body = JSON.parse(init.body);
  assert.equal(body.informationSource.payerId, 'SHCPAP');
  assert.equal(body.informationReceiver.organizationName, 'Penn Home Health LLC');
  assert.equal(body.informationReceiver.npi, '1234567890');
  assert.equal(body.subscriber.memberId, MEMBER_ID, 'the policy number is the member ID');
  assert.equal(body.subscriber.lastName, 'Sample');
  assert.equal(body.subscriber.firstName, 'Jane');
  assert.equal(body.subscriber.dateOfBirth, '19620304');
  assert.deepEqual(body.subscriber.serviceTypeCodes, ['30', '42']);
  assert.equal(body.subscriber.dateOfService, result.data.verification.date_of_service);
  assert.ok(!JSON.stringify(body).includes('MRN-998877'), 'the sending facility MRN never reaches the 270');
  assert.ok(!JSON.stringify(result.data).includes(MEMBER_ID), 'the full member ID is never in the outcome');
  assert.ok(!JSON.stringify(result.data).includes('MRN-998877'));
});

// ---- fingerprint guard -------------------------------------------------------------

test('the fingerprint guard returns the stored answered outcome; manual re-verify re-spends and increments', async () => {
  const storedVerification = {
    status: 'verified_active',
    provider: 'office_ally',
    trigger: 'referral_analysis',
    attempted_at: '2026-10-01T12:00:00.000Z',
    verified_at: '2026-10-01T12:00:01.000Z',
    payer_id: 'SHCPAP',
    payer_name: 'Highmark Senior Health Company (PA)',
    plan_name: 'SecurityBlue HMO',
    plan_type: 'Medicare Advantage HMO',
    member_id_masked: '…3001',
    date_of_service: '2026-10-01',
    input_fingerprint: fingerprint('SHCPAP', MEMBER_ID, DOB),
    coverage: { active: true, effective_date: '2026-01-01', termination_date: null },
    benefits: {
      home_health: { copay: null, coinsurance_percent: null, visit_limit: null, notes: null },
      deductible: { individual_total: null, individual_remaining: null },
      prior_auth: 'unknown',
    },
    message: 'Coverage active — SecurityBlue HMO.',
    aaa_code: null,
    trace_id: 'OA-TRACE-OLD',
    attempts: 2,
    missing: [],
  };

  const guarded = createRuntime();
  guarded.addUser('nurse');
  guarded.db.Referral[0] = referralRow({ insurance_verification: clone(storedVerification) });
  const guardedResult = await verify(guarded);
  assert.equal(guardedResult.status, 200);
  assert.deepEqual(guardedResult.data.verification, storedVerification);
  assert.equal(guarded.oaCalls.length, 0, 'reprocessing never re-spends a transaction');

  const manual = createRuntime();
  manual.addUser('nurse');
  manual.db.Referral[0] = referralRow({ insurance_verification: clone(storedVerification) });
  const manualResult = await verify(manual, { trigger: 'manual_reverify' });
  assert.equal(manual.oaCalls.length, 1, 'manual re-verify always fires');
  assert.equal(manualResult.data.verification.status, 'verified_active');
  assert.equal(manualResult.data.verification.attempts, 3, 'attempts increments past the stored count');
  assert.equal(manualResult.data.verification.trace_id, 'OA-TRACE-1001');
});

// ---- payer directory ------------------------------------------------------------------

test('payer name variants normalize onto the seeded directory', async () => {
  const cases = [
    { payer: 'SecurityBlue', payerId: 'SHCPAP' },
    { payer: 'security blue', payerId: 'SHCPAP' },
    { payer: 'Highmark Senior Health Company', payerId: 'SHCPAP' },
    { payer: 'Highmark BCBS', payerId: 'SHCPAP' },
    { payer: 'Highmark Health Options', payerId: 'HHO' },
    { payer: 'Highmark Western New York', payerId: '55204' },
    { payer: 'BCBS Western New York', payerId: '00246' },
  ];
  for (const { payer, payerId } of cases) {
    const runtime = createRuntime();
    runtime.addUser('nurse');
    runtime.db.Referral[0] = referralRow({
      extracted_data: {
        demographics: {
          full_name: 'Jane Sample',
          date_of_birth: DOB,
          insurance_primary: payer,
          insurance_details: { primary: { provider: payer, policy_number: MEMBER_ID } },
        },
      },
    });
    const result = await verify(runtime);
    assert.equal(result.data.verification.payer_id, payerId, payer);
    assert.equal(JSON.parse(runtime.oaCalls[0].init.body).informationSource.payerId, payerId, payer);
  }
});

test('member ID falls back through member_id then legacy policy_numbers', async () => {
  const legacy = createRuntime();
  legacy.addUser('nurse');
  legacy.db.Referral[0] = referralRow({
    extracted_data: {
      demographics: {
        full_name: 'Sample, Jane',
        date_of_birth: '03/04/1962',
        insurance_primary: 'SecurityBlue',
        policy_numbers: MEMBER_ID,
      },
    },
  });
  const legacyResult = await verify(legacy);
  assert.equal(legacyResult.data.verification.status, 'verified_active');
  const legacyBody = JSON.parse(legacy.oaCalls[0].init.body);
  assert.equal(legacyBody.subscriber.memberId, MEMBER_ID);
  assert.equal(legacyBody.subscriber.lastName, 'Sample');
  assert.equal(legacyBody.subscriber.firstName, 'Jane');
  assert.equal(legacyBody.subscriber.dateOfBirth, '19620304');
});
