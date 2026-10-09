import { describe, expect, it } from 'vitest';
import { localDatePlusDays, reminderSendAt } from '@/components/signature/signatureRequestLabels';

describe('signature request scheduling helpers', () => {
  const now = new Date(2026, 9, 8, 10, 0, 0);

  it('books the automatic reminder at 9:00 local, N days before the due date', () => {
    const at = new Date(reminderSendAt('2026-10-20', 2, now));
    expect([at.getFullYear(), at.getMonth(), at.getDate(), at.getHours(), at.getMinutes()]).toEqual([2026, 9, 18, 9, 0]);
  });

  it('skips a reminder that would be due within the hour or in the past', () => {
    expect(reminderSendAt('2026-10-09', 1, now)).toBeNull();
    expect(reminderSendAt('2026-10-10', 1, new Date(2026, 9, 9, 8, 30))).toBeNull();
    expect(reminderSendAt('2026-10-10', 1, new Date(2026, 9, 9, 7, 30))).not.toBeNull();
  });

  it('refuses malformed input instead of guessing', () => {
    expect(reminderSendAt('10/20/2026', 2, now)).toBeNull();
    expect(reminderSendAt('2026-10-20', 0, now)).toBeNull();
    expect(reminderSendAt('2026-10-20', 1.5, now)).toBeNull();
  });

  it('formats local calendar dates for the due-date picker', () => {
    expect(localDatePlusDays(7, now)).toBe('2026-10-15');
    expect(localDatePlusDays(30, now)).toBe('2026-11-07');
  });
});
