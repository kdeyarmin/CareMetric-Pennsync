import { beforeEach, describe, expect, it, vi } from 'vitest';

const broker = vi.hoisted(() => ({
  list: vi.fn(),
}));
vi.mock('@/functions/listAuthorizedPatients', () => ({
  listAuthorizedPatients: (...args) => broker.list(...args),
}));

import {
  listAuthorizedReferralIdentityRoster,
  resolveAuthorizedReferralPatients,
} from './authorizedPatientMatches';

const tenantContext = (overrides = {}) => ({
  user_id: 'user-a',
  agency_id: 'agency-a',
  membership_id: 'membership-a',
  membership_version: 2,
  tenant_role: 'manager',
  ...overrides,
});

const scope = (overrides = {}) => ({
  agency_id: 'agency-a',
  membership_id: 'membership-a',
  membership_version: 2,
  tenant_role: 'manager',
  ...overrides,
});

const page = ({ patients, hasMore = false, nextCursor = null, scopeOverrides = {} }) => ({
  patients,
  scope: scope(scopeOverrides),
  page: {
    has_more: hasMore,
    next_cursor: nextCursor,
  },
});

describe('authorized referral patient matching', () => {
  beforeEach(() => {
    broker.list.mockReset();
  });

  it('walks the identity-match keyset under one exact tenant authority', async () => {
    const cursor = { after_id: 'patient-a' };
    broker.list
      .mockResolvedValueOnce(page({
        patients: [{ id: 'patient-a', first_name: 'Ada' }],
        hasMore: true,
        nextCursor: cursor,
      }))
      .mockResolvedValueOnce(page({
        patients: [{ id: 'patient-b', first_name: 'Grace' }],
      }));

    await expect(listAuthorizedReferralIdentityRoster({
      tenantContext: tenantContext(),
    })).resolves.toEqual([
      { id: 'patient-a', first_name: 'Ada' },
      { id: 'patient-b', first_name: 'Grace' },
    ]);
    expect(broker.list).toHaveBeenNthCalledWith(1, {
      agencyId: 'agency-a',
      mode: 'page',
      purpose: 'identity_match',
      sort: 'id_asc',
      pageSize: 25,
      cursor: null,
    });
    expect(broker.list).toHaveBeenNthCalledWith(2, {
      agencyId: 'agency-a',
      mode: 'page',
      purpose: 'identity_match',
      sort: 'id_asc',
      pageSize: 25,
      cursor,
    });
  });

  it('rejects authority drift and duplicate rows across pages', async () => {
    broker.list.mockResolvedValueOnce(page({
      patients: [{ id: 'patient-a' }],
      scopeOverrides: { membership_version: 3 },
    }));
    await expect(listAuthorizedReferralIdentityRoster({
      tenantContext: tenantContext(),
    })).rejects.toThrow(/scope changed/);

    broker.list
      .mockResolvedValueOnce(page({
        patients: [{ id: 'patient-a' }],
        hasMore: true,
        nextCursor: { after_id: 'patient-a' },
      }))
      .mockResolvedValueOnce(page({ patients: [{ id: 'patient-a' }] }));
    await expect(listAuthorizedReferralIdentityRoster({
      tenantContext: tenantContext(),
    })).rejects.toThrow(/duplicate row/);
  });

  it('hard-fails when a short final page takes the identity roster over 10,000 rows', async () => {
    const firstPage = Array.from({ length: 9_999 }, (_, index) => ({
      id: `patient-${index}`,
    }));
    broker.list
      .mockResolvedValueOnce(page({
        patients: firstPage,
        hasMore: true,
        nextCursor: { after_id: 'patient-9998' },
      }))
      .mockResolvedValueOnce(page({
        patients: [{ id: 'patient-9999' }, { id: 'patient-10000' }],
        hasMore: false,
      }));

    await expect(listAuthorizedReferralIdentityRoster({
      tenantContext: tenantContext(),
    })).rejects.toThrow(/exceeds the reviewed limit/);
  });

  it('accepts exactly 10,000 rows only when the final page proves there are no more', async () => {
    const firstPage = Array.from({ length: 9_999 }, (_, index) => ({
      id: `patient-${index}`,
    }));
    broker.list
      .mockResolvedValueOnce(page({
        patients: firstPage,
        hasMore: true,
        nextCursor: { after_id: 'patient-9998' },
      }))
      .mockResolvedValueOnce(page({ patients: [{ id: 'patient-9999' }] }));

    const result = await listAuthorizedReferralIdentityRoster({
      tenantContext: tenantContext(),
    });
    expect(result).toHaveLength(10_000);
  });

  it('intersects identity and roster projections and preserves requested order', async () => {
    broker.list.mockImplementation(async ({ purpose, patientIds }) => ({
      scope: scope(),
      patients: purpose === 'identity_match'
        ? patientIds.map((id) => ({ id, first_name: `Identity ${id}` }))
        : patientIds
          .filter((id) => id !== 'patient-b')
          .map((id) => ({ id, updated_date: '2026-09-07T12:00:00.000Z' })),
    }));

    const result = await resolveAuthorizedReferralPatients({
      tenantContext: tenantContext(),
      patientIds: ['patient-b', 'patient-a', 'patient-a'],
    });
    expect(result).toEqual([{
      id: 'patient-a',
      first_name: 'Identity patient-a',
      updated_date: '2026-09-07T12:00:00.000Z',
    }]);
    expect(broker.list).toHaveBeenCalledTimes(2);
    expect(broker.list.mock.calls.map(([request]) => request.purpose).sort()).toEqual([
      'identity_match',
      'roster',
    ]);
  });

  it('pairs the roster MRN with its updated_date when purpose reads straddle an update', async () => {
    broker.list.mockImplementation(async ({ purpose }) => ({
      scope: scope(),
      patients: purpose === 'identity_match'
        ? [{ id: 'patient-a', medical_record_number: null }]
        : [{
          id: 'patient-a',
          medical_record_number: 'MRN-CONCURRENT',
          updated_date: '2026-09-07T12:00:01.000Z',
        }],
    }));

    await expect(resolveAuthorizedReferralPatients({
      tenantContext: tenantContext(),
      patientIds: ['patient-a'],
    })).resolves.toEqual([{
      id: 'patient-a',
      medical_record_number: 'MRN-CONCURRENT',
      updated_date: '2026-09-07T12:00:01.000Z',
    }]);
  });

  it('batches suggested ids without weakening the 100-record review cap', async () => {
    broker.list.mockImplementation(async ({ purpose, patientIds }) => ({
      scope: scope(),
      patients: patientIds.map((id) => ({
        id,
        ...(purpose === 'identity_match'
          ? { first_name: id }
          : { updated_date: '2026-09-07T12:00:00.000Z' }),
      })),
    }));
    const patientIds = Array.from({ length: 26 }, (_, index) => `patient-${index}`);

    await expect(resolveAuthorizedReferralPatients({
      tenantContext: tenantContext(),
      patientIds,
    })).resolves.toHaveLength(26);
    expect(broker.list).toHaveBeenCalledTimes(4);
    expect(broker.list.mock.calls.every(([request]) => request.patientIds.length <= 25))
      .toBe(true);

    broker.list.mockClear();
    await expect(resolveAuthorizedReferralPatients({
      tenantContext: tenantContext(),
      patientIds: Array.from({ length: 101 }, (_, index) => `patient-${index}`),
    })).rejects.toThrow(/exceeds the reviewed limit/);
    expect(broker.list).not.toHaveBeenCalled();
  });

  it('keeps office_staff identity matching fail-closed', async () => {
    broker.list.mockImplementation(({ purpose }) => (purpose === 'identity_match'
      ? Promise.reject(new Error('Patient list purpose is not permitted'))
      : Promise.resolve({ scope: scope(), patients: [] })));

    await expect(resolveAuthorizedReferralPatients({
      tenantContext: tenantContext({ tenant_role: 'office_staff' }),
      patientIds: ['patient-a'],
    })).rejects.toThrow(/not permitted/);
    expect(broker.list).toHaveBeenCalledWith(expect.objectContaining({
      purpose: 'identity_match',
    }));
  });
});
