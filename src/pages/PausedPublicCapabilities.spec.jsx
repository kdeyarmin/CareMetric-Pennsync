import { afterEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/testUtils';
import SignerPortal from './SignerPortal';
import ProviderFollowUpPortal from './ProviderFollowUpPortal';

afterEach(() => {
  window.history.replaceState({}, '', '/');
});

describe('paused public capability pages', () => {
  it('scrubs the signer token and offers no signature inputs or actions', () => {
    window.history.replaceState({}, '', '/signer?token=secret-signer-token');
    renderWithProviders(<SignerPortal />);

    expect(window.location.search).toBe('');
    expect(screen.getByText(/No token was submitted/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('scrubs the follow-up token and offers no response inputs or actions', () => {
    window.history.replaceState({}, '', '/followup?token=secret-follow-up-token');
    renderWithProviders(<ProviderFollowUpPortal />);

    expect(window.location.search).toBe('');
    expect(screen.getByText(/No token was submitted/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
