import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCoreWorkQueues } from './coreWorkQueues.js';

test('buildCoreWorkQueues gives nurses task and note queues only', () => {
  const queues = buildCoreWorkQueues({
    role: 'nurse',
    tasks: [{ status: 'pending' }, { status: 'completed' }],
    notes: [{ status: 'pending_review' }],
    referrals: [{ status: 'awaiting_info' }],
  });
  assert.deepEqual(queues.map((q) => q.id), ['notes-pending-review', 'my-open-tasks']);
});

test('buildCoreWorkQueues gives admins referral, incident, credential, task, and note queues', () => {
  const queues = buildCoreWorkQueues({
    role: 'facility_admin',
    referrals: [{ status: 'awaiting_info' }, { requires_manual_review: true }, { status: 'ready_for_admission' }],
    incidents: [{ status: 'reported' }, { status: 'resolved' }],
    credentials: [{ status: 'pending_approval' }, { status: 'approved' }],
    tasks: [{ status: 'pending' }],
    notes: [{ status: 'submitted' }],
  });
  assert.deepEqual(queues.map((q) => q.id), [
    'referrals-awaiting-info',
    'incidents-open-review',
    'notes-pending-review',
    'credentials-pending',
    'my-open-tasks',
  ]);
  assert.equal(queues[0].count, 2);
});

test('buildCoreWorkQueues gives managers the referral queue but not admin review queues', () => {
  const queues = buildCoreWorkQueues({
    role: 'manager',
    referrals: [{ status: 'awaiting_info' }],
    incidents: [{ status: 'reported' }],
    credentials: [{ status: 'pending_approval' }],
    notes: [{ status: 'submitted' }],
  });
  assert.deepEqual(queues.map((q) => q.id), ['notes-pending-review', 'referrals-awaiting-info']);
  assert.equal(queues.find((q) => q.id === 'referrals-awaiting-info').route, '/ReferralIntake');
  assert.equal(queues.some((q) => q.route === '/IncidentReview' || q.route === '/CredentialCompliance'), false);
});

test('Dashboard loads manager referrals through the bound-authority broker and shows their queue outside clinical-only content', () => {
  const dashboard = readFileSync(new URL('../../pages/Dashboard.jsx', import.meta.url), 'utf8');
  const referralQuery = dashboard.slice(
    dashboard.indexOf('const { data: managerReferrals'),
    dashboard.indexOf('if (isLoading)'),
  );

  assert.match(dashboard, /import \{ listAuthorizedReferrals \} from ["']@\/functions\/manageAuthorizedReferral["']/);
  assert.match(referralQuery, /agencyId: tenantContext\.agency_id/);
  assert.match(referralQuery, /status: ["']awaiting_info["']/);
  assert.match(referralQuery, /limit: 5000/);
  assert.match(referralQuery, /enabled: workQueueRole === ["']manager["'] && !!tenantContext\?\.agency_id/);
  assert.doesNotMatch(referralQuery, /base44\.entities\.(?:Task|Visit|ClinicalEvent)\./);
  assert.match(dashboard, /\{\(clinical \|\| workQueueRole === ["']manager["']\) && \(\s*<CoreWorkQueuesStrip/);
  assert.match(dashboard, /<CoreWorkQueuesStrip[\s\S]*?referrals=\{managerReferrals\}/);
});

test('buildCoreWorkQueues omits empty queues', () => {
  assert.deepEqual(buildCoreWorkQueues({ role: 'admin' }), []);
});
