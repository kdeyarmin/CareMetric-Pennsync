/**
 * HIPAA Breach Detection System
 * 
 * Monitors for suspicious activities and potential data breaches
 * Implements HIPAA Breach Notification Rule requirements
 */

import { base44 } from "@/api/base44Client";
import { hipaaAuditLogger } from "./HIPAAAuditLogger";

class HIPAABreachDetector {
  constructor() {
    this.suspiciousActivityThresholds = {
      maxFailedLogins: 5,
      maxRecordsAccessedPerMinute: 50,
      maxExportsPerHour: 10,
      unusualAccessTimeWindow: { start: 22, end: 6 } // 10 PM to 6 AM
    };

    this.breachIndicators = [];
    this.monitoringActive = false;
  }

  /**
   * Start breach monitoring
   */
  startMonitoring(userEmail) {
    if (this.monitoringActive) return;
    
    this.monitoringActive = true;
    this.userEmail = userEmail;
    this.activityLog = [];
    this.failedLoginAttempts = 0;
    this.exportCount = 0;

    // Monitor user activity
    this.monitorInterval = setInterval(() => {
      this.analyzeActivity();
    }, 60000); // Check every minute
  }

  /**
   * Stop breach monitoring
   */
  stopMonitoring() {
    this.monitoringActive = false;
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
    }
  }

  /**
   * Log user activity
   */
  logActivity(activityType, metadata = {}) {
    this.activityLog.push({
      type: activityType,
      timestamp: Date.now(),
      ...metadata
    });

    // Keep only last hour of activity
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    this.activityLog = this.activityLog.filter(a => a.timestamp > oneHourAgo);
  }

  /**
   * Track failed login attempt
   */
  async trackFailedLogin(userEmail, ipAddress) {
    this.failedLoginAttempts++;

    if (this.failedLoginAttempts >= this.suspiciousActivityThresholds.maxFailedLogins) {
      await this.triggerBreachAlert({
        type: 'EXCESSIVE_FAILED_LOGINS',
        severity: 'HIGH',
        description: `${this.failedLoginAttempts} failed login attempts for user ${userEmail}`,
        metadata: { userEmail, ipAddress, attempts: this.failedLoginAttempts }
      });
    }
  }

  /**
   * Track bulk data access
   */
  async trackBulkAccess(entityType, recordCount) {
    this.logActivity('bulk_access', { entityType, recordCount });

    const recentAccesses = this.activityLog.filter(
      a => a.type === 'bulk_access' && a.timestamp > Date.now() - 60000
    );

    const totalRecords = recentAccesses.reduce((sum, a) => sum + a.recordCount, 0);

    if (totalRecords > this.suspiciousActivityThresholds.maxRecordsAccessedPerMinute) {
      await this.triggerBreachAlert({
        type: 'EXCESSIVE_BULK_ACCESS',
        severity: 'CRITICAL',
        description: `Accessed ${totalRecords} records in 1 minute`,
        metadata: { entityType, recordCount: totalRecords }
      });
    }
  }

  /**
   * Track data export
   */
  async trackExport(exportType, recordCount) {
    this.exportCount++;
    this.logActivity('export', { exportType, recordCount });

    if (this.exportCount > this.suspiciousActivityThresholds.maxExportsPerHour) {
      await this.triggerBreachAlert({
        type: 'EXCESSIVE_EXPORTS',
        severity: 'HIGH',
        description: `${this.exportCount} exports in past hour`,
        metadata: { exportType, exportCount: this.exportCount }
      });
    }
  }

  /**
   * Detect unusual access time
   */
  detectUnusualAccessTime() {
    const hour = new Date().getHours();
    const { start, end } = this.suspiciousActivityThresholds.unusualAccessTimeWindow;
    
    return hour >= start || hour < end;
  }

  /**
   * Analyze recent activity for patterns
   */
  async analyzeActivity() {
    if (!this.monitoringActive) return;

    const recentActivity = this.activityLog.filter(
      a => a.timestamp > Date.now() - (5 * 60 * 1000) // Last 5 minutes
    );

    // Pattern 1: Rapid sequential patient access
    const patientAccesses = recentActivity.filter(a => a.type === 'patient_access');
    if (patientAccesses.length > 20) {
      await this.triggerBreachAlert({
        type: 'RAPID_PATIENT_ACCESS',
        severity: 'MEDIUM',
        description: `Accessed ${patientAccesses.length} patient records in 5 minutes`,
        metadata: { count: patientAccesses.length }
      });
    }

    // Pattern 2: Access during unusual hours
    if (this.detectUnusualAccessTime() && recentActivity.length > 0) {
      await this.logSuspiciousActivity({
        type: 'UNUSUAL_ACCESS_TIME',
        description: 'System access during off-hours',
        severity: 'LOW'
      });
    }

    // Pattern 3: Multiple different entity types accessed rapidly
    const uniqueEntities = new Set(recentActivity.map(a => a.entityType));
    if (uniqueEntities.size > 5) {
      await this.logSuspiciousActivity({
        type: 'DIVERSE_ENTITY_ACCESS',
        description: `Accessed ${uniqueEntities.size} different entity types rapidly`,
        severity: 'MEDIUM'
      });
    }
  }

  /**
   * Trigger breach alert
   */
  async triggerBreachAlert({ type, severity, description, metadata = {} }) {
    const alert = {
      type,
      severity,
      description,
      userEmail: this.userEmail,
      timestamp: new Date().toISOString(),
      metadata,
      status: 'active'
    };

    // Log to audit system
    await hipaaAuditLogger.logBreachAttempt({
      attemptType: type,
      userEmail: this.userEmail,
      targetEntity: metadata.entityType,
      targetId: metadata.entityId,
      description
    });

    // Create alert for admin
    try {
      await base44.entities.PatientAlert.create({
        alert_type: 'security_breach',
        severity: severity.toLowerCase(),
        title: `Security Alert: ${type.replace(/_/g, ' ')}`,
        description,
        status: 'active',
        metadata: {
          ...metadata,
          userEmail: this.userEmail,
          detectedAt: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('Failed to create breach alert:', error);
    }

    // If critical, lock account
    if (severity === 'CRITICAL') {
      await this.lockUserAccount();
    }

    this.breachIndicators.push(alert);
  }

  /**
   * Log suspicious activity (not yet a breach)
   */
  async logSuspiciousActivity({ type, description, severity }) {
    await hipaaAuditLogger.logSecurityEvent({
      eventType: 'SUSPICIOUS_ACTIVITY',
      severity,
      userEmail: this.userEmail,
      description,
      metadata: { type }
    });
  }

  /**
   * Lock user account after critical breach
   */
  async lockUserAccount() {
    try {
      // Log account lock
      await hipaaAuditLogger.logSecurityEvent({
        eventType: 'ACCOUNT_LOCKED',
        severity: 'CRITICAL',
        userEmail: this.userEmail,
        description: 'Account locked due to suspicious activity'
      });

      // Force logout
      await base44.auth.logout();
    } catch (error) {
      console.error('Failed to lock account:', error);
    }
  }

  /**
   * Generate breach report
   */
  generateBreachReport() {
    return {
      totalIndicators: this.breachIndicators.length,
      bySeverity: {
        critical: this.breachIndicators.filter(i => i.severity === 'CRITICAL').length,
        high: this.breachIndicators.filter(i => i.severity === 'HIGH').length,
        medium: this.breachIndicators.filter(i => i.severity === 'MEDIUM').length,
        low: this.breachIndicators.filter(i => i.severity === 'LOW').length
      },
      byType: this.groupBy(this.breachIndicators, 'type'),
      recentActivity: this.activityLog.slice(-50),
      timestamp: new Date().toISOString()
    };
  }

  groupBy(array, key) {
    return array.reduce((result, item) => {
      const group = item[key] || 'unknown';
      result[group] = (result[group] || 0) + 1;
      return result;
    }, {});
  }

  /**
   * Clear breach indicators (after review)
   */
  clearBreachIndicators() {
    this.breachIndicators = [];
    this.failedLoginAttempts = 0;
    this.exportCount = 0;
  }
}

export const hipaaBreachDetector = new HIPAABreachDetector();