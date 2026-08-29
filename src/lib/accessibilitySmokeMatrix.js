/**
 * Accessibility smoke inventory for axe / browser runners (P2-02).
 *
 * PUBLIC routes can run without credentials (Playwright against preview/staging).
 * AUTHENTICATED routes are documented for future LR-02 staging runs only —
 * do not claim CI coverage until a seeded tenant exists.
 */

export const PUBLIC_ACCESSIBILITY_SMOKE_ROUTES = Object.freeze([
  {
    route: '/privacy',
    page: 'PrivacyPolicy',
    requiresAuth: false,
    expectedNoCredentialState: 'policy_content',
    requiredChecks: ['document-title', 'main-landmark', 'heading-order', 'keyboard-scroll', 'color-contrast'],
  },
  {
    route: '/join',
    page: 'JoinTelehealth',
    requiresAuth: false,
    expectedNoCredentialState: 'invalid_visit_link',
    requiredChecks: ['document-title', 'main-landmark', 'form-labels', 'focus-visible', 'color-contrast'],
  },
  {
    route: '/signer',
    page: 'SignerPortal',
    requiresAuth: false,
    expectedNoCredentialState: 'access_denied',
    requiredChecks: ['document-title', 'main-landmark', 'error-announcement', 'focus-visible', 'color-contrast'],
  },
  {
    route: '/followup',
    page: 'ProviderFollowUpPortal',
    requiresAuth: false,
    expectedNoCredentialState: 'invalid_or_missing_token',
    requiredChecks: ['document-title', 'main-landmark', 'form-labels', 'error-announcement', 'focus-visible'],
  },
]);

/** Authenticated surfaces — inventory only until staging credentials (LR-02). */
export const AUTHENTICATED_ACCESSIBILITY_SMOKE_ROUTES = Object.freeze([
  {
    route: '/Dashboard',
    page: 'Dashboard',
    requiresAuth: true,
    role: 'nurse',
    expectedState: 'authenticated_dashboard',
    requiredChecks: ['document-title', 'main-landmark', 'nav-landmark', 'skip-link-or-landmark', 'color-contrast'],
  },
  {
    route: '/Patients',
    page: 'Patients',
    requiresAuth: true,
    role: 'nurse',
    expectedState: 'patient_list',
    requiredChecks: ['document-title', 'main-landmark', 'table-or-list-semantics', 'color-contrast'],
  },
  {
    route: '/ClinicalDocumentation',
    page: 'ClinicalDocumentation',
    requiresAuth: true,
    role: 'nurse',
    expectedState: 'clinical_notes_hub',
    requiredChecks: ['document-title', 'main-landmark', 'form-labels', 'focus-visible', 'color-contrast'],
  },
  {
    route: '/UserManagement',
    page: 'UserManagement',
    requiresAuth: true,
    role: 'admin',
    expectedState: 'admin_user_table',
    requiredChecks: ['document-title', 'main-landmark', 'table-or-list-semantics', 'color-contrast'],
  },
  {
    route: '/ReportsAnalytics',
    page: 'ReportsAnalytics',
    requiresAuth: true,
    role: 'admin',
    expectedState: 'admin_reports',
    requiredChecks: ['document-title', 'main-landmark', 'heading-order', 'color-contrast'],
  },
]);

export const ALL_ACCESSIBILITY_SMOKE_ROUTES = Object.freeze([
  ...PUBLIC_ACCESSIBILITY_SMOKE_ROUTES,
  ...AUTHENTICATED_ACCESSIBILITY_SMOKE_ROUTES,
]);

export function validateAccessibilitySmokeRoute(routeConfig) {
  const missing = [];
  for (const field of ['route', 'page']) {
    if (!routeConfig?.[field]) missing.push(field);
  }
  if (routeConfig?.requiresAuth) {
    if (!routeConfig.expectedState) missing.push('expectedState');
    if (!routeConfig.role) missing.push('role');
  } else if (!routeConfig?.expectedNoCredentialState) {
    missing.push('expectedNoCredentialState');
  }
  const checks = routeConfig?.requiredChecks;
  if (!Array.isArray(checks) || checks.length < 3) missing.push('requiredChecks');
  if (checks && new Set(checks).size !== checks.length) missing.push('unique requiredChecks');
  return { valid: missing.length === 0, missing };
}

/** Routes safe to run in CI without staging secrets. */
export function publicAccessibilityRoutes() {
  return PUBLIC_ACCESSIBILITY_SMOKE_ROUTES.filter((r) => !r.requiresAuth);
}

/** Routes that must wait for LR-02 staging auth. */
export function authenticatedAccessibilityRoutes() {
  return AUTHENTICATED_ACCESSIBILITY_SMOKE_ROUTES.filter((r) => r.requiresAuth);
}
