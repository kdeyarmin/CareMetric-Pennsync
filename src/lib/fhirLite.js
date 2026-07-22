function compact(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => {
      if (value === undefined || value === null || value === '') return false;
      if (Array.isArray(value)) return value.length > 0;
      return true;
    }),
  );
}

export function patientToFhirLite(patient = {}) {
  return compact({
    resourceType: 'Patient',
    id: patient.id || undefined,
    identifier: patient.medical_record_number ? [{ system: 'urn:pennsync:mrn', value: patient.medical_record_number }] : [],
    name: patient.first_name || patient.last_name ? [{ given: patient.first_name ? [patient.first_name] : [], family: patient.last_name || '' }] : [],
    birthDate: patient.date_of_birth || undefined,
    telecom: patient.phone ? [{ system: 'phone', value: patient.phone }] : [],
    address: patient.address ? [{ text: patient.address }] : [],
  });
}

export function referralToServiceRequestFhirLite(referral = {}) {
  return compact({
    resourceType: 'ServiceRequest',
    id: referral.id || undefined,
    status: referral.status === 'declined' ? 'revoked' : 'active',
    intent: 'order',
    subject: referral.patient_id ? { reference: `Patient/${referral.patient_id}` } : undefined,
    authoredOn: referral.referral_date || undefined,
    reasonCode: referral.diagnosis ? [{ text: referral.diagnosis }] : [],
    requester: referral.referral_source ? { display: referral.referral_source } : undefined,
  });
}

export function fhirLitePatientToAppPatient(resource = {}) {
  if (resource.resourceType !== 'Patient') throw new Error(`Unsupported FHIR resourceType: ${resource.resourceType || '(blank)'}`);
  const name = Array.isArray(resource.name) ? resource.name[0] || {} : {};
  const phone = (Array.isArray(resource.telecom) ? resource.telecom : []).find((t) => t.system === 'phone')?.value || null;
  const mrn = (Array.isArray(resource.identifier) ? resource.identifier : []).find((id) => String(id.system || '').includes('mrn'))?.value || null;
  return {
    external_id: resource.id || null,
    first_name: Array.isArray(name.given) ? name.given.join(' ') : '',
    last_name: name.family || '',
    date_of_birth: resource.birthDate || null,
    phone,
    address: Array.isArray(resource.address) ? resource.address[0]?.text || null : null,
    medical_record_number: mrn,
  };
}

export function validateFhirLiteResource(resource = {}) {
  const missing = [];
  if (!resource.resourceType) missing.push('resourceType');
  if (resource.resourceType === 'Patient' && (!Array.isArray(resource.name) || resource.name.length === 0)) missing.push('name');
  if (resource.resourceType === 'ServiceRequest' && !resource.intent) missing.push('intent');
  if (resource.resourceType && !['Patient', 'ServiceRequest'].includes(resource.resourceType)) missing.push('supported resourceType');
  return { valid: missing.length === 0, missing };
}
