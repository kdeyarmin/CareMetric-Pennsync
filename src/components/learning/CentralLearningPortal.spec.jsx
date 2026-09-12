import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import CentralLearningPortal from './CentralLearningPortal';

describe('central learning portal', () => {
  it('uses the protected same-window navigation pattern for all Hub links', () => {
    render(<CentralLearningPortal authoring />);
    expect(screen.getByRole('link', { name: 'Create course' }).getAttribute('href')).toContain('/library/courses/new');
    for (const link of screen.getAllByRole('link')) {
      expect(link.getAttribute('target')).toBeNull();
      expect(new URL(link.getAttribute('href')).origin).toBe('https://support-hub-web-production.up.railway.app');
    }
  });
  it('keeps the course editor out of the learner launcher', () => {
    render(<CentralLearningPortal />);
    expect(screen.queryByRole('link', { name: 'Create course' })).toBeNull();
  });
});
