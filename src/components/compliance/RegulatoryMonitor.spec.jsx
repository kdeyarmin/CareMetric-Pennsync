import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/testUtils';

const { filterUpdates } = vi.hoisted(() => ({ filterUpdates: vi.fn() }));

vi.mock('@/api/base44Client', () => ({
  base44: {
    auth: { me: vi.fn().mockResolvedValue({ email: 'admin@example.test' }) },
    entities: {
      RegulatoryUpdate: {
        filter: filterUpdates,
        create: vi.fn(),
        update: vi.fn(),
      },
    },
  },
}));
vi.mock('@/hooks/useAICall', () => ({
  useAICall: () => ({ loading: false, run: vi.fn() }),
}));

import { parseLastRegulatoryScan, regulatoryStatusLabel } from './RegulatoryMonitor';
import RegulatoryMonitor from './RegulatoryMonitor';

describe('parseLastRegulatoryScan', () => {
  it('accepts valid timestamps', () => {
    expect(parseLastRegulatoryScan('2026-09-13T12:30:00.000Z')?.toISOString())
      .toBe('2026-09-13T12:30:00.000Z');
  });

  it.each([null, '', 'not-a-date'])('rejects invalid cached scan values: %s', (value) => {
    expect(parseLastRegulatoryScan(value)).toBeNull();
  });
});

describe('regulatoryStatusLabel', () => {
  it('formats every separator and tolerates missing provider data', () => {
    expect(regulatoryStatusLabel('pending_human_review')).toBe('pending human review');
    expect(regulatoryStatusLabel(undefined)).toBe('unknown');
  });
});

describe('RegulatoryMonitor query states', () => {
  it('does not render authoritative zero counts when the source query fails', async () => {
    filterUpdates.mockRejectedValueOnce(new Error('offline'));
    renderWithProviders(<RegulatoryMonitor isAdmin />);

    expect(await screen.findByText(/counts and review queues are unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText('Pending (0)')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});
