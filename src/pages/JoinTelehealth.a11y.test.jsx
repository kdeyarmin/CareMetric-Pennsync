import { describe, it, expect } from 'vitest';
import { axe } from 'vitest-axe';
import { renderWithProviders } from '@/test/testUtils';
import JoinTelehealth from '@/pages/JoinTelehealth';

describe('JoinTelehealth a11y (no-token state)', () => {
  it('has no serious axe violations when room/token are missing', async () => {
    const { container } = renderWithProviders(<JoinTelehealth />, { route: '/join' });
    const results = await axe(container, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results).toHaveNoViolations();
  });
});
