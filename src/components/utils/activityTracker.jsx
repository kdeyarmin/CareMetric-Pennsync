import { base44 } from '@/api/base44Client';

/**
 * Activity tracking utility
 * Logs user activities to the UserActivity entity
 */

/**
 * Get device type from user agent
 */
function getDeviceType(userAgent) {
  if (!userAgent) return 'desktop';
  const ua = userAgent.toLowerCase();
  if (/mobile|android|webos|iphone|ipod|blackberry|iemobile|opera mini/.test(ua)) {
    return 'mobile';
  }
  if (/tablet|ipad|playbook|silk/.test(ua)) {
    return 'tablet';
  }
  return 'desktop';
}

/**
 * Get IP address from headers (best effort)
 */
export function getClientIp(req) {
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0].trim() : req.headers.get('x-real-ip');
  return ip || 'unknown';
}

/**
 * Track a user activity
 * @param {Object} activityData - Activity details
 */
export async function trackActivity(activityData) {
  try {
    const user = await base44.auth.me().catch(() => null);
    
    if (!user) return;

    const activity = {
      user_email: user.email,
      user_name: user.full_name,
      user_agent: navigator.userAgent,
      device_type: getDeviceType(navigator.userAgent),
      ...activityData
    };

    await base44.asServiceRole.entities.UserActivity.create(activity);
  } catch (error) {
    console.error('Failed to track activity:', error);
    // Silently fail - don't interrupt user experience
  }
}

/**
 * Track page visit
 */
export async function trackPageVisit(pageName) {
  await trackActivity({
    action: 'page_visit',
    page: pageName
  });
}

/**
 * Track entity creation
 */
export async function trackEntityCreate(entityType, entityId, details = {}) {
  await trackActivity({
    action: 'create',
    entity_type: entityType,
    entity_id: entityId,
    details
  });
}

/**
 * Track entity update
 */
export async function trackEntityUpdate(entityType, entityId, details = {}) {
  await trackActivity({
    action: 'update',
    entity_type: entityType,
    entity_id: entityId,
    details
  });
}

/**
 * Track entity delete
 */
export async function trackEntityDelete(entityType, entityId, details = {}) {
  await trackActivity({
    action: 'delete',
    entity_type: entityType,
    entity_id: entityId,
    details
  });
}

/**
 * Track export action
 */
export async function trackExport(exportType, details = {}) {
  await trackActivity({
    action: 'export',
    details: { export_type: exportType, ...details }
  });
}

/**
 * Track document view
 */
export async function trackDocumentView(documentId, documentName) {
  await trackActivity({
    action: 'view_document',
    entity_type: 'Document',
    entity_id: documentId,
    details: { document_name: documentName }
  });
}

/**
 * Track search
 */
export async function trackSearch(searchType, query, resultCount) {
  await trackActivity({
    action: 'search',
    details: {
      search_type: searchType,
      query,
      result_count: resultCount
    }
  });
}

/**
 * Track error/failure
 */
export async function trackActivityError(action, errorMessage, details = {}) {
  await trackActivity({
    action,
    status: 'failure',
    error_message: errorMessage,
    details
  });
}