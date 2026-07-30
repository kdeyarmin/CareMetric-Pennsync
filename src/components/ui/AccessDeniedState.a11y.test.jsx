import { describe, it, expect } from 'vitest';
import { axe } from 'vitest-axe';
import { renderWithProviders } from '@/test/testUtils';
import AccessDeniedState from '@/components/ui/AccessDeniedState';

describe('AccessDeniedState a11y', () => {
  it('has no serious axe violations', async () => {
    const { container } = renderWithProviders(
      <AccessDeniedState
        title="Access Restricted"
        description="Only administrators can access User Management."
      />,
    );
    const results = await axe(container, {
      // jsdom cannot compute real contrast; exclude color-contrast for component unit scans.
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results).toHaveNoViolations();
  });
});
