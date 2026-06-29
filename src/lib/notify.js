import { base44 } from '@/api/base44Client';

/**
 * notify — single validated entry point for creating in-app notifications.
 *
 * Notifications were created ad-hoc via direct `Notification.create` calls with no
 * shared validation, so an invalid `type`, an out-of-range `priority`, or an
 * external `action_url` (a phishing-link vector) could slip through. This mirrors
 * the server-side createNotification validation so the client behaves consistently.
 */

// Must match the Notification entity `type` enum.
export const NOTIFICATION_TYPES = [
  'report_ready', 'compliance_alert', 'critical_alert', 'patient_alert',
  'task_assigned', 'task_due_soon', 'new_referral', 'referral_urgent',
  'training_due', 'system_update', 'message_received', 'sms_failed',
  'sms_urgent', 'sms_received', 'fax_delivered', 'fax_failed', 'voicemail',
  'info', 'expiration_warning', 'credential_expiration',
  'admin_expiration_summary', 'care_plan_proposal', 'signature_request',
];

const PRIORITIES = ['low', 'medium', 'high', 'critical'];

/** Validate the attacker/typo-prone fields shared by all notification paths. */
export function validateNotification({ user_email, title, message, type, priority = 'medium', action_url } = {}) {
  if (!user_email || !title || !message || !type) {
    return { valid: false, error: 'Notification requires user_email, title, message, and type.' };
  }
  if (!NOTIFICATION_TYPES.includes(type)) {
    return { valid: false, error: `Invalid notification type: ${type}` };
  }
  const safePriority = PRIORITIES.includes(priority) ? priority : 'medium';
  if (action_url != null) {
    const a = String(action_url);
    if (!a.startsWith('/') || a.startsWith('//')) {
      return { valid: false, error: 'action_url must be a relative in-app path.' };
    }
  }
  return { valid: true, safePriority };
}

/**
 * Create an in-app notification after validating its fields. Throws on invalid
 * input so callers don't silently persist malformed/abusable notifications.
 */
export async function sendInAppNotification(params = {}) {
  // Destructure `priority` out so it lands in neither path twice — leaving it in
  // `rest` would let the trailing `...rest` spread overwrite the validated
  // safePriority with the original (possibly out-of-range) value.
  const { user_email, title, message, type, priority: _priority, action_url, action_label, metadata, ...rest } = params;
  const check = validateNotification(params);
  if (!check.valid) throw new Error(check.error);

  return base44.entities.Notification.create({
    user_email,
    title,
    message,
    type,
    priority: check.safePriority,
    ...(action_url != null ? { action_url } : {}),
    ...(action_label != null ? { action_label } : {}),
    ...(metadata != null ? { metadata } : {}),
    is_read: false,
    ...rest,
  });
}
