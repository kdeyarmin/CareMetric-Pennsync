import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@/api/base44Client', () => ({
  base44: { functions: { invoke: (...args) => invoke(...args) } },
}));

import { getAuthorizedPatient } from './getAuthorizedPatient';

const scope = {
  agency_id: 'agency-a',
  membership_id: 'membership-a',
  membership_version: 2,
  tenant_role: 'clinician',
};

describe('getAuthorizedPatient wrapper', () => {
  beforeEach(() => invoke.mockReset());

  it('invokes the exact read broker with an explicit narrow purpose', async () => {
    invoke.mockResolvedValue({
      data: {
        success: true,
        purpose: 'display',
        patient: { id: 'patient-a', first_name: 'Ada', last_name: 'Lovelace' },
        scope,
      },
    });
    const result = await getAuthorizedPatient({
      agencyId: 'agency-a',
      patientId: 'patient-a',
      purpose: 'display',
    });
    expect(invoke).toHaveBeenCalledWith('getAuthorizedPatient', {
      agency_id: 'agency-a',
      patient_id: 'patient-a',
      purpose: 'display',
    });
    expect(result.patient.first_name).toBe('Ada');
  });

  it('accepts a raw valid response envelope', async () => {
    invoke.mockResolvedValue({
      success: true,
      purpose: 'education_context',
      patient: { id: 'patient-a', primary_diagnosis: 'I10' },
      scope: {
        agency_id: 'agency-a',
        membership_id: null,
        membership_version: null,
        tenant_role: 'platform_owner',
      },
    });
    await expect(getAuthorizedPatient({
      agencyId: 'agency-a', patientId: 'patient-a', purpose: 'education_context',
    })).resolves.toMatchObject({ purpose: 'education_context' });
  });

  it('rejects invalid or operator-shaped input before invoking the backend', async () => {
    await expect(getAuthorizedPatient({
      agencyId: 'agency-a', patientId: '$patient', purpose: 'display',
    })).rejects.toThrow(/patientId/);
    await expect(getAuthorizedPatient({
      agencyId: 'agency-a', patientId: 'patient-a', purpose: 'all_fields',
    })).rejects.toThrow(/purpose/);
    await expect(getAuthorizedPatient({
      agencyId: 'agency-a', patientId: 'patient-a', purpose: 'display', fields: ['email'],
    })).rejects.toThrow(/unsupported/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('rejects identity, scope, and projection drift in a false-success envelope', async () => {
    invoke.mockResolvedValue({
      data: {
        success: true,
        purpose: 'display',
        patient: { id: 'patient-a', created_by_user_id: 'hidden' },
        scope,
      },
    });
    await expect(getAuthorizedPatient({
      agencyId: 'agency-a', patientId: 'patient-a', purpose: 'display',
    })).rejects.toThrow(/lookup failed/);

    invoke.mockResolvedValue({
      data: {
        success: true,
        purpose: 'display',
        patient: { id: 'other' },
        scope,
      },
    });
    await expect(getAuthorizedPatient({
      agencyId: 'agency-a', patientId: 'patient-a', purpose: 'display',
    })).rejects.toThrow(/lookup failed/);
  });
});
