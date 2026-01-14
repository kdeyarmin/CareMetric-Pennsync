/**
 * PHI Masking Utilities
 * 
 * Dynamic data de-identification and masking based on user roles
 * Implements HIPAA "minimum necessary" principle
 */

import { PHI_FIELDS } from "./HIPAAEncryption";

// Role-based access levels
export const ACCESS_LEVELS = {
  admin: 'full',
  physician: 'full',
  md: 'full',
  do: 'full',
  np: 'full',
  rn: 'clinical',
  lpn: 'clinical',
  msw: 'limited',
  pt: 'limited',
  ot: 'limited',
  st: 'limited',
  user: 'minimal'
};

// Field access by level
export const FIELD_ACCESS = {
  full: ['*'], // All fields
  clinical: [
    'first_name',
    'last_name',
    'date_of_birth',
    'medical_record_number',
    'phone',
    'primary_diagnosis',
    'secondary_diagnoses',
    'allergies',
    'current_medications',
    'vital_signs',
    'nurse_notes',
    'care_plans'
  ],
  limited: [
    'first_name',
    'last_name',
    'medical_record_number',
    'primary_diagnosis',
    'care_plans'
  ],
  minimal: [
    'first_name',
    'last_name',
    'medical_record_number'
  ]
};

/**
 * Mask PHI field based on field type
 */
export function maskField(value, fieldName, fieldType = 'default') {
  if (!value) return '';

  const masks = {
    ssn: () => '***-**-' + String(value).slice(-4),
    phone: () => {
      const digits = String(value).replace(/\D/g, '');
      return '***-***-' + digits.slice(-4);
    },
    email: () => {
      const [local, domain] = String(value).split('@');
      return local.slice(0, 2) + '***@' + domain;
    },
    name: () => String(value).charAt(0) + '***',
    mrn: () => '***' + String(value).slice(-3),
    address: () => '*** [Address Redacted]',
    dob: () => {
      // Show only year
      const date = new Date(value);
      return `**/**/${date.getFullYear()}`;
    },
    notes: () => '[Clinical notes redacted for privacy]',
    default: () => '*** [Protected Information]'
  };

  // Determine mask type from field name
  if (fieldName.includes('ssn')) return masks.ssn();
  if (fieldName.includes('phone')) return masks.phone();
  if (fieldName.includes('email')) return masks.email();
  if (fieldName.includes('name') && fieldName !== 'first_name' && fieldName !== 'last_name') return masks.name();
  if (fieldName.includes('mrn') || fieldName.includes('medical_record')) return masks.mrn();
  if (fieldName.includes('address')) return masks.address();
  if (fieldName.includes('birth') || fieldName === 'date_of_birth') return masks.dob();
  if (fieldName.includes('note') || fieldName.includes('clinical')) return masks.notes();

  return masks[fieldType] ? masks[fieldType]() : masks.default();
}

/**
 * Check if user has access to specific field
 */
export function hasFieldAccess(userRole, fieldName, entityType) {
  const accessLevel = ACCESS_LEVELS[userRole?.toLowerCase()] || 'minimal';
  const allowedFields = FIELD_ACCESS[accessLevel];

  // Full access gets everything
  if (allowedFields.includes('*')) return true;

  // Check if field is in allowed list
  return allowedFields.includes(fieldName);
}

/**
 * Mask entity data based on user role
 */
export function maskEntityData(entityType, data, userRole, context = {}) {
  if (!data) return data;

  const accessLevel = ACCESS_LEVELS[userRole?.toLowerCase()] || 'minimal';
  const phiFields = PHI_FIELDS[entityType] || [];

  // Full access - no masking
  if (accessLevel === 'full') return data;

  const masked = { ...data };

  // Mask fields user doesn't have access to
  phiFields.forEach(field => {
    if (!hasFieldAccess(userRole, field, entityType)) {
      if (masked[field] !== undefined) {
        masked[field] = maskField(masked[field], field);
        masked[`${field}_masked`] = true;
      }
    }
  });

  return masked;
}

/**
 * Mask array of entities
 */
export function maskEntityArray(entityType, dataArray, userRole) {
  if (!Array.isArray(dataArray)) return dataArray;
  return dataArray.map(data => maskEntityData(entityType, data, userRole));
}

/**
 * Get masked patient name for display
 */
export function getMaskedPatientName(patient, userRole) {
  const accessLevel = ACCESS_LEVELS[userRole?.toLowerCase()] || 'minimal';

  if (accessLevel === 'full' || accessLevel === 'clinical') {
    return `${patient.first_name} ${patient.last_name}`;
  }

  // Limited access - show initials
  if (accessLevel === 'limited') {
    return `${patient.first_name?.[0]}. ${patient.last_name}`;
  }

  // Minimal - just MRN
  return `Patient ${patient.medical_record_number}`;
}

/**
 * Mask clinical notes for different roles
 */
export function maskClinicalNotes(notes, userRole) {
  const accessLevel = ACCESS_LEVELS[userRole?.toLowerCase()] || 'minimal';

  if (accessLevel === 'full' || accessLevel === 'clinical') {
    return notes;
  }

  // Limited/minimal access
  return '[Clinical notes available to clinical staff only]';
}

/**
 * Create audit trail for masked access
 */
export function logMaskedAccess(entityType, entityId, userRole, maskedFields) {
  if (maskedFields.length > 0) {
    console.log('[PHI Masking]', {
      entityType,
      entityId,
      userRole,
      maskedFields,
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * React Hook for masked data display
 */
export function useMaskedData(entityType, data, userRole) {
  if (!data) return null;
  return maskEntityData(entityType, data, userRole);
}

/**
 * Check if data is masked
 */
export function isDataMasked(data, fieldName) {
  return data?.[`${fieldName}_masked`] === true;
}

/**
 * Get access level description
 */
export function getAccessLevelDescription(userRole) {
  const level = ACCESS_LEVELS[userRole?.toLowerCase()] || 'minimal';
  
  const descriptions = {
    full: 'Complete access to all patient health information',
    clinical: 'Clinical access to medical records and care information',
    limited: 'Limited access to basic patient information and care plans',
    minimal: 'Minimal access to patient identifiers only'
  };

  return descriptions[level];
}