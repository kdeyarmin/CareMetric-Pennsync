const CHECKS = Object.freeze([
  { id: 'app_config', label: 'Base44 app configuration', route: '/AgencySettings', required: true },
  { id: 'agency_profile', label: 'Agency profile', route: '/AgencySettings', required: true },
  { id: 'staff_invites', label: 'Staff invitations', route: '/UserManagement', required: true },
  { id: 'telnyx_secret', label: 'Communications provider secret', route: '/AgencySettings', required: false },
  { id: 'clinical_templates', label: 'Clinical templates', route: '/TemplateManagement', required: true },
  { id: 'required_training', label: 'Required training assignments', route: '/AdminTraining', required: true },
]);

export function buildAdminOnboardingChecklist({ appConfigured, agencyProfileComplete, invitedStaffCount = 0, telnyxSecretConfigured, clinicalTemplateCount = 0, requiredTrainingAssigned } = {}) {
  const completed = new Set();
  if (appConfigured) completed.add('app_config');
  if (agencyProfileComplete) completed.add('agency_profile');
  if (invitedStaffCount > 0) completed.add('staff_invites');
  if (telnyxSecretConfigured) completed.add('telnyx_secret');
  if (clinicalTemplateCount > 0) completed.add('clinical_templates');
  if (requiredTrainingAssigned) completed.add('required_training');

  const items = CHECKS.map((check) => ({ ...check, complete: completed.has(check.id) }));
  const requiredItems = items.filter((item) => item.required);
  const completedRequired = requiredItems.filter((item) => item.complete).length;
  return {
    items,
    percentComplete: Math.round((completedRequired / requiredItems.length) * 100),
    readyForPilot: completedRequired === requiredItems.length,
    nextAction: items.find((item) => item.required && !item.complete) || items.find((item) => !item.complete) || null,
  };
}
