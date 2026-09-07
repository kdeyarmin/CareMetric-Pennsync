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
