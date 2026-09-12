import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/centralLearning', async (importOriginal) => ({
  ...await importOriginal(), CENTRAL_LEARNING_ENABLED: true,
}));
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...await importOriginal(),
  useQuery: () => { throw new Error('A retired authoring screen queried local course data'); },
  useQueryClient: () => { throw new Error('A retired authoring screen initialized local writes'); },
}));

import AIComplianceInServicesHub from '@/components/training/AIComplianceInServicesHub';
import AnnualMandatoryEducationHub from '@/components/training/AnnualMandatoryEducationHub';
import SMEReviewQueue from '@/components/training/SMEReviewQueue';

describe('authoring cutover', () => {
  it.each([
    ['in-service creation', AIComplianceInServicesHub],
    ['annual mandatory creation', AnnualMandatoryEducationHub],
    ['SME publication', SMEReviewQueue],
  ])('replaces %s before local data hooks run', (_name, Component) => {
    render(<Component />);
    expect(screen.getByRole('heading', { name: 'Create courses in the Support Hub' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Create course' }).getAttribute('href'))
      .toBe('https://support-hub-web-production.up.railway.app/library/courses/new');
  });
});
