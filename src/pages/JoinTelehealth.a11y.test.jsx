import { describe, it } from 'vitest';
import { renderWithProviders } from '@/test/testUtils';
import { expectNoAxeViolations } from '@/test/axeHelpers';
import JoinTelehealth from '@/pages/JoinTelehealth';

describe('JoinTelehealth a11y (no-token state)', () => {
  it('has no serious axe violations when room/token are missing', async () => {
    const { container } = renderWithProviders(<JoinTelehealth />, { route: '/join' });
    await expectNoAxeViolations(container);
  });
});
