import { describe, it } from 'vitest';
import { renderWithProviders } from '@/test/testUtils';
import { expectNoAxeViolations } from '@/test/axeHelpers';
import AccessDeniedState from '@/components/ui/AccessDeniedState';

describe('AccessDeniedState a11y', () => {
  it('has no serious axe violations', async () => {
    const { container } = renderWithProviders(
      <AccessDeniedState
        title="Access Restricted"
        description="Only administrators can access User Management."
      />,
    );
    await expectNoAxeViolations(container);
  });
});
