// Validation utilities for patient data

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

// Levenshtein edit distance (iterative, two-row) — helper for fuzzyMatch.
const levenshtein = (a, b) => {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
};

// Fuzzy string match. Returns { match, type } where type is 'exact' (identical
// after normalization), 'close' (similarity >= threshold but not identical), or
// 'none'. Consumed by RealTimeValidator to surface "did you mean an existing
// value?" warnings — it only warns on type === 'close', so an exact match
// deliberately produces no warning.
export const fuzzyMatch = (value, target, threshold = 0.8) => {
  if (!value || !target) return { match: false, type: 'none' };
  const a = String(value).trim().toLowerCase();
  const b = String(target).trim().toLowerCase();
  if (!a || !b) return { match: false, type: 'none' };
  if (a === b) return { match: true, type: 'exact' };
  const similarity = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  return similarity >= threshold
    ? { match: true, type: 'close' }
    : { match: false, type: 'none' };
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
export const validateDate = (dateString) => {
  if (!dateString) return null;
  
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dateString)) {
    return VALIDATION_ERRORS.INVALID_DATE;
  }
  
  const date = new Date(dateString + 'T00:00:00');
  if (isNaN(date.getTime())) {
    return VALIDATION_ERRORS.INVALID_DATE;
  }
  
  return null;
};

// Date of birth validation
export const validateDateOfBirth = (dob) => {
  const error = validateDate(dob);
  if (error) return error;
  
  const dobDate = new Date(dob + 'T00:00:00');
  const today = new Date();
  
  if (dobDate > today) {
    return VALIDATION_ERRORS.FUTURE_DOB;
  }
  
  const age = today.getFullYear() - dobDate.getFullYear();
  if (age > 125) {
    return VALIDATION_ERRORS.INVALID_AGE;
  }
  
  return null;
};

// Cross-field validation: admission before discharge
export const validateDateOrder = (admissionDate, dischargeDate) => {
  if (!admissionDate || !dischargeDate) return null;
  
  const admission = new Date(admissionDate + 'T00:00:00');
  const discharge = new Date(dischargeDate + 'T00:00:00');
  
  if (admission > discharge) {
    return VALIDATION_ERRORS.INVALID_DATE_ORDER;
  }
  
  return null;
};

// MRN validation
export const validateMRN = (mrn) => {
  if (!mrn || !mrn.trim()) return VALIDATION_ERRORS.INVALID_MRN;
  return null;
};

// Name validation
export const validateName = (firstName, lastName) => {
  if (!firstName?.trim() || !lastName?.trim()) {
    return VALIDATION_ERRORS.INVALID_NAME;
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
      const dobDate = new Date(patient.date_of_birth + 'T00:00:00');
      const age = new Date().getFullYear() - dobDate.getFullYear();
      if (age < 18) {
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

// Comprehensive patient record validation (legacy)
export const validatePatientRecord = (patient) => {
  const errors = {};
  
  if (patient.email) {
    const emailError = validateEmail(patient.email);
    if (emailError) errors.email = emailError;
  }
  
  if (patient.phone) {
    const phoneError = validatePhone(patient.phone);
    if (phoneError) errors.phone = phoneError;
  }
  
  if (patient.date_of_birth) {
    const dobError = validateDateOfBirth(patient.date_of_birth);
    if (dobError) errors.date_of_birth = dobError;
  }
  
  if (patient.admission_date) {
    const admitError = validateDate(patient.admission_date);
    if (admitError) errors.admission_date = admitError;
  }
  
  if (patient.discharge_date) {
    const dischargeError = validateDate(patient.discharge_date);
    if (dischargeError) errors.discharge_date = dischargeError;
  }
  
  if (patient.admission_date && patient.discharge_date) {
    const orderError = validateDateOrder(patient.admission_date, patient.discharge_date);
    if (orderError) errors.date_order = orderError;
  }
  
  if (patient.emergency_contact_phone) {
    const emergPhoneError = validatePhone(patient.emergency_contact_phone);
    if (emergPhoneError) errors.emergency_contact_phone = emergPhoneError;
  }
  
  if (patient.physician_phone) {
    const physPhoneError = validatePhone(patient.physician_phone);
    if (physPhoneError) errors.physician_phone = physPhoneError;
  }
  
  if (patient.caregiver_phone) {
    const carePhoneError = validatePhone(patient.caregiver_phone);
    if (carePhoneError) errors.caregiver_phone = carePhoneError;
  }
  
  return Object.keys(errors).length === 0 ? null : errors;
};