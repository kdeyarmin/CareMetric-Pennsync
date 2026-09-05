import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@/api/base44Client', () => ({
  base44: { functions: { invoke: (...args) => invoke(...args) } },
}));

import { getAuthorizedPatientNoteHistory } from './getAuthorizedPatientNoteHistory';

describe('getAuthorizedPatientNoteHistory wrapper', () => {
  beforeEach(() => invoke.mockReset());

  it('uses the authorized backend projection instead of a direct entity read', async () => {
    invoke.mockResolvedValue({
      data: {
        success: true,
        patient_id: 'patient-1',
        entries: [{ event_id: 'event-1', visit_id: 'visit-1', note: 'Stable.' }],
        page: { has_more: false },
      },
    });
    const result = await getAuthorizedPatientNoteHistory({
      patientId: 'patient-1', eventLimit: 50, offset: 10,
    });
    expect(invoke).toHaveBeenCalledWith('getAuthorizedPatientNoteHistory', {
      patient_id: 'patient-1', event_limit: 50, offset: 10,
    });
    expect(result.entries).toHaveLength(1);
  });

  it('rejects invalid input without a network request', async () => {
    await expect(getAuthorizedPatientNoteHistory({ patientId: '' })).rejects.toThrow(/patientId/);
    await expect(getAuthorizedPatientNoteHistory({ patientId: 'p1', eventLimit: 501 })).rejects.toThrow(/eventLimit/);
    await expect(getAuthorizedPatientNoteHistory({ patientId: 'p1', offset: -1 })).rejects.toThrow(/offset/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('rejects a false-success response envelope', async () => {
    invoke.mockResolvedValue({ data: { success: true, patient_id: 'other', entries: [] } });
    await expect(getAuthorizedPatientNoteHistory({ patientId: 'patient-1' }))
      .rejects.toThrow(/lookup failed/);
  });
});
