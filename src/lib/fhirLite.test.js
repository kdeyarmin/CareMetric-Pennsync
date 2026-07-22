import test from 'node:test';
import assert from 'node:assert/strict';
import { fhirLitePatientToAppPatient, patientToFhirLite, referralToServiceRequestFhirLite, validateFhirLiteResource } from './fhirLite.js';

test('patientToFhirLite exports a minimal deterministic Patient resource', () => {
  const resource = patientToFhirLite({ id: 'p1', first_name: 'Ada', last_name: 'Lovelace', date_of_birth: '1815-12-10', phone: '555-0100', medical_record_number: 'MRN1' });
  assert.equal(resource.resourceType, 'Patient');
  assert.equal(resource.name[0].family, 'Lovelace');
  assert.equal(resource.identifier[0].value, 'MRN1');
  assert.equal(validateFhirLiteResource(resource).valid, true);
});

test('referralToServiceRequestFhirLite exports referral intent and subject links', () => {
  const resource = referralToServiceRequestFhirLite({ id: 'r1', patient_id: 'p1', diagnosis: 'CHF', referral_date: '2026-07-22', referral_source: 'Hospital' });
  assert.equal(resource.resourceType, 'ServiceRequest');
  assert.equal(resource.intent, 'order');
  assert.equal(resource.subject.reference, 'Patient/p1');
});

test('fhirLitePatientToAppPatient imports supported Patient resources and rejects others', () => {
  const patient = fhirLitePatientToAppPatient({ resourceType: 'Patient', id: 'ext1', name: [{ given: ['Ada'], family: 'Lovelace' }], birthDate: '1815-12-10', telecom: [{ system: 'phone', value: '555' }] });
  assert.equal(patient.external_id, 'ext1');
  assert.equal(patient.first_name, 'Ada');
  assert.throws(() => fhirLitePatientToAppPatient({ resourceType: 'Observation' }), /Unsupported FHIR resourceType/);
});
