import { describe, it } from 'vitest';
import { renderWithProviders } from '@/test/testUtils';
import { expectNoAxeViolations } from '@/test/axeHelpers';
import PrivacyPolicy from '@/pages/PrivacyPolicy';

describe('PrivacyPolicy a11y', () => {
  it('has no serious axe violations on the public policy page', async () => {
    const { container } = renderWithProviders(<PrivacyPolicy />, { route: '/privacy' });
    await expectNoAxeViolations(container);
  });
});
