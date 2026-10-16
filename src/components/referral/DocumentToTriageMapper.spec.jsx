import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/testUtils';

const {
  createPatient,
  updatePatientFieldsMock,
  createReferral,
  extractedState,
} = vi.hoisted(() => ({
  createPatient: vi.fn(async () => ({ id: 'patient-new' })),
  updatePatientFieldsMock: vi.fn(async () => ({})),
  createReferral: vi.fn(async () => ({ id: 'referral-new' })),
  extractedState: { value: null },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ tenantContext: { agency_id: 'agency-a', tenant_role: 'manager' } }),
}));

vi.mock('@/hooks/useScopedPatients', () => ({
  useScopedPatients: () => ({ data: [] }),
}));

vi.mock('@/functions/createAuthorizedPatient', () => ({
  createAuthorizedPatient: (...args) => createPatient(...args),
  createPatientRequestId: () => 'request-1',
}));

vi.mock('@/functions/updateAuthorizedPatient', () => ({
  updatePatientFields: (...args) => updatePatientFieldsMock(...args),
}));

vi.mock('@/functions/manageAuthorizedReferral', () => ({
  createAuthorizedReferral: (...args) => createReferral(...args),
}));

vi.mock('@/components/documents/DocumentIngestionUploader', () => ({
  default: ({ onDataExtracted }) => (
    <button onClick={() => onDataExtracted(extractedState.value)}>run-extraction</button>
  ),
}));

vi.mock('@/components/ui/SearchablePatientSelect', () => ({
  default: () => null,
}));

import DocumentToTriageMapper from './DocumentToTriageMapper';

// A hostile extraction: the source document is a Heritage Ridge SNF packet
// whose printed MRN (13383) is that facility's record number. It arrives
// under both keys extractors have used. Neither may reach a PennSync chart:
// MatrixCare assigns our MRN (D233).
const HOSTILE_EXTRACTION = {
  patient: {
    first_name: 'Robert',
    last_name: 'Grove',
    full_name: 'Robert Grove',
    date_of_birth: '1936-06-23',
    medical_record_number: '13383',
    mrn: '13383',
    phone: '(814) 322-4273',
    address: '733 Mineral Point Rd, Mineral Point, PA 15942',
    email: '',
  },
  clinical: {
    primary_diagnosis: 'Cellulitis of groin',
    secondary_diagnoses: ['Urinary tract infection'],
    allergies: 'Celecoxib, Levaquin',
    current_medications: [],
    chief_complaint: '',
  },
  vitals: {},
  document_info: {
    source_facility: 'Heritage Ridge Senior Living',
    document_type: 'pdf',
    confidence_score: 90,
  },
};

beforeEach(() => {
  extractedState.value = HOSTILE_EXTRACTION;
  createPatient.mockClear();
  updatePatientFieldsMock.mockClear();
  createReferral.mockClear();
});

describe('DocumentToTriageMapper — document MRN containment (D233)', () => {
  it('creates the chart without the document MRN anywhere in the payload', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DocumentToTriageMapper />);

    await user.click(screen.getByText('run-extraction'));
    await user.click(screen.getByLabelText(/Create New Patient/));
    await user.click(screen.getByLabelText(/Create Triage\/Referral/));
    await user.click(screen.getByRole('button', { name: /Create in System/ }));

    await waitFor(() => expect(createPatient).toHaveBeenCalledTimes(1));
    const payload = createPatient.mock.calls[0][0];
    expect(payload).toMatchObject({
      first_name: 'Robert',
      last_name: 'Grove',
      date_of_birth: '1936-06-23',
      phone: '(814) 322-4273',
    });
    expect(payload).not.toHaveProperty('medical_record_number');
    expect(JSON.stringify(payload)).not.toContain('13383');
    expect(updatePatientFieldsMock).not.toHaveBeenCalled();
    await waitFor(() => expect(createReferral).toHaveBeenCalledTimes(1));
  });
});
