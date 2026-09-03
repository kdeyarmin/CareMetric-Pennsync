import { describe, expect, it } from 'vitest';
import { getPriorNote, mergePatientNoteHistory } from './noteHelpers';

describe('append-only Patient note compatibility', () => {
  it('lets a new immutable revision replace the same Visit in the UI projection', () => {
    const patient = {
      id: 'p1',
      clinical_notes: 'legacy current',
      enhanced_notes_history: [
        { entry_id: 'legacy-a', visit_id: 'visit-a', note: 'Old A', date: '2026-01-01' },
        { entry_id: 'legacy-b', visit_id: 'visit-b', note: 'Old B', date: '2026-01-02' },
      ],
    };
    const merged = mergePatientNoteHistory(patient, [
      { event_id: 'event-a2', visit_id: 'visit-a', note: 'Revised A', created_at: '2026-01-03T12:00:00Z' },
    ]);
    expect(merged.enhanced_notes_history).toHaveLength(2);
    expect(merged.enhanced_notes_history.find((entry) => entry.visit_id === 'visit-a').note)
      .toBe('Revised A');
    expect(getPriorNote(merged)).toBe('Revised A');
    expect(merged.clinical_notes).toBe('Revised A');
  });

  it('retains un-migrated legacy rows and does not mutate the Patient input', () => {
    const history = [{ entry_id: 'legacy', note: 'Legacy only', date: '2026-01-01' }];
    const patient = { clinical_notes: 'Legacy current', enhanced_notes_history: history };
    const merged = mergePatientNoteHistory(patient, []);
    expect(merged).not.toBe(patient);
    expect(merged.enhanced_notes_history).not.toBe(history);
    expect(getPriorNote(merged)).toBe('Legacy only');
  });
});
