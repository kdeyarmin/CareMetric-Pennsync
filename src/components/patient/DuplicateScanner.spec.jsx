import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/testUtils';

// Hoisted so the vi.mock factory (which is hoisted above imports) can reference it.
const { invoke, entityAccess } = vi.hoisted(() => ({ invoke: vi.fn(), entityAccess: vi.fn() }));

vi.mock('@/api/base44Client', () => ({
  base44: {
    functions: { invoke },
    // Patient and its linked tables deny client reads and writes; the scanner
    // must never reach them directly.
    entities: new Proxy({}, { get: (_t, name) => entityAccess(name) }),
    auth: { me: async () => ({ id: 'admin-1', email: 'admin@agency.test', role: 'user' }) },
  },
}));

// sonner toast is noisy/irrelevant here.
vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import DuplicateScanner from './DuplicateScanner';

const PREVIEW = {
  success: true,
  dry_run: true,
  duplicate_groups_found: 1,
  patients_to_remove: 1,
  patients_removed: 0,
  merge_failures: 0,
  details: [{
    kept: { id: 'p1', name: 'John Smith', mrn: 'M1', status: 'active' },
    removed: [{ id: 'p2', name: 'John Smith', mrn: 'M1', match_score: 100 }],
    confidence: 'High',
    average_match_score: 100,
  }],
};

describe('DuplicateScanner', () => {
  beforeEach(() => {
    invoke.mockReset();
    entityAccess.mockReset();
  });

  it('previews a server scan and merges exactly the reviewed group through the broker', async () => {
    invoke
      .mockResolvedValueOnce({ data: PREVIEW })
      .mockResolvedValueOnce({
        data: { success: true, complete: true, keep_id: 'p1', merged_ids: ['p2'], incomplete: [], reassigned: {} },
      });

    renderWithProviders(<DuplicateScanner />);
    fireEvent.click(screen.getByRole('button', { name: /Run Standard Scan/i }));

    await screen.findByText(/nothing has been changed yet/i);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenLastCalledWith('deduplicatePatients', { action: 'scan' });
    expect(screen.getByText(/Will merge: John Smith/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Confirm & merge 1 duplicate/i }));
    await screen.findByText(/Deduplication Complete/i);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenLastCalledWith('deduplicatePatients', {
      action: 'merge', keep_id: 'p1', duplicate_ids: ['p2'],
    });
    expect(screen.getByText(/Merged: John Smith/)).toBeInTheDocument();
    expect(entityAccess).not.toHaveBeenCalled();
  });

  it('keeps an unfinished merge visible as still active so it can be retried', async () => {
    invoke
      .mockResolvedValueOnce({ data: PREVIEW })
      .mockResolvedValueOnce({
        data: {
          success: false,
          complete: false,
          keep_id: 'p1',
          merged_ids: [],
          incomplete: [{ duplicate_id: 'p2', failed: { 'Visit.patient_id': 1 }, pending: [] }],
        },
      });

    renderWithProviders(<DuplicateScanner />);
    fireEvent.click(screen.getByRole('button', { name: /Run Standard Scan/i }));
    await screen.findByText(/nothing has been changed yet/i);
    fireEvent.click(screen.getByRole('button', { name: /Confirm & merge 1 duplicate/i }));

    await waitFor(() => expect(screen.getByText(/could not be merged and are still active/i)).toBeInTheDocument());
    expect(screen.getByText(/Merge did not finish \(still active/i)).toBeInTheDocument();
  });

  it('reports no duplicates without offering a merge', async () => {
    invoke.mockResolvedValueOnce({
      data: { ...PREVIEW, duplicate_groups_found: 0, patients_to_remove: 0, details: [] },
    });
    renderWithProviders(<DuplicateScanner />);
    fireEvent.click(screen.getByRole('button', { name: /Run Standard Scan/i }));
    await screen.findByText(/No duplicates found/i);
    expect(screen.queryByRole('button', { name: /Confirm & merge/i })).not.toBeInTheDocument();
  });
});
