import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/testUtils';
import DischargeSummaryWorkflow from './DischargeSummaryWorkflow';
import DischargeSummaryGenerator from './DischargeSummaryGenerator';
import { toast } from 'sonner';

const mocks = vi.hoisted(() => ({
  filter: vi.fn(),
  update: vi.fn(),
  invoke: vi.fn(),
  exportToPDF: vi.fn(),
  signDischargeSummary: vi.fn(),
  png: `data:image/png;base64,${btoa(String.fromCharCode(...new Uint8Array(140).map((_, index) => index)))}`,
}));

vi.mock('@/api/base44Client', () => ({
  base44: {
    auth: { me: async () => ({ id: 'clinician-1', email: 'rn@example.test' }) },
    entities: { DischargeSummary: { filter: mocks.filter, update: mocks.update } },
    functions: { invoke: mocks.invoke },
  },
}));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ tenantContext: { agency_id: 'agency-1' } }) }));
vi.mock('@/hooks/useAuthorizedPatient', () => ({ useAuthorizedPatient: ({ patientId }) => ({ data: { id: patientId } }) }));
vi.mock('@/components/utils/pdfExporter', () => ({ exportToPDF: mocks.exportToPDF }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
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
  mocks.update.mockReset();
  mocks.invoke.mockReset();
  mocks.exportToPDF.mockReset();
  toast.error.mockClear();
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

  it('reviews the generated record rather than an older cached summary', async () => {
    const generated = summary({ id: 'summary-new', status: 'pending_review', summary_of_care: 'New clinical narrative' });
    mocks.filter.mockImplementation(async query => [query.id === generated.id ? generated : summary({ id: 'summary-old' })]);
    mocks.invoke.mockResolvedValue({ data: { discharge_summary: generated } });
    mocks.update.mockImplementation(async (id, updates) => ({ ...generated, id, ...updates }));
    renderWithProviders(<DischargeSummaryWorkflow patientId="patient-1" onClose={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Generate Discharge Summary' }));
    await screen.findByDisplayValue('New clinical narrative');
    await userEvent.click(screen.getByRole('button', { name: 'Complete Review' }));
    await screen.findByRole('button', { name: 'Sign Discharge Summary' });
    expect(mocks.update).toHaveBeenCalledWith('summary-new', expect.objectContaining({ status: 'reviewed', summary_of_care: 'New clinical narrative' }));
    expect(mocks.filter).toHaveBeenCalledWith({ patient_id: 'patient-1', id: 'summary-new' }, '-generated_date', 1);
  });

  it('leaves edits available when review cannot be saved', async () => {
    mocks.filter.mockResolvedValue([summary({ status: 'pending_review' })]);
    mocks.update.mockRejectedValue(new Error('Save refused'));
    renderWithProviders(<DischargeSummaryWorkflow patientId="patient-1" summaryId="summary-1" initialStep="review" onClose={() => {}} />);
    await screen.findByDisplayValue('Goals met; discharged home.');
    await userEvent.click(screen.getByRole('button', { name: 'Complete Review' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Your edits are still here')));
    expect(screen.getByDisplayValue('Goals met; discharged home.')).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Sign Discharge Summary' })).not.toBeInTheDocument();
  });

  it('locks signed clinical content against accidental re-review', async () => {
    mocks.filter.mockResolvedValue([summary({ status: 'signed' })]);
    renderWithProviders(<DischargeSummaryWorkflow patientId="patient-1" summaryId="summary-1" initialStep="review" onClose={() => {}} />);
    expect(await screen.findByDisplayValue('Goals met; discharged home.')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Complete Review' })).not.toBeInTheDocument();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('shows a recoverable empty state instead of loading forever', async () => {
    mocks.filter.mockResolvedValue([]);
    renderWithProviders(<DischargeSummaryWorkflow patientId="patient-1" summaryId="missing" initialStep="review" onClose={() => {}} />);
    expect(await screen.findByText('This discharge summary was not found for the selected patient.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry loading summary' })).toBeEnabled();
  });

  it('keeps a signed summary open when its PDF download fails', async () => {
    mocks.filter.mockResolvedValue([summary({ status: 'signed', discharge_instructions: 'Call for SpO2 <90%.' })]);
    mocks.exportToPDF.mockRejectedValue(new Error('Download failed'));
    const onClose = vi.fn();
    const onComplete = vi.fn();
    renderWithProviders(<DischargeSummaryWorkflow patientId="patient-1" summaryId="summary-1" initialStep="complete" onClose={onClose} onComplete={onComplete} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Download PDF' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('remains open')));
    expect(onClose).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(mocks.exportToPDF.mock.calls[0][0].content).toContainEqual({ type: 'text', text: 'Call for SpO2 <90%.' });
  });

  it('closes abandoned generation when the selected patient changes', async () => {
    let resolve;
    mocks.filter.mockResolvedValue([]);
    mocks.invoke.mockImplementation(() => new Promise(done => { resolve = done; }));
    const { rerender } = renderWithProviders(<DischargeSummaryGenerator patientId="patient-1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Generate Discharge Summary' }));
    await userEvent.click(screen.getByRole('button', { name: 'Generate Discharge Summary' }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
    rerender(<DischargeSummaryGenerator patientId="patient-2" />);
    resolve({ data: { discharge_summary: summary({ summary_of_care: 'Abandoned patient narrative' }) } });
    await waitFor(() => expect(screen.queryByText('Discharge Summary Workflow')).not.toBeInTheDocument());
    expect(screen.queryByDisplayValue('Abandoned patient narrative')).not.toBeInTheDocument();
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