import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/testUtils';

// Hoisted so the vi.mock factory (which is hoisted above imports) can reference it.
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('@/api/base44Client', () => {
  const entityStub = new Proxy({}, { get: () => async () => [] });
  return {
    base44: {
      functions: { invoke },
      entities: new Proxy({}, { get: () => entityStub }),
      auth: { me: async () => ({ role: 'admin' }) },
    },
  };
});

// sonner toast is noisy/irrelevant here.
vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }));

import DuplicateScanner from './DuplicateScanner';

const previewResult = {
  success: true,
  dry_run: true,
  duplicate_groups_found: 1,
  patients_removed: 0,
  patients_to_remove: 1,
  removed_patients: [{ id: '2', name: 'Jon Smith', mrn: 'N/A' }],
  details: [
    {
      kept: { id: '1', name: 'Jon Smith', mrn: 'MRN1', status: 'active' },
      removed: [{ id: '2', name: 'Jon Smith', mrn: 'N/A', match_score: 90 }],
      confidence: 'High',
      average_match_score: 90,
    },
  ],
};

const appliedResult = { ...previewResult, dry_run: false, patients_removed: 1, patients_to_remove: 0 };

describe('DuplicateScanner standard mode (dry-run + confirm)', () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockImplementation(async (_name, args) =>
      args?.confirm === true ? { data: appliedResult } : { data: previewResult }
    );
  });

  it('previews matches first and only deletes after explicit confirm', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DuplicateScanner />);

    // Standard mode is the default. Run the scan.
    await user.click(screen.getByRole('button', { name: /Run Standard Scan/i }));

    // It must PREVIEW (dry-run) — the backend was called WITHOUT confirm, and the
    // UI shows the review state with a confirm button, not a completed deletion.
    await screen.findByText(/Review required/i);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenLastCalledWith('deduplicatePatients');
    const confirmBtn = screen.getByRole('button', { name: /Confirm & merge/i });
    expect(confirmBtn).toBeInTheDocument();

    // Confirm → backend called WITH confirm:true, applied state shown.
    await user.click(confirmBtn);
    await waitFor(() =>
      expect(invoke).toHaveBeenLastCalledWith('deduplicatePatients', { confirm: true })
    );
    await screen.findByText(/Deduplication Complete/i);
  });
});
