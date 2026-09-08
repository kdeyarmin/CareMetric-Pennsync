import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/testUtils';
import SigningUnavailable, { SIGNING_UNAVAILABLE_MESSAGE } from './SigningUnavailable';

describe('signing fail-closed presentation', () => {
  it('states that unavailable data is not an empty or completed signing result', () => {
    renderWithProviders(<SigningUnavailable title="Signature history unavailable" />);

    expect(screen.getByText('Signature history unavailable')).toBeInTheDocument();
    expect(screen.getByText(SIGNING_UNAVAILABLE_MESSAGE)).toHaveTextContent(
      /must not be interpreted as an empty queue, a completed request, or zero activity/,
    );
  });
});
