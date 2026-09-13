import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/testUtils';

const { filterUpdates } = vi.hoisted(() => ({ filterUpdates: vi.fn() }));

vi.mock('@/api/base44Client', () => ({
  base44: { entities: { RegulatoryUpdate: { filter: filterUpdates } } },
}));

import { parseAcknowledgedUpdates } from './NurseRegulatoryAlerts';
import NurseRegulatoryAlerts from './NurseRegulatoryAlerts';

describe('parseAcknowledgedUpdates', () => {
  it('returns only unique, non-empty string identifiers', () => {
    expect(parseAcknowledgedUpdates('["update-1","update-1",""," spaced ",null,3,"update-2"]'))
      .toEqual(['update-1', 'update-2']);
  });

  it.each([
    null,
    '',
    '{bad json',
    '{}',
    '"update-1"',
  ])('fails closed for malformed or non-array storage: %s', (stored) => {
    expect(parseAcknowledgedUpdates(stored)).toEqual([]);
  });
});

describe('NurseRegulatoryAlerts query states', () => {
  it('does not report compliance success when the update query fails', async () => {
    filterUpdates.mockRejectedValueOnce(new Error('offline'));
    renderWithProviders(<NurseRegulatoryAlerts nurseEmail="nurse@example.test" />);

    expect(await screen.findByText(/Regulatory updates could not be loaded/i)).toBeInTheDocument();
    expect(screen.queryByText(/up to date on all regulations/i)).not.toBeInTheDocument();
  });

  it('uses the destructive compact alert styling when the update query fails', async () => {
    filterUpdates.mockRejectedValueOnce(new Error('offline'));
    renderWithProviders(<NurseRegulatoryAlerts nurseEmail="nurse@example.test" compact />);

    const message = await screen.findByText(/Regulatory updates could not be loaded/i);
    const alert = message.closest('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert).toHaveClass('border-red-300');
    expect(alert).not.toHaveClass('border-indigo-200');
  });

  it('exposes the disclosure and acknowledgment controls to assistive technology', async () => {
    filterUpdates.mockResolvedValueOnce([{
      id: 'update-1',
      title: 'Updated documentation rule',
      summary: 'Review the updated rule.',
      status: 'implemented',
      reviewed_at: new Date().toISOString(),
    }]);
    renderWithProviders(<NurseRegulatoryAlerts nurseEmail="nurse@example.test" />);

    const disclosure = screen.getByRole('button', { name: /regulatory updates/i });
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByRole('checkbox', { name: /acknowledge updated documentation rule/i }))
      .toBeInTheDocument();
  });
});
