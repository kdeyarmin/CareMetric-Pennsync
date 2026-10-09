import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/testUtils';
import SignatureRequestCreator from './SignatureRequestCreator';

const mocks = vi.hoisted(() => ({
  createSignatureRequest: vi.fn(),
  sendSigningLink: vi.fn(),
  tenant: { loading: false, agencyId: 'agency-1', canRequest: true, canManage: false, tenantRole: 'clinician' },
}));

// A native stand-in for the Radix select, so the test drives real choices.
vi.mock('@/components/ui/select', async () => {
  const React = await import('react');
  const Context = React.createContext(null);
  return {
    Select: ({ value, onValueChange, children }) => (
      <Context.Provider value={{ value, onValueChange }}>{children}</Context.Provider>
    ),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: function SelectContent({ children }) {
      const context = React.useContext(Context);
      return (
        <select value={context.value} onChange={(event) => context.onValueChange(event.target.value)}>
          <option value="" />
          {children}
        </select>
      );
    },
    SelectItem: ({ value, children }) => <option value={value}>{children}</option>,
  };
});
vi.mock('@/hooks/useSignatureRequests', () => ({
  useSigningTenant: () => mocks.tenant,
  signatureRequestsKey: (agencyId, ...rest) => ['esign', agencyId, ...rest],
}));
vi.mock('@/hooks/useScopedPatients', () => ({
  useScopedPatients: () => ({
    isLoading: false,
    data: [{
      id: 'patient-1', first_name: 'Pat', last_name: 'Example', email: 'pat@example.test',
      caregiver_name: 'Cara Giver', caregiver_email: 'cara@example.test',
    }],
  }),
}));
vi.mock('@/hooks/useAuthorizedDocuments', () => ({
  useAuthorizedDocuments: ({ patientId }) => ({
    isFetching: false,
    data: patientId ? [
      { id: 'doc-1', title: 'Consent for care', file_type: 'application/pdf', patient_id: 'patient-1' },
      { id: 'doc-2', title: 'Wound photo notes', file_type: 'text/plain', patient_id: 'patient-1' },
    ] : [],
  }),
}));
// The chart-upload wrapper loads for real; its SDK never gets a call here.
vi.mock('@/api/base44Client', () => ({ base44: { functions: { invoke: vi.fn() } } }));
vi.mock('@/lib/esignClient', async (importOriginal) => ({
  ...(await importOriginal()),
  createSignatureRequest: mocks.createSignatureRequest,
  sendSigningLink: mocks.sendSigningLink,
}));

beforeEach(() => {
  globalThis.ResizeObserver ||= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  mocks.createSignatureRequest.mockReset();
  mocks.sendSigningLink.mockReset();
  mocks.createSignatureRequest.mockResolvedValue({
    success: true,
    request: {
      package_name: 'Admission consents', due_date: '2026-10-20',
      packages: [{ id: 'package-1', signer_id: 'signer-1', signer_name: 'Pat Example' }],
    },
  });
  mocks.sendSigningLink.mockResolvedValue({ success: true });
});

describe('SignatureRequestCreator', () => {
  it('creates a request from chart documents and emails each signer a link', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SignatureRequestCreator />);

    await user.selectOptions(screen.getAllByRole('combobox')[0], 'patient-1');
    expect(screen.queryByText('Wound photo notes')).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Consent for care' }));
    await user.click(screen.getByRole('button', { name: 'Add patient' }));
    await user.type(screen.getByLabelText('Request name'), 'Admission consents');
    await user.click(screen.getByRole('button', { name: /Create signature request/ }));

    await waitFor(() => expect(mocks.createSignatureRequest).toHaveBeenCalledTimes(1));
    const [body] = mocks.createSignatureRequest.mock.calls[0];
    expect(body).toMatchObject({
      agency_id: 'agency-1',
      patient_id: 'patient-1',
      document_ids: ['doc-1'],
      signers: [{ name: 'Pat Example', email: 'pat@example.test', role: 'patient' }],
      package_name: 'Admission consents',
      signature_fields: [],
      auto_reminders: true,
      reminder_days_before: 2,
    });
    expect(body.client_request_id).toMatch(/^request-/);
    expect(body.due_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await waitFor(() => expect(mocks.sendSigningLink).toHaveBeenCalledWith({
      agencyId: 'agency-1', packageId: 'package-1', signerId: 'signer-1',
    }));
    expect(await screen.findByText('Signing link emailed to Pat Example')).toBeInTheDocument();
  });

  it('explains the requirements instead of sending an incomplete request', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SignatureRequestCreator />);
    await user.click(screen.getByRole('button', { name: /Create signature request/ }));
    expect(await screen.findByText('Choose a patient.')).toBeInTheDocument();
    expect(mocks.createSignatureRequest).not.toHaveBeenCalled();
  });
});
