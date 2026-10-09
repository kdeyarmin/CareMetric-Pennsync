import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/testUtils';
import DocumentSignatures from './DocumentSignatures';

const esign = vi.hoisted(() => ({
  listSignatureRequests: vi.fn(),
  getSignatureRequest: vi.fn(),
  sendSigningLink: vi.fn(),
  sendSignatureReminder: vi.fn(),
  cancelSignatureRequest: vi.fn(),
}));

vi.mock('@/api/base44Client', () => ({
  base44: { auth: { me: async () => ({ id: 'user-1', email: 'nurse@example.test' }) } },
}));
vi.mock('@/lib/roles', () => ({
  getTrustedTenantContext: (user) => (user ? {
    user_id: 'user-1', agency_id: 'agency-1', membership_id: 'membership-1', membership_version: 1, tenant_role: 'clinician',
  } : null),
}));
vi.mock('@/lib/esignClient', async (importOriginal) => ({ ...(await importOriginal()), ...esign }));

const REQUEST_KEY = 'a'.repeat(64);

function request(overrides = {}) {
  return {
    request_key: REQUEST_KEY,
    package_name: 'Admission consents',
    patient_id: 'patient-1',
    patient_name: 'Pat Example',
    created_at: '2026-10-01T12:00:00.000Z',
    created_by_email: 'nurse@example.test',
    created_by_me: true,
    due_date: '2026-10-20',
    message: null,
    status: 'awaiting_signatures',
    counts: { documents: 1, signers_total: 2, signers_signed: 0 },
    can_manage: true,
    documents: [{
      id: 'doc-1', title: 'Consent for care', status: 'pending', workflow_status: 'pending', sealing_pending: false,
      signers: [
        { signer_id: 'signer-1', name: 'Pat Example', status: 'pending' },
        { signer_id: 'signer-2', name: 'Cara Giver', status: 'pending' },
      ],
    }],
    packages: [
      { id: 'package-1', signer_id: 'signer-1', signer_name: 'Pat Example', signer_email: 'pat@example.test', signer_role: 'patient', status: 'pending', link: null, reminders: { pending: 0 } },
      {
        id: 'package-2', signer_id: 'signer-2', signer_name: 'Cara Giver', signer_email: 'cara@example.test', signer_role: 'caregiver', status: 'pending',
        link: { status: 'active', sent_at: '2026-10-01T12:00:00.000Z', expires_at: '2026-10-08T12:00:00.000Z', opened_count: 1 }, reminders: { pending: 0 },
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  for (const fn of Object.values(esign)) fn.mockReset();
  esign.listSignatureRequests.mockResolvedValue({ success: true, requests: [request()], truncated: false });
  esign.getSignatureRequest.mockResolvedValue({ success: true, request: request(), events: [] });
  esign.sendSigningLink.mockResolvedValue({ success: true });
  esign.sendSignatureReminder.mockResolvedValue({ success: true });
  esign.cancelSignatureRequest.mockResolvedValue({ success: true, cancelled_documents: 1, revoked_links: 1 });
});

describe('DocumentSignatures', () => {
  it('lists the requests the broker returns for the bound agency', async () => {
    renderWithProviders(<DocumentSignatures />);
    expect(await screen.findByText('Admission consents')).toBeInTheDocument();
    expect(esign.listSignatureRequests).toHaveBeenCalledWith({ agencyId: 'agency-1', status: 'open', patientId: null });
    expect(screen.getByText(/0 of 2 signatures/)).toBeInTheDocument();
  });

  it('sends a first link, rotates an existing one, and cancels with a reason', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DocumentSignatures />);
    await user.click(await screen.findByRole('button', { name: /Admission consents/ }));
    const signers = screen.getByRole('region', { name: 'Signers' });

    await user.click(within(signers).getByRole('button', { name: /Email signing link/ }));
    await waitFor(() => expect(esign.sendSigningLink).toHaveBeenCalledWith({
      agencyId: 'agency-1', packageId: 'package-1', signerId: 'signer-1',
    }));
    await user.click(within(signers).getByRole('button', { name: /Send new link/ }));
    await waitFor(() => expect(esign.sendSignatureReminder).toHaveBeenCalledWith({
      agencyId: 'agency-1', packageId: 'package-2', signerId: 'signer-2',
    }));

    await user.click(screen.getByRole('button', { name: /Cancel request/ }));
    await user.type(await screen.findByLabelText(/Reason/), 'Sent to the wrong address');
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel request' }));
    await waitFor(() => expect(esign.cancelSignatureRequest).toHaveBeenCalledWith({
      agencyId: 'agency-1', requestKey: REQUEST_KEY, reason: 'Sent to the wrong address',
    }));
  });
});
