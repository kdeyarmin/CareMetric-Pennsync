import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { authMe, userList, invoke, sendEmail, uploadFile, notificationCreate, pdgmFilter, pdgmList, payerFilter, payerList, exportToPDF } = vi.hoisted(() => ({
  authMe: vi.fn(),
  userList: vi.fn(),
  invoke: vi.fn(),
  sendEmail: vi.fn(),
  uploadFile: vi.fn(),
  notificationCreate: vi.fn(),
  pdgmFilter: vi.fn(),
  pdgmList: vi.fn(),
  payerFilter: vi.fn(),
  payerList: vi.fn(),
  exportToPDF: vi.fn(),
}));

vi.mock('@/api/base44Client', () => ({
  base44: {
    auth: { me: (...a) => authMe(...a) },
    functions: { invoke: (...a) => invoke(...a) },
    entities: {
      User: { list: (...a) => userList(...a) },
      Notification: { create: (...a) => notificationCreate(...a) },
      PDGMRateConfig: { filter: (...a) => pdgmFilter(...a), list: (...a) => pdgmList(...a) },
      PayerRateConfig: { filter: (...a) => payerFilter(...a), list: (...a) => payerList(...a) },
    },
    integrations: { Core: { SendEmail: (...a) => sendEmail(...a), UploadFile: (...a) => uploadFile(...a) } },
  },
}));

vi.mock('@/components/utils/pdfExporter', () => ({ exportToPDF: (...a) => exportToPDF(...a) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

// Radix Select shim (same rationale as AdmissionBriefEmailCard.spec).
vi.mock('@/components/ui/select', async () => {
  const React = await import('react');
  const Ctx = React.createContext(() => {});
  return {
    Select: ({ onValueChange, children }) => <Ctx.Provider value={onValueChange}>{children}</Ctx.Provider>,
    SelectTrigger: ({ children, ...props }) => <div {...props}>{children}</div>,
    SelectValue: ({ placeholder }) => <span>{placeholder}</span>,
    SelectContent: ({ children }) => <div>{children}</div>,
    SelectItem: ({ value, children }) => {
      const onValueChange = React.useContext(Ctx);
      return <button type="button" onClick={() => onValueChange(value)}>{children}</button>;
    },
  };
});

import ClinicalManagerBriefCard from '@/components/referral/ClinicalManagerBriefCard';

const ADMIN = { email: 'admin@a.example', full_name: 'Alex Admin', role: 'admin', agency_name: 'Agency A' };
const NURSE = { email: 'nurse@a.example', full_name: 'Nina Nurse', role: 'user', agency_name: 'Agency A' };

const roster = [
  { id: 'u1', email: 'manager@a.example', full_name: 'Mia Manager', role: 'admin', agency_name: 'Agency A', is_active: true },
  { id: 'u2', email: 'nurse@a.example', full_name: 'Nina Nurse', role: 'user', agency_name: 'Agency A', is_active: true },
];

const referralData = {
  demographics: { full_name: 'Jane Doe', insurance_primary: 'Medicare' },
  diagnoses: { primary_diagnosis: 'CHF', primary_icd10: 'I50.9' },
  skilled_needs: { frequency_duration: 'SN 3w2, 2w2, 1w5' },
  oasis_assessment: { m1860_ambulation: '2 - Walker with supervision' },
};

const pdgmResponse = {
  rateBasis: { isOfficial: false, isEstimate: true },
  original: {
    clinicalGroup: 'MMTA_Cardiac_Circulatory',
    admissionSource: 'institutional',
    episodeTiming: 'early',
    functionalLevel: 'high',
    functionalPoints: 2,
    comorbidityLevel: 'none',
    caseMixWeight: 1.43,
    basePayment: 2038.22,
    wageIndex: 1,
    totalPayment: 2914.66,
  },
  dataValidation: { discrepancies: [] },
};

const renderCard = (props = {}) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ClinicalManagerBriefCard referralData={referralData} analysis={null} {...props} />
    </QueryClientProvider>
  );

beforeEach(() => {
  authMe.mockReset().mockResolvedValue(ADMIN);
  userList.mockReset().mockResolvedValue(roster);
  invoke.mockReset().mockResolvedValue({ data: pdgmResponse });
  sendEmail.mockReset().mockResolvedValue({});
  uploadFile.mockReset().mockResolvedValue({ file_url: 'https://files.example/brief.pdf' });
  notificationCreate.mockReset().mockResolvedValue({});
  pdgmFilter.mockReset().mockResolvedValue([]);
  pdgmList.mockReset().mockResolvedValue([]);
  payerFilter.mockReset().mockResolvedValue([]);
  payerList.mockReset().mockResolvedValue([]);
  exportToPDF.mockReset().mockResolvedValue(new Blob(['pdf'], { type: 'application/pdf' }));
});

describe('ClinicalManagerBriefCard', () => {
  it('renders NOTHING for a non-financial (nurse) user — fail closed', async () => {
    authMe.mockResolvedValue(NURSE);
    const { container } = renderCard();
    // Give the queries a tick; the card must never appear.
    await waitFor(() => expect(authMe).toHaveBeenCalled());
    expect(container.querySelector('.border-violet-300')).toBeNull();
    expect(screen.queryByText(/Clinical Manager Revenue Brief/i)).not.toBeInTheDocument();
    // The PDGM endpoint is never even called for a nurse.
    expect(invoke).not.toHaveBeenCalled();
  });

  it('shows the HIPPS code and draft payment for an admin, offering only admin-tier recipients', async () => {
    renderCard();
    // Derived HIPPS: early+institutional=2, Cardiac=H, high=C, none=1 → 2HC11.
    expect(await screen.findByText('HIPPS 2HC11')).toBeInTheDocument();
    expect(await screen.findByText(/\$2914\.66 \/ 30-day period \(draft\)/)).toBeInTheDocument();
    expect(await screen.findByText(/Mia Manager — manager@a\.example/)).toBeInTheDocument();
    // The nurse never appears as a recipient for the financial brief.
    expect(screen.queryByText(/Nina Nurse — nurse@a\.example/)).not.toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith('calculatePDGM', expect.objectContaining({
      pdgmData: expect.objectContaining({ primary_diagnosis_code: 'I50.9', admission_source: 'community' }),
    }));
  });

  it('emails the PDF brief: generates the blob, uploads it, and sends subject with initials + link', async () => {
    renderCard();
    await userEvent.click(await screen.findByText(/Mia Manager — manager@a\.example/));
    await userEvent.click(screen.getByRole('button', { name: /Email PDF brief/i }));

    await waitFor(() => expect(sendEmail).toHaveBeenCalledTimes(1));
    expect(exportToPDF).toHaveBeenCalledWith(expect.objectContaining({ output: 'blob' }));
    expect(uploadFile).toHaveBeenCalledTimes(1);
    const sent = sendEmail.mock.calls[0][0];
    expect(sent.to).toBe('manager@a.example');
    expect(sent.subject).toContain('J.D.');
    expect(sent.subject).not.toContain('Jane');
    expect(sent.body).toContain('HIPPS: 2HC11');
    expect(sent.body).toContain('https://files.example/brief.pdf');
    expect(await screen.findByText(/Sent to Mia Manager/)).toBeInTheDocument();
    await waitFor(() => expect(notificationCreate).toHaveBeenCalledTimes(1));
  });

  it('still renders the brief with a warning when the PDGM calculation fails', async () => {
    invoke.mockRejectedValue(new Error('pdgm down'));
    renderCard();
    expect(await screen.findByText(/Clinical Manager Revenue Brief/i)).toBeInTheDocument();
    expect(await screen.findByText(/PDGM estimate could not be calculated/i)).toBeInTheDocument();
    // No HIPPS badge without a PDGM result (the static description text still
    // mentions the words "HIPPS code" — target the badge's code format).
    expect(screen.queryByText(/HIPPS \w{5}/)).not.toBeInTheDocument();
  });

  it('a non-Medicare payer skips calculatePDGM entirely and shows the contract estimate', async () => {
    payerFilter.mockResolvedValue([
      {
        agency_name: 'Agency A',
        payers: [
          {
            payer_name: 'Aetna MA',
            payer_type: 'medicare_advantage',
            payment_model: 'per_visit',
            per_visit_rates: { SN: 160 },
            approved_visits: {},
            match_terms: ['aetna'],
          },
        ],
      },
    ]);
    renderCard({
      referralData: {
        ...referralData,
        demographics: { ...referralData.demographics, insurance_primary: 'Aetna Medicare Advantage' },
      },
    });
    expect(await screen.findByText('non-PDGM payer')).toBeInTheDocument();
    // SN 3w2,2w2,1w5 = 15 visits × $160 → contract estimate badge, no PDGM call.
    expect(await screen.findByText(/\$2400\.00 \/ episode \(contract est\.\)/)).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
    expect(screen.queryByText(/HIPPS \w{5}/)).not.toBeInTheDocument();
  });

  it('downloads the PDF via the exporter', async () => {
    renderCard();
    await userEvent.click(await screen.findByRole('button', { name: /Download PDF/i }));
    await waitFor(() => expect(exportToPDF).toHaveBeenCalledTimes(1));
    expect(exportToPDF.mock.calls[0][0].content.some((c) => c.type === 'heading')).toBe(true);
    expect(exportToPDF.mock.calls[0][0].title).toContain('J.D.');
  });
});
