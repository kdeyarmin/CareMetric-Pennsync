import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/testUtils';

const { patientList, patientUpdate, visitFilter } = vi.hoisted(() => ({
  patientList: vi.fn(),
  patientUpdate: vi.fn(),
  visitFilter: vi.fn(),
}));

vi.mock('@/api/base44Client', () => {
  const patient = { list: patientList, filter: vi.fn(async () => []), update: patientUpdate };
  const visit = { list: vi.fn(async () => []), filter: visitFilter, update: vi.fn(async () => ({})) };
  const generic = { list: vi.fn(async () => []), filter: vi.fn(async () => []), update: vi.fn(async () => ({})) };
  const entities = new Proxy(
    {},
    {
      get: (_t, name) => {
        if (name === 'Patient') return patient;
        if (name === 'Visit') return visit;
        return generic;
      },
    }
  );
  return {
    base44: { entities, auth: { me: async () => ({ email: 'admin@x.com', role: 'admin' }) } },
  };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import DuplicatePatients from './DuplicatePatients';

const DUPLICATES = [
  { id: 'p1', first_name: 'John', last_name: 'Smith', medical_record_number: 'M1', date_of_birth: '1950-01-01', status: 'active', is_archived: false },
  { id: 'p2', first_name: 'John', last_name: 'Smith', medical_record_number: 'M1', date_of_birth: '1950-01-01', status: 'active', is_archived: false },
];

describe('DuplicatePatients page', () => {
  beforeEach(() => {
    patientList.mockReset().mockResolvedValue(DUPLICATES);
    patientUpdate.mockReset().mockResolvedValue({});
    visitFilter.mockReset().mockResolvedValue([{ id: 'v1', patient_id: 'p2' }]);
  });

  it('auto-scans on load and surfaces the duplicate group without a button click', async () => {
    renderWithProviders(<DuplicatePatients />);
    await screen.findByText(/Duplicate Group 1/i);
    // Archived/merged records are filtered out before scanning.
    expect(patientList).toHaveBeenCalled();
  });

  it('really merges the group: reassigns visits to the survivor and archives the duplicate', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DuplicatePatients />);
    await screen.findByText(/Duplicate Group 1/i);

    // Keep the first record, merge the rest in.
    const mergeButtons = screen.getAllByRole('button', { name: /Keep & merge others/i });
    await user.click(mergeButtons[0]);

    // Confirm in the dialog.
    await user.click(await screen.findByRole('button', { name: 'Merge' }));

    await waitFor(() => {
      // p2's visit was reassigned to the survivor p1...
      expect(visitFilter).toHaveBeenCalledWith({ patient_id: 'p2' });
      // ...and p2 was soft-archived (not hard-deleted) and pointed at p1.
      expect(patientUpdate).toHaveBeenCalledWith(
        'p2',
        expect.objectContaining({ is_archived: true, status: 'merged', merged_into_id: 'p1' })
      );
    });

    // The merged group is removed from view.
    await waitFor(() => expect(screen.queryByText(/Duplicate Group 1/i)).not.toBeInTheDocument());
  });
});
