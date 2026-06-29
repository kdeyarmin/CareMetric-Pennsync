import DOMPurify from 'dompurify';
import { base44 } from '@/api/base44Client';
import { logError } from './activityLogger';

/**
 * Security utility functions for Penn Sync
 * HIPAA-compliant security controls for PHI protection
 */

/**
 * Check if current user has access to a specific patient
 * @param {string} patientId - Patient ID to check access for
 * @returns {Promise<boolean>} - True if user has access
 */
export async function canAccessPatient(_patientId) {
  try {
    const user = await base44.auth.me();
    if (!user) return false;
    
    // All authenticated users can access all patients in the system
    return true;
  } catch (error) {
    console.error('Access check failed:', error);
    return false;
  }
}

/**
 * Check if current user has access to a specific visit
 * @param {string} visitId - Visit ID to check access for
 * @returns {Promise<boolean>} - True if user has access
 */
export async function canAccessVisit(_visitId) {
  try {
    const _user = await base44.auth.me();
    
    // All authenticated users can access all visits
    return true;
  } catch (error) {
    console.error('Access check failed:', error);
    return false;
  }
}

/**
 * Validate file upload
 * @param {File} file - File to validate
 * @param {Object} options - Validation options
 * @returns {Object} - {valid: boolean, error: string}
 */
export function validateFileUpload(file, options = {}) {
  const {
    maxSize = 10 * 1024 * 1024, // 10MB default
    allowedTypes = ['audio/webm', 'audio/wav', 'audio/mp3', 'audio/mpeg', 'image/jpeg', 'image/png', 'application/pdf'],
    allowedExtensions = ['.webm', '.wav', '.mp3', '.jpeg', '.jpg', '.png', '.pdf']
  } = options;
  
  // Check file size
  if (file.size > maxSize) {
    return {
      valid: false,
      error: `File size exceeds maximum allowed size of ${maxSize / 1024 / 1024}MB`
    };
  }
  
  // Check file type
  if (!allowedTypes.includes(file.type)) {
    return {
      valid: false,
      error: `File type ${file.type} is not allowed`
    };
  }
  
  // Check file extension
  const extension = '.' + file.name.split('.').pop().toLowerCase();
  if (!allowedExtensions.includes(extension)) {
    return {
      valid: false,
      error: `File extension ${extension} is not allowed`
    };
  }
  
  return { valid: true };
}

/**
 * Sanitize user input to prevent XSS
 * @param {string} input - User input to sanitize
 * @returns {string} - Sanitized input
 */
export function sanitizeInput(input) {
  if (typeof input !== 'string') {
    return input;
  }
  
  return input
    .replace(/[<>]/g, '') // Remove < and >
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+=/gi, '') // Remove event handlers
    .trim();
}

/**
 * Validate that a URL is safe to navigate to / open in a new tab. Only http(s)
 * (and protocol-relative) URLs are allowed; javascript:, data:, vbscript: etc.
 * are rejected. Use before window.open()/href when the URL comes from entity or
 * AI-generated data.
 * @param {string} url
 * @returns {boolean}
 */
export function isSafeExternalUrl(url) {
  if (typeof url !== 'string' || url.trim() === '') return false;
  const trimmed = url.trim();
  // Allow protocol-relative and site-relative URLs.
  if (trimmed.startsWith('//') || trimmed.startsWith('/')) return true;
  try {
    const protocol = new URL(trimmed, window.location.origin).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Open an (untrusted) URL in a new tab only if it uses a safe scheme. Returns
 * true if it opened, false if the URL was rejected. Always applies
 * noopener,noreferrer.
 * @param {string} url
 * @returns {boolean}
 */
export function openExternalUrl(url) {
  if (!isSafeExternalUrl(url)) {
    console.error('Blocked attempt to open unsafe URL');
    return false;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}

/**
 * Sanitize an HTML string for safe use with dangerouslySetInnerHTML.
 *
 * The regex-based sanitizeInput() above is for plain-text fields and is NOT a
 * safe sanitizer for an HTML sink. Any time stored/AI/user-supplied HTML is
 * rendered (e.g. document content), run it through this DOMPurify pass, which
 * strips scripts, event handlers, and dangerous URL schemes while keeping
 * formatting markup.
 * @param {string} html
 * @returns {string} sanitized HTML safe to inject
 */
export function sanitizeHtml(html) {
  if (typeof html !== 'string' || html.length === 0) {
    return '';
  }
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}

/**
 * Uniform random integer in [0, max) from the Web Crypto CSPRNG, rejection-sampled
 * to avoid modulo bias. Never use Math.random() for tokens/passwords.
 * @param {number} max
 * @returns {number}
 */
export function secureRandomInt(max) {
  // Reject max > 2^32-1: with a 32-bit source, `limit` would floor to 0 and the
  // rejection-sampling loop below would never terminate. Fail fast instead.
  if (!Number.isInteger(max) || max <= 0 || max > 0xffffffff) {
    throw new Error('max must be a positive integer <= 2^32-1');
  }
  const limit = Math.floor(0xffffffff / max) * max;
  const buf = new Uint32Array(1);
  let x;
  do {
    crypto.getRandomValues(buf);
    x = buf[0];
  } while (x >= limit);
  return x % max;
}

/**
 * Generate a high-entropy URL-safe token (default ~190 bits over 32 chars).
 * Use for bearer credentials such as document-signing links — NOT Math.random().
 * @param {number} length number of characters
 * @returns {string}
 */
export function generateSecureToken(length = 32) {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  // charset.length === 64 divides 256 evenly, so `byte % 64` is bias-free.
  for (let i = 0; i < bytes.length; i++) out += charset[bytes[i] % charset.length];
  return out;
}

/**
 * Generate a CSPRNG temporary password with at least one upper/lower/digit/symbol,
 * shuffled with a Fisher–Yates pass (the `sort(() => Math.random()-0.5)` idiom is
 * both non-cryptographic and statistically biased).
 * @param {number} length
 * @returns {string}
 */
export function generateSecurePassword(length = 12) {
  const classes = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '!@#$%^&*'];
  const all = classes.join('');
  const chars = classes.map((set) => set[secureRandomInt(set.length)]);
  while (chars.length < Math.max(length, classes.length)) chars.push(all[secureRandomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = secureRandomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/**
 * Sanitize object with all string fields
 * @param {Object} obj - Object to sanitize
 * @returns {Object} - Sanitized object
 */
export function sanitizeObject(obj) {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }
  
  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitizeInput(value);
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map(item => 
        typeof item === 'string' ? sanitizeInput(item) : item
      );
    } else if (value && typeof value === 'object') {
      sanitized[key] = sanitizeObject(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * Validate email address
 * @param {string} email - Email to validate
 * @returns {boolean} - True if valid
 */
export function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate phone number (US format)
 * @param {string} phone - Phone number to validate
 * @returns {boolean} - True if valid
 */
export function isValidPhone(phone) {
  const phoneRegex = /^[\d\s\-\(\)\+]+$/;
  return phoneRegex.test(phone) && phone.replace(/\D/g, '').length >= 10;
}

/**
 * Log security event (audit trail) - ENHANCED
 * @param {string} action - Action performed
 * @param {Object} details - Additional details
 * @param {string} severity - Severity level: critical, warning, info
 * @returns {Promise<void>}
 */
export async function logSecurityEvent(action, details = {}, severity = 'info') {
  try {
    const user = await base44.auth.me();
    if (!user) return;
    
    const logEntry = {
      timestamp: new Date().toISOString(),
      user_email: user.email,
      user_role: user.role,
      action,
      details: {
        ...details,
        page: window.location.pathname,
        timestamp_local: new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })
      },
      ip_address: 'client-side',
      user_agent: navigator.userAgent
    };
    
    // Store in SecurityLog entity - don't await to avoid blocking
    base44.entities.SecurityLog.create(logEntry).catch(err => {
      console.error('Failed to store security log:', err);
    });
    
    // Detect anomalies and create alerts for critical events
    if (severity === 'critical') {
      detectAndAlertAnomalies(action, user, details);
    }
  } catch (error) {
    console.error('Failed to log security event:', error);
  }
}

/**
 * Detect security anomalies and create alerts
 */
async function detectAndAlertAnomalies(action, user, details) {
  try {
    const anomalies = [];
    
    // Check for rapid repeated failed attempts
    if (action.includes('FAILED') || action.includes('DENIED')) {
      anomalies.push({
        type: 'failed_action',
        message: `Failed action detected: ${action}`,
        severity: 'high'
      });
    }
    
    // Check for bulk deletions
    if (action.includes('DELETE') && details.bulk_count > 5) {
      anomalies.push({
        type: 'bulk_deletion',
        message: `Bulk deletion of ${details.bulk_count} records`,
        severity: 'critical'
      });
    }
    
    // Check for after-hours access (outside 6am-10pm ET)
    const hour = new Date().getHours();
    if (hour < 6 || hour > 22) {
      anomalies.push({
        type: 'after_hours_access',
        message: `After-hours system access at ${new Date().toLocaleTimeString()}`,
        severity: 'warning'
      });
    }
    
    // Log anomalies
    for (const anomaly of anomalies) {
      await base44.entities.SecurityLog.create({
        timestamp: new Date().toISOString(),
        user_email: user.email,
        user_role: user.role,
        action: 'SECURITY_ANOMALY_DETECTED',
        details: {
          original_action: action,
          anomaly_type: anomaly.type,
          anomaly_message: anomaly.message,
          anomaly_severity: anomaly.severity
        },
        ip_address: 'client-side',
        user_agent: navigator.userAgent
      });
    }
  } catch (error) {
    console.error('Failed to detect anomalies:', error);
  }
}

/**
 * Secure entity update with audit logging - ENHANCED
 * @param {Object} entity - Entity object (e.g., base44.entities.Patient)
 * @param {string} id - Record ID
 * @param {Object} data - Data to update
 * @param {string} entityName - Name of entity for logging
 * @returns {Promise} - Updated record
 */
export async function secureUpdate(entity, id, data, entityName) {
  try {
    // Sanitize input data
    const sanitizedData = sanitizeObject(data);
    
    // Perform update
    const result = await entity.update(id, sanitizedData);
    
    // Enhanced logging with change tracking
    const isPHI = ['Patient', 'Visit', 'CarePlan'].includes(entityName);
    await logSecurityEvent(`${entityName.toUpperCase()}_UPDATED`, {
      record_id: id,
      fields_changed: Object.keys(data),
      field_count: Object.keys(data).length,
      contains_phi: isPHI,
      entity_type: entityName
    }, isPHI ? 'warning' : 'info');
    
    return result;
  } catch (error) {
    await logSecurityEvent(`${entityName.toUpperCase()}_UPDATE_FAILED`, {
      record_id: id,
      entity_type: entityName,
      error: error.message,
      attempted_fields: Object.keys(data)
    }, 'critical');
    throw error;
  }
}

/**
 * Secure entity create with audit logging - ENHANCED
 * @param {Object} entity - Entity object
 * @param {Object} data - Data to create
 * @param {string} entityName - Name of entity for logging
 * @returns {Promise} - Created record
 */
export async function secureCreate(entity, data, entityName) {
  try {
    // Sanitize input data
    const sanitizedData = sanitizeObject(data);
    
    // Perform create
    const result = await entity.create(sanitizedData);
    
    // Enhanced logging with metadata
    const isPHI = ['Patient', 'Visit', 'CarePlan'].includes(entityName);
    await logSecurityEvent(`${entityName.toUpperCase()}_CREATED`, {
      record_id: result.id,
      entity_type: entityName,
      contains_phi: isPHI,
      field_count: Object.keys(data).length
    }, isPHI ? 'warning' : 'info');
    
    return result;
  } catch (error) {
    await logSecurityEvent(`${entityName.toUpperCase()}_CREATE_FAILED`, {
      entity_type: entityName,
      error: error.message,
      attempted_fields: Object.keys(data)
    }, 'critical');
    throw error;
  }
}

/**
 * Secure entity delete with audit logging - ENHANCED
 * @param {Object} entity - Entity object
 * @param {string} id - Record ID
 * @param {string} entityName - Name of entity for logging
 * @returns {Promise} - Delete result
 */
export async function secureDelete(entity, id, entityName) {
  try {
    // Get record before deletion for audit
    const records = await entity.filter({ id });
    const record = records[0];
    
    // Perform delete
    const result = await entity.delete(id);
    
    // Enhanced logging - deletions are always critical
    const isPHI = ['Patient', 'Visit', 'CarePlan'].includes(entityName);
    await logSecurityEvent(`${entityName.toUpperCase()}_DELETED`, {
      record_id: id,
      entity_type: entityName,
      contains_phi: isPHI,
      record_created_by: record?.created_by,
      record_age_days: record?.created_date ? Math.floor((Date.now() - new Date(record.created_date)) / (1000 * 60 * 60 * 24)) : null
    }, 'critical');
    
    return result;
  } catch (error) {
    await logSecurityEvent(`${entityName.toUpperCase()}_DELETE_FAILED`, {
      record_id: id,
      entity_type: entityName,
      error: error.message
    }, 'critical');
    throw error;
  }
}

/**
 * Rate limiter for API calls
 */
export class RateLimiter {
  constructor(maxRequests = 10, timeWindow = 60000) {
    this.maxRequests = maxRequests;
    this.timeWindow = timeWindow;
    this.requests = [];
  }
  
  canMakeRequest(key) {
    const now = Date.now();

    // Drop only expired requests. (Previously this also dropped every other
    // key's in-window history, so a call from one user reset every other user's
    // count to zero on the shared `aiCallLimiter` instance — letting them blow
    // past the per-user limit.)
    this.requests = this.requests.filter(r => (now - r.timestamp) < this.timeWindow);

    // Check this key's usage against the limit.
    if (this.requests.filter(r => r.key === key).length >= this.maxRequests) {
      return false;
    }

    // Add new request
    this.requests.push({ key, timestamp: now });
    return true;
  }
}

export const aiCallLimiter = new RateLimiter(20, 60000); // 20 calls per minute

/**
 * Secure wrapper for AI calls with rate limiting
 * @param {Function} aiFunction - AI function to call
 * @param {string} userKey - User identifier for rate limiting
 * @returns {Promise} - Result of AI function
 */
export async function secureAICall(aiFunction, userKey) {
  if (!aiCallLimiter.canMakeRequest(userKey)) {
    throw new Error('Rate limit exceeded. Please wait before making more requests.');
  }
  
  await logSecurityEvent('AI_API_CALL', { user: userKey });
  
  return await aiFunction();
}

/**
 * Handle errors securely without exposing sensitive information
 * @param {Error} error - Error object
 * @param {string} context - Context where error occurred
 * @param {Function} userCallback - Callback to show user-friendly message
 */
export async function handleSecureError(error, context, userCallback) {
  // Log detailed error for debugging
  console.error(`[${context}] Error:`, error);
  
  // Log security event
  await logSecurityEvent('ERROR_OCCURRED', {
    context,
    error_type: error.name,
    // Don't log full error message as it might contain sensitive info
  });
  
  // Log error for admin review via UserActivity
  await logError(error.message, {
    stack: error.stack,
    component: context,
    context: context,
    page: window.location.pathname
  });
  
  // Show generic error to user
  const userMessage = getUserFriendlyError(error);
  if (userCallback) {
    userCallback(userMessage);
  }
  
  return userMessage;
}

/**
 * Convert technical error to user-friendly message
 * @param {Error} error - Error object
 * @returns {string} - User-friendly message
 */
function getUserFriendlyError(error) {
  if (error.message.includes('Rate limit')) {
    return 'Too many requests. Please wait a moment and try again.';
  }
  
  if (error.message.includes('Network') || error.message.includes('fetch')) {
    return 'Network error. Please check your connection and try again.';
  }
  
  if (error.message.includes('Unauthorized') || error.message.includes('403')) {
    return 'You do not have permission to perform this action.';
  }
  
  if (error.message.includes('Not found') || error.message.includes('404')) {
    return 'The requested resource was not found.';
  }
  
  // Generic fallback
  return 'An error occurred. Please try again or contact support if the problem persists.';
}

/**
 * Clear sensitive data from memory
 * @param {Object} stateSetters - Object with state setter functions
 */
export function clearSensitiveData(stateSetters) {
  Object.values(stateSetters).forEach(setter => {
    if (typeof setter === 'function') {
      try {
        setter(null);
        setter('');
        setter({});
        setter([]);
      } catch {
        // Ignore errors from setters
      }
    }
  });
}

/**
 * De-identify PHI for AI processing (basic implementation)
 * @param {string} text - Text containing potential PHI
 * @returns {string} - De-identified text
 */
export function deIdentifyForAI(text) {
  if (!text) return text;
  
  // Replace common PHI patterns
  let deidentified = text;
  
  // Replace email addresses
  deidentified = deidentified.replace(/[\w.-]+@[\w.-]+\.\w+/g, '[EMAIL]');
  
  // Replace phone numbers
  deidentified = deidentified.replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[PHONE]');
  
  // Replace SSN patterns
  deidentified = deidentified.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN]');
  
  // Replace dates (MM/DD/YYYY)
  deidentified = deidentified.replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, '[DATE]');
  
  // Note: Names and addresses are harder to de-identify automatically
  // Consider using specialized NLP library for more thorough de-identification
  
  return deidentified;
}

/**
 * Session management utilities
 */
export class SessionManager {
  static ACTIVITY_EVENTS = ['mousemove', 'keypress', 'click', 'scroll', 'touchstart'];

  constructor(timeoutMinutes = 15) {
    this.timeoutDuration = timeoutMinutes * 60 * 1000;
    this.timeoutId = null;
    this.warningId = null;
    this.warningShown = false;
    this._activityHandler = null;
  }
  
  /**
   * Start session timeout monitoring
   * @param {Function} onTimeout - Callback when session times out
   * @param {Function} onWarning - Callback for warning before timeout
   */
  startMonitoring(onTimeout, onWarning) {
    // Detach any handler from a previous start so repeated calls don't stack
    // listeners (and so we hold the exact reference stopMonitoring must remove).
    this.stopMonitoring();
    this.resetTimeout(onTimeout, onWarning);

    // Reset on user activity. Store the bound handler so the same reference is
    // both added and removed — previously stopMonitoring tried to remove the
    // bare `resetTimeout` method, which was never the function registered, so
    // the listeners leaked and kept re-arming the timers after logout.
    this._activityHandler = () => this.resetTimeout(onTimeout, onWarning);
    SessionManager.ACTIVITY_EVENTS.forEach(event => {
      window.addEventListener(event, this._activityHandler);
    });
  }

  /**
   * Reset session timeout
   */
  resetTimeout(onTimeout, onWarning) {
    clearTimeout(this.timeoutId);
    clearTimeout(this.warningId);
    this.warningShown = false;

    // Set warning at 2 minutes before timeout
    const warningTime = this.timeoutDuration - (2 * 60 * 1000);
    this.warningId = setTimeout(() => {
      if (!this.warningShown && onWarning) {
        this.warningShown = true;
        onWarning();
      }
    }, warningTime);

    // Set actual timeout
    this.timeoutId = setTimeout(async () => {
      await logSecurityEvent('SESSION_TIMEOUT', {});
      if (onTimeout) {
        onTimeout();
      }
    }, this.timeoutDuration);
  }

  /**
   * Stop monitoring
   */
  stopMonitoring() {
    clearTimeout(this.timeoutId);
    clearTimeout(this.warningId);
    if (this._activityHandler) {
      SessionManager.ACTIVITY_EVENTS.forEach(event => {
        window.removeEventListener(event, this._activityHandler);
      });
      this._activityHandler = null;
    }
  }
}

/**
 * Export data with audit logging - ENHANCED
 * @param {Object} data - Data to export
 * @param {string} exportType - Type of export (PDF, CSV, etc.)
 * @param {string} context - Context (patient_id, visit_id, etc.)
 */
export async function secureExport(data, exportType, context = {}) {
  const recordCount = Array.isArray(data) ? data.length : 1;
  
  await logSecurityEvent('PHI_EXPORTED', {
    export_type: exportType,
    record_count: recordCount,
    is_bulk_export: recordCount > 10,
    ...context
  }, recordCount > 10 ? 'warning' : 'info');
  
  return data;
}

/**
 * Track PHI access for compliance
 * @param {string} entityType - Type of entity accessed
 * @param {string} entityId - ID of record accessed
 * @param {string} accessReason - Reason for access (view, edit, etc.)
 */
export async function trackPHIAccess(entityType, entityId, accessReason = 'view') {
  await logSecurityEvent('PHI_ACCESSED', {
    entity_type: entityType,
    entity_id: entityId,
    access_reason: accessReason,
    access_time: new Date().toISOString()
  }, 'info');
}

/**
 * Log bulk operations with enhanced tracking
 * @param {string} operation - Operation type (delete, update, export)
 * @param {string} entityType - Entity type affected
 * @param {number} count - Number of records affected
 * @param {Object} criteria - Filter criteria used
 */
export async function logBulkOperation(operation, entityType, count, criteria = {}) {
  await logSecurityEvent(`BULK_${operation.toUpperCase()}`, {
    entity_type: entityType,
    record_count: count,
    criteria: JSON.stringify(criteria),
    requires_review: count > 50
  }, count > 50 ? 'critical' : 'warning');
}