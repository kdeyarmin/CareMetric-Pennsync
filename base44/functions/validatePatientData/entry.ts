import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: pennsyncProductionAppId — generated, edit base44/_shared/backendHelpers.mjs>>>
const PENNSYNC_PRODUCTION_APP_ID = '694ec16e72e01b60d22f7cbf';
// <<<END SHARED HELPER: pennsyncProductionAppId>>>
// <<<BEGIN SHARED HELPER: base44ClientRequest — generated, edit base44/_shared/backendHelpers.mjs>>>
function pinnedBase44Request(req, expectedAppId, forwardUserCredential) {
  if (typeof expectedAppId !== 'string' || expectedAppId === '') {
    throw new Error('pinned Base44 request requires an expected Base44-App-Id');
  }
  // Read the inbound headers without ever throwing on the SHAPE of req. A production
  // request is always a real Request with a Headers bag; a bare object with no usable
  // headers (a test fixture, a malformed direct call) carries no inbound header, which
  // is the absent case handled below. Only a PRESENT, different app id throws, and that
  // requires a real header an attacker would have to set — so a real Request always
  // reaches this read and the refusal is never skipped by the tolerance.
  const inbound =
    req && req.headers && typeof req.headers.get === 'function' ? req.headers : null;
  const read = (name) => (inbound ? inbound.get(name) : null);
  const received = read('Base44-App-Id');
  // Refuse only an ACTIVE mismatch: a caller presenting a DIFFERENT app id is the
  // tenant-redirect attack, and that is the case the refusal exists for. An ABSENT
  // header is not a mismatch and selects no other tenant — it only means the request
  // did not arrive through the platform, which always injects this header. We SET the
  // pinned constant below either way, so absent falls back to the correct app exactly
  // as the dropped Base44-Api-Url falls back to the default serverUrl. Throwing on
  // absent would turn every anonymous denial into a 500 instead of a clean 403.
  if (received !== null && received !== expectedAppId) {
    throw new Error(
      'Base44-App-Id mismatch: expected ' + expectedAppId + ', received ' + received
    );
  }
  const headers = new Headers();
  // Load-bearing: SET the constant (never forward the inbound value). The SDK reads
  // appId from this header and throws of its own accord when it is absent, so pinning
  // requires setting it here — dropping the inbound header alone would not suffice.
  headers.set('Base44-App-Id', expectedAppId);
  const serviceAuth = read('Base44-Service-Authorization');
  if (serviceAuth !== null) headers.set('Base44-Service-Authorization', serviceAuth);
  if (forwardUserCredential) {
    const authorization = read('Authorization');
    if (authorization !== null) headers.set('Authorization', authorization);
    const dataEnv = read('X-Data-Env');
    if (dataEnv === 'dev' || dataEnv === 'prod') headers.set('X-Data-Env', dataEnv);
  }
  // Cosmetic URL: serverUrl comes from the dropped Base44-Api-Url, not from here.
  // No method: the SDK request factory reads only headers.get(...), never the
  // method, so the request defaults to GET. An explicit POST would be inert for the
  // SDK and would read as an outbound delivery primitive to the inventory scanner
  // once this block is inlined into the fax status pollers.
  return new Request('https://base44.app', { headers });
}
function userScopedClientRequest(req, expectedAppId) {
  return pinnedBase44Request(req, expectedAppId, true);
}
function serviceRoleClientRequest(req, expectedAppId) {
  return pinnedBase44Request(req, expectedAppId, false);
}
// <<<END SHARED HELPER: base44ClientRequest>>>
// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


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
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    const user = await base44.auth.me();
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

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
      error: 'Internal server error',
      valid: false
    }, { status: 500 });
  }
});