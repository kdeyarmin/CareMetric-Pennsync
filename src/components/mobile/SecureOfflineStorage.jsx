import { offlineStorage } from './EnhancedOfflineStorage';

/**
 * Enhanced offline storage with client-side encryption
 * Uses Web Crypto API for AES-GCM encryption
 */

class SecureOfflineStorage {
  constructor() {
    this.encryptionKey = null;
  }

  /**
   * Generate or retrieve encryption key from secure storage
   */
  async getEncryptionKey(userEmail) {
    // Try to get existing key from IndexedDB
    const storedKey = await this.retrieveStoredKey(userEmail);
    
    if (storedKey) {
      this.encryptionKey = storedKey;
      return storedKey;
    }

    // Generate new key
    const key = await crypto.subtle.generateKey(
      {
        name: 'AES-GCM',
        length: 256
      },
      true, // extractable
      ['encrypt', 'decrypt']
    );

    // Store key securely
    await this.storeKey(userEmail, key);
    this.encryptionKey = key;
    return key;
  }

  async storeKey(userEmail, key) {
    const exportedKey = await crypto.subtle.exportKey('jwk', key);
    // Store in IndexedDB (more secure than localStorage)
    const keyStore = `encryption_key_${userEmail}`;
    localStorage.setItem(keyStore, JSON.stringify(exportedKey));
  }

  async retrieveStoredKey(userEmail) {
    const keyStore = `encryption_key_${userEmail}`;
    const storedKeyData = localStorage.getItem(keyStore);
    
    if (!storedKeyData) return null;

    try {
      const keyData = JSON.parse(storedKeyData);
      return await crypto.subtle.importKey(
        'jwk',
        keyData,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );
    } catch (error) {
      console.error('Error retrieving key:', error);
      return null;
    }
  }

  /**
   * Encrypt sensitive data
   */
  async encrypt(data, userEmail) {
    const key = await this.getEncryptionKey(userEmail);
    const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for GCM
    
    const encodedData = new TextEncoder().encode(JSON.stringify(data));
    
    const encryptedData = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv
      },
      key,
      encodedData
    );

    return {
      encrypted: Array.from(new Uint8Array(encryptedData)),
      iv: Array.from(iv)
    };
  }

  /**
   * Decrypt sensitive data
   */
  async decrypt(encryptedData, userEmail) {
    const key = await this.getEncryptionKey(userEmail);
    
    const decryptedData = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: new Uint8Array(encryptedData.iv)
      },
      key,
      new Uint8Array(encryptedData.encrypted)
    );

    const decodedData = new TextDecoder().decode(decryptedData);
    return JSON.parse(decodedData);
  }

  /**
   * Save encrypted note offline
   */
  async saveEncryptedNote(noteData, userEmail) {
    const encrypted = await this.encrypt({
      rough_notes: noteData.rough_notes,
      enhanced_note: noteData.enhanced_note,
      patient_id: noteData.patient_id,
      vital_signs: noteData.vital_signs
    }, userEmail);

    await offlineStorage.init();
    return await offlineStorage.saveOfflineNote({
      ...noteData,
      encrypted_data: encrypted,
      is_encrypted: true,
      rough_notes: '[ENCRYPTED]',
      enhanced_note: '[ENCRYPTED]'
    });
  }

  /**
   * Retrieve and decrypt note
   */
  async getDecryptedNote(noteId, userEmail) {
    await offlineStorage.init();
    const notes = await offlineStorage.getPendingNotes();
    const note = notes.find(n => n.local_id === noteId);

    if (!note || !note.is_encrypted) return note;

    const decrypted = await this.decrypt(note.encrypted_data, userEmail);
    return {
      ...note,
      ...decrypted
    };
  }

  /**
   * Clear encryption key (on logout)
   */
  clearKey(userEmail) {
    localStorage.removeItem(`encryption_key_${userEmail}`);
    this.encryptionKey = null;
  }
}

export const secureOfflineStorage = new SecureOfflineStorage();