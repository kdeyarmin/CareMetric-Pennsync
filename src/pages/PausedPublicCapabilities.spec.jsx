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
}));

vi.mock('@/api/base44Client', () => ({
  publicCapabilityClient: {
    validateFollowUpToken: capabilityFunctions.validate,
    submitFollowUpResponse: capabilityFunctions.submit,
  },
}));

const TOKEN = 'a'.repeat(64);

function renderFollowUp() {
  return renderWithProviders(
    <PublicCapabilityBoundary capabilitySnapshot={`followup|${TOKEN}`}>
      <ProviderFollowUpPortal />
    </PublicCapabilityBoundary>,
  );
}

beforeEach(() => {
  capabilityFunctions.validate.mockReset();
  capabilityFunctions.submit.mockReset();
});

afterEach(() => {
  closePublicCapabilityRealm();
  window.history.replaceState({}, '', '/');
});

describe('public capability pages', () => {
  it('keeps signing paused, scrubs its token, and offers no signature controls', () => {
    window.history.replaceState({}, '', '/signer?token=secret-signer-token');
    renderWithProviders(<SignerPortal />);

    expect(window.location.search).toBe('');
    expect(screen.getByText(/No token was submitted/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('scrubs a follow-up token before reporting a rejected capability', async () => {
    capabilityFunctions.validate.mockResolvedValue({
      data: { valid: false, error: 'This link has expired.' },
    });
    window.history.replaceState({}, '', `/followup?token=${TOKEN}`);
    renderFollowUp();

    expect(window.location.search).toBe('');
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
