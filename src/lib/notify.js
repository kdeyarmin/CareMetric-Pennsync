import { base44 } from '@/api/base44Client';

/**
 * notify — single validated browser entry point for requesting notifications.
 *
 * Notification is service-role-only. Browser callers validate their request here
 * and then invoke the createNotification broker; they never receive entity CRUD
 * authority and cannot set tenant, recipient-provenance, dedupe, or workflow fields.
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
    if (!a.startsWith('/') || a.startsWith('//') || a.includes('\\')) {
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
  const {
    user_email,
    title,
    message,
    type,
    action_url,
    action_label,
    metadata,
    patient_id,
  } = params;
  const check = validateNotification(params);
  if (!check.valid) throw new Error(check.error);

  const response = await base44.functions.invoke('createNotification', {
    user_email,
    title,
    message,
    type,
    priority: check.safePriority,
    ...(action_url != null ? { action_url } : {}),
    ...(action_label != null ? { action_label } : {}),
    ...(metadata != null ? { metadata } : {}),
    ...(patient_id != null ? { patient_id } : {}),
  });
  return response?.data ?? response;
}
