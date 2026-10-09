import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/testUtils';
import { PublicCapabilityBoundary } from '@/lib/PublicCapabilityContext';
import { closePublicCapabilityRealm } from '@/lib/publicCapabilityRealmGate';
import SignerPortal from './SignerPortal';
import ProviderFollowUpPortal from './ProviderFollowUpPortal';

const capabilityFunctions = vi.hoisted(() => ({
  validate: vi.fn(),
  submit: vi.fn(),
  validateSigner: vi.fn(),
  submitSigner: vi.fn(),
  fetchReview: vi.fn(),
}));

vi.mock('@/api/base44Client', () => ({
  publicCapabilityClient: {
    validateFollowUpToken: capabilityFunctions.validate,
    submitFollowUpResponse: capabilityFunctions.submit,
    validateSignerToken: capabilityFunctions.validateSigner,
    submitSignerSignature: capabilityFunctions.submitSigner,
    fetchSignerReviewDocument: capabilityFunctions.fetchReview,
  },
}));

// jsdom has neither a canvas nor pdf.js; stand in for the two widgets so the
// page's own data flow is what is under test.
vi.mock('@/components/signature/DocumentBytesViewer', () => ({
  default: ({ bytes, title }) => <p>{`${title}: ${bytes.length} reviewed bytes`}</p>,
}));
const testSignature = vi.hoisted(() => ({
  png: `data:image/png;base64,${btoa(String.fromCharCode(...new Uint8Array(160).map((_, index) => index)))}`,
}));
vi.mock('@/components/signature/SignaturePadCanvas', () => ({
  default: ({ onSignatureCapture }) => (
    <button type="button" onClick={() => onSignatureCapture(testSignature.png)}>Draw test signature</button>
  ),
}));

const SIGNER_TOKEN = 'S'.repeat(43);
const REVIEW_NONCE = 'N'.repeat(43);

function signerPackage() {
  return {
    valid: true,
    package_id: 'package-1',
    package_name: 'Admission consents',
    due_date: '2026-10-20',
    agency_name: 'Example Home Health',
    message: 'Please sign before your first visit.',
    signer_id: 'signer-1',
    signer_name: 'Pat Example',
    agreement: { version: 'signature-consent-v1', text: 'I agree to sign electronically.', sha256: 'f'.repeat(64) },
    documents: [{
      id: 'signature-1', name: 'Consent for care', status: 'pending', signed_at: null,
      review_url: 'https://storage.example.test/review', review_nonce: REVIEW_NONCE,
    }],
    expires_at: '2026-10-15T00:00:00.000Z',
  };
}

function renderSigner() {
  return renderWithProviders(
    <PublicCapabilityBoundary capabilitySnapshot={`signer|${SIGNER_TOKEN}`}>
      <SignerPortal />
    </PublicCapabilityBoundary>,
  );
}

const TOKEN = 'a'.repeat(64);

function renderFollowUp() {
  return renderWithProviders(
    <PublicCapabilityBoundary capabilitySnapshot={`followup|${TOKEN}`}>
      <ProviderFollowUpPortal />
    </PublicCapabilityBoundary>,
  );
}

beforeEach(() => {
  for (const fn of Object.values(capabilityFunctions)) fn.mockReset();
});

afterEach(() => {
  closePublicCapabilityRealm();
  window.history.replaceState({}, '', '/');
});

describe('public capability pages', () => {
  it('scrubs a signer token and reports a rejected link without any signing control', async () => {
    capabilityFunctions.validateSigner.mockRejectedValue({
      response: { status: 401, data: { valid: false, error: 'Invalid or expired token' } },
    });
    window.history.replaceState({}, '', `/signer?token=${SIGNER_TOKEN}`);
    const { container } = renderSigner();

    expect(window.location.search).toBe('');
    expect(document.title).toBe('Document signing | PennSync by CareMetric');
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(await screen.findByText('Invalid or expired token')).toBeInTheDocument();
    expect(capabilityFunctions.validateSigner).toHaveBeenCalledWith(expect.any(Object), { token: SIGNER_TOKEN });
    expect(capabilityFunctions.fetchReview).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('never calls the signer seam when the link carries no token', async () => {
    window.history.replaceState({}, '', '/signer');
    renderSigner();
    expect(await screen.findByText(/missing its access code/)).toBeInTheDocument();
    expect(capabilityFunctions.validateSigner).not.toHaveBeenCalled();
  });

  it('reviews the exact leased bytes and submits a signature through the leased seam', async () => {
    capabilityFunctions.validateSigner.mockResolvedValue({ data: signerPackage() });
    capabilityFunctions.fetchReview.mockResolvedValue(new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]));
    capabilityFunctions.submitSigner.mockResolvedValue({
      data: { success: true, document_id: 'signature-1', all_signed: true, document_completed: true },
    });
    window.history.replaceState({}, '', `/signer?token=${SIGNER_TOKEN}`);
    renderSigner();

    const user = userEvent.setup();
    expect(window.location.search).toBe('');
    expect(await screen.findByText('Please sign before your first visit.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Review and sign' }));
    expect(await screen.findByText('Consent for care: 8 reviewed bytes')).toBeInTheDocument();
    expect(capabilityFunctions.fetchReview).toHaveBeenCalledWith(expect.any(Object), 'https://storage.example.test/review');

    const sign = screen.getByRole('button', { name: 'Sign document' });
    expect(sign).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Draw test signature' }));
    expect(sign).toBeDisabled();
    await user.click(screen.getByRole('checkbox'));
    expect(sign).toBeEnabled();
    expect(screen.getByLabelText('Your full name')).toHaveValue('Pat Example');
    await user.click(sign);

    await waitFor(() => expect(capabilityFunctions.submitSigner).toHaveBeenCalledTimes(1));
    const [lease, payload] = capabilityFunctions.submitSigner.mock.calls[0];
    expect(lease).toEqual(expect.any(Object));
    expect(Object.keys(payload).sort()).toEqual([
      'agreement_version', 'client_request_id', 'document_id', 'review_nonce', 'signature_file', 'token', 'typed_name',
    ]);
    expect(payload).toMatchObject({
      token: SIGNER_TOKEN, review_nonce: REVIEW_NONCE, document_id: 'signature-1',
      typed_name: 'Pat Example', agreement_version: 'signature-consent-v1',
    });
    expect(payload.signature_file).toBeInstanceOf(File);
    expect(payload.signature_file.type).toBe('image/png');
    expect(await screen.findByText('All documents signed')).toBeInTheDocument();
  });

  it('scrubs a follow-up token before reporting a rejected capability', async () => {
    capabilityFunctions.validate.mockResolvedValue({
      data: { valid: false, error: 'This link has expired.' },
    });
    window.history.replaceState({}, '', `/followup?token=${TOKEN}`);
    const { container } = renderFollowUp();

    expect(window.location.search).toBe('');
    expect(document.title).toBe('Referral information request | PennSync by CareMetric');
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(container.querySelector('h1')).toHaveTextContent('Home Health Referral — Information Request');
    expect(await screen.findByText('This link has expired.')).toBeInTheDocument();
    expect(capabilityFunctions.validate).toHaveBeenCalledWith(
      expect.any(Object),
      { token: TOKEN },
    );
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('loads the minimum request and submits only answered item ids through the leased seam', async () => {
    capabilityFunctions.validate.mockResolvedValue({
      data: {
        valid: true,
        patient_name: 'Jane Doe',
        patient_dob: '1940-01-02',
        referral_date: '2026-09-01',
        provider_name: 'Example Practice',
        request_status: 'sent',
        already_submitted: false,
        expires_at: '2026-10-01T00:00:00.000Z',
        items: [
          {
            item_id: 'orders_missing',
            number: 1,
            title: 'Signed orders',
            question: 'Please provide signed orders.',
            hint: '',
            why: 'Required for care.',
            citation: '42 CFR 484.60',
            response_type: 'text',
            item_status: 'open',
          },
        ],
      },
    });
    capabilityFunctions.submit.mockResolvedValue({
      data: { success: true, answered: 1, notified: true },
    });
    window.history.replaceState({}, '', `/followup?token=${TOKEN}`);
    renderFollowUp();

    const user = userEvent.setup();
    expect(await screen.findByText(/Jane Doe/)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Response for Signed orders/), 'Orders attached by secure channel.');
    await user.type(screen.getByLabelText(/Completed by/), 'Pat Smith');
    await user.type(screen.getByLabelText(/Credential or role/), 'RN');
    await user.click(screen.getByRole('button', { name: /Send 1 response to the agency/ }));

    await waitFor(() => expect(capabilityFunctions.submit).toHaveBeenCalledWith(
      expect.any(Object),
      {
        token: TOKEN,
        responses: [{ item_id: 'orders_missing', response_text: 'Orders attached by secure channel.' }],
        completed_by: 'Pat Smith',
        credential: 'RN',
      },
    ));
    expect(await screen.findByText('Thank you — responses sent')).toBeInTheDocument();
  });
});
