import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { renderWithProviders } from '@/test/testUtils';

const { filterUpdates } = vi.hoisted(() => ({ filterUpdates: vi.fn() }));
vi.mock('@/api/base44Client', () => ({
  base44: { entities: { RegulatoryUpdate: { filter: filterUpdates } } },
}));
import NurseRegulatoryAlerts from './NurseRegulatoryAlerts';

function cachedClient(updates) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['implementedRegUpdates'], updates);
  return client;
}

beforeEach(() => {
  localStorage.clear();
  filterUpdates.mockReset();
  filterUpdates.mockRejectedValue(new Error('offline'));
});

describe('cached regulatory updates during failed background refresh', () => {
  const update = () => ({
    id: 'cached-update', title: 'Known documentation update',
    summary: 'Previously retrieved details.', status: 'implemented',
    reviewed_at: new Date().toISOString(),
  });

  it('keeps known updates readable and acknowledgeable with a stale-data warning', async () => {
    renderWithProviders(<NurseRegulatoryAlerts nurseEmail="cached@example.test" />, {
      queryClient: cachedClient([update()]),
    });
    expect(await screen.findByText(/unable to refresh regulatory updates/i)).toBeInTheDocument();
    const checkbox = screen.getByRole('checkbox', { name: /acknowledge known documentation update/i });
    expect(screen.getByText('Previously retrieved details.')).toBeInTheDocument();
    fireEvent.click(checkbox);
    expect(JSON.parse(localStorage.getItem('acknowledged_updates_cached@example.test')))
      .toEqual(['cached-update']);
    expect(screen.queryByText(/up to date on all regulations/i)).not.toBeInTheDocument();
  });

  it('keeps the compact review link available while showing the refresh warning', async () => {
    renderWithProviders(<NurseRegulatoryAlerts nurseEmail="cached@example.test" compact />, {
      queryClient: cachedClient([update()]),
    });
    expect(await screen.findByText(/unable to refresh regulatory updates/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /review now/i })).toBeInTheDocument();
    expect(screen.getByText('1 New Regulation Update(s)')).toBeInTheDocument();
  });

  it.each([false, true])('does not present an empty stale cache as current compliance (compact=%s)', async (compact) => {
    renderWithProviders(<NurseRegulatoryAlerts nurseEmail="cached@example.test" compact={compact} />, {
      queryClient: cachedClient([]),
    });
    expect(await screen.findByText(/unable to refresh regulatory updates/i)).toBeInTheDocument();
    expect(screen.queryByText(/up to date on all regulations/i)).not.toBeInTheDocument();
  });
});
