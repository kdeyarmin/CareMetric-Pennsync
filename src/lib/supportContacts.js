/**
 * Owner-verified CareMetric support routes.
 *
 * Keep these values centralized and non-configurable so product builds cannot
 * silently drift to a facility phone number or a developer's personal inbox.
 */
export const CENTRAL_SUPPORT_PHONE_E164 = '+18775212890';
export const CENTRAL_SUPPORT_PHONE_DISPLAY = '(877) 521-2890';
export const CENTRAL_SUPPORT_EMAIL = 'support@caremetric.ai';

export const CENTRAL_SUPPORT_PHONE_HREF = `tel:${CENTRAL_SUPPORT_PHONE_E164}`;
export const CENTRAL_SUPPORT_EMAIL_HREF = `mailto:${CENTRAL_SUPPORT_EMAIL}`;

// A pre-filled request to central support — the one deletion channel that
// reaches a person for every user (see handleDeleteAccount in
// src/pages/UserSettings.jsx).
export function accountDeletionEmailHref(accountEmail, requestedAt) {
  const subject = 'PennSync account deletion request';
  const body = [
    'Please delete my PennSync account.',
    '',
    `Account email: ${accountEmail || '(not available)'}`,
    `Requested in the app: ${requestedAt || new Date().toISOString()}`,
    '',
    'I understand my agency retains clinical records it is legally required to keep.',
  ].join('\n');
  return `${CENTRAL_SUPPORT_EMAIL_HREF}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
