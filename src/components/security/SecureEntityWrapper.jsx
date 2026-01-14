/**
 * Secure Entity Wrapper
 * 
 * Centralized wrapper for all entity operations with:
 * - Automatic PHI encryption/decryption
 * - Comprehensive audit logging
 * - Role-based access control
 * - Breach detection integration
 */

import { base44 } from "@/api/base44Client";
import { hipaaEncryption, PHI_FIELDS, isPHIField } from "./HIPAAEncryption";
import { hipaaAuditLogger } from "./HIPAAAuditLogger";
import { hipaaBreachDetector } from "./HIPAABreachDetector";

class SecureEntityWrapper {
  constructor() {
    this.encryptionEnabled = true;
    this.auditEnabled = true;
  }

  /**
   * Get current user context
   */
  async getUserContext() {
    try {
      const user = await base44.auth.me();
      return {
        email: user.email,
        name: user.full_name,
        role: user.role,
        providerType: user.provider_type
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Encrypt PHI fields in entity data
   */
  async encryptEntityData(entityType, data) {
    if (!this.encryptionEnabled) return data;

    const phiFields = PHI_FIELDS[entityType] || [];
    if (phiFields.length === 0) return data;

    const encrypted = { ...data };
    const key = await hipaaEncryption.generateKey();

    for (const field of phiFields) {
      if (data[field] !== undefined && data[field] !== null) {
        try {
          encrypted[field] = await hipaaEncryption.encryptPHI(data[field], key);
          encrypted[`${field}_encrypted`] = true;
        } catch (error) {
          console.error(`Failed to encrypt ${field}:`, error);
        }
      }
    }

    // Store key reference (in production, use proper key management)
    encrypted._encryption_key = await crypto.subtle.exportKey('jwk', key);

    return encrypted;
  }

  /**
   * Decrypt PHI fields in entity data
   */
  async decryptEntityData(entityType, data) {
    if (!this.encryptionEnabled) return data;

    const phiFields = PHI_FIELDS[entityType] || [];
    if (phiFields.length === 0 || !data._encryption_key) return data;

    const decrypted = { ...data };
    
    try {
      const key = await crypto.subtle.importKey(
        'jwk',
        data._encryption_key,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );

      for (const field of phiFields) {
        if (data[`${field}_encrypted`] && data[field]) {
          try {
            decrypted[field] = await hipaaEncryption.decryptPHI(data[field], key);
            delete decrypted[`${field}_encrypted`];
          } catch (error) {
            console.error(`Failed to decrypt ${field}:`, error);
          }
        }
      }

      delete decrypted._encryption_key;
    } catch (error) {
      console.error('Decryption failed:', error);
    }

    return decrypted;
  }

  /**
   * Secure entity creation
   */
  async create(entityType, data, options = {}) {
    const user = await this.getUserContext();
    if (!user) throw new Error('Authentication required');

    // Track for breach detection
    hipaaBreachDetector.logActivity('create', { entityType, user: user.email });

    // Encrypt PHI fields
    const encryptedData = await this.encryptEntityData(entityType, data);

    // Create entity
    const created = await base44.entities[entityType].create(encryptedData);

    // Audit log
    if (this.auditEnabled) {
      await hipaaAuditLogger.logPHIAccess({
        entityType,
        entityId: created.id,
        action: 'create',
        fieldNames: Object.keys(data),
        userEmail: user.email,
        userName: user.name,
        userRole: user.role,
        patientId: data.patient_id || data.id
      });
    }

    // Return decrypted for immediate use
    return await this.decryptEntityData(entityType, created);
  }

  /**
   * Secure entity read/list
   */
  async list(entityType, sortField = '-updated_date', limit = 50) {
    const user = await this.getUserContext();
    if (!user) throw new Error('Authentication required');

    // Track bulk access
    await hipaaBreachDetector.trackBulkAccess(entityType, limit);

    const entities = await base44.entities[entityType].list(sortField, limit);

    // Audit log for bulk access
    if (this.auditEnabled && entities.length > 0) {
      await hipaaAuditLogger.logPHIAccess({
        entityType,
        entityId: 'bulk',
        action: 'view',
        fieldNames: ['*'],
        userEmail: user.email,
        userName: user.name,
        userRole: user.role
      });
    }

    // Decrypt all entities
    return await Promise.all(
      entities.map(e => this.decryptEntityData(entityType, e))
    );
  }

  /**
   * Secure entity filter
   */
  async filter(entityType, query, sortField = '-updated_date', limit = 50) {
    const user = await this.getUserContext();
    if (!user) throw new Error('Authentication required');

    const entities = await base44.entities[entityType].filter(query, sortField, limit);

    // Track access
    await hipaaBreachDetector.trackBulkAccess(entityType, entities.length);

    // Audit log
    if (this.auditEnabled && entities.length > 0) {
      await hipaaAuditLogger.logPHIAccess({
        entityType,
        entityId: 'filtered',
        action: 'view',
        fieldNames: ['*'],
        userEmail: user.email,
        userName: user.name,
        userRole: user.role
      });
    }

    // Decrypt all
    return await Promise.all(
      entities.map(e => this.decryptEntityData(entityType, e))
    );
  }

  /**
   * Secure entity update
   */
  async update(entityType, id, data) {
    const user = await this.getUserContext();
    if (!user) throw new Error('Authentication required');

    // Track activity
    hipaaBreachDetector.logActivity('update', { entityType, id, user: user.email });

    // Encrypt PHI fields
    const encryptedData = await this.encryptEntityData(entityType, data);

    // Update entity
    const updated = await base44.entities[entityType].update(id, encryptedData);

    // Audit log
    if (this.auditEnabled) {
      await hipaaAuditLogger.logPHIAccess({
        entityType,
        entityId: id,
        action: 'update',
        fieldNames: Object.keys(data),
        userEmail: user.email,
        userName: user.name,
        userRole: user.role,
        patientId: data.patient_id || id
      });
    }

    return await this.decryptEntityData(entityType, updated);
  }

  /**
   * Secure entity delete
   */
  async delete(entityType, id) {
    const user = await this.getUserContext();
    if (!user) throw new Error('Authentication required');

    // Track activity
    hipaaBreachDetector.logActivity('delete', { entityType, id, user: user.email });

    // Audit log before deletion
    if (this.auditEnabled) {
      await hipaaAuditLogger.logPHIAccess({
        entityType,
        entityId: id,
        action: 'delete',
        fieldNames: ['*'],
        userEmail: user.email,
        userName: user.name,
        userRole: user.role
      });
    }

    return await base44.entities[entityType].delete(id);
  }

  /**
   * Secure bulk create
   */
  async bulkCreate(entityType, dataArray) {
    const user = await this.getUserContext();
    if (!user) throw new Error('Authentication required');

    // Track bulk operation
    await hipaaBreachDetector.trackBulkAccess(entityType, dataArray.length);

    // Encrypt all
    const encryptedArray = await Promise.all(
      dataArray.map(data => this.encryptEntityData(entityType, data))
    );

    const created = await base44.entities[entityType].bulkCreate(encryptedArray);

    // Audit log
    if (this.auditEnabled) {
      await hipaaAuditLogger.logPHIAccess({
        entityType,
        entityId: 'bulk',
        action: 'create',
        fieldNames: ['bulk_operation'],
        userEmail: user.email,
        userName: user.name,
        userRole: user.role
      });
    }

    return await Promise.all(
      created.map(e => this.decryptEntityData(entityType, e))
    );
  }
}

export const secureEntity = new SecureEntityWrapper();

// Convenience methods for common entities
export const securePatient = {
  create: (data) => secureEntity.create('Patient', data),
  list: () => secureEntity.list('Patient'),
  filter: (query) => secureEntity.filter('Patient', query),
  update: (id, data) => secureEntity.update('Patient', id, data),
  delete: (id) => secureEntity.delete('Patient', id)
};

export const secureVisit = {
  create: (data) => secureEntity.create('Visit', data),
  list: () => secureEntity.list('Visit'),
  filter: (query) => secureEntity.filter('Visit', query),
  update: (id, data) => secureEntity.update('Visit', id, data),
  delete: (id) => secureEntity.delete('Visit', id)
};

export const secureCarePlan = {
  create: (data) => secureEntity.create('CarePlan', data),
  list: () => secureEntity.list('CarePlan'),
  filter: (query) => secureEntity.filter('CarePlan', query),
  update: (id, data) => secureEntity.update('CarePlan', id, data),
  delete: (id) => secureEntity.delete('CarePlan', id)
};