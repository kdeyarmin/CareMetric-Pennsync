/**
 * Data masking and redaction utilities for HIPAA compliance
 */

/**
 * Mask sensitive PHI fields
 */
export const maskPHI = (data, unmaskFields = []) => {
  if (!data) return data;
  
  const sensitiveFields = {
    ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
    phone: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,
    email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    dob: /\b\d{1,2}\/\d{1,2}\/\d{4}\b/g,
    mrn: /\b(MRN|Medical Record #):\s*\d+\b/gi,
    address: /\b\d+\s+[\w\s]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Court|Ct)\b/gi
  };

  // Create masked version
  let masked = JSON.parse(JSON.stringify(data));
  
  Object.keys(sensitiveFields).forEach(field => {
    if (!unmaskFields.includes(field)) {
      if (typeof masked === 'string') {
        masked = masked.replace(sensitiveFields[field], `[${field.toUpperCase()}]`);
      }
    }
  });

  return masked;
};

/**
 * Redact specific fields from object
 */
export const redactFields = (obj, fieldsToRedact) => {
  if (!obj || typeof obj !== 'object') return obj;

  const redacted = JSON.parse(JSON.stringify(obj));
  
  const redactRecursive = (current, fields) => {
    Object.keys(current).forEach(key => {
      if (fields.includes(key)) {
        current[key] = '[REDACTED]';
      } else if (typeof current[key] === 'object' && current[key] !== null) {
        redactRecursive(current[key], fields);
      }
    });
  };

  redactRecursive(redacted, fieldsToRedact);
  return redacted;
};

/**
 * Check if user has permission to view unmasked data
 */
export const canViewUnmaskedData = (userRole, userEmail, resourceCreatedBy) => {
  // Admins always see full data
  if (userRole === 'admin') return true;
  
  // Users see their own data unmasked
  if (userEmail === resourceCreatedBy) return true;
  
  // Otherwise masked
  return false;
};

/**
 * Apply role-based data filtering
 */
export const filterByRole = (data, userRole, userEmail) => {
  if (userRole === 'admin') return data;

  // Non-admin users see limited fields
  const allowedFields = [
    'id',
    'created_date',
    'patient_name',
    'visit_type',
    'status',
    'priority',
    'title',
    'description'
  ];

  if (Array.isArray(data)) {
    return data.map(item => filterObject(item, allowedFields));
  }

  return filterObject(data, allowedFields);
};

function filterObject(obj, allowedFields) {
  if (!obj || typeof obj !== 'object') return obj;

  const filtered = {};
  allowedFields.forEach(field => {
    if (field in obj) {
      filtered[field] = obj[field];
    }
  });

  return filtered;
}

/**
 * Audit log helper - create audit entry without storing sensitive data
 */
export const createAuditEntry = (action, user, entityType, entityId, changes = {}) => {
  // Remove sensitive data from changes
  const sensitiveKeys = ['ssn', 'phone', 'email', 'password', 'credit_card'];
  const sanitizedChanges = {};

  Object.keys(changes).forEach(key => {
    if (!sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
      sanitizedChanges[key] = changes[key];
    }
  });

  return {
    timestamp: new Date().toISOString(),
    action,
    user_email: user?.email,
    user_role: user?.role,
    entity_type: entityType,
    entity_id: entityId,
    changes: sanitizedChanges
  };
};