export const PUBLIC_ACCESSIBILITY_SMOKE_ROUTES = Object.freeze([
  {
    route: '/privacy',
    page: 'PrivacyPolicy',
    expectedNoCredentialState: 'policy_content',
    requiredChecks: ['document-title', 'main-landmark', 'heading-order', 'keyboard-scroll', 'color-contrast'],
  },
  {
    route: '/join',
    page: 'JoinTelehealth',
    expectedNoCredentialState: 'invalid_visit_link',
    requiredChecks: ['document-title', 'main-landmark', 'form-labels', 'focus-visible', 'color-contrast'],
  },
  {
    route: '/signer',
    page: 'SignerPortal',
    expectedNoCredentialState: 'access_denied',
    requiredChecks: ['document-title', 'main-landmark', 'error-announcement', 'focus-visible', 'color-contrast'],
  },
  {
    route: '/followup',
    page: 'ProviderFollowUpPortal',
    expectedNoCredentialState: 'invalid_or_missing_token',
    requiredChecks: ['document-title', 'main-landmark', 'form-labels', 'error-announcement', 'focus-visible'],
  },
]);

export function validateAccessibilitySmokeRoute(routeConfig) {
  const missing = [];
  for (const field of ['route', 'page', 'expectedNoCredentialState']) {
    if (!routeConfig?.[field]) missing.push(field);
  }
  const checks = routeConfig?.requiredChecks;
  if (!Array.isArray(checks) || checks.length < 3) missing.push('requiredChecks');
  if (checks && new Set(checks).size !== checks.length) missing.push('unique requiredChecks');
  return { valid: missing.length === 0, missing };
}
