import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@/api/base44Client', () => ({
  base44: { functions: { invoke: (...args) => invoke(...args) } },
}));

import {
  createAuthorizedReferral,
  deleteAuthorizedReferral,
  getAuthorizedReferral,
  listAuthorizedReferrals,
  updateAuthorizedReferral,
} from './manageAuthorizedReferral';

const scope = {
  agency_id: 'agency-a',
  membership_id: 'membership-a',
  membership_version: 3,
  tenant_role: 'office_staff',
};

const referral = {
  id: 'referral-a',
  agency_id: 'agency-a',
  version: 2,
  status: 'new',
  patient_id: 'patient-a',
  assigned_to: 'office@agency.test',
  patient_name: 'Fictional Patient',
  created_date: '2026-09-06T12:00:00.000Z',
  updated_date: '2026-09-06T12:01:00.000Z',
};

describe('authorized Referral browser broker', () => {
  beforeEach(() => invoke.mockReset());

  it('lists only through the explicit agency-scoped broker request', async () => {
    invoke.mockResolvedValue({
      data: { success: true, action: 'list', referrals: [referral], scope },
    });
    const result = await listAuthorizedReferrals({
      agencyId: 'agency-a', limit: 25, patientId: 'patient-a', status: 'new',
      assignedTo: 'OFFICE@AGENCY.TEST',
    });
    expect(invoke).toHaveBeenCalledWith('manageAuthorizedReferral', {
      action: 'list',
      agency_id: 'agency-a',
      limit: 25,
      patient_id: 'patient-a',
      status: 'new',
      assigned_to: 'office@agency.test',
    });
    expect(result.referrals).toEqual([referral]);
  });

  it('gets, creates, and conditionally updates without accepting authority fields', async () => {
    invoke
      .mockResolvedValueOnce({
        data: { success: true, action: 'get', referral, scope },
      })
      .mockResolvedValueOnce({
        data: { success: true, action: 'create', created: true, referral, scope },
      })
      .mockResolvedValueOnce({
        data: { success: true, action: 'update', referral: { ...referral, version: 3 }, scope },
      });

    await getAuthorizedReferral({ agencyId: 'agency-a', referralId: 'referral-a' });
    await createAuthorizedReferral(
      { patient_name: 'Fictional Patient' },
      { agencyId: 'agency-a', clientRequestId: 'request-a' },
    );
    await updateAuthorizedReferral({
      agencyId: 'agency-a',
      referralId: 'referral-a',
      changes: { status: 'pending' },
    });

    expect(invoke).toHaveBeenNthCalledWith(1, 'manageAuthorizedReferral', {
      action: 'get', agency_id: 'agency-a', referral_id: 'referral-a',
    });
    expect(invoke).toHaveBeenNthCalledWith(2, 'manageAuthorizedReferral', {
      action: 'create',
      agency_id: 'agency-a',
      client_request_id: 'request-a',
      referral: { patient_name: 'Fictional Patient' },
    });
    expect(invoke).toHaveBeenNthCalledWith(3, 'manageAuthorizedReferral', {
      action: 'update',
      agency_id: 'agency-a',
      referral_id: 'referral-a',
      changes: { status: 'pending' },
    });
  });

  it('rejects malformed caller input before invoking the broker', async () => {
    await expect(listAuthorizedReferrals({ agencyId: '$operator' })).rejects.toThrow(/agencyId/);
    await expect(listAuthorizedReferrals({ agencyId: 'agency-a', limit: 5001 })).rejects.toThrow(/limit/);
    await expect(listAuthorizedReferrals({
      agencyId: 'agency-a', assignedTo: 'not-an-email',
    })).rejects.toThrow(/assignedTo/);
    await expect(getAuthorizedReferral({
      agencyId: 'agency-a', referralId: ' referral-a',
    })).rejects.toThrow(/referralId/);
    await expect(createAuthorizedReferral([], {
      agencyId: 'agency-a', clientRequestId: 'request-a',
    })).rejects.toThrow(/object/);
    await expect(updateAuthorizedReferral({
      agencyId: 'agency-a', referralId: 'referral-a', changes: {},
    })).rejects.toThrow(/non-empty/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('rejects false-success identity, tenant, role, and projection drift', async () => {
    for (const envelope of [
      { success: true, action: 'get', referral: { ...referral, id: 'other' }, scope },
      { success: true, action: 'get', referral: { ...referral, agency_id: 'agency-b' }, scope },
      { success: true, action: 'get', referral: { ...referral, created_by_user_id: 'hidden' }, scope },
      { success: true, action: 'get', referral, scope: { ...scope, membership_version: null } },
      { success: true, action: 'get', referral, scope: { ...scope, tenant_role: 'clinician' } },
      { success: true, action: 'get', referral, scope, extra: true },
    ]) {
      invoke.mockResolvedValueOnce({ data: envelope });
      await expect(getAuthorizedReferral({
        agencyId: 'agency-a', referralId: 'referral-a',
      })).rejects.toThrow(/integrity validation/);
    }
  });

  it('rejects list rows that do not match the requested patient, status, or assignee', async () => {
    for (const changed of [
      { patient_id: 'patient-b' },
      { status: 'declined' },
      { assigned_to: 'other@agency.test' },
    ]) {
      invoke.mockResolvedValueOnce({
        data: {
          success: true,
          action: 'list',
          referrals: [{ ...referral, ...changed }],
          scope,
        },
      });
      await expect(listAuthorizedReferrals({
        agencyId: 'agency-a',
        patientId: 'patient-a',
        status: 'new',
        assignedTo: 'office@agency.test',
      })).rejects.toThrow(/integrity validation/);
    }
  });

  it('keeps non-atomic Referral deletion paused in the browser', async () => {
    await expect(deleteAuthorizedReferral({
      agencyId: 'agency-a', referralId: 'referral-a',
    })).rejects.toThrow(/atomic datastore support/);
    expect(invoke).not.toHaveBeenCalled();
  });
});
