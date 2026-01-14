/**
 * HIPAA-Compliant Encryption Utilities
 * 
 * Provides field-level encryption for PHI (Protected Health Information)
 * Uses Web Crypto API with AES-GCM 256-bit encryption
 */

class HIPAAEncryption {
  constructor() {
    this.algorithm = 'AES-GCM';
    this.keyLength = 256;
  }

  /**
   * Generate a cryptographically secure encryption key
   */
  async generateKey() {
    return await crypto.subtle.generateKey(
      {
        name: this.algorithm,
        length: this.keyLength,
      },
      true,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Encrypt PHI data
   */
  async encryptPHI(data, key) {
    if (!data) return null;
    
    try {
      const encoder = new TextEncoder();
      const dataBuffer = encoder.encode(JSON.stringify(data));
      
      // Generate a random IV for each encryption
      const iv = crypto.getRandomValues(new Uint8Array(12));
      
      const encryptedBuffer = await crypto.subtle.encrypt(
        {
          name: this.algorithm,
          iv: iv,
        },
        key,
        dataBuffer
      );

      // Combine IV and encrypted data
      const combined = new Uint8Array(iv.length + encryptedBuffer.byteLength);
      combined.set(iv, 0);
      combined.set(new Uint8Array(encryptedBuffer), iv.length);

      // Return as base64 string
      return btoa(String.fromCharCode(...combined));
    } catch (error) {
      console.error('Encryption failed:', error);
      throw new Error('HIPAA encryption failed');
    }
  }

  /**
   * Decrypt PHI data
   */
  async decryptPHI(encryptedData, key) {
    if (!encryptedData) return null;
    
    try {
      // Decode base64
      const combined = new Uint8Array(
        atob(encryptedData).split('').map(c => c.charCodeAt(0))
      );

      // Extract IV and encrypted data
      const iv = combined.slice(0, 12);
      const data = combined.slice(12);

      const decryptedBuffer = await crypto.subtle.decrypt(
        {
          name: this.algorithm,
          iv: iv,
        },
        key,
        data
      );

      const decoder = new TextDecoder();
      const decryptedString = decoder.decode(decryptedBuffer);
      
      return JSON.parse(decryptedString);
    } catch (error) {
      console.error('Decryption failed:', error);
      throw new Error('HIPAA decryption failed');
    }
  }

  /**
   * Mask PHI for display to unauthorized users
   */
  maskPHI(data, fieldType) {
    if (!data) return '';
    
    const masks = {
      ssn: '***-**-' + data.slice(-4),
      phone: '***-***-' + data.slice(-4),
      email: data.split('@')[0].slice(0, 2) + '***@' + data.split('@')[1],
      name: data.charAt(0) + '***',
      mrn: '***' + data.slice(-3),
      address: '*** [Redacted]',
      dob: '**/**/****',
      default: '*** [Protected]'
    };

    return masks[fieldType] || masks.default;
  }

  /**
   * Hash sensitive data for comparison (one-way)
   */
  async hashPHI(data) {
    if (!data) return null;
    
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Secure data comparison without exposing actual values
   */
  async secureCompare(data1, data2) {
    const hash1 = await this.hashPHI(data1);
    const hash2 = await this.hashPHI(data2);
    return hash1 === hash2;
  }

  /**
   * Generate audit trail hash for data integrity
   */
  async generateAuditHash(data) {
    const timestamp = Date.now();
    const auditString = JSON.stringify({ data, timestamp });
    return {
      hash: await this.hashPHI(auditString),
      timestamp
    };
  }
}

export const hipaaEncryption = new HIPAAEncryption();

/**
 * PHI Field Identifiers - fields that contain Protected Health Information
 */
export const PHI_FIELDS = {
  patient: [
    'first_name',
    'middle_name', 
    'last_name',
    'date_of_birth',
    'medical_record_number',
    'address',
    'phone',
    'email',
    'emergency_contact_name',
    'emergency_contact_phone',
    'physician_name',
    'physician_phone',
    'physician_email',
    'caregiver_name',
    'caregiver_email',
    'caregiver_phone',
    'allergies',
    'current_medications',
    'past_medical_history',
    'clinical_notes'
  ],
  visit: [
    'nurse_notes',
    'raw_transcription',
    'vital_signs',
    'family_update_text'
  ],
  carePlan: [
    'problem',
    'goal',
    'interventions',
    'baseline_measurement'
  ]
};

/**
 * Check if a field contains PHI
 */
export function isPHIField(entityType, fieldName) {
  return PHI_FIELDS[entityType]?.includes(fieldName) || false;
}

/**
 * Redact PHI from objects for logging/debugging
 */
export function redactPHI(obj, entityType) {
  if (!obj || typeof obj !== 'object') return obj;
  
  const redacted = { ...obj };
  const phiFields = PHI_FIELDS[entityType] || [];
  
  phiFields.forEach(field => {
    if (redacted[field]) {
      redacted[field] = '[REDACTED - PHI]';
    }
  });
  
  return redacted;
}