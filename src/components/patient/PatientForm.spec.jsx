import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/testUtils';

// Hoisted so the vi.mock factory (hoisted above imports) can reference them.
const { listMock, createMock, scopedPatientsMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  createMock: vi.fn(),
  scopedPatientsMock: vi.fn(),
}));

// Duplicate-guard tests own their exact authorized roster fixture. Mocking the
// shared hook avoids letting unrelated child entity reads satisfy a generic
// `listMock` wait, and avoids inventing mutable User-based tenant authority.
vi.mock('@/hooks/useScopedPatients', () => ({
  useScopedPatients: (...args) => scopedPatientsMock(...args),
  excludeArchived: (rows) => rows.filter((row) => !row.is_archived),
}));

vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ tenantContext: { agency_id: 'agency-a' } }),
}));

vi.mock('@/api/base44Client', () => {
  const entityStub = new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === 'then') return undefined;
        if (prop === 'list') return listMock;
        if (prop === 'create') return createMock;
        if (prop === 'get' || prop === 'update') return async () => ({});
        return async () => [];
      },
    }
  );
  return {
    base44: {
      entities: new Proxy({}, { get: () => entityStub }),
      functions: {
        invoke: async (name, payload) => {
          if (name === 'createAuthorizedPatient') {
            return { data: { patient: await createMock(payload) } };
          }
          return { data: {} };
        },
      },
      auth: { me: async () => ({ role: 'nurse' }) },
    },
  };
});

// security helpers: pass data through, no-op logging.
vi.mock('../utils/security', () => ({
  sanitizeObject: (o) => o,
  handleSecureError: vi.fn(),
  logSecurityEvent: vi.fn(),
}));

// The document scanner, stubbed to hand back what a scan of a Heritage
// Ridge SNF packet carries if the model volunteers the facility's printed
// MRN (13383) under both keys extractors have used. D233: that number is
// the sending facility's, and it must never reach a PennSync chart
// through this form — MatrixCare assigns our MRN.
vi.mock('./OCRDocumentExtractor', () => ({
  default: ({ onDataExtracted }) => (
    <button onClick={() => onDataExtracted({
      first_name: 'Robert',
      last_name: 'Grove',
      date_of_birth: '1936-06-23',
      medical_record_number: '13383',
      mrn: '13383',
    })}>run-scan</button>
  ),
}));

import PatientForm from './PatientForm';

const EXISTING = {
  id: 'existing-1',
  first_name: 'John',
  last_name: 'Smith',
  date_of_birth: '1950-01-15',
  medical_record_number: 'MRN-100',
  is_archived: false,
  status: 'active',
};

async function fillRequired(user) {
  await user.type(screen.getByLabelText(/First Name/i), 'John');
  await user.type(screen.getByLabelText(/Last Name/i), 'Smith');
}

describe('PatientForm add-time duplicate guard', () => {
  it('includes an unsubmitted secondary diagnosis when saving', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PatientForm onSuccess={() => {}} onCancel={() => {}} />);
    await user.type(screen.getByLabelText(/First Name/i), 'Zelda');
    await user.type(screen.getByLabelText(/Last Name/i), 'Nightingale');
    await user.type(screen.getByLabelText(/Secondary Diagnoses/i), 'E11.9');
    await user.click(screen.getByRole('button', { name: /Add Patient/i }));
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock.mock.calls[0][0].secondary_diagnoses).toEqual(['E11.9']);
  });
  it('preserves clinical comparison signs in saved text', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PatientForm onSuccess={() => {}} onCancel={() => {}} />);
    await user.type(screen.getByLabelText(/First Name/i), 'Zelda');
    await user.type(screen.getByLabelText(/Last Name/i), 'Nightingale');
    await user.type(screen.getByLabelText(/Allergies/i), 'Reaction within < 1 hour');
    await user.click(screen.getByRole('button', { name: /Add Patient/i }));
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock.mock.calls[0][0].allergies).toBe('Reaction within < 1 hour');
  });
  beforeEach(() => {
    listMock.mockReset();
    createMock.mockReset();
    listMock.mockResolvedValue([EXISTING]);
    createMock.mockResolvedValue({ id: 'new-1' });
    scopedPatientsMock.mockReset().mockReturnValue({ data: [EXISTING] });
  });

  it('warns and does NOT create when the entered patient matches an existing one', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    renderWithProviders(<PatientForm onSuccess={onSuccess} onCancel={() => {}} />);

    // Wait for the existing roster to load into the query cache.
    await waitFor(() => expect(scopedPatientsMock).toHaveBeenCalled());

    await fillRequired(user);
    // Match on MRN + name so the candidate is unmistakably a duplicate.
    await user.type(screen.getByLabelText(/Medical Record Number/i), 'MRN-100');

    await user.click(screen.getByRole('button', { name: /Add Patient/i }));

    // The duplicate warning appears and the patient is NOT created.
    await screen.findByText(/Possible duplicate patient/i);
    expect(screen.getByRole('button', { name: /Open chart/i })).toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('creates the patient anyway after the user overrides the warning', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    renderWithProviders(<PatientForm onSuccess={onSuccess} onCancel={() => {}} />);
    await waitFor(() => expect(scopedPatientsMock).toHaveBeenCalled());

    await fillRequired(user);
    await user.type(screen.getByLabelText(/Medical Record Number/i), 'MRN-100');
    await user.click(screen.getByRole('button', { name: /Add Patient/i }));

    await screen.findByText(/Possible duplicate patient/i);
    await user.click(screen.getByRole('button', { name: /Add as new anyway/i }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(onSuccess).toHaveBeenCalled();
  });

  it('does not start a second roster read when the parent already supplied one', async () => {
    renderWithProviders(
      <PatientForm rosterPatients={[EXISTING]} onSuccess={() => {}} onCancel={() => {}} />,
    );
    await waitFor(() => expect(scopedPatientsMock).toHaveBeenCalled());
    expect(scopedPatientsMock.mock.calls.every((call) => call[0]?.enabled === false)).toBe(true);
    expect(screen.getByLabelText(/First Name/i)).toBeInTheDocument();
  });

  it('drops a scanned document MRN instead of pre-populating the chart MRN (D233)', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    renderWithProviders(<PatientForm onSuccess={onSuccess} onCancel={() => {}} />);
    await waitFor(() => expect(scopedPatientsMock).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'run-scan' }));

    // The scan pre-populates the form from the document...
    await waitFor(() => expect(screen.getByLabelText(/First Name/i)).toHaveValue('Robert'));
    // ...but the MRN field stays empty: the document's number is not ours.
    expect(screen.getByLabelText(/Medical Record Number/i)).toHaveValue('');

    await user.click(screen.getByRole('button', { name: /Add Patient/i }));
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    const payload = createMock.mock.calls[0][0];
    expect(payload.medical_record_number).toBe('');
    expect(JSON.stringify(payload)).not.toContain('13383');
  });

  it('creates without warning when no existing patient matches', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    renderWithProviders(<PatientForm onSuccess={onSuccess} onCancel={() => {}} />);
    await waitFor(() => expect(scopedPatientsMock).toHaveBeenCalled());

    await user.type(screen.getByLabelText(/First Name/i), 'Zelda');
    await user.type(screen.getByLabelText(/Last Name/i), 'Nightingale');
    await user.click(screen.getByRole('button', { name: /Add Patient/i }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/Possible duplicate patient/i)).not.toBeInTheDocument();
    expect(onSuccess).toHaveBeenCalled();
  });
});