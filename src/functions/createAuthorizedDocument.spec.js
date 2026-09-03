import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@/api/base44Client', () => ({
  base44: { functions: { invoke: (...args) => invoke(...args) } },
}));

import { createAuthorizedDocument } from './createAuthorizedDocument';

function pdf(name = 'clinical-note.pdf', contents = 'pdf-content') {
  return new File([contents], name, { type: 'application/pdf' });
}

function success(file, overrides = {}) {
  return {
    data: {
      success: true,
      created: true,
      document: {
        id: 'document-a',
        file_url: 'https://files.base44.app/document-a.pdf',
        file_name: file.name,
        file_type: file.type,
        file_size: file.size,
        category: 'other',
        patient_id: 'patient-a',
      },
      binding: {
        id: 'binding-a',
        version: 1,
        client_request_id: 'request-a',
      },
      scope: {
        agency_id: 'agency-a',
        patient_id: 'patient-a',
        membership_id: 'membership-a',
        membership_version: 2,
        tenant_role: 'clinician',
      },
      ...overrides,
    },
  };
}

describe('createAuthorizedDocument wrapper', () => {
  beforeEach(() => invoke.mockReset());

  it('sends the actual File through one finite multipart broker payload', async () => {
    const file = pdf();
    invoke.mockResolvedValue(success(file));

    const result = await createAuthorizedDocument({
      file,
      agencyId: 'agency-a',
      patientId: 'patient-a',
      purpose: 'patient_document',
      clientRequestId: 'request-a',
    });

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('createAuthorizedDocument', {
      file,
      agency_id: 'agency-a',
      patient_id: 'patient-a',
      purpose: 'patient_document',
      client_request_id: 'request-a',
    });
    expect(invoke.mock.calls[0][1].file).toBe(file);
    expect(result.document.id).toBe('document-a');
  });

  it('supports an agency-scoped referral without inventing a Patient link', async () => {
    const file = pdf('referral.pdf');
    invoke.mockResolvedValue(success(file, {
      document: {
        id: 'document-r',
        file_url: 'https://files.base44.app/document-r.pdf',
        file_name: file.name,
        file_type: file.type,
        file_size: file.size,
        category: 'referral',
        patient_id: null,
      },
      binding: { id: 'binding-r', version: 1, client_request_id: 'request-r' },
      scope: {
        agency_id: 'agency-a',
        patient_id: null,
        membership_id: 'membership-a',
        membership_version: 2,
        tenant_role: 'manager',
      },
    }));
    await createAuthorizedDocument({
      file,
      agencyId: 'agency-a',
      purpose: 'referral',
      clientRequestId: 'request-r',
    });
    expect(invoke.mock.calls[0][1]).not.toHaveProperty('patient_id');
  });

  it('rejects pseudo-files, unsafe metadata, and caller authority fields before invoke', async () => {
    await expect(createAuthorizedDocument({
      file: { name: 'fake.pdf', type: 'application/pdf', size: 3 },
      agencyId: 'agency-a',
      patientId: 'patient-a',
      purpose: 'patient_document',
    })).rejects.toThrow(/File/);

    for (const file of [
      pdf('../escape.pdf'),
      new File(['x'], 'clinical.exe', { type: 'application/pdf' }),
      new File(['x'], 'clinical.pdf', { type: 'text/plain' }),
      new File([], 'empty.pdf', { type: 'application/pdf' }),
    ]) {
      await expect(createAuthorizedDocument({
        file,
        agencyId: 'agency-a',
        patientId: 'patient-a',
        purpose: 'patient_document',
      })).rejects.toThrow(/file/);
    }

    await expect(createAuthorizedDocument({
      file: pdf(),
      agencyId: 'agency-a',
      patientId: 'patient-a',
      purpose: 'patient_document',
      file_url: 'https://attacker.test/file.pdf',
      created_by: 'attacker@example.test',
      uploaded_by: 'attacker@example.test',
      agency_name: 'Forged Agency',
    })).rejects.toThrow(/unsupported/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('requires exact selectors and the Patient link for patient_document', async () => {
    const file = pdf();
    for (const options of [
      { file, agencyId: '$agency', patientId: 'patient-a', purpose: 'patient_document' },
      { file, agencyId: 'agency-a', patientId: { $ne: null }, purpose: 'patient_document' },
      { file, agencyId: 'agency-a', patientId: null, purpose: 'patient_document' },
      { file, agencyId: 'agency-a', patientId: null, purpose: 'all_documents' },
      {
        file,
        agencyId: 'agency-a',
        patientId: 'patient-a',
        purpose: 'patient_document',
        clientRequestId: ' request-a ',
      },
    ]) {
      await expect(createAuthorizedDocument(options)).rejects.toThrow();
    }
    expect(invoke).not.toHaveBeenCalled();
  });

  it('rejects a false-success response with identity, projection, or scope drift', async () => {
    const file = pdf();
    const options = {
      file,
      agencyId: 'agency-a',
      patientId: 'patient-a',
      purpose: 'patient_document',
      clientRequestId: 'request-a',
    };
    for (const override of [
      { document: { ...success(file).data.document, patient_id: 'patient-b' } },
      { document: { ...success(file).data.document, file_url: 'http://files.test/a.pdf' } },
      { document: { ...success(file).data.document, notes: 'unexpected projection' } },
      { binding: { id: 'binding-a', version: 2, client_request_id: 'request-a' } },
      {
        scope: {
          ...success(file).data.scope,
          agency_id: 'agency-b',
        },
      },
    ]) {
      invoke.mockResolvedValueOnce(success(file, override));
      await expect(createAuthorizedDocument(options)).rejects.toThrow(/upload failed/);
    }
  });
});
