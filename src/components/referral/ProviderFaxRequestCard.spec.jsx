import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { authMe, invoke, uploadFile, exportToPDF, agencySettingsFilter, ruleConfigFilter } = vi.hoisted(() => ({
  authMe: vi.fn(),
  invoke: vi.fn(),
  uploadFile: vi.fn(),
  exportToPDF: vi.fn(),
  agencySettingsFilter: vi.fn(),
  ruleConfigFilter: vi.fn(),
}));

// Mock at the base44 layer so the REAL @/lib/agencySettings helpers run (the
// card loads them via dynamic import) against these entity stubs.
vi.mock('@/api/base44Client', () => ({
  base44: {
    auth: { me: (...a) => authMe(...a) },
    functions: { invoke: (...a) => invoke(...a) },
    integrations: { Core: { UploadFile: (...a) => uploadFile(...a) } },
    entities: {
      AgencySettings: { filter: (...a) => agencySettingsFilter(...a), list: vi.fn(async () => []) },
      FollowUpRuleConfig: { filter: (...a) => ruleConfigFilter(...a), list: vi.fn(async () => []) },
    },
  },
}));

vi.mock('@/components/utils/pdfExporter', () => ({ exportToPDF: (...a) => exportToPDF(...a) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

import ProviderFaxRequestCard from '@/components/referral/ProviderFaxRequestCard';
import { toast } from 'sonner';

// A referral with plenty to request: no F2F, no frequencies, uncoded
// comorbidity signal (metformin, no diabetes code), thin functional detail.
const gappyReferral = {
  demographics: {
    full_name: 'Jane Doe',
    date_of_birth: '1948-03-02',
    insurance_primary: 'Medicare',
    referring_physician: 'Dr. Alice Wong, MD',
  },
  diagnoses: { primary_diagnosis: 'Hip fracture S72.001A', secondary_diagnoses: [] },
  medications: [{ name: 'Metformin', dosage: '500 mg' }],
  skilled_needs: { services_ordered: ['Skilled nursing'] },
};

const renderCard = (props = {}) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ProviderFaxRequestCard referralData={gappyReferral} analysis={null} {...props} />
    </QueryClientProvider>
  );

beforeEach(() => {
  authMe.mockReset().mockResolvedValue({ email: 'intake@a.example', agency_name: 'Agency A' });
  invoke.mockReset().mockResolvedValue({ data: { success: true, log_id: 'fx1' } });
  uploadFile.mockReset().mockResolvedValue({ file_url: 'https://files.example/request.pdf' });
  exportToPDF.mockReset().mockResolvedValue(new Blob(['pdf'], { type: 'application/pdf' }));
  ruleConfigFilter.mockReset().mockResolvedValue([]);
  // fetchCallerAgencySettings tries agency_code first — return the row there.
  agencySettingsFilter.mockReset().mockResolvedValue([
    {
      office_name: 'Acme Home Health',
      office_fax_number_e164: '+15705550111',
      main_office_number_e164: '+15705550100',
    },
  ]);
});

describe('ProviderFaxRequestCard', () => {
  it('itemizes engine gaps AND analyzer comorbidity confirmations', async () => {
    renderCard();
    expect(await screen.findByText(/Face-to-Face encounter documentation missing/)).toBeInTheDocument();
    expect(screen.getByText(/Visit frequency and duration not specified/)).toBeInTheDocument();
    expect(screen.getByText(/Confirm diagnosis: Diabetes \(documented but not coded\)/)).toBeInTheDocument();
    // Return fax prefilled from agency settings (via the real lib helper).
    await waitFor(() => expect(screen.getByLabelText(/Return fax/).value).toBe('+15705550111'));
  });

  it('unchecking an item drops it from the request count', async () => {
    renderCard();
    const before = (await screen.findByRole('button', { name: /Fax to provider \(\d+\)/ })).textContent;
    const countBefore = Number(before.match(/\((\d+)\)/)[1]);
    await userEvent.click(screen.getByRole('checkbox', { name: /Include: Face-to-Face encounter documentation missing/ }));
    const after = screen.getByRole('button', { name: /Fax to provider \(\d+\)/ }).textContent;
    expect(Number(after.match(/\((\d+)\)/)[1])).toBe(countBefore - 1);
  });

  it('faxes the generated request PDF to the entered provider number', async () => {
    renderCard();
    await screen.findByText(/Face-to-Face encounter documentation missing/);
    await userEvent.type(screen.getByLabelText(/Provider fax #/), '570-555-0199');
    await userEvent.click(screen.getByRole('button', { name: /Fax to provider/ }));

    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(exportToPDF).toHaveBeenCalledWith(expect.objectContaining({ output: 'blob' }));
    expect(uploadFile).toHaveBeenCalledTimes(1);
    const [fn, payload] = invoke.mock.calls[0];
    expect(fn).toBe('sendFax');
    expect(payload).toMatchObject({
      file_url: 'https://files.example/request.pdf',
      to_number: '570-555-0199',
      to_name: 'Dr. Alice Wong, MD',
    });
    expect(await screen.findByText(/delivery tracked in the fax log/i)).toBeInTheDocument();
    // The PDF content carries the itemized request sections.
    const pdfArgs = exportToPDF.mock.calls[0][0];
    expect(JSON.stringify(pdfArgs.content)).toContain('Face-to-Face');
  });

  it('refuses to fax without a provider number', async () => {
    renderCard();
    await screen.findByText(/Face-to-Face encounter documentation missing/);
    await userEvent.click(screen.getByRole('button', { name: /Fax to provider/ }));
    expect(toast.error).toHaveBeenCalledWith("Enter the provider's fax number first.");
    expect(invoke).not.toHaveBeenCalled();
  });

  it('downloads the PDF without faxing', async () => {
    renderCard();
    await screen.findByText(/Face-to-Face encounter documentation missing/);
    await userEvent.click(screen.getByRole('button', { name: /Download PDF/ }));
    await waitFor(() => expect(exportToPDF).toHaveBeenCalledTimes(1));
    expect(exportToPDF.mock.calls[0][0].output).toBe('save');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('switching to a different referral clears the destination fax number (PHI guard)', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrap = (data) => (
      <QueryClientProvider client={client}>
        <ProviderFaxRequestCard referralData={data} analysis={null} />
      </QueryClientProvider>
    );
    const { rerender } = render(wrap(gappyReferral));
    await screen.findByText(/Face-to-Face encounter documentation missing/);
    await userEvent.type(screen.getByLabelText(/Provider fax #/), '570-555-0199');
    expect(screen.getByLabelText(/Provider fax #/).value).toBe('570-555-0199');

    // Patient B's referral arrives in the same mounted card — patient A's
    // provider fax number must not survive as the destination.
    rerender(wrap({ ...gappyReferral, demographics: { ...gappyReferral.demographics, full_name: 'Patient B' } }));
    expect(screen.getByLabelText(/Provider fax #/).value).toBe('');
  });
});
