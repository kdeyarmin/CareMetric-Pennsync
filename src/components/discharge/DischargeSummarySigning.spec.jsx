import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/testUtils';
import DischargeSummaryWorkflow from './DischargeSummaryWorkflow';

const mocks = vi.hoisted(() => ({
  filter: vi.fn(),
  update: vi.fn(),
  signDischargeSummary: vi.fn(),
  png: `data:image/png;base64,${btoa(String.fromCharCode(...new Uint8Array(140).map((_, index) => index)))}`,
}));

vi.mock('@/api/base44Client', () => ({
  base44: {
    auth: { me: async () => ({ id: 'clinician-1', email: 'rn@example.test' }) },
    entities: { DischargeSummary: { filter: mocks.filter, update: mocks.update } },
    functions: { invoke: vi.fn() },
  },
}));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ tenantContext: { agency_id: 'agency-1' } }) }));
vi.mock('@/hooks/useAuthorizedPatient', () => ({ useAuthorizedPatient: () => ({ data: { id: 'patient-1' } }) }));
vi.mock('@/lib/esignClient', async (importOriginal) => ({
  ...(await importOriginal()),
  signDischargeSummary: mocks.signDischargeSummary,
}));
vi.mock('@/components/signature/SignaturePadCanvas', () => ({
  default: ({ onSignatureCapture }) => (
    <button type="button" onClick={() => onSignatureCapture(mocks.png)}>Draw test signature</button>
  ),
}));

function summary(overrides = {}) {
  return {
    id: 'summary-1', patient_id: 'patient-1', status: 'reviewed', discharge_disposition: 'home_independent',
    summary_of_care: 'Goals met; discharged home.', ...overrides,
  };
}

beforeEach(() => {
  mocks.filter.mockReset();
  mocks.signDischargeSummary.mockReset();
});

describe('discharge summary clinician signing', () => {
  it('signs a reviewed summary only after attestation and a signature, through the broker', async () => {
    mocks.filter.mockResolvedValue([summary()]);
    mocks.signDischargeSummary.mockImplementation(async () => {
      mocks.filter.mockResolvedValue([summary({
        status: 'signed', signature: { signed_by_name: 'Riley Nurse', signed_date: '2026-10-08T15:00:00.000Z' },
      })]);
      return { success: true, status: 'signed' };
    });
    const user = userEvent.setup();
    renderWithProviders(
      <DischargeSummaryWorkflow patientId="patient-1" summaryId="summary-1" initialStep="sign" onClose={() => {}} />,
    );

    const sign = await screen.findByRole('button', { name: /Sign Discharge Summary/ });
    expect(sign).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Draw test signature' }));
    expect(sign).toBeDisabled();
    await user.click(screen.getByRole('checkbox'));
    expect(sign).toBeEnabled();
    await user.click(sign);

    await waitFor(() => expect(mocks.signDischargeSummary).toHaveBeenCalledTimes(1));
    const [input] = mocks.signDischargeSummary.mock.calls[0];
    expect(input).toMatchObject({ agencyId: 'agency-1', dischargeSummaryId: 'summary-1' });
    expect(input.file).toBeInstanceOf(File);
    expect(input.clientRequestId).toMatch(/^discharge-/);
    expect(await screen.findByText(/Signed by Riley Nurse/)).toBeInTheDocument();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('offers no signature control until the clinical review is complete', async () => {
    mocks.filter.mockResolvedValue([summary({ status: 'pending_review' })]);
    renderWithProviders(
      <DischargeSummaryWorkflow patientId="patient-1" summaryId="summary-1" initialStep="sign" onClose={() => {}} />,
    );
    expect(await screen.findByText('Complete the clinical review before signing.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sign Discharge Summary/ })).not.toBeInTheDocument();
  });
});
