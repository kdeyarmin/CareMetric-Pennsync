import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/testUtils';
import { expectNoAxeViolations } from '@/test/axeHelpers';
import JoinTelehealth from '@/pages/JoinTelehealth';

describe('JoinTelehealth a11y (no-token state)', () => {
  it('has no serious axe violations when room/token are missing', async () => {
    const { container } = renderWithProviders(<JoinTelehealth />, { route: '/join' });
    expect(document.title).toBe('Telehealth visit | PennSync by CareMetric');
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(container.querySelector('h1')).toHaveTextContent('Telehealth visit unavailable');
    await expectNoAxeViolations(container);
  });
});
