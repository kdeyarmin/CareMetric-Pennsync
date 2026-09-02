import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/testUtils';
import { REFERRAL_ACCEPT_ATTR } from '@/components/referral/referralUploadUtils';

const { uploadFile, invokeLLM, toastError, toastWarning, toastSuccess } = vi.hoisted(() => ({
  uploadFile: vi.fn(async () => ({ file_url: 'https://files/referral.tiff' })),
  invokeLLM: vi.fn(async () => ({ patient_name: 'Jane Doe' })),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { error: toastError, warning: toastWarning, success: toastSuccess, info: vi.fn() },
}));

vi.mock('@/lib/invokeLLM', () => ({
  invokeLLM: (...args) => invokeLLM(...args),
  invokeLLMWithFile: (...args) => invokeLLM(...args),
}));

vi.mock('@/api/base44Client', async () => {
  const { makeBase44Stub } = await import('@/test/testUtils');
  const stub = makeBase44Stub({ auth: { me: async () => ({ email: 'intake@x.com', role: 'admin' }) } });
  return {
    base44: {
      ...stub,
      integrations: { Core: { UploadFile: (...args) => uploadFile(...args) } },
    },
  };
});

// Heavy children that are irrelevant to the upload path.
vi.mock('@/components/hub-tabs/ReferralProcessor', () => ({ default: () => <div /> }));
vi.mock('@/components/hub-tabs/ReferralAdmissionNote', () => ({ default: () => <div /> }));
vi.mock('../components/referral/ReferralPDFSummarizer', () => ({ default: () => <div /> }));
vi.mock('../components/referral/MultiReferralDetector', () => ({
  default: ({ fileUrl }) => <div data-testid="multi-detector">{fileUrl}</div>,
}));

import ReferralIntake from '@/pages/ReferralIntake';

const scanFile = (name = 'referral.tiff', type = 'image/tiff') =>
  new File(['scanned referral'], name, { type });

/** Open the upload dialog and hand back its hidden file input. */
async function openUploadDialog(user) {
  await user.click(await screen.findByRole('button', { name: /New Referral/i }));
  const input = await screen.findByLabelText(/Upload Document/i);
  return input;
}

beforeEach(() => {
  uploadFile.mockReset();
  uploadFile.mockResolvedValue({ file_url: 'https://files/referral.tiff' });
  invokeLLM.mockReset();
  invokeLLM.mockResolvedValue({ patient_name: 'Jane Doe' });
  toastError.mockClear();
  toastWarning.mockClear();
  toastSuccess.mockClear();
});

describe('ReferralIntake — uploading a referral document', () => {
  it('only offers file types the referral validator accepts', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReferralIntake />);

    const input = await openUploadDialog(user);
    expect(input).toHaveAttribute('accept', REFERRAL_ACCEPT_ATTR);
  });

  it('pre-fills the form from the quick scan on a clean upload', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReferralIntake />);

    const input = await openUploadDialog(user);
    await user.upload(input, scanFile());

    await waitFor(() => expect(screen.getByLabelText(/Patient Name/i)).toHaveValue('Jane Doe'));
    expect(toastError).not.toHaveBeenCalled();
    expect(toastWarning).not.toHaveBeenCalled();
  });

  // The reported bug: the file uploads fine, the AI pre-fill fails, and the user
  // is told "Failed to upload file. Please try again." — forever.
  it('does not blame the upload when only the AI pre-fill fails', async () => {
    invokeLLM.mockRejectedValue(Object.assign(new Error('timed out'), { code: 'AI_TIMEOUT' }));
    const user = userEvent.setup();
    renderWithProviders(<ReferralIntake />);

    const input = await openUploadDialog(user);
    await user.upload(input, scanFile());

    await waitFor(() => expect(toastWarning).toHaveBeenCalledTimes(1));
    expect(toastWarning.mock.calls[0][0]).toMatch(/Document uploaded/);
    expect(toastWarning.mock.calls[0][0]).toMatch(/timed out/i);
    expect(toastError).not.toHaveBeenCalled();

    // The document is stored, so the user can still create the referral.
    expect(await screen.findByText(/Document uploaded — not analyzed/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create & Process Referral/i })).toBeEnabled();
  });

  it('reports why an upload actually failed instead of a generic retry line', async () => {
    uploadFile.mockRejectedValue(Object.assign(new Error('unauthorized'), { status: 401 }));
    const user = userEvent.setup();
    renderWithProviders(<ReferralIntake />);

    const input = await openUploadDialog(user);
    await user.upload(input, scanFile());

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(toastError.mock.calls[0][0]).toMatch(/session has expired/i);
    expect(toastError.mock.calls[0][0]).not.toMatch(/Failed to upload file/i);
  });

  it('treats a response with no file_url as a failure rather than storing nothing', async () => {
    uploadFile.mockResolvedValue({});
    const user = userEvent.setup();
    renderWithProviders(<ReferralIntake />);

    const input = await openUploadDialog(user);
    await user.upload(input, scanFile());

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(toastError.mock.calls[0][0]).toMatch(/no file link/i);
    expect(screen.getByRole('button', { name: /Create & Process Referral/i })).toBeDisabled();
  });

  // A file input fires no change event for a repeat selection unless its value
  // is cleared, so "please try again" with the same document did nothing at all.
  it('lets the user retry with the very same file after a failure', async () => {
    uploadFile.mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 503 }));
    const user = userEvent.setup();
    renderWithProviders(<ReferralIntake />);

    const input = await openUploadDialog(user);
    const file = scanFile();

    await user.upload(input, file);
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));

    await user.upload(input, file);
    await waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByLabelText(/Patient Name/i)).toHaveValue('Jane Doe'));
  });

  it('routes a PDF to the multi-referral detector without a quick scan', async () => {
    uploadFile.mockResolvedValue({ file_url: 'https://files/batch.pdf' });
    const user = userEvent.setup();
    renderWithProviders(<ReferralIntake />);

    const input = await openUploadDialog(user);
    await user.upload(input, scanFile('batch.pdf', 'application/pdf'));

    expect(await screen.findByTestId('multi-detector')).toHaveTextContent('https://files/batch.pdf');
    expect(invokeLLM).not.toHaveBeenCalled();
  });

  // Otherwise patient A's extracted demographics ride along on patient B's referral.
  it('clears the previous document’s extraction when the dialog is reopened', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReferralIntake />);

    const input = await openUploadDialog(user);
    await user.upload(input, scanFile());
    await waitFor(() => expect(screen.getByLabelText(/Patient Name/i)).toHaveValue('Jane Doe'));

    await user.click(screen.getByRole('button', { name: /^Cancel$/i }));
    await openUploadDialog(user);

    expect(screen.getByLabelText(/Patient Name/i)).toHaveValue('');
    expect(screen.getByRole('button', { name: /Create & Process Referral/i })).toBeDisabled();
  });
});
