/**
 * HIPAA-Compliant Audit Logger
 * 
 * Tracks all access and modifications to PHI
 * Required for HIPAA Security Rule compliance
 */

import { base44 } from "@/api/base44Client";
import { isPHIField } from "./HIPAAEncryption";

class HIPAAAuditLogger {
  constructor() {
    this.batchQueue = [];
    this.batchSize = 10;
    this.flushInterval = 5000; // 5 seconds
    this.startBatchProcessor();
  }

  /**
   * Log PHI access event
   */
  async logPHIAccess({
    entityType,
    entityId,
    action, // 'view', 'create', 'update', 'delete', 'export', 'print'
    fieldNames = [],
    userEmail,
    userName,
    userRole,
    ipAddress,
    reason = null,
    patientId = null
  }) {
    const auditEntry = {
      timestamp: new Date().toISOString(),
      event_type: 'PHI_ACCESS',
      entity_type: entityType,
      entity_id: entityId,
      action,
      field_names: fieldNames,
      user_email: userEmail,
      user_name: userName,
      user_role: userRole,
      ip_address: ipAddress || 'unknown',
      access_reason: reason,
      patient_id: patientId,
      session_id: this.getSessionId(),
      device_info: this.getDeviceInfo()
    };

    // Add to batch queue
    this.batchQueue.push(auditEntry);

    // Flush if batch is full
    if (this.batchQueue.length >= this.batchSize) {
      await this.flushBatch();
    }

    return auditEntry;
  }

  /**
   * Log security event
   */
  async logSecurityEvent({
    eventType, // 'LOGIN', 'LOGOUT', 'FAILED_AUTH', 'SESSION_TIMEOUT', 'BREACH_ATTEMPT', 'PERMISSION_DENIED'
    severity, // 'INFO', 'WARNING', 'CRITICAL'
    userEmail,
    description,
    metadata = {}
  }) {
    try {
      await base44.entities.SecurityLog.create({
        timestamp: new Date().toISOString(),
        user_email: userEmail || 'system',
        user_role: metadata.userRole || 'unknown',
        action: eventType,
        details: {
          severity,
          description,
          ...metadata,
          device: this.getDeviceInfo(),
          session: this.getSessionId()
        },
        ip_address: metadata.ipAddress || 'unknown',
        user_agent: navigator.userAgent
      });
    } catch (error) {
      console.error('Failed to log security event:', error);
      // Fallback to localStorage if DB fails
      this.logToLocalStorage('security_event', {
        eventType,
        severity,
        userEmail,
        description,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Log data breach or suspicious activity
   */
  async logBreachAttempt({
    attemptType,
    userEmail,
    targetEntity,
    targetId,
    description
  }) {
    await this.logSecurityEvent({
      eventType: 'BREACH_ATTEMPT',
      severity: 'CRITICAL',
      userEmail,
      description,
      metadata: {
        attemptType,
        targetEntity,
        targetId,
        timestamp: new Date().toISOString()
      }
    });

    // Trigger immediate notification to admin
    await this.notifyAdminOfBreach({
      attemptType,
      userEmail,
      description
    });
  }

  /**
   * Log export of PHI
   */
  async logPHIExport({
    exportType, // 'PDF', 'CSV', 'PRINT', 'EMAIL', 'FAX'
    entityType,
    entityIds,
    userEmail,
    userName,
    recipientInfo = null
  }) {
    await this.logPHIAccess({
      entityType,
      entityId: entityIds.join(','),
      action: 'export',
      userEmail,
      userName,
      reason: `Export as ${exportType}`,
      userRole: 'provider'
    });

    await this.logSecurityEvent({
      eventType: 'PHI_EXPORT',
      severity: 'INFO',
      userEmail,
      description: `Exported ${entityIds.length} ${entityType} records as ${exportType}`,
      metadata: {
        exportType,
        entityType,
        recordCount: entityIds.length,
        recipientInfo
      }
    });
  }

  /**
   * Batch processor for audit logs
   */
  startBatchProcessor() {
    setInterval(async () => {
      if (this.batchQueue.length > 0) {
        await this.flushBatch();
      }
    }, this.flushInterval);
  }

  /**
   * Flush batch queue to database
   */
  async flushBatch() {
    if (this.batchQueue.length === 0) return;

    const batch = [...this.batchQueue];
    this.batchQueue = [];

    try {
      await base44.entities.AuditTrail.bulkCreate(
        batch.map(entry => ({
          ...entry,
          created_date: new Date().toISOString()
        }))
      );
    } catch (error) {
      console.error('Failed to flush audit batch:', error);
      // Restore to queue for retry
      this.batchQueue = [...batch, ...this.batchQueue];
    }
  }

  /**
   * Get current session ID
   */
  getSessionId() {
    let sessionId = sessionStorage.getItem('hipaa_session_id');
    if (!sessionId) {
      sessionId = this.generateSessionId();
      sessionStorage.setItem('hipaa_session_id', sessionId);
    }
    return sessionId;
  }

  /**
   * Generate unique session ID
   */
  generateSessionId() {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get device information
   */
  getDeviceInfo() {
    return {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      screenResolution: `${window.screen.width}x${window.screen.height}`,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    };
  }

  /**
   * Notify admin of critical security event
   */
  async notifyAdminOfBreach(breachInfo) {
    try {
      // Create high-priority alert
      await base44.entities.PatientAlert.create({
        alert_type: 'security_breach',
        severity: 'critical',
        title: 'Security Breach Attempt Detected',
        description: `Breach attempt: ${breachInfo.description}`,
        status: 'active',
        metadata: breachInfo
      });
    } catch (error) {
      console.error('Failed to notify admin:', error);
    }
  }

  /**
   * Fallback logging to localStorage
   */
  logToLocalStorage(type, data) {
    try {
      const logs = JSON.parse(localStorage.getItem('hipaa_audit_fallback') || '[]');
      logs.push({ type, data, timestamp: new Date().toISOString() });
      
      // Keep only last 100 entries
      if (logs.length > 100) {
        logs.shift();
      }
      
      localStorage.setItem('hipaa_audit_fallback', JSON.stringify(logs));
    } catch (error) {
      console.error('Failed to log to localStorage:', error);
    }
  }

  /**
   * Generate compliance report
   */
  async generateComplianceReport(startDate, endDate) {
    const logs = await base44.entities.AuditTrail.filter({
      timestamp: {
        $gte: startDate,
        $lte: endDate
      }
    });

    return {
      totalAccesses: logs.length,
      byAction: this.groupBy(logs, 'action'),
      byUser: this.groupBy(logs, 'user_email'),
      byEntity: this.groupBy(logs, 'entity_type'),
      criticalEvents: logs.filter(l => l.severity === 'CRITICAL'),
      exportEvents: logs.filter(l => l.action === 'export'),
      timeRange: { startDate, endDate }
    };
  }

  groupBy(array, key) {
    return array.reduce((result, item) => {
      const group = item[key] || 'unknown';
      result[group] = (result[group] || 0) + 1;
      return result;
    }, {});
  }
}

export const hipaaAuditLogger = new HIPAAAuditLogger();

/**
 * React Hook for automatic PHI access logging
 */
export function useHIPAAAudit(entityType, entityId, action = 'view') {
  React.useEffect(() => {
    const logAccess = async () => {
      const user = await base44.auth.me();
      if (user && entityId) {
        await hipaaAuditLogger.logPHIAccess({
          entityType,
          entityId,
          action,
          userEmail: user.email,
          userName: user.full_name,
          userRole: user.role
        });
      }
    };

    logAccess();
  }, [entityType, entityId, action]);
}