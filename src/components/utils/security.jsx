import { base44 } from '@/api/base44Client';
import { logError } from './activityLogger';
import DOMPurify from 'dompurify';

/**
 * Security utility functions for CareMetric AI
 * HIPAA-compliant security controls for PHI protection
 */

/**
 * Check if current user has access to a specific patient
 * @param {string} patientId - Patient ID to check access for
 * @returns {Promise<boolean>} - True if user has access
 */
export async function canAccessPatient(patientId) {
  try {
    const user = await base44.auth.me();
    if (!user) return false;
    
    // Admins can access all patients
    if (user.role === 'admin') return true;
    
    // Regular users can only access patients they've documented visits for
    const userVisits = await base44.entities.Visit.filter({
      patient_id: patientId,
      created_by: user.email
    });
    
    return userVisits.length > 0;
  } catch (error) {
    console.error('Access check failed');
    return false;
  }
}

/**
 * Check if current user has access to a specific visit
 * @param {string} visitId - Visit ID to check access for
 * @returns {Promise<boolean>} - True if user has access
 */
export async function canAccessVisit(visitId) {
  try {
    const user = await base44.auth.me();
    if (!user) return false;
    
    // Admins can access all visits
    if (user.role === 'admin') return true;
    
    // Regular users can only access visits they created
    const visit = await base44.entities.Visit.filter({ id: visitId });
    if (visit.length === 0) return false;
    
    return visit[0].created_by === user.email;
  } catch (error) {
    console.error('Access check failed');
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
  
  // Use DOMPurify for comprehensive XSS protection
  return DOMPurify.sanitize(input, {
    ALLOWED_TAGS: [], // Strip all HTML tags
    ALLOWED_ATTR: [], // Strip all attributes
    KEEP_CONTENT: true // Keep text content
  });
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
 * Log security event (audit trail)
 * @param {string} action - Action performed
 * @param {Object} details - Additional details
 * @returns {Promise<void>}
 */
export async function logSecurityEvent(action, details = {}) {
  try {
    const user = await base44.auth.me();
    if (!user) return;
    
    const logEntry = {
      timestamp: new Date().toISOString(),
      user_email: user.email,
      user_role: user.role,
      action,
      details,
      ip_address: 'client-side',
      user_agent: navigator.userAgent
    };
    
    // Log to console for debugging
    console.log('[SECURITY AUDIT]', logEntry);
    
    // Store in SecurityLog entity - don't await to avoid blocking
    base44.entities.SecurityLog.create(logEntry).catch(err => {
      // Failed to store log
    });
  } catch (error) {
    // Failed to log event
  }
}

/**
 * Secure entity update with audit logging
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
    
    // Log the update
    await logSecurityEvent(`${entityName.toUpperCase()}_UPDATED`, {
      record_id: id,
      fields_changed: Object.keys(data),
      // Don't log actual PHI values, just metadata
    });
    
    return result;
  } catch (error) {
    await logSecurityEvent(`${entityName.toUpperCase()}_UPDATE_FAILED`, {
      record_id: id,
      error: error.message
    });
    throw error;
  }
}

/**
 * Secure entity create with audit logging
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
    
    // Log the creation
    await logSecurityEvent(`${entityName.toUpperCase()}_CREATED`, {
      record_id: result.id,
      // Don't log actual PHI values
    });
    
    return result;
  } catch (error) {
    await logSecurityEvent(`${entityName.toUpperCase()}_CREATE_FAILED`, {
      error: error.message
    });
    throw error;
  }
}

/**
 * Secure entity delete with audit logging
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
    
    // Log the deletion
    await logSecurityEvent(`${entityName.toUpperCase()}_DELETED`, {
      record_id: id,
      // Log minimal metadata, not PHI
    });
    
    return result;
  } catch (error) {
    await logSecurityEvent(`${entityName.toUpperCase()}_DELETE_FAILED`, {
      record_id: id,
      error: error.message
    });
    throw error;
  }
}

/**
 * Rate limiter for API calls
 */
class RateLimiter {
  constructor(maxRequests = 10, timeWindow = 60000) {
    this.maxRequests = maxRequests;
    this.timeWindow = timeWindow;
    this.requests = [];
  }
  
  canMakeRequest(key) {
    const now = Date.now();
    
    // Clean old requests
    this.requests = this.requests.filter(r => 
      r.key === key && (now - r.timestamp) < this.timeWindow
    );
    
    // Check if under limit
    if (this.requests.length >= this.maxRequests) {
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
      } catch (e) {
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
  constructor(timeoutMinutes = 15) {
    this.timeoutDuration = timeoutMinutes * 60 * 1000;
    this.timeoutId = null;
    this.warningShown = false;
  }
  
  /**
   * Start session timeout monitoring
   * @param {Function} onTimeout - Callback when session times out
   * @param {Function} onWarning - Callback for warning before timeout
   */
  startMonitoring(onTimeout, onWarning) {
    this.onTimeout = onTimeout;
    this.onWarning = onWarning;
    this.resetTimeout();
    
    // Reset on user activity
    const activityHandler = () => this.resetTimeout();
    ['mousemove', 'keypress', 'click', 'scroll', 'touchstart'].forEach(event => {
      window.addEventListener(event, activityHandler);
    });
    
    // Store handler for cleanup
    this.activityHandler = activityHandler;
  }
  
  /**
   * Reset session timeout
   */
  resetTimeout() {
    clearTimeout(this.timeoutId);
    clearTimeout(this.warningTimeoutId);
    this.warningShown = false;
    
    // Set warning at 2 minutes before timeout
    const warningTime = this.timeoutDuration - (2 * 60 * 1000);
    this.warningTimeoutId = setTimeout(() => {
      if (!this.warningShown && this.onWarning) {
        this.warningShown = true;
        this.onWarning();
      }
    }, warningTime);
    
    // Set actual timeout
    this.timeoutId = setTimeout(async () => {
      await logSecurityEvent('SESSION_TIMEOUT', {});
      if (this.onTimeout) {
        this.onTimeout();
      }
    }, this.timeoutDuration);
  }
  
  /**
   * Public method to manually reset the session
   */
  resetSession() {
    this.resetTimeout();
  }
  
  /**
   * Stop monitoring
   */
  stopMonitoring() {
    clearTimeout(this.timeoutId);
    clearTimeout(this.warningTimeoutId);
    if (this.activityHandler) {
      ['mousemove', 'keypress', 'click', 'scroll', 'touchstart'].forEach(event => {
        window.removeEventListener(event, this.activityHandler);
      });
    }
  }
}

/**
 * Export data with audit logging
 * @param {Object} data - Data to export
 * @param {string} exportType - Type of export (PDF, CSV, etc.)
 * @param {string} context - Context (patient_id, visit_id, etc.)
 */
export async function secureExport(data, exportType, context = {}) {
  await logSecurityEvent('PHI_EXPORTED', {
    export_type: exportType,
    record_count: Array.isArray(data) ? data.length : 1,
    ...context
  });
  
  return data;
}