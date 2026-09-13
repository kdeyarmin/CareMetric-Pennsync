import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/testUtils';

const {
  filterUpdates,
  filterComplianceRules,
  createComplianceRule,
  updateComplianceRule,
  filterTasks,
  createTask,
  updateRegulatoryUpdate,
} = vi.hoisted(() => ({
  filterUpdates: vi.fn(),
  filterComplianceRules: vi.fn(),
  createComplianceRule: vi.fn(),
  updateComplianceRule: vi.fn(),
  filterTasks: vi.fn(),
  createTask: vi.fn(),
  updateRegulatoryUpdate: vi.fn(),
}));

vi.mock('@/api/base44Client', () => ({
  base44: {
    auth: { me: vi.fn().mockResolvedValue({ email: 'admin@example.test' }) },
    entities: {
      ComplianceRule: {
        filter: filterComplianceRules,
        create: createComplianceRule,
        update: updateComplianceRule,
      },
      RegulatoryUpdate: {
        filter: filterUpdates,
        create: vi.fn(),
        update: updateRegulatoryUpdate,
      },
      Task: {
        filter: filterTasks,
        create: createTask,
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

  it('reuses the in-session reconciliation state when the final update write is retried', async () => {
    filterUpdates.mockResolvedValue([{
      id: 'reg-update-1',
      title: 'Updated training requirement',
      summary: 'Review the updated requirement.',
      full_details: 'Detailed review instructions.',
      status: 'pending_review',
      source: 'CMS',
      category: 'documentation',
      impact_level: 'high',
      suggested_training: ['Updated onboarding'],
      required_actions: [],
      compliance_check_updates: [],
    }]);
    filterTasks.mockResolvedValue([]);
    updateRegulatoryUpdate
      .mockRejectedValueOnce(new Error('save failed'))
      .mockResolvedValueOnce({});

    renderWithProviders(<RegulatoryMonitor isAdmin />);

    fireEvent.click(await screen.findByRole('button', { name: /review/i }));

    const implementNow = await screen.findByRole('button', { name: /implement now/i });
    fireEvent.click(implementNow);

    expect(await screen.findByText('save failed')).toBeInTheDocument();
    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1));

    fireEvent.click(implementNow);

    await waitFor(() => expect(updateRegulatoryUpdate).toHaveBeenCalledTimes(2));
    expect(createTask).toHaveBeenCalledTimes(1);
  });
});
