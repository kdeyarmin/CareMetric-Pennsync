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
  'createUserWithTempPasswordV2',
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
  'userManagementV2',
];

const INVITE_SENDERS = [
  'adminResetPassword',
  'createUserWithTempPassword',
  'createUserWithTempPasswordV2',
  'resendInvitation',
  'resendInvitationV2',
  'userManagement',
  'userManagementV2',
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
// Telnyx helper above the handler but gate every reachable invocation. Protected
// manual invitations are explicitly released independently of the general gate;
// mixed invitation handlers retain that gate on their other delivery actions.
const BACKEND_DELIVERY_CLASSIFICATION = {
  adminResetPassword: 'platform-boundary',
  autoApproveInvitedUser: 'mixed-state-transition',
  cancelTimeOffRequest: 'mixed-state-transition',
  checkExpiredInvitations: 'scheduled-maintenance',
  createNotification: 'mixed-state-transition',
  createUserWithTempPassword: 'manual-invitation',
  createUserWithTempPasswordV2: 'manual-invitation',
  dispatchScheduledSignatureReminders: 'scheduled-worker',
  dispatchScheduledSms: 'provider-wrapper',
  generateAIReport: 'direct',
  generatePatientHandout: 'direct',
  generateSignerToken: 'direct',
  handleTelnyxStatusWebhook: 'mixed-channel',
  manageUserVerification: 'platform-boundary',
  onUserSignup: 'mixed-platform-boundary',
  redriveFailedSms: 'provider-wrapper',
  resendInvitation: 'manual-invitation',
  resendInvitationV2: 'manual-invitation',
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
  userManagement: 'mixed-with-manual-invitation',
  userManagementV2: 'mixed-with-manual-invitation',
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

test('every backend sender is gated or an explicitly scoped protected manual invitation', async () => {
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
  assert.deepEqual(
    Object.entries(BACKEND_DELIVERY_CLASSIFICATION)
      .filter(([, classification]) => classification === 'manual-invitation')
      .map(([name]) => name).sort(),
    ['createUserWithTempPassword', 'createUserWithTempPasswordV2', 'resendInvitation', 'resendInvitationV2'],
    'only the protected invitation endpoints omit the general gate',
  );
  assert.deepEqual(
    Object.entries(BACKEND_DELIVERY_CLASSIFICATION)
      .filter(([, classification]) => classification === 'mixed-with-manual-invitation')
      .map(([name]) => name),
    ['userManagement', 'userManagementV2'],
    'mixed exceptions are restricted to userManagement invitation actions',
  );

  for (const [name, classification] of Object.entries(BACKEND_DELIVERY_CLASSIFICATION)) {
    const source = sources.get(name);
    assert.ok(source, `${name}: source exists`);
    assert.ok(
      ['direct', 'mixed-state-transition', 'scheduled-maintenance', 'scheduled-worker',
        'provider-wrapper', 'mixed-channel', 'platform-boundary',
        'mixed-platform-boundary', 'manual-invitation',
        'mixed-with-manual-invitation'].includes(classification),
      `${name}: known classification`,
    );

    const marker = source.indexOf('BEGIN SHARED HELPER: outboundDeliveryGate');
    PROVIDER_PRIMITIVE.lastIndex = 0;
    const firstPrimitive = PROVIDER_PRIMITIVE.exec(source)?.index ?? -1;
    assert.notEqual(firstPrimitive, -1, `${name}: provider primitive exists`);
    if (classification === 'manual-invitation') {
      assert.equal(marker, -1, `${name}: unused general gate is absent`);
      assert.doesNotMatch(source, /outboundDeliveryReleased\s*\(/);
      const primitives = [...source.matchAll(new RegExp(PROVIDER_PRIMITIVE.source, 'g'))];
      assert.equal(primitives.length, name.startsWith('createUserWithTempPassword') ? 2 : 1,
        `${name}: only its reviewed invitation delivery primitives are exempt`);
      continue;
    }
    assert.notEqual(marker, -1, `${name}: canonical gate marker exists`);
    assert.ok(marker < firstPrimitive, `${name}: gate helper is declared before its first provider primitive`);

    const releaseChecks = [...source.matchAll(/outboundDeliveryReleased\s*\(\s*\)/g)]
      .map((match) => match.index)
      .filter((index) => !/function\s*$/.test(source.slice(Math.max(0, index - 20), index)));
    assert.ok(releaseChecks.length > 0, `${name}: has a runtime release check`);

    const effectPattern = WRAPPED_PROVIDER_EFFECT[name] || PROVIDER_PRIMITIVE;
    effectPattern.lastIndex = 0;
    const effects = [...source.matchAll(effectPattern)].map((match) => match.index);
    assert.ok(effects.length > 0, `${name}: classified delivery effect exists`);
    let gatedEffects = effects;
    if (classification === 'mixed-with-manual-invitation') {
      const manualRanges = [
        ['inviteUser', 'resendInvitation'],
        ['resendInvitation', 'resetPassword'],
      ].map(([startName, endName]) => {
        const start = source.indexOf(`async function ${startName}(`);
        const end = source.indexOf(`async function ${endName}(`);
        assert.ok(start >= 0 && end > start, `${name}: exact ${startName} action exists`);
        const action = source.slice(start, end);
        assert.doesNotMatch(action, /outboundDeliveryReleased\s*\(/,
          `${name}: ${startName} remains independent of the general gate`);
        assert.equal([...action.matchAll(PROVIDER_PRIMITIVE)].length, 1,
          `${name}: ${startName} exempts only its invitation email`);
        return { start, end };
      });
      gatedEffects = effects.filter((effect) => !manualRanges.some(({ start, end }) => effect >= start && effect < end));
      assert.equal(gatedEffects.length, 2,
        `${name}: password-recovery and expiry-digest emails remain under the general gate`);
      const resetAction = source.slice(source.indexOf('async function resetPassword('));
      const resetGate = resetAction.indexOf('!outboundDeliveryReleased()');
      assert.ok(resetGate >= 0 && resetGate < resetAction.indexOf('.SendEmail('),
        `${name}: password recovery retains its own gate`);
      assert.match(source, /case 'check_expired_invitations':[\s\S]*?if \(!outboundDeliveryReleased\(\)\) return outboundDeliveryPausedResponse\('email'\);[\s\S]*?return await checkExpiredInvitations\(base44\);/,
        `${name}: expiry digests retain their dispatch gate`);
    }
    if (classification !== 'provider-wrapper') {
      for (const effect of gatedEffects) {
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
