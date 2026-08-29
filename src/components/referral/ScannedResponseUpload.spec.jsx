import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { uploadFile, invokeLLM, referralUpdate } = vi.hoisted(() => ({
  uploadFile: vi.fn(),
  invokeLLM: vi.fn(),
  referralUpdate: vi.fn(),
}));

vi.mock('@/api/base44Client', () => ({
  base44: {
    integrations: { Core: { UploadFile: (...a) => uploadFile(...a), InvokeLLM: (...a) => invokeLLM(...a) } },
    entities: { Referral: { update: (...a) => referralUpdate(...a) } },
  },
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

import ScannedResponseUpload from '@/components/referral/ScannedResponseUpload';
import { toast } from 'sonner';

const tracking = {
  status: 'sent',
  items: [
    { id: 'f2f_missing', item_status: 'open', title: 'Face-to-Face missing', provider_request: { question: 'Attach the F2F note' } },
    { id: 'frequency_missing', item_status: 'open', title: 'Frequencies missing', provider_request: { question: 'State frequencies' } },
    { id: 'insurance_missing', item_status: 'answered', title: 'Insurance', response: { text: 'portal answer' } },
  ],
};

const referral = { id: 'ref1' };

const chooseFile = () => {
  const file = new File(['scan'], 'response.pdf', { type: 'application/pdf' });
  fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [file] } });
};

beforeEach(() => {
  uploadFile.mockReset().mockResolvedValue({ file_url: 'https://files.example/scan.pdf' });
  invokeLLM.mockReset().mockResolvedValue({
    answers: [
      { id: 'f2f_missing', answered: true, response_text: 'Encounter note attached, seen 8/20 by Dr. Wong' },
      { id: 'frequency_missing', answered: true, response_text: 'SN 2w9; PT 2w4' },
      { id: 'insurance_missing', answered: true, response_text: 'must not apply (already answered)' },
    ],
    document_summary: 'Completed information request form, 2 pages.',
  });
  referralUpdate.mockReset().mockResolvedValue({});
});

describe('ScannedResponseUpload', () => {
  it('extracts answers for OPEN items only and previews them for confirmation', async () => {
    render(<ScannedResponseUpload referral={referral} tracking={tracking} onApplied={() => {}} />);
    chooseFile();

    expect(await screen.findByText(/Encounter note attached, seen 8\/20/)).toBeInTheDocument();
    expect(screen.getByText('SN 2w9; PT 2w4')).toBeInTheDocument();
    expect(screen.getByText(/Completed information request form/)).toBeInTheDocument();
    // The already-answered item is never offered for application.
    expect(screen.queryByText(/must not apply/)).not.toBeInTheDocument();
    // The extraction prompt only requested the open items.
    const prompt = invokeLLM.mock.calls[0][0].prompt;
    expect(prompt).toContain('id: f2f_missing');
    expect(prompt).not.toContain('id: insurance_missing');
    expect(invokeLLM.mock.calls[0][0].file_urls).toEqual(['https://files.example/scan.pdf']);
  });

  it('applies only the ACCEPTED answers as source "scan" and records the response_scan block', async () => {
    const onApplied = vi.fn();
    render(<ScannedResponseUpload referral={referral} tracking={tracking} onApplied={onApplied} />);
    chooseFile();
    await screen.findByText(/Encounter note attached/);

    // Uncheck the frequency answer; apply only the F2F one.
    await userEvent.click(screen.getByRole('checkbox', { name: /Accept answer: Frequencies missing/ }));
    await userEvent.click(screen.getByRole('button', { name: /Apply 1 answer$/ }));

    await waitFor(() => expect(referralUpdate).toHaveBeenCalledTimes(1));
    const [id, payload] = referralUpdate.mock.calls[0];
    expect(id).toBe('ref1');
    const fu = payload.follow_up_requests;
    expect(fu.status).toBe('received');
    expect(fu.response_scan).toMatchObject({ document_url: 'https://files.example/scan.pdf', auto_answered_count: 1 });
    const f2f = fu.items.find((it) => it.id === 'f2f_missing');
    expect(f2f.item_status).toBe('answered');
    expect(f2f.response).toEqual({ text: 'Encounter note attached, seen 8/20 by Dr. Wong', source: 'scan' });
    // Unaccepted answer stays open; portal answer untouched.
    expect(fu.items.find((it) => it.id === 'frequency_missing').item_status).toBe('open');
    expect(fu.items.find((it) => it.id === 'insurance_missing').response.text).toBe('portal answer');
    expect(onApplied).toHaveBeenCalledTimes(1);
  });

  it('a document with no usable answers informs the user and applies nothing', async () => {
    invokeLLM.mockResolvedValue({ answers: [{ id: 'f2f_missing', answered: false, response_text: '' }] });
    render(<ScannedResponseUpload referral={referral} tracking={tracking} onApplied={() => {}} />);
    chooseFile();
    await waitFor(() => expect(toast.info).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Apply/ })).not.toBeInTheDocument();
    expect(referralUpdate).not.toHaveBeenCalled();
  });

  it('switching to a different referral clears an extracted preview (PHI guard)', async () => {
    const { rerender } = render(<ScannedResponseUpload referral={referral} tracking={tracking} onApplied={() => {}} />);
    chooseFile();
    await screen.findByText(/Encounter note attached/);

    // Staff selects referral B while A's extracted answers are still previewed —
    // the preview must not survive to be applied against B's items.
    rerender(<ScannedResponseUpload referral={{ id: 'ref2' }} tracking={tracking} onApplied={() => {}} />);
    expect(screen.queryByText(/Encounter note attached/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Apply/ })).not.toBeInTheDocument();
    expect(referralUpdate).not.toHaveBeenCalled();
  });

  it('renders nothing when every item is already answered/resolved', () => {
    const done = {
      status: 'received',
      items: [{ id: 'a', item_status: 'answered' }, { id: 'b', item_status: 'resolved' }],
    };
    const { container } = render(<ScannedResponseUpload referral={referral} tracking={done} onApplied={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});
