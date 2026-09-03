import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@/api/base44Client', () => ({
  base44: { functions: { invoke: (...args) => invoke(...args) } },
}));

import { listAuthorizedPatients } from './listAuthorizedPatients';

const scope = {
  agency_id: 'agency-a',
  membership_id: 'membership-a',
  membership_version: 2,
  tenant_role: 'manager',
};

describe('listAuthorizedPatients wrapper', () => {
  beforeEach(() => invoke.mockReset());

  it('invokes a bounded page with explicit purpose and tenant scope', async () => {
    invoke.mockResolvedValue({
      data: {
        success: true,
        mode: 'page',
        purpose: 'roster',
        patients: [{ id: 'patient-a', first_name: 'Ada', status: 'active' }],
        page: { page_size: 20, offset: 40, has_more: true, next_offset: 60 },
        scope,
      },
    });
    const result = await listAuthorizedPatients({
      agencyId: 'agency-a',
      mode: 'page',
      purpose: 'roster',
      status: 'active',
      sort: 'name_asc',
      pageSize: 20,
      offset: 40,
    });
    expect(invoke).toHaveBeenCalledWith('listAuthorizedPatients', {
      agency_id: 'agency-a',
      mode: 'page',
      purpose: 'roster',
      status: 'active',
      sort: 'name_asc',
      page_size: 20,
      offset: 40,
    });
    expect(result.page.next_offset).toBe(60);
  });

  it('invokes a capped id batch and accepts only requested ids', async () => {
    invoke.mockResolvedValue({
      success: true,
      mode: 'ids',
      purpose: 'contact',
      patients: [{ id: 'patient-b', phone: '555-0100' }],
      scope,
    });
    await listAuthorizedPatients({
      agencyId: 'agency-a',
      mode: 'ids',
      purpose: 'contact',
      patientIds: ['patient-a', 'patient-b'],
    });
    expect(invoke).toHaveBeenCalledWith('listAuthorizedPatients', {
      agency_id: 'agency-a',
      mode: 'ids',
      purpose: 'contact',
      patient_ids: ['patient-a', 'patient-b'],
    });
  });

  it('rejects invalid caps, modes, ids, and purpose before invocation', async () => {
    await expect(listAuthorizedPatients({
      agencyId: 'agency-a', mode: 'page', purpose: 'contact', pageSize: 26,
    })).rejects.toThrow(/pageSize/);
    await expect(listAuthorizedPatients({
      agencyId: 'agency-a', mode: 'page', purpose: 'roster', pageSize: 25, offset: 4990,
    })).rejects.toThrow(/offset/);
    await expect(listAuthorizedPatients({
      agencyId: 'agency-a', mode: 'ids', purpose: 'roster', patientIds: ['patient-a', 'patient-a'],
    })).rejects.toThrow(/patientIds/);
    await expect(listAuthorizedPatients({
      agencyId: 'agency-a', mode: 'ids', purpose: 'roster', patientIds: ['$in'],
    })).rejects.toThrow(/patientIds/);
    await expect(listAuthorizedPatients({
      agencyId: 'agency-a', mode: 'search', purpose: 'roster',
    })).rejects.toThrow(/mode/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('rejects projection or id injection in a successful response', async () => {
    invoke.mockResolvedValue({
      data: {
        success: true,
        mode: 'ids',
        purpose: 'roster',
        patients: [{ id: 'foreign', created_by: 'hidden@example.test' }],
        scope,
      },
    });
    await expect(listAuthorizedPatients({
      agencyId: 'agency-a', mode: 'ids', purpose: 'roster', patientIds: ['patient-a'],
    })).rejects.toThrow(/list failed/);
  });

  it('rejects inconsistent paging and duplicate patient ids', async () => {
    invoke.mockResolvedValue({
      data: {
        success: true,
        mode: 'page',
        purpose: 'roster',
        patients: [{ id: 'patient-a' }, { id: 'patient-a' }],
        page: { page_size: 25, offset: 0, has_more: false, next_offset: 25 },
        scope,
      },
    });
    await expect(listAuthorizedPatients({
      agencyId: 'agency-a', mode: 'page', purpose: 'roster',
    })).rejects.toThrow(/list failed/);
  });

  it('rejects a successful response that exceeds the requested bound', async () => {
    invoke.mockResolvedValue({
      data: {
        success: true,
        mode: 'page',
        purpose: 'roster',
        patients: [{ id: 'patient-a' }, { id: 'patient-b' }],
        page: { page_size: 1, offset: 0, has_more: true, next_offset: 1 },
        scope,
      },
    });
    await expect(listAuthorizedPatients({
      agencyId: 'agency-a', mode: 'page', purpose: 'roster', pageSize: 1,
    })).rejects.toThrow(/list failed/);

    invoke.mockResolvedValue({
      data: {
        success: true,
        mode: 'ids',
        purpose: 'roster',
        patients: [{ id: 'patient-a' }, { id: 'patient-b' }],
        scope,
      },
    });
    await expect(listAuthorizedPatients({
      agencyId: 'agency-a', mode: 'ids', purpose: 'roster', patientIds: ['patient-a'],
    })).rejects.toThrow(/list failed/);
  });
});
