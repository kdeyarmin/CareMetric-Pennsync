import { describe, it, expect } from 'vitest';
import { axe } from 'vitest-axe';
import { renderWithProviders } from '@/test/testUtils';
import PrivacyPolicy from '@/pages/PrivacyPolicy';

describe('PrivacyPolicy a11y', () => {
  it('has no serious axe violations on the public policy page', async () => {
    const { container } = renderWithProviders(<PrivacyPolicy />, { route: '/privacy' });
    const results = await axe(container, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results).toHaveNoViolations();
  });
});
