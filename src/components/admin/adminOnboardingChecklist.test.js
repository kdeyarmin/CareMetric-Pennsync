import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdminOnboardingChecklist } from './adminOnboardingChecklist.js';

test('admin onboarding checklist reports required setup progress and next action', () => {
  const checklist = buildAdminOnboardingChecklist({ appConfigured: true, agencyProfileComplete: true });
  assert.equal(checklist.percentComplete, 40);
  assert.equal(checklist.readyForPilot, false);
  assert.equal(checklist.nextAction.id, 'staff_invites');
});

test('admin onboarding checklist is ready for pilot when required checks are complete', () => {
  const checklist = buildAdminOnboardingChecklist({ appConfigured: true, agencyProfileComplete: true, invitedStaffCount: 2, clinicalTemplateCount: 1, requiredTrainingAssigned: true });
  assert.equal(checklist.percentComplete, 100);
  assert.equal(checklist.readyForPilot, true);
  assert.equal(checklist.nextAction.id, 'telnyx_secret');
});
