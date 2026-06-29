import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Email validation
const validateEmail = (email) => {
  if (!email) return null;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return 'Invalid email format. Must be in format: user@domain.com';
  }
  return null;
};

// Phone validation
const validatePhone = (phone) => {
  if (!phone) return null;
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length !== 10 && cleaned.length !== 11) {
    return 'Phone number must be 10 digits (or 11 with country code)';
  }
  if (cleaned.length === 11 && cleaned[0] !== '1') {
    return '11-digit phone numbers must start with 1';
  }
  return null;
};

// Date validation
const validateDate = (dateString, fieldName = 'date') => {
  if (!dateString) return null;
  
  // Check format YYYY-MM-DD
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dateString)) {
    return `${fieldName} must be in YYYY-MM-DD format (e.g., 2024-12-18)`;
  }
  
  const date = new Date(dateString);
  if (isNaN(date.getTime())) {
    return `Invalid ${fieldName}`;
  }
  
  const now = new Date();
  if (fieldName === 'date_of_birth' && date > now) {
    return 'Date of birth cannot be in the future';
  }
  
  return null;
};

// Validate patient data
const validatePatientData = (patient) => {
  const errors = [];

  // Required fields
  if (!patient.first_name || patient.first_name.trim() === '') {
    errors.push({ field: 'first_name', message: 'First name is required' });
  }

  if (!patient.last_name || patient.last_name.trim() === '') {
    errors.push({ field: 'last_name', message: 'Last name is required' });
  }

  if (!patient.date_of_birth) {
    errors.push({ field: 'date_of_birth', message: 'Date of birth is required' });
  } else {
    const dobError = validateDate(patient.date_of_birth, 'date_of_birth');
    if (dobError) {
      errors.push({ field: 'date_of_birth', message: dobError });
    }
  }

  // Optional field validation
  if (patient.email) {
    const emailError = validateEmail(patient.email);
    if (emailError) {
      errors.push({ field: 'email', message: emailError });
    }
  }

  if (patient.phone) {
    const phoneError = validatePhone(patient.phone);
    if (phoneError) {
      errors.push({ field: 'phone', message: phoneError });
    }
  }

  if (patient.emergency_contact_phone) {
    const phoneError = validatePhone(patient.emergency_contact_phone);
    if (phoneError) {
      errors.push({ field: 'emergency_contact_phone', message: 'Emergency contact phone: ' + phoneError });
    }
  }

  if (patient.physician_email) {
    const emailError = validateEmail(patient.physician_email);
    if (emailError) {
      errors.push({ field: 'physician_email', message: 'Physician email: ' + emailError });
    }
  }

  if (patient.physician_phone) {
    const phoneError = validatePhone(patient.physician_phone);
    if (phoneError) {
      errors.push({ field: 'physician_phone', message: 'Physician phone: ' + phoneError });
    }
  }

  if (patient.caregiver_email) {
    const emailError = validateEmail(patient.caregiver_email);
    if (emailError) {
      errors.push({ field: 'caregiver_email', message: 'Caregiver email: ' + emailError });
    }
  }

  if (patient.caregiver_phone) {
    const phoneError = validatePhone(patient.caregiver_phone);
    if (phoneError) {
      errors.push({ field: 'caregiver_phone', message: 'Caregiver phone: ' + phoneError });
    }
  }

  if (patient.admission_date) {
    const admissionError = validateDate(patient.admission_date, 'admission_date');
    if (admissionError) {
      errors.push({ field: 'admission_date', message: admissionError });
    }
  }

  return errors;
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { patient } = body;

    if (!patient) {
      return Response.json({ 
        valid: false, 
        errors: [{ field: 'general', message: 'Patient data is required' }] 
      }, { status: 400 });
    }

    const errors = validatePatientData(patient);

    if (errors.length > 0) {
      return Response.json({
        valid: false,
        errors
      }, { status: 200 });
    }

    return Response.json({
      valid: true,
      message: 'Patient data is valid'
    });
  } catch (error) {
    console.error('Validation error:', error);
    return Response.json({ 
      error: error.message,
      valid: false
    }, { status: 500 });
  }
});