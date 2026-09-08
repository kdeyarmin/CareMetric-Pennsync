import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@/api/base44Client', () => ({
  base44: { functions: { invoke: (...args) => invoke(...args) } },
}));

import {
  advanceVisitHandoff,
  hashVisitNoteForReview,
  recoverLegacyVisitUpdate,
  rescheduleVisit,
  saveVisitDocumentation,
  setVisitAiTags,
  setVisitReviewAcknowledgement,
} from './updateAuthorizedVisit';

const ok = (action = 'save_documentation') => ({
  data: {
    updated: true,
    action,
    visit: { id: 'visit-1', patient_id: 'patient-1', agency_id: 'agency-1' },
  },
});

describe('updateAuthorizedVisit action wrappers', () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(ok());
  });

  it('sends patient_id as a documentation assertion, never as a mutable patch', async () => {
    await saveVisitDocumentation({
      visitId: 'visit-1',
      patientId: 'patient-1',
      fields: { status: 'completed', nurse_notes: 'final note', grounding_pending: false },
    });

    expect(invoke).toHaveBeenCalledWith('updateAuthorizedVisit', {
      visit_id: 'visit-1',
      action: 'save_documentation',
      patient_id: 'patient-1',
      status: 'completed',
      nurse_notes: 'final note',
      grounding_pending: false,
    });
    expect(invoke.mock.calls[0][1]).not.toHaveProperty('patch');
  });

  it('refuses mutable or unknown documentation fields before invoking', async () => {
    await expect(saveVisitDocumentation({
      visitId: 'visit-1',
      patientId: 'patient-1',
      fields: { patient_id: 'patient-2', agency_id: 'agency-2' },
    })).rejects.toThrow(/cannot write: patient_id, agency_id/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('allows only namespaced reporting tags through documentation save', async () => {
    await saveVisitDocumentation({
      visitId: 'visit-1',
      patientId: 'patient-1',
      fields: {
        ai_tags: ['trend:pain:down', 'chart_flag:allergy', 'denial_risk:homebound_narrative'],
      },
    });
    expect(invoke).toHaveBeenCalledTimes(1);

    invoke.mockClear();
    await expect(saveVisitDocumentation({
      visitId: 'visit-1',
      patientId: 'patient-1',
      fields: { ai_tags: ['wound_care'] },
    })).rejects.toThrow(/reporting tag prefixes/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('builds each narrow non-documentation action', async () => {
    await rescheduleVisit({ visitId: 'visit-1', visitTime: '09:30' });
    await setVisitAiTags({ visitId: 'visit-1', tags: ['wound_care'] });
    await advanceVisitHandoff({ visitId: 'visit-1', nextStatus: 'copied_to_emr' });
    await setVisitReviewAcknowledgement({
      visitId: 'visit-1', acknowledged: true, nurseEdited: true, noteText: 'hello',
    });

    expect(invoke.mock.calls.map((call) => call[1])).toEqual([
      { visit_id: 'visit-1', action: 'reschedule', visit_time: '09:30' },
      { visit_id: 'visit-1', action: 'set_ai_tags', ai_tags: ['wound_care'] },
      { visit_id: 'visit-1', action: 'advance_handoff', next_status: 'copied_to_emr' },
      {
        visit_id: 'visit-1', action: 'set_review_ack',
        acknowledged: true,
        expected_note_hash: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
        nurse_edited: true,
      },
    ]);
  });

  it('hashes the exact UTF-8 note text as lowercase SHA-256', async () => {
    await expect(hashVisitNoteForReview('hello')).resolves.toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });

  it('sends acknowledgement withdrawal without nurse_edited metadata', async () => {
    await setVisitReviewAcknowledgement({
      visitId: 'visit-1', acknowledged: false, nurseEdited: true,
    });
    expect(invoke).toHaveBeenCalledWith('updateAuthorizedVisit', {
      visit_id: 'visit-1',
      action: 'set_review_ack',
      acknowledged: false,
    });
  });

  it('does not coerce a missing acknowledgement decision into withdrawal', async () => {
    await expect(setVisitReviewAcknowledgement({ visitId: 'visit-1' }))
      .rejects.toThrow(/acknowledged must be a boolean/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('uses the injected functions client for a bounded legacy recovery patch', async () => {
    const functions = { invoke: vi.fn(async () => ok('legacy_recovery')) };
    await recoverLegacyVisitUpdate({
      visitId: 'visit-1',
      fields: { nurse_notes: 'recovered', vital_signs: { heart_rate: 72 } },
      functions,
    });
    expect(functions.invoke).toHaveBeenCalledWith('updateAuthorizedVisit', {
      visit_id: 'visit-1',
      action: 'legacy_recovery',
      nurse_notes: 'recovered',
      vital_signs: { heart_rate: 72 },
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('refuses tenant-bearing legacy payloads so the retirement caller can retain them', async () => {
    const functions = { invoke: vi.fn() };
    await expect(recoverLegacyVisitUpdate({
      visitId: 'visit-1',
      fields: { patient_id: 'patient-1', nurse_notes: 'do not discard' },
      functions,
    })).rejects.toThrow(/cannot write: patient_id/);
    expect(functions.invoke).not.toHaveBeenCalled();
  });

  it('rejects a malformed success envelope instead of reporting a false save', async () => {
    invoke.mockResolvedValueOnce({ data: { updated: false } });
    await expect(rescheduleVisit({ visitId: 'visit-1', visitTime: '10:00' }))
      .rejects.toThrow('Visit update failed');
  });
});
