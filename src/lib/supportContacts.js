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
