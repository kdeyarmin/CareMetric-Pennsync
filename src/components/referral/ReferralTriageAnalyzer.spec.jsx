import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const { invoke, extractPdfText } = vi.hoisted(() => ({
  invoke: vi.fn(),
  extractPdfText: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock('@/api/base44Client', () => ({
  base44: { functions: { invoke: (...args) => invoke(...args) } },
}));

vi.mock('./referralPdfText', async (importOriginal) => ({
  ...(await importOriginal()),
  extractPdfText: (...args) => extractPdfText(...args),
}));

import ReferralTriageAnalyzer from '@/components/referral/ReferralTriageAnalyzer';

const ANALYSIS = {
  patient_name: 'Jane Doe',
  date_of_birth: '1950-05-01',
  primary_diagnosis: 'CHF',
  urgency_level: 'HIGH',
  urgency_reason: 'Recent hospitalization',
  clinical_summary: 'Referred for skilled nursing.',
  admission_notes: 'Call daughter before visit.',
};

const pdf = (name = 'packet.pdf') => new File(['%PDF-1.7'], name, { type: 'application/pdf' });
const choose = (file) =>
  fireEvent.change(screen.getByLabelText('Referral packet PDF'), { target: { files: [file] } });

beforeEach(() => {
  invoke.mockReset().mockResolvedValue({ data: { success: true, analysis: ANALYSIS } });
  extractPdfText.mockReset().mockResolvedValue({
    text: 'Patient: Jane Doe\nDx: CHF', pageCount: 3, emptyPages: 0, unreadPages: 0, cutPage: null,
  });
});

describe('ReferralTriageAnalyzer', () => {
  it('has no text box — the packet PDF is the only input', () => {
    render(<ReferralTriageAnalyzer />);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('button', { name: /choose pdf/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Referral packet PDF')).toHaveAttribute('accept', '.pdf,application/pdf');
  });

  it('reads the uploaded packet and triages its text without another click', async () => {
    const onTriageComplete = vi.fn();
    const onTriageReset = vi.fn();
    render(<ReferralTriageAnalyzer onTriageComplete={onTriageComplete} onTriageReset={onTriageReset} />);

    choose(pdf());

    expect(await screen.findByText('Urgency Level: HIGH')).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('triageReferralWithAI', { referralData: 'Patient: Jane Doe\nDx: CHF' });
    expect(onTriageReset).toHaveBeenCalledTimes(1);
    expect(onTriageComplete).toHaveBeenCalledWith(ANALYSIS);
    expect(screen.getByText(/Analyzed packet\.pdf/)).toBeInTheDocument();
    expect(screen.queryByText(/not analyzed/i)).toBeNull();
  });

  it('accepts a packet dropped on the upload area', async () => {
    render(<ReferralTriageAnalyzer />);
    fireEvent.drop(screen.getByTestId('referral-packet-dropzone'), { dataTransfer: { files: [pdf()] } });
    expect(await screen.findByText('Urgency Level: HIGH')).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('refuses a scanned packet with no text layer instead of triaging nothing', async () => {
    extractPdfText.mockResolvedValue({ text: '', pageCount: 4, emptyPages: 4, unreadPages: 0, cutPage: null });
    const onTriageComplete = vi.fn();
    render(<ReferralTriageAnalyzer onTriageComplete={onTriageComplete} />);

    choose(pdf());

    expect(await screen.findByText(/looks like a scanned or faxed image/)).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
    expect(onTriageComplete).not.toHaveBeenCalled();
  });

  it('says which pages triage did not see when the packet was read only in part', async () => {
    extractPdfText.mockResolvedValue({ text: 'Patient: Jane Doe', pageCount: 12, emptyPages: 3, unreadPages: 1, cutPage: null });
    render(<ReferralTriageAnalyzer />);

    choose(pdf());

    expect(await screen.findByText('Urgency Level: HIGH')).toBeInTheDocument();
    expect(screen.getByText('Part of the packet was not analyzed')).toBeInTheDocument();
    expect(screen.getByText(/3 of 12 pages had no readable text/)).toBeInTheDocument();
    expect(screen.getByText(/the last 1 page was not included/)).toBeInTheDocument();
  });

  it('warns when a single oversized page was cut, though no page is unread or empty', async () => {
    extractPdfText.mockResolvedValue({ text: 'x'.repeat(90_000), pageCount: 1, emptyPages: 0, unreadPages: 0, cutPage: 1 });
    render(<ReferralTriageAnalyzer />);

    choose(pdf());

    expect(await screen.findByText('Urgency Level: HIGH')).toBeInTheDocument();
    expect(screen.getByText('Part of the packet was not analyzed')).toBeInTheDocument();
    expect(screen.getByText(/Page 1 is longer than triage can read at once/)).toBeInTheDocument();
  });

  it('turns an unreadable PDF into words and does not call triage', async () => {
    extractPdfText.mockRejectedValue(Object.assign(new Error('x'), { name: 'PasswordException' }));
    render(<ReferralTriageAnalyzer />);

    choose(pdf());

    expect(await screen.findByText(/password-protected/)).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('refuses a file that is not a PDF before reading it', async () => {
    render(<ReferralTriageAnalyzer />);
    choose(new File(['hello'], 'notes.txt', { type: 'text/plain' }));
    expect(await screen.findByText('Upload the referral packet as a PDF.')).toBeInTheDocument();
    expect(extractPdfText).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('shows the triage failure and clears the previous result when a new packet fails', async () => {
    render(<ReferralTriageAnalyzer />);
    choose(pdf('first.pdf'));
    expect(await screen.findByText('Urgency Level: HIGH')).toBeInTheDocument();

    invoke.mockResolvedValueOnce({ data: { success: false, error: 'Triage analysis failed' } });
    choose(pdf('second.pdf'));

    expect(await screen.findByText('Triage analysis failed')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Urgency Level: HIGH')).toBeNull());
  });
});
