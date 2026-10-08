import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/testUtils';
import UserNotRegisteredError from './UserNotRegisteredError';

vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ logout: vi.fn() }),
}));

describe('UserNotRegisteredError support routes', () => {
  it('shows the owner-verified central phone and email without requiring app access', () => {
    renderWithProviders(<UserNotRegisteredError />);

    expect(screen.getByRole('link', { name: '(877) 521-2890' }))
      .toHaveAttribute('href', 'tel:+18775212890');
    expect(screen.getByRole('link', { name: 'support@caremetric.ai' }))
      .toHaveAttribute('href', 'mailto:support@caremetric.ai');
  });
});

describe('UserNotRegisteredError account deletion', () => {
  it('lets an account that never reached Settings start a deletion request (Guideline 5.1.1(v))', () => {
    renderWithProviders(<UserNotRegisteredError />);

    const link = screen.getByRole('link', { name: 'Request account deletion' });
    const href = new URL(link.getAttribute('href'));
    expect(href.protocol).toBe('mailto:');
    expect(href.pathname).toBe('support@caremetric.ai');
    expect(href.searchParams.get('subject')).toBe('PennSync account deletion request');
  });
});
