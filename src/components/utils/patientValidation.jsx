// Validation utilities for patient data

import { calculateAge, parseLocalDate } from '@/lib/dateLocal';

export const SEVERITY = {
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info'
};

export const VALIDATION_ERRORS = {
  INVALID_EMAIL: 'Invalid email format',
  INVALID_PHONE: 'Invalid phone format (10+ digits)',
  INVALID_DATE: 'Invalid date format (YYYY-MM-DD)',
  FUTURE_DOB: 'Date of birth cannot be in the future',
  INVALID_DATE_ORDER: 'Admission date must be before discharge date',
  INVALID_MRN: 'MRN cannot be empty or only spaces',
  INVALID_NAME: 'First and last name are required',
  INVALID_AGE: 'Patient appears to be over 125 years old'
};

// Email validation
export const validateEmail = (email) => {
  if (!email) return null;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) ? null : VALIDATION_ERRORS.INVALID_EMAIL;
};

// Phone number validation (US format)
export const validatePhone = (phone) => {
  if (!phone) return null;
  const digitsOnly = phone.replace(/\D/g, '');
  return digitsOnly.length >= 10 ? null : VALIDATION_ERRORS.INVALID_PHONE;
};

// Date validation (YYYY-MM-DD format)
//
// The shape check is not enough: `new Date('2026-02-31T00:00:00')` does NOT
// produce Invalid Date — V8 rolls the overflow forward to 2026-03-03. So this
// validator used to PASS 2/30, 2/31, 4/31, 6/31, 9/31, 11/31 and Feb 29 in a
// non-leap year, and every downstream reader then silently interpreted the
// typo as a different calendar day. parseLocalDate rejects those (see the
// header of src/lib/dateLocal.js), which is what a validator has to do.
export const validateDate = (dateString) => {
  if (!dateString) return null;

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dateString)) {
    return VALIDATION_ERRORS.INVALID_DATE;
  }

  if (!parseLocalDate(dateString)) {
    return VALIDATION_ERRORS.INVALID_DATE;
  }

  return null;
};

// Date of birth validation
export const validateDateOfBirth = (dob) => {
  const error = validateDate(dob);
  if (error) return error;

  const dobDate = parseLocalDate(dob);
  const today = new Date();

  if (dobDate > today) {
    return VALIDATION_ERRORS.FUTURE_DOB;
  }

  const age = calculateAge(dobDate, today);
  if (age > 125) {
    return VALIDATION_ERRORS.INVALID_AGE;
  }

  return null;
};

// Cross-field validation: admission before discharge
export const validateDateOrder = (admissionDate, dischargeDate) => {
  const admission = parseLocalDate(admissionDate);
  const discharge = parseLocalDate(dischargeDate);
  // An unparseable side is reported by validateDate on its own field; don't
  // also emit a misleading ordering error for it.
  if (!admission || !discharge) return null;

  if (admission > discharge) {
    return VALIDATION_ERRORS.INVALID_DATE_ORDER;
  }

  return null;
};

// Format phone number for display
export const formatPhoneNumber = (phone) => {
  if (!phone) return '';
  const digitsOnly = phone.replace(/\D/g, '');
  if (digitsOnly.length === 10) {
    return `(${digitsOnly.slice(0, 3)}) ${digitsOnly.slice(3, 6)}-${digitsOnly.slice(6)}`;
  }
  return phone;
};

// Comprehensive patient record validation with severity levels
export const validatePatient = (patient) => {
  const validationResults = [];
  
  // Email validation
  if (patient.email) {
    const emailError = validateEmail(patient.email);
    if (emailError) {
      validationResults.push({
        field: 'email',
        message: emailError,
        severity: SEVERITY.ERROR
      });
    }
  }
  
  // Phone validation
  if (patient.phone) {
    const phoneError = validatePhone(patient.phone);
    if (phoneError) {
      validationResults.push({
        field: 'phone',
        message: phoneError,
        severity: SEVERITY.ERROR
      });
    }
  }
  
  // Date of birth validation
  if (patient.date_of_birth) {
    const dobError = validateDateOfBirth(patient.date_of_birth);
    if (dobError) {
      validationResults.push({
        field: 'date_of_birth',
        message: dobError,
        severity: SEVERITY.ERROR
      });
    } else {
      // Age warning for very young patients
      const age = calculateAge(patient.date_of_birth);
      if (age != null && age < 18) {
        validationResults.push({
          field: 'date_of_birth',
          message: `Patient is ${age} years old. Is this correct?`,
          severity: SEVERITY.WARNING,
          canOverride: true
        });
      }
    }
  }
  
  // Admission date validation
  if (patient.admission_date) {
    const admitError = validateDate(patient.admission_date);
    if (admitError) {
      validationResults.push({
        field: 'admission_date',
        message: admitError,
        severity: SEVERITY.ERROR
      });
    }
  }
  
  // Discharge date validation
  if (patient.discharge_date) {
    const dischargeError = validateDate(patient.discharge_date);
    if (dischargeError) {
      validationResults.push({
        field: 'discharge_date',
        message: dischargeError,
        severity: SEVERITY.ERROR
      });
    }
  }
  
  // Cross-field date order validation
  if (patient.admission_date && patient.discharge_date) {
    const orderError = validateDateOrder(patient.admission_date, patient.discharge_date);
    if (orderError) {
      validationResults.push({
        field: 'discharge_date',
        message: orderError,
        severity: SEVERITY.ERROR
      });
    }
  }
  
  // Emergency contact phone
  if (patient.emergency_contact_phone) {
    const emergPhoneError = validatePhone(patient.emergency_contact_phone);
    if (emergPhoneError) {
      validationResults.push({
        field: 'emergency_contact_phone',
        message: emergPhoneError,
        severity: SEVERITY.ERROR
      });
    }
  }
  
  // Physician phone
  if (patient.physician_phone) {
    const physPhoneError = validatePhone(patient.physician_phone);
    if (physPhoneError) {
      validationResults.push({
        field: 'physician_phone',
        message: physPhoneError,
        severity: SEVERITY.ERROR
      });
    }
  }
  
  // Caregiver phone
  if (patient.caregiver_phone) {
    const carePhoneError = validatePhone(patient.caregiver_phone);
    if (carePhoneError) {
      validationResults.push({
        field: 'caregiver_phone',
        message: carePhoneError,
        severity: SEVERITY.ERROR
      });
    }
  }
  
  return validationResults;
};