import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/testUtils';
import { expectNoAxeViolations } from '@/test/axeHelpers';
import PrivacyPolicy from '@/pages/PrivacyPolicy';

describe('PrivacyPolicy a11y', () => {
  it('has no serious axe violations on the public policy page', async () => {
    const { container } = renderWithProviders(<PrivacyPolicy />, { route: '/privacy' });
    expect(document.title).toBe('Privacy Policy | PennSync by CareMetric');
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(container.querySelector('h1')).toHaveTextContent('Privacy Policy');
    await expectNoAxeViolations(container);
  });
});
