import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@/api/base44Client', () => ({
  base44: { functions: { invoke: (...args) => invoke(...args) } },
}));

import { getAuthorizedVisit } from './getAuthorizedVisit';

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

const scheduleVisit = (overrides = {}) => ({
  id: 'visit-a',
  patient_id: 'patient-a',
  visit_date: '2026-09-03',
  visit_time: '09:30',
  visit_type: 'skilled_nursing',
  status: 'completed',
  updated_date: '2026-09-03T12:30:00.000Z',
  ...overrides,
});

describe('getAuthorizedVisit wrapper', () => {
  beforeEach(() => invoke.mockReset());

  it('invokes the exact broker with an explicit finite purpose', async () => {
    invoke.mockResolvedValue({
      data: {
        success: true,
        purpose: 'schedule',
        visit: scheduleVisit(),
        scope: clinicianScope,
      },
    });
    const result = await getAuthorizedVisit({
      agencyId: 'agency-a', visitId: 'visit-a', purpose: 'schedule',
    });
    expect(invoke).toHaveBeenCalledWith('getAuthorizedVisit', {
      agency_id: 'agency-a', visit_id: 'visit-a', purpose: 'schedule',
    });
    expect(result.visit.patient_id).toBe('patient-a');
  });

  it('rejects invalid and operator-shaped input before invoking', async () => {
    await expect(getAuthorizedVisit({
      agencyId: 'agency-a', visitId: '$visit', purpose: 'schedule',
    })).rejects.toThrow(/visitId/);
    await expect(getAuthorizedVisit({
      agencyId: 'agency-a', visitId: 'visit-a', purpose: 'all_fields',
    })).rejects.toThrow(/purpose/);
    await expect(getAuthorizedVisit({
      agencyId: 'agency-a', visitId: 'visit-a', purpose: 'schedule', fields: ['nurse_notes'],
    })).rejects.toThrow(/unsupported/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('fails closed on envelope, projection, identity, or scope drift', async () => {
    const invalidResults = [
      {
        success: true,
        purpose: 'schedule',
        visit: scheduleVisit({ secret_claim: 'leak' }),
        scope: clinicianScope,
      },
      {
        success: true,
        purpose: 'schedule',
        visit: scheduleVisit({ id: 'visit-b' }),
        scope: clinicianScope,
      },
      {
        success: true,
        purpose: 'schedule',
        visit: scheduleVisit(),
        scope: { ...clinicianScope, assignment_version: null },
      },
      {
        success: true,
        purpose: 'schedule',
        visit: scheduleVisit(),
        scope: { ...clinicianScope, patient_id: 'patient-b' },
        extra: true,
      },
    ];
    for (const result of invalidResults) {
      invoke.mockResolvedValueOnce({ data: result });
      await expect(getAuthorizedVisit({
        agencyId: 'agency-a', visitId: 'visit-a', purpose: 'schedule',
      })).rejects.toThrow(/lookup failed/);
    }
  });

  it('validates nested clinical objects instead of trusting a success flag', async () => {
    const invalidVisits = [
      scheduleVisit({
        vital_signs: { heart_rate: 72, hidden_phi: 1 },
        nurse_notes: 'note',
        raw_transcription: 'raw',
        documentation_source: 'smart_note',
        grounding_pending: false,
      }),
      scheduleVisit({
        compliance_score: 92,
        compliance_issues: [],
        documentation_review_ack: {
          acknowledged: true,
          is_clinical_signature: false,
          hidden_phi: 'leak',
        },
      }),
    ];
    for (const [index, visit] of invalidVisits.entries()) {
      const purpose = index === 0 ? 'documentation' : 'compliance_review';
      invoke.mockResolvedValueOnce({
        data: { success: true, purpose, visit, scope: clinicianScope },
      });
      await expect(getAuthorizedVisit({
        agencyId: 'agency-a', visitId: 'visit-a', purpose,
      })).rejects.toThrow(/lookup failed/);
    }
  });

  it.each(['documentation', 'compliance_review'])(
    'accepts current and legacy review acknowledgements for %s',
    async (purpose) => {
      for (const hashes of [
        { note_hash: '1234abcd', note_sha256: 'a'.repeat(64) },
        { note_hash: 'b'.repeat(64) },
      ]) {
        const acknowledgement = {
          acknowledged: true,
          acknowledged_by: 'nurse@example.com',
          acknowledged_at: '2026-09-03T12:30:00.000Z',
          ...hashes,
          note_length: 4,
          ai_assisted: true,
          nurse_edited: true,
          statement: 'Reviewed for accuracy',
          is_clinical_signature: false,
        };
        const visit = scheduleVisit({ documentation_review_ack: acknowledgement });
        if (purpose === 'compliance_review') delete visit.visit_time;
        invoke.mockResolvedValueOnce({
          data: { success: true, purpose, visit, scope: clinicianScope },
        });
        await expect(getAuthorizedVisit({
          agencyId: 'agency-a', visitId: 'visit-a', purpose,
        })).resolves.toMatchObject({
          visit: { documentation_review_ack: acknowledgement },
        });
      }
    },
  );

  it.each([
    { note_hash: 'a'.repeat(7) },
    { note_hash: 'a'.repeat(9) },
    { note_hash: 'g'.repeat(8) },
    { note_hash: 'a'.repeat(63) },
    { note_hash: 'a'.repeat(65) },
    { note_sha256: 'a'.repeat(8) },
    { note_sha256: 'g'.repeat(64) },
    { note_sha256: null },
    { hidden_phi: 'leak' },
  ])('rejects malformed review acknowledgement fields: %j', async (invalidFields) => {
    invoke.mockResolvedValueOnce({
      data: {
        success: true,
        purpose: 'documentation',
        visit: scheduleVisit({
          documentation_review_ack: {
            note_hash: '1234abcd',
            note_sha256: 'a'.repeat(64),
            ...invalidFields,
          },
        }),
        scope: clinicianScope,
      },
    });
    await expect(getAuthorizedVisit({
      agencyId: 'agency-a', visitId: 'visit-a', purpose: 'documentation',
    })).rejects.toThrow(/lookup failed/);
  });

  it('accepts the protected platform-owner agency-wide scope', async () => {
    invoke.mockResolvedValue({
      success: true,
      purpose: 'schedule',
      visit: scheduleVisit(),
      scope: {
        agency_id: 'agency-a',
        membership_id: null,
        membership_version: null,
        tenant_role: 'platform_owner',
        patient_id: 'patient-a',
        access_basis: 'agency_wide',
        assignment_id: null,
        assignment_version: null,
      },
    });
    await expect(getAuthorizedVisit({
      agencyId: 'agency-a', visitId: 'visit-a', purpose: 'schedule',
    })).resolves.toMatchObject({ success: true });
  });
});
