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
      patient: {
        id: 'patient-a',
        first_name: 'Ada',
        last_name: 'Lovelace',
        primary_diagnosis: 'I10',
      },
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

    invoke.mockResolvedValue({
      data: {
        success: true,
        purpose: 'display',
        patient: { id: 'patient-a' },
        scope: { ...scope, membership_version: null },
      },
    });
    await expect(getAuthorizedPatient({
      agencyId: 'agency-a', patientId: 'patient-a', purpose: 'display',
    })).rejects.toThrow(/lookup failed/);

    invoke.mockResolvedValue({
      data: {
        success: true,
        purpose: 'display',
        patient: { id: 'patient-a' },
        scope: { ...scope, tenant_role: 'office_staff' },
        extra: true,
      },
    });
    await expect(getAuthorizedPatient({
      agencyId: 'agency-a', patientId: 'patient-a', purpose: 'display',
    })).rejects.toThrow(/lookup failed/);
  });

  it('requires mandatory purpose fields and type-checks every returned optional field', async () => {
    for (const patient of [
      { id: 'patient-a' },
      { id: 'patient-a', first_name: ['Ada'], last_name: 'Lovelace' },
      {
        id: 'patient-a',
        first_name: 'Ada',
        last_name: 'Lovelace',
        secondary_diagnoses: 'E11.9',
        status: 'active',
      },
      {
        id: 'patient-a',
        first_name: 'Ada',
        last_name: 'Lovelace',
        status: 'unknown',
      },
    ]) {
      invoke.mockResolvedValueOnce({
        data: { success: true, purpose: 'alert_analysis', patient, scope },
      });
      await expect(getAuthorizedPatient({
        agencyId: 'agency-a', patientId: 'patient-a', purpose: 'alert_analysis',
      })).rejects.toThrow(/lookup failed/);
    }

    invoke.mockResolvedValueOnce({
      data: {
        success: true,
        purpose: 'visit_summary',
        patient: { id: 'patient-a', first_name: 'Ada', last_name: 'Lovelace' },
        scope,
      },
    });
    await expect(getAuthorizedPatient({
      agencyId: 'agency-a', patientId: 'patient-a', purpose: 'visit_summary',
    })).resolves.toMatchObject({ patient: { first_name: 'Ada' } });
  });

  it('rejects malformed identity, enum, date, and nested projection values', async () => {
    const cases = [
      {
        purpose: 'display',
        patient: { id: 'patient-a', first_name: '', last_name: 'Lovelace' },
      },
      {
        purpose: 'display',
        patient: { id: 'patient-a', first_name: ' Ada', last_name: 'Lovelace' },
      },
      {
        purpose: 'display',
        patient: { id: 'patient-a', first_name: 'Ada', last_name: ' ' },
      },
      {
        purpose: 'display',
        patient: { id: 'patient-a', first_name: 'A'.repeat(201), last_name: 'Lovelace' },
      },
      {
        purpose: 'selector',
        patient: {
          id: 'patient-a',
          first_name: 'Ada',
          last_name: 'Lovelace',
          status: 'active',
          updated_date: '2026-09-03T12:00:00.000Z',
          care_type: 'skilled_nursing',
        },
      },
      {
        purpose: 'visit_summary',
        patient: {
          id: 'patient-a',
          first_name: 'Ada',
          last_name: 'Lovelace',
          date_of_birth: '2026-02-30',
        },
      },
      {
        purpose: 'visit_summary',
        patient: {
          id: 'patient-a',
          first_name: 'Ada',
          last_name: 'Lovelace',
          date_of_birth: '02/03/2026',
        },
      },
      {
        purpose: 'health_history_write_base',
        patient: {
          id: 'patient-a',
          updated_date: '2026-09-03T12:00:00.000Z',
          past_hospitalizations: [{
            date: '2026-09-01',
            hospital: 'General Hospital',
            internal_note: 'must not cross the projection boundary',
          }],
        },
      },
      {
        purpose: 'health_history_write_base',
        patient: {
          id: 'patient-a',
          updated_date: '2026-09-03T12:00:00.000Z',
          past_hospitalizations: [{ date: '2026-02-30' }],
        },
      },
    ];

    for (const { purpose, patient } of cases) {
      invoke.mockResolvedValueOnce({
        data: { success: true, purpose, patient, scope },
      });
      await expect(getAuthorizedPatient({
        agencyId: 'agency-a', patientId: 'patient-a', purpose,
      })).rejects.toThrow(/lookup failed/);
    }
  });
});
