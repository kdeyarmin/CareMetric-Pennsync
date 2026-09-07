import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = new URL('../../', import.meta.url);
const FUNCTIONS_ROOT = new URL('../functions/', import.meta.url);

const EMAIL_SENDERS = [
  'adminResetPassword',
  'autoApproveInvitedUser',
  'cancelTimeOffRequest',
  'checkExpiredInvitations',
  'createNotification',
  'createUserWithTempPassword',
  'dispatchScheduledSignatureReminders',
  'generateAIReport',
  'generatePatientHandout',
  'generateSignerToken',
  'onUserSignup',
  'resetUserPassword',
  'reviewPersonnelCredential',
  'reviewTimeOffRequest',
  'reviewTimesheet',
  'sendAccountReadyEmail',
  'sendCredentialRenewalReminders',
  'sendFaxStatusNotification',
  'sendPersonnelExpirationNotifications',
  'sendTrainingCertificateEmail',
  'sendWelcomeEmail',
  'submitPersonnelCredential',
  'submitStateReportableIncident',
  'submitTimeOffRequest',
  'submitTimesheet',
  'userManagement',
];

const INVITE_SENDERS = [
  'adminResetPassword',
  'createUserWithTempPassword',
  'resendInvitation',
];

const SMS_SENDERS = [
  'dispatchScheduledSms',
  'handleTelnyxStatusWebhook',
  'redriveFailedSms',
  'sendFaxStatusNotification',
  'sendSms',
  'sendTestSms',
];

const FAX_SENDERS = [
  'handleTelnyxStatusWebhook',
  'sendAuthorizedReferralFax',
  'sendBatchFax',
  'sendFax',
];

const VOICE_SENDERS = [
  'handleTelnyxStatusWebhook',
  'startMaskedCall',
];

// Every function in the primitive census must be named here. The classification
// is deliberately explicit: mixed state-transition handlers keep their primary
// mutation live while skipping delivery; platform-boundary handlers invoke a
// Base44-managed invite/OTP primitive; provider wrappers define a low-level
// Telnyx helper above the handler but gate every reachable invocation.
const BACKEND_DELIVERY_CLASSIFICATION = {
  adminResetPassword: 'platform-boundary',
  autoApproveInvitedUser: 'mixed-state-transition',
  cancelTimeOffRequest: 'mixed-state-transition',
  checkExpiredInvitations: 'scheduled-maintenance',
  createNotification: 'mixed-state-transition',
  createUserWithTempPassword: 'platform-boundary',
  dispatchScheduledSignatureReminders: 'scheduled-worker',
  dispatchScheduledSms: 'provider-wrapper',
  generateAIReport: 'direct',
  generatePatientHandout: 'direct',
  generateSignerToken: 'direct',
  handleTelnyxStatusWebhook: 'mixed-channel',
  manageUserVerification: 'platform-boundary',
  onUserSignup: 'mixed-platform-boundary',
  redriveFailedSms: 'provider-wrapper',
  resendInvitation: 'platform-boundary',
  resetUserPassword: 'direct',
  reviewPersonnelCredential: 'mixed-state-transition',
  reviewTimeOffRequest: 'mixed-state-transition',
  reviewTimesheet: 'mixed-state-transition',
  sendAccountReadyEmail: 'direct',
  sendAuthorizedReferralFax: 'direct',
  sendBatchFax: 'provider-wrapper',
  sendCredentialRenewalReminders: 'scheduled-worker',
  sendFax: 'direct',
  sendFaxStatusNotification: 'mixed-channel',
  sendPersonnelExpirationNotifications: 'scheduled-maintenance',
  sendSms: 'direct',
  sendTestSms: 'direct',
  sendTrainingCertificateEmail: 'direct',
  sendWelcomeEmail: 'direct',
  startMaskedCall: 'direct',
  submitPersonnelCredential: 'mixed-state-transition',
  submitStateReportableIncident: 'mixed-state-transition',
  submitTimeOffRequest: 'mixed-state-transition',
  submitTimesheet: 'mixed-state-transition',
  userManagement: 'mixed-platform-boundary',
};

const PROVIDER_PRIMITIVE = /(?:\.SendEmail\s*\(|\.inviteUser\s*\(|\.resendOtp\s*\(|\/auth\/resend-otp|\/v2\/(?:messages|faxes|calls))/g;
const WRAPPED_PROVIDER_EFFECT = {
  dispatchScheduledSms: /\bresp\s*=\s*await\s+sendTelnyx\s*\(/g,
  redriveFailedSms: /\bresp\s*=\s*await\s+sendTelnyx\s*\(/g,
  sendBatchFax: /(?:results\.push\(await|const result\s*=\s*await)\s+submitOneFax\s*\(/g,
};

const BROWSER_EMAIL_PATHS = [
  'src/components/education/PersonalizedEducationGenerator.jsx',
  'src/components/feedback/FeedbackButton.jsx',
  'src/components/hub-tabs/ComplianceMonitoringDashboard.jsx',
  'src/components/patient/PersonalizedEducationGenerator.jsx',
  'src/components/referral/AdmissionBriefEmailCard.jsx',
  'src/pages/ComplianceCenter.jsx',
];

async function functionSources() {
  const entries = await readdir(FUNCTIONS_ROOT, { withFileTypes: true });
  const pairs = await Promise.all(entries
    .filter((entry) => entry.isDirectory())
    .map(async (entry) => {
      const url = new URL(`./${entry.name}/entry.ts`, FUNCTIONS_ROOT);
      return [entry.name, await readFile(url, 'utf8').catch(() => '')];
    }));
  return new Map(pairs.filter(([, source]) => source));
}

function matchingFunctions(sources, predicate) {
  return [...sources]
    .filter(([, source]) => predicate(source))
    .map(([name]) => name)
    .sort();
}

async function sourceFiles(directory) {
  const output = [];
  async function visit(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) {
        await visit(child);
      } else if (['.js', '.jsx', '.ts', '.tsx'].includes(extname(entry.name))) {
        if (!/\.(?:spec|test)\.[^.]+$/.test(entry.name)) output.push(child);
      }
    }
  }
  await visit(directory);
  return output;
}

test('the canonical delivery gate is strict, secretless-by-default, and no-store', async () => {
  const canonical = await readFile(
    new URL('../_shared/backendHelpers.mjs', import.meta.url),
    'utf8',
  );
  const health = await readFile(
    new URL('../functions/checkAllIntegrations/entry.ts', import.meta.url),
    'utf8',
  );

  assert.match(canonical, /outboundDeliveryGate:/);
  assert.match(canonical, /OUTBOUND_DELIVERY_RELEASE_ENV = 'OUTBOUND_DELIVERY_RELEASE'/);
  assert.match(canonical, /OUTBOUND_DELIVERY_RELEASE_VALUE = 'enabled-v1'/);
  assert.match(
    canonical,
    /Deno\.env\.get\(OUTBOUND_DELIVERY_RELEASE_ENV\)\s*=== OUTBOUND_DELIVERY_RELEASE_VALUE/,
  );
  assert.doesNotMatch(
    canonical.slice(
      canonical.indexOf('outboundDeliveryGate:'),
      canonical.indexOf('pdgmReimbursementGate:'),
    ),
    /\.trim\(/,
  );
  assert.match(canonical, /code: 'OUTBOUND_DELIVERY_RELEASE_PAUSED'/);
  assert.match(canonical, /status: 503/);
  assert.match(canonical, /'Cache-Control': 'no-store'/);
  assert.match(health, /BEGIN SHARED HELPER: outboundDeliveryGate/);
  assert.match(health, /release_state: outboundDeliveryIsReleased \? 'released' : 'paused'/);
});

test('backend delivery primitive inventory cannot grow unnoticed', async () => {
  const sources = await functionSources();

  assert.deepEqual(
    matchingFunctions(sources, (source) => /\.SendEmail\s*\(/.test(source)),
    [...EMAIL_SENDERS].sort(),
  );
  assert.deepEqual(
    matchingFunctions(sources, (source) => /\.inviteUser\s*\(/.test(source)),
    [...INVITE_SENDERS].sort(),
  );
  assert.deepEqual(
    matchingFunctions(sources, (source) => /\.resendOtp\s*\(/.test(source)),
    ['manageUserVerification'],
  );
  assert.deepEqual(
    matchingFunctions(sources, (source) => /\/auth\/resend-otp/.test(source)),
    ['onUserSignup'],
  );
  assert.deepEqual(
    matchingFunctions(sources, (source) => (
      /\/v2\/messages/.test(source)
      && /method\s*:\s*['"]POST['"]/.test(source)
    )),
    [...SMS_SENDERS].sort(),
  );
  assert.deepEqual(
    matchingFunctions(sources, (source) => (
      /\/v2\/faxes(?:['"`/$?{])/.test(source)
      && /method\s*:\s*['"]POST['"]/.test(source)
    )),
    [...FAX_SENDERS].sort(),
  );
  assert.deepEqual(
    matchingFunctions(sources, (source) => (
      /\/v2\/calls(?:['"`/$?{])/.test(source)
      && /method\s*:\s*['"]POST['"]/.test(source)
    )),
    [...VOICE_SENDERS].sort(),
  );
});

test('every inventoried backend sender is classified and fail-closed before delivery', async () => {
  const sources = await functionSources();
  const inventory = new Set([
    ...EMAIL_SENDERS,
    ...INVITE_SENDERS,
    ...SMS_SENDERS,
    ...FAX_SENDERS,
    ...VOICE_SENDERS,
    'manageUserVerification',
    'onUserSignup',
  ]);
  assert.deepEqual(
    Object.keys(BACKEND_DELIVERY_CLASSIFICATION).sort(),
    [...inventory].sort(),
    'every primitive-bearing function must have an explicit delivery classification',
  );

  for (const [name, classification] of Object.entries(BACKEND_DELIVERY_CLASSIFICATION)) {
    const source = sources.get(name);
    assert.ok(source, `${name}: source exists`);
    assert.ok(
      ['direct', 'mixed-state-transition', 'scheduled-maintenance', 'scheduled-worker',
        'provider-wrapper', 'mixed-channel', 'platform-boundary',
        'mixed-platform-boundary'].includes(classification),
      `${name}: known classification`,
    );

    const marker = source.indexOf('BEGIN SHARED HELPER: outboundDeliveryGate');
    PROVIDER_PRIMITIVE.lastIndex = 0;
    const firstPrimitive = PROVIDER_PRIMITIVE.exec(source)?.index ?? -1;
    assert.notEqual(marker, -1, `${name}: canonical gate marker exists`);
    assert.notEqual(firstPrimitive, -1, `${name}: provider primitive exists`);
    assert.ok(marker < firstPrimitive, `${name}: gate helper is declared before its first provider primitive`);

    const releaseChecks = [...source.matchAll(/outboundDeliveryReleased\s*\(\s*\)/g)]
      .map((match) => match.index)
      .filter((index) => !/function\s*$/.test(source.slice(Math.max(0, index - 20), index)));
    assert.ok(releaseChecks.length > 0, `${name}: has a runtime release check`);

    const effectPattern = WRAPPED_PROVIDER_EFFECT[name] || PROVIDER_PRIMITIVE;
    effectPattern.lastIndex = 0;
    const effects = [...source.matchAll(effectPattern)].map((match) => match.index);
    assert.ok(effects.length > 0, `${name}: classified delivery effect exists`);
    if (classification !== 'provider-wrapper') {
      for (const effect of effects) {
        assert.ok(
          releaseChecks.some((check) => check < effect),
          `${name}: release check precedes provider primitive at source offset ${effect}`,
        );
      }
    } else {
      // The primitive is encapsulated in a source-level helper. Reachability is
      // guarded at each handler/action boundary; the dedicated assigned-function
      // contract asserts those branch-specific orderings for sendBatchFax.
      assert.ok(
        effects.some((effect) => releaseChecks.some((check) => check < effect)),
        `${name}: a release check precedes the reachable provider-helper invocation`,
      );
    }
  }
});

test('browser production code has no direct email primitive or release flag', async () => {
  const srcRoot = new URL('../../src/', import.meta.url);
  const srcRootPath = fileURLToPath(srcRoot);
  const files = await sourceFiles(srcRootPath);
  const offenders = [];
  for (const path of files) {
    const source = await readFile(path, 'utf8');
    if (/\.SendEmail\s*\(/.test(source) || /export const SendEmail\b/.test(source)) {
      offenders.push(relative(srcRootPath, path));
    }
  }
  assert.deepEqual(offenders, []);

  const containment = await readFile(
    new URL('../../src/lib/outboundDeliveryContainment.js', import.meta.url),
    'utf8',
  );
  assert.match(containment, /OUTBOUND_DELIVERY_RELEASE_PAUSED/);
  assert.doesNotMatch(containment, /import\.meta\.env|process\.env|base44[^\n]*SendEmail/);

  for (const path of BROWSER_EMAIL_PATHS) {
    const source = await readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
    assert.match(source, /outboundDeliveryContainment/, path);
    assert.match(source, /(?:rejectOutboundDelivery|OUTBOUND_DELIVERY_PAUSED_MESSAGE)/, path);
  }
});
