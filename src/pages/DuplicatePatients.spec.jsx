import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/testUtils';

const { patientList, patientUpdate, visitList, visitFilter } = vi.hoisted(() => ({
  patientList: vi.fn(),
  patientUpdate: vi.fn(),
  visitList: vi.fn(),
  visitFilter: vi.fn(),
}));

vi.mock('@/api/base44Client', () => {
  const patient = {
    list: patientList,
    // Kept for page-level roster/query compatibility; paused merge controls
    // must never reach this mutation-oriented lookup path.
    filter: vi.fn(async (query) => {
      const rows = await patientList();
      if (query && 'id' in query) return (rows || []).filter((r) => r.id === query.id);
      return [];
    }),
    update: patientUpdate,
  };
  const visit = { list: visitList, filter: visitFilter, update: vi.fn(async () => ({})) };
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
    visitList.mockReset().mockResolvedValue([]);
    visitFilter.mockReset().mockResolvedValue([{ id: 'v1', patient_id: 'p2' }]);
  });

  it('renders a pause notice without loading patient or visit data', () => {
    renderWithProviders(<DuplicatePatients />);
    expect(screen.getByText(/No patient or visit data is loaded/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /merge/i })).not.toBeInTheDocument();
    expect(patientList).not.toHaveBeenCalled();
    expect(visitList).not.toHaveBeenCalled();
    expect(visitFilter).not.toHaveBeenCalled();
    expect(patientUpdate).not.toHaveBeenCalled();
  });
});
