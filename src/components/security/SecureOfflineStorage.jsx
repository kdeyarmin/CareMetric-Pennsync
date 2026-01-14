/**
 * Secure Offline Storage
 * 
 * Encrypted local storage for offline mobile workflow
 * Ensures PHI is protected even when cached locally
 */

import { hipaaEncryption } from "./HIPAAEncryption";

class SecureOfflineStorage {
  constructor() {
    this.storagePrefix = 'secure_offline_';
    this.encryptionKey = null;
    this.initialized = false;
  }

  /**
   * Initialize encryption key for session
   */
  async initialize() {
    if (this.initialized) return;

    try {
      // Generate or retrieve session key
      const storedKey = sessionStorage.getItem('offline_encryption_key');
      
      if (storedKey) {
        this.encryptionKey = await crypto.subtle.importKey(
          'jwk',
          JSON.parse(storedKey),
          { name: 'AES-GCM', length: 256 },
          true,
          ['encrypt', 'decrypt']
        );
      } else {
        this.encryptionKey = await hipaaEncryption.generateKey();
        const exportedKey = await crypto.subtle.exportKey('jwk', this.encryptionKey);
        sessionStorage.setItem('offline_encryption_key', JSON.stringify(exportedKey));
      }

      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize secure storage:', error);
      throw new Error('Secure storage initialization failed');
    }
  }

  /**
   * Securely store data offline
   */
  async setItem(key, value) {
    await this.initialize();

    try {
      const encrypted = await hipaaEncryption.encryptPHI(value, this.encryptionKey);
      const storageKey = this.storagePrefix + key;
      
      localStorage.setItem(storageKey, JSON.stringify({
        data: encrypted,
        timestamp: Date.now(),
        encrypted: true
      }));

      return true;
    } catch (error) {
      console.error('Failed to store encrypted data:', error);
      return false;
    }
  }

  /**
   * Securely retrieve data from offline storage
   */
  async getItem(key) {
    await this.initialize();

    try {
      const storageKey = this.storagePrefix + key;
      const stored = localStorage.getItem(storageKey);
      
      if (!stored) return null;

      const parsed = JSON.parse(stored);
      
      if (!parsed.encrypted) {
        // Legacy unencrypted data - remove it
        localStorage.removeItem(storageKey);
        return null;
      }

      return await hipaaEncryption.decryptPHI(parsed.data, this.encryptionKey);
    } catch (error) {
      console.error('Failed to retrieve encrypted data:', error);
      return null;
    }
  }

  /**
   * Remove item from storage
   */
  async removeItem(key) {
    const storageKey = this.storagePrefix + key;
    localStorage.removeItem(storageKey);
  }

  /**
   * Clear all offline data
   */
  async clearAll() {
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
      if (key.startsWith(this.storagePrefix)) {
        localStorage.removeItem(key);
      }
    });

    // Clear encryption key
    sessionStorage.removeItem('offline_encryption_key');
    this.encryptionKey = null;
    this.initialized = false;
  }

  /**
   * Store patient data for offline access
   */
  async cachePatient(patient) {
    const key = `patient_${patient.id}`;
    return await this.setItem(key, patient);
  }

  /**
   * Retrieve cached patient
   */
  async getCachedPatient(patientId) {
    const key = `patient_${patientId}`;
    return await this.getItem(key);
  }

  /**
   * Cache multiple patients
   */
  async cachePatients(patients) {
    const results = await Promise.all(
      patients.map(p => this.cachePatient(p))
    );
    return results.every(r => r === true);
  }

  /**
   * Get all cached patients
   */
  async getAllCachedPatients() {
    const keys = Object.keys(localStorage).filter(k => 
      k.startsWith(this.storagePrefix + 'patient_')
    );

    const patients = await Promise.all(
      keys.map(async key => {
        const id = key.replace(this.storagePrefix + 'patient_', '');
        return await this.getCachedPatient(id);
      })
    );

    return patients.filter(p => p !== null);
  }

  /**
   * Cache visit note
   */
  async cacheVisitNote(visitId, noteData) {
    const key = `visit_note_${visitId}`;
    return await this.setItem(key, noteData);
  }

  /**
   * Get cached visit note
   */
  async getCachedVisitNote(visitId) {
    const key = `visit_note_${visitId}`;
    return await this.getItem(key);
  }

  /**
   * Get storage size and usage
   */
  getStorageInfo() {
    let totalSize = 0;
    let itemCount = 0;

    Object.keys(localStorage).forEach(key => {
      if (key.startsWith(this.storagePrefix)) {
        totalSize += localStorage.getItem(key).length;
        itemCount++;
      }
    });

    return {
      totalSize: `${(totalSize / 1024).toFixed(2)} KB`,
      itemCount,
      maxSize: '5 MB (browser limit)',
      percentUsed: ((totalSize / (5 * 1024 * 1024)) * 100).toFixed(1)
    };
  }

  /**
   * Validate stored data integrity
   */
  async validateIntegrity() {
    const keys = Object.keys(localStorage).filter(k => 
      k.startsWith(this.storagePrefix)
    );

    let valid = 0;
    let invalid = 0;

    for (const key of keys) {
      try {
        const data = await this.getItem(key.replace(this.storagePrefix, ''));
        if (data) valid++;
        else invalid++;
      } catch (error) {
        invalid++;
      }
    }

    return { valid, invalid, total: keys.length };
  }

  /**
   * Auto-cleanup old cached data
   */
  async cleanupOldData(maxAgeMs = 86400000) { // 24 hours default
    const keys = Object.keys(localStorage).filter(k => 
      k.startsWith(this.storagePrefix)
    );

    let cleaned = 0;

    for (const key of keys) {
      try {
        const stored = JSON.parse(localStorage.getItem(key));
        if (stored.timestamp && (Date.now() - stored.timestamp) > maxAgeMs) {
          localStorage.removeItem(key);
          cleaned++;
        }
      } catch (error) {
        // Invalid data, remove it
        localStorage.removeItem(key);
        cleaned++;
      }
    }

    return cleaned;
  }
}

export const secureOfflineStorage = new SecureOfflineStorage();

/**
 * React Hook for secure offline storage
 */
export function useSecureOfflineStorage() {
  return {
    store: (key, value) => secureOfflineStorage.setItem(key, value),
    retrieve: (key) => secureOfflineStorage.getItem(key),
    remove: (key) => secureOfflineStorage.removeItem(key),
    clear: () => secureOfflineStorage.clearAll(),
    getInfo: () => secureOfflineStorage.getStorageInfo()
  };
}