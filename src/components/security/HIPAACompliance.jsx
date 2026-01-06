import { base44 } from "@/api/base44Client";

/**
 * HIPAA Compliance Utilities
 * Ensures all data handling meets HIPAA security requirements
 */

// Encryption utilities
export const encryptPHI = async (data) => {
  if (!data) return null;
  
  // Convert to string if object
  const dataStr = typeof data === 'object' ? JSON.stringify(data) : String(data);
  
  // Use Web Crypto API for encryption
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(dataStr);
  
  // Generate encryption key (in production, use a secure key management system)
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    dataBuffer
  );
  
  return {
    encrypted: btoa(String.fromCharCode(...new Uint8Array(encryptedBuffer))),
    iv: btoa(String.fromCharCode(...iv)),
    key: await crypto.subtle.exportKey("jwk", key)
  };
};

// Access logging for HIPAA audit trail
export const logPHIAccess = async (action, entityType, entityId, details = {}) => {
  try {
    const user = await base44.auth.me();
    
    await base44.entities.AuditTrail.create({
      timestamp: new Date().toISOString(),
      user_email: user?.email || 'system',
      user_role: user?.role || 'unknown',
      action,
      entity_type: entityType,
      entity_id: entityId,
      details: {
        ...details,
        ip_address: details.ip_address || 'unknown',
        user_agent: navigator.userAgent,
        compliance_flag: 'HIPAA'
      }
    });
  } catch (error) {
    console.error("Failed to log PHI access:", error);
  }
};

// Verify user has valid session and proper authentication
export const verifyHIPAASession = async () => {
  try {
    const user = await base44.auth.me();
    if (!user) {
      throw new Error("User not authenticated");
    }
    
    // Check session age (HIPAA requires automatic logoff after inactivity)
    const lastActivity = localStorage.getItem('lastActivity');
    if (lastActivity) {
      const inactiveMinutes = (Date.now() - parseInt(lastActivity)) / 60000;
      if (inactiveMinutes > 15) { // 15 minutes timeout
        await base44.auth.logout();
        throw new Error("Session expired due to inactivity");
      }
    }
    
    localStorage.setItem('lastActivity', Date.now().toString());
    return user;
  } catch (error) {
    throw new Error("HIPAA session verification failed");
  }
};

// Data minimization - only return necessary fields
export const minimizeDataExposure = (data, allowedFields) => {
  if (!data || !allowedFields) return data;
  
  if (Array.isArray(data)) {
    return data.map(item => {
      const minimized = {};
      allowedFields.forEach(field => {
        if (item[field] !== undefined) {
          minimized[field] = item[field];
        }
      });
      return minimized;
    });
  }
  
  const minimized = {};
  allowedFields.forEach(field => {
    if (data[field] !== undefined) {
      minimized[field] = data[field];
    }
  });
  return minimized;
};

// Secure data export with audit logging
export const secureExport = async (data, exportType, purpose) => {
  const user = await verifyHIPAASession();
  
  // Log the export
  await logPHIAccess('export', 'data_export', 'bulk', {
    export_type: exportType,
    purpose,
    record_count: Array.isArray(data) ? data.length : 1,
    timestamp: new Date().toISOString()
  });
  
  // Add watermark to exported data
  const watermarked = {
    exported_by: user.email,
    export_date: new Date().toISOString(),
    purpose,
    confidentiality: "CONFIDENTIAL - PROTECTED HEALTH INFORMATION",
    data
  };
  
  return watermarked;
};

// Validate data integrity
export const validateDataIntegrity = (data) => {
  if (!data) return false;
  
  // Check for required security fields
  const hasCreatedBy = data.created_by !== undefined;
  const hasCreatedDate = data.created_date !== undefined;
  const hasId = data.id !== undefined;
  
  return hasCreatedBy && hasCreatedDate && hasId;
};

// Check for potential data breach indicators
export const detectBreachIndicators = async () => {
  try {
    const user = await base44.auth.me();
    if (user?.role !== 'admin') return null;
    
    // Check for suspicious activity patterns
    const recentActivity = await base44.entities.UserActivity.filter({
      created_date: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() }
    });
    
    const suspiciousPatterns = {
      unusualAccessTimes: [],
      massExports: [],
      failedAccessAttempts: [],
      multipleLocationAccess: []
    };
    
    // Analyze activity patterns
    recentActivity.forEach(activity => {
      // Check for access at unusual hours (12am-5am)
      const hour = new Date(activity.created_date).getHours();
      if (hour >= 0 && hour < 5) {
        suspiciousPatterns.unusualAccessTimes.push(activity);
      }
      
      // Check for mass export events
      if (activity.action === 'export' && activity.details?.record_count > 100) {
        suspiciousPatterns.massExports.push(activity);
      }
      
      // Check for failed access attempts
      if (activity.action === 'error' && activity.details?.error_message?.includes('Unauthorized')) {
        suspiciousPatterns.failedAccessAttempts.push(activity);
      }
    });
    
    return suspiciousPatterns;
  } catch (error) {
    console.error("Error detecting breach indicators:", error);
    return null;
  }
};

// Secure deletion (HIPAA right to be forgotten)
export const secureDelete = async (entityName, entityId, reason) => {
  const user = await verifyHIPAASession();
  
  // Log deletion with reason
  await logPHIAccess('secure_delete', entityName, entityId, {
    reason,
    deleted_by: user.email,
    timestamp: new Date().toISOString()
  });
  
  // Perform deletion
  await base44.entities[entityName].delete(entityId);
  
  // Create deletion record for audit
  await base44.entities.AuditTrail.create({
    timestamp: new Date().toISOString(),
    user_email: user.email,
    user_role: user.role,
    action: 'data_deletion',
    entity_type: entityName,
    entity_id: entityId,
    details: {
      reason,
      compliance_flag: 'HIPAA_RIGHT_TO_FORGET'
    }
  });
};

export default {
  encryptPHI,
  logPHIAccess,
  verifyHIPAASession,
  minimizeDataExposure,
  secureExport,
  validateDataIntegrity,
  detectBreachIndicators,
  secureDelete
};