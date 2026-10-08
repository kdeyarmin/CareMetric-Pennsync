import { beforeEach, describe, expect, it, vi } from 'vitest';

const { create, caller } = vi.hoisted(() => ({
  create: vi.fn(),
  caller: { current: { email: 'nurse@example.test', full_name: 'Nora Nurse' } },
}));

vi.mock('@/api/base44Client', () => ({
  base44: { entities: { UserActivity: { create: (...args) => create(...args) } } },
}));
vi.mock('@/lib/agencyRoster', () => ({
  loadCurrentCaller: async () => caller.current,
}));

import { logActivity, minimizeActivityDetails, logError } from '@/components/utils/activityLogger';

beforeEach(() => {
  create.mockReset();
  caller.current = { email: 'nurse@example.test', full_name: 'Nora Nurse' };
});

describe('logActivity', () => {
  it('appends one row naming the signed-in caller, with PHI-minimal details', async () => {
    await logActivity('page_visit', {
      page: 'Dashboard',
      page_title: 'Dashboard',
      user_role: 'user',
      patient_name: 'Ada Lovelace',
      patient_id: 'patient-1',
      invited_email: 'someone@example.test',
      overall_score: 92,
      entity_type: 'Patient',
      entity_id: 'patient-1',
    });
    expect(create).toHaveBeenCalledTimes(1);
    const row = create.mock.calls[0][0];
    expect(row).toMatchObject({
      user_email: 'nurse@example.test',
      user_name: 'Nora Nurse',
      action: 'page_visit',
      page: 'Dashboard',
      entity_type: 'Patient',
      entity_id: 'patient-1',
      status: 'success',
    });
    expect(row.details).toEqual({ page_title: 'Dashboard', user_role: 'user', overall_score: 92 });
    expect(JSON.stringify(row)).not.toMatch(/Ada Lovelace|someone@example\.test/);
  });

  it('records nothing without a signed-in caller or with a malformed action', async () => {
    caller.current = null;
    await logActivity('page_visit', { page: 'Dashboard' });
    caller.current = { email: 'nurse@example.test' };
    await logActivity('Not An Action!', {});
    expect(create).not.toHaveBeenCalled();
  });

  it('never fails the action that logged it', async () => {
    create.mockRejectedValueOnce(new Error('denied'));
    await expect(logActivity('page_visit', {})).resolves.toBeUndefined();
  });

  it('keeps error telemetry out of the trail', async () => {
    await logError('Something about a patient', { patient_id: 'p' });
    expect(create).not.toHaveBeenCalled();
  });
});

describe('minimizeActivityDetails', () => {
  it('drops strings outside the operational allowlist and identifying keys', () => {
    expect(minimizeActivityDetails({
      source: 'smart_note',
      file_name: 'chart.pdf',
      matched_patient_name: 'Ada',
      visit_id: 'v1',
      success: true,
      tab: '555-123-4567',
    })).toEqual({ source: 'smart_note', success: true });
    expect(minimizeActivityDetails(null)).toBeUndefined();
    expect(minimizeActivityDetails(['a'])).toBeUndefined();
  });
});
