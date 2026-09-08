import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@/api/base44Client', () => ({
  base44: { functions: { invoke: (...args) => invoke(...args) } },
}));

import {
  changePatientStatus,
  setPatientPrimaryDiagnosis,
  updatePatientFields,
} from './updateAuthorizedPatient';

const T1 = '2026-09-04T12:00:00.000Z';
const T2 = '2026-09-04T12:00:01.000Z';
const T3 = '2026-09-04T12:00:02.000Z';

function response(actions, updatedDate) {
  return {
    data: {
      success: true,
      updated: true,
      action: actions.length === 1 ? actions[0] : 'batch',
      actions,
      changed_fields: [],
      patient: { id: 'patient-1', agency_id: 'agency-1', updated_date: updatedDate },
    },
  };
}

describe('updateAuthorizedPatient wrapper', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('classifies the whole patch and sends one canonical finite-action batch', async () => {
    invoke.mockResolvedValueOnce(response(
      ['edit_demographics', 'edit_clinical_profile'],
      T2,
    ));

    const result = await updatePatientFields({
      patientId: 'patient-1',
      agencyId: 'agency-1',
      expectedUpdatedDate: T1,
      changes: {
        first_name: 'Ada',
        allergies: 'Penicillin',
        secondary_diagnoses: ['I10'],
      },
    });

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][1]).toEqual({
      patient_id: 'patient-1',
      agency_id: 'agency-1',
      expected_updated_date: T1,
      actions: [
        { action: 'edit_demographics', changes: { first_name: 'Ada' } },
        {
          action: 'edit_clinical_profile',
          changes: { allergies: 'Penicillin', secondary_diagnoses: ['I10'] },
        },
      ],
    });
    expect(result.patient.updated_date).toBe(T2);
    expect(result.actions).toHaveLength(2);
  });

  it('rejects every unsupported field before making the first request', async () => {
    await expect(updatePatientFields({
      patientId: 'patient-1',
      expectedUpdatedDate: T1,
      changes: { first_name: 'Ada', current_medications: [], family_medical_history: {} },
    })).rejects.toThrow(/current_medications, family_medical_history/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('does not silently ignore an unsupported field whose value is undefined', async () => {
    await expect(updatePatientFields({
      patientId: 'patient-1',
      expectedUpdatedDate: T1,
      changes: { first_name: 'Ada', baseline_vitals: undefined },
    })).rejects.toThrow(/baseline_vitals/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('preflights discharge requirements before another action can commit', async () => {
    await expect(updatePatientFields({
      patientId: 'patient-1',
      expectedUpdatedDate: T1,
      changes: { first_name: 'Ada', status: 'discharged' },
    })).rejects.toThrow(/Discharge requires a date and disposition/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('builds the finite status and primary-diagnosis actions', async () => {
    invoke
      .mockResolvedValueOnce(response(['change_status'], T2))
      .mockResolvedValueOnce(response(['set_primary_diagnosis'], T3));
    await changePatientStatus({
      patientId: 'patient-1', expectedUpdatedDate: T1, status: 'hospitalized',
    });
    await setPatientPrimaryDiagnosis({
      patientId: 'patient-1', expectedUpdatedDate: T2, primaryDiagnosis: 'I50.9',
    });
    expect(invoke.mock.calls.map((call) => call[1].actions[0].action))
      .toEqual(['change_status', 'set_primary_diagnosis']);
  });

  it('returns a local no-op without invoking the server', async () => {
    const result = await updatePatientFields({
      patientId: 'patient-1', expectedUpdatedDate: T1, changes: {},
    });
    expect(result).toMatchObject({ updated: false, patient: { id: 'patient-1' } });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('requires the current concurrency timestamp', async () => {
    await expect(setPatientPrimaryDiagnosis({
      patientId: 'patient-1', primaryDiagnosis: 'I50.9',
    })).rejects.toThrow(/updated_date/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('rejects a false success envelope', async () => {
    invoke.mockResolvedValueOnce({ data: { success: true, updated: true } });
    await expect(setPatientPrimaryDiagnosis({
      patientId: 'patient-1', expectedUpdatedDate: T1, primaryDiagnosis: 'I50.9',
    })).rejects.toThrow('Patient update failed');
  });
});
