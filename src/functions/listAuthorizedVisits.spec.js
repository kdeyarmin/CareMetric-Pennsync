import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@/api/base44Client', () => ({
  base44: { functions: { invoke: (...args) => invoke(...args) } },
}));

import { listAuthorizedVisits } from './listAuthorizedVisits';

const clinicianScope = {
  agency_id: 'agency-a',
  membership_id: 'membership-a',
  membership_version: 2,
  tenant_role: 'clinician',
  patient_id: 'patient-a',
  access_basis: 'care_team_assignment',
  assignment_id: 'assignment-a',
  assignment_version: 3,
};

const cursor = (overrides = {}) => ({
  version: 1,
  after_id: 'visit-a',
  agency_id: 'agency-a',
  patient_id: 'patient-a',
  purpose: 'schedule',
  status: 'completed',
  sort: 'id_asc',
  page_size: 1,
  subject_user_id: 'user-1',
  membership_id: 'membership-a',
  membership_version: 2,
  tenant_role: 'clinician',
  access_basis: 'care_team_assignment',
  assignment_id: 'assignment-a',
  assignment_version: 3,
  ...overrides,
});

const scheduleVisit = (overrides = {}) => ({
  id: 'visit-b',
  patient_id: 'patient-a',
  visit_date: '2026-09-03',
  visit_time: '09:30',
  visit_type: 'skilled_nursing',
  status: 'completed',
  updated_date: '2026-09-03T12:30:00.000Z',
  ...overrides,
});

describe('listAuthorizedVisits wrapper', () => {
  beforeEach(() => invoke.mockReset());

  it('invokes the id-keyset broker with explicit patient and assignment context', async () => {
    invoke.mockResolvedValue({
      data: {
        success: true,
        purpose: 'schedule',
        visits: [scheduleVisit()],
        scope: clinicianScope,
        page: {
          page_size: 1,
          sort: 'id_asc',
          after_id: 'visit-a',
          has_more: true,
          next_cursor: cursor({ after_id: 'visit-b' }),
        },
      },
    });
    const result = await listAuthorizedVisits({
      agencyId: 'agency-a',
      patientId: 'patient-a',
      purpose: 'schedule',
      status: 'completed',
      pageSize: 1,
      cursor: cursor(),
    });
    expect(invoke).toHaveBeenCalledWith('listAuthorizedVisits', {
      agency_id: 'agency-a',
      patient_id: 'patient-a',
      purpose: 'schedule',
      status: 'completed',
      sort: 'id_asc',
      page_size: 1,
      cursor: cursor(),
    });
    expect(result.page.next_cursor.after_id).toBe('visit-b');
  });

  it('rejects invalid caps, filters, cursors, and identifiers before invocation', async () => {
    await expect(listAuthorizedVisits({
      agencyId: 'agency-a', purpose: 'compliance_review', pageSize: 26,
    })).rejects.toThrow(/pageSize/);
    await expect(listAuthorizedVisits({
      agencyId: 'agency-a', purpose: 'schedule', sort: 'visit_date_desc',
    })).rejects.toThrow(/sort/);
    await expect(listAuthorizedVisits({
      agencyId: 'agency-a', patientId: '$patient', purpose: 'schedule',
    })).rejects.toThrow(/patientId/);
    await expect(listAuthorizedVisits({
      agencyId: 'agency-a', purpose: 'schedule', offset: 25,
    })).rejects.toThrow(/unsupported/);
    await expect(listAuthorizedVisits({
      agencyId: 'agency-a', patientId: 'patient-a', purpose: 'schedule',
      status: 'completed', pageSize: 1, cursor: { ...cursor(), extra: true },
    })).rejects.toThrow(/cursor/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('fails closed on excess rows, projection leaks, duplicate/order drift, and page mismatch', async () => {
    const invalidResults = [
      {
        success: true,
        purpose: 'schedule',
        visits: [scheduleVisit(), scheduleVisit({ id: 'visit-c' })],
        scope: clinicianScope,
        page: {
          page_size: 1, sort: 'id_asc', after_id: null, has_more: false, next_cursor: null,
        },
      },
      {
        success: true,
        purpose: 'schedule',
        visits: [scheduleVisit({ secret_claim: 'leak' })],
        scope: clinicianScope,
        page: {
          page_size: 1, sort: 'id_asc', after_id: null, has_more: false, next_cursor: null,
        },
      },
      {
        success: true,
        purpose: 'schedule',
        visits: [scheduleVisit({ id: 'visit-b' }), scheduleVisit({ id: 'visit-b' })],
        scope: clinicianScope,
        page: {
          page_size: 2, sort: 'id_asc', after_id: null, has_more: false, next_cursor: null,
        },
      },
      {
        success: true,
        purpose: 'schedule',
        visits: [scheduleVisit({ patient_id: 'patient-b' })],
        scope: clinicianScope,
        page: {
          page_size: 1, sort: 'id_asc', after_id: null, has_more: false, next_cursor: null,
        },
      },
    ];
    for (const result of invalidResults) {
      invoke.mockResolvedValueOnce({ data: result });
      await expect(listAuthorizedVisits({
        agencyId: 'agency-a', patientId: 'patient-a', purpose: 'schedule',
        pageSize: result.page.page_size,
      })).rejects.toThrow(/list failed/);
    }
  });

  it('rejects authority changes between the supplied and returned cursor context', async () => {
    invoke.mockResolvedValue({
      data: {
        success: true,
        purpose: 'schedule',
        visits: [scheduleVisit()],
        scope: { ...clinicianScope, assignment_version: 4 },
        page: {
          page_size: 1,
          sort: 'id_asc',
          after_id: 'visit-a',
          has_more: false,
          next_cursor: null,
        },
      },
    });
    await expect(listAuthorizedVisits({
      agencyId: 'agency-a',
      patientId: 'patient-a',
      purpose: 'schedule',
      status: 'completed',
      pageSize: 1,
      cursor: cursor(),
    })).rejects.toThrow(/list failed/);
  });

  it('accepts an agency-wide tenant-admin page without a patient selector', async () => {
    invoke.mockResolvedValue({
      success: true,
      purpose: 'schedule',
      visits: [scheduleVisit()],
      scope: {
        agency_id: 'agency-a',
        membership_id: 'membership-a',
        membership_version: 2,
        tenant_role: 'agency_admin',
        patient_id: null,
        access_basis: 'agency_wide',
        assignment_id: null,
        assignment_version: null,
      },
      page: {
        page_size: 25,
        sort: 'id_asc',
        after_id: null,
        has_more: false,
        next_cursor: null,
      },
    });
    await expect(listAuthorizedVisits({
      agencyId: 'agency-a', purpose: 'schedule',
    })).resolves.toMatchObject({ scope: { access_basis: 'agency_wide' } });
  });
});
