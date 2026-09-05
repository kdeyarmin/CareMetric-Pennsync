import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@/api/base44Client', () => ({
  base44: { functions: { invoke: (...args) => invoke(...args) } },
}));

import {
  getAuthorizedOASISAssessment,
  listAuthorizedOASISAssessments,
} from './readAuthorizedOASISAssessments';

const summary = (overrides = {}) => ({
  id: 'assessment-a',
  patient_id: 'patient-a',
  visit_id: 'visit-a',
  visit_type: 'Start of Care',
  assessment_date: '2026-09-04',
  status: 'in_progress',
  completion_percentage: 25,
  response_schema_id: 'pennsync-oasis-response-v2-cms-e2',
  instrument_version: 'oasis-e2',
  migration_status: 'native_v2',
  created_date: '2026-09-04T11:00:00.000Z',
  updated_date: '2026-09-04T12:00:00.000Z',
  ...overrides,
});

const item = (overrides = {}) => ({
  definition_id: 'm1830_cms_e2',
  item_number: 'M1830',
  item_name: 'Bathing',
  item_source: 'cms_item',
  item_spec_version: 'oasis-e2',
  response_schema_id: 'pennsync-oasis-response-v2-cms-e2',
  response_shape: 'single',
  response_value: { code: '01' },
  response_origin: 'clinician_selected',
  selected_by: 'clinician@agency.test',
  selected_at: '2026-09-04T11:30:00.000Z',
  ai_suggested: false,
  ...overrides,
});

const verified = (overrides = {}) => ({
  ...summary(),
  response_schema_source: 'final-oasis-e2-all-item-04-01-2026',
  last_written_by: 'clinician@agency.test',
  last_written_at: '2026-09-04T12:00:00.000Z',
  oasis_items: [item()],
  ...overrides,
});

const creatorScope = (overrides = {}) => ({
  agency_id: 'agency-a',
  patient_id: 'patient-a',
  membership_id: 'membership-a',
  membership_version: 2,
  tenant_role: 'clinician',
  chart_access_basis: 'patient_creator',
  ...overrides,
});

const getEnvelope = (overrides = {}) => ({
  success: true,
  operation: 'get',
  purpose: 'verified_responses',
  assessment: verified(),
  scope: creatorScope(),
  ...overrides,
});

const listEnvelope = (overrides = {}) => ({
  success: true,
  operation: 'list',
  purpose: 'summary',
  assessments: [summary()],
  page: { limit: 10, returned: 1, has_more: false },
  scope: creatorScope(),
  ...overrides,
});

describe('authorized OASIS read wrappers', () => {
  beforeEach(() => invoke.mockReset());

  it('invokes exact verified-response retrieval with only explicit identifiers and purpose', async () => {
    invoke.mockResolvedValue({ data: getEnvelope() });
    const result = await getAuthorizedOASISAssessment({
      agencyId: 'agency-a',
      patientId: 'patient-a',
      assessmentId: 'assessment-a',
      purpose: 'verified_responses',
    });
    expect(invoke).toHaveBeenCalledWith('readAuthorizedOASISAssessments', {
      operation: 'get',
      agency_id: 'agency-a',
      patient_id: 'patient-a',
      assessment_id: 'assessment-a',
      purpose: 'verified_responses',
    });
    expect(result.assessment.oasis_items[0].response_value.code).toBe('01');
  });

  it('accepts exact summary retrieval and protected platform-owner scope', async () => {
    invoke.mockResolvedValue(getEnvelope({
      purpose: 'summary',
      assessment: summary(),
      scope: creatorScope({
        membership_id: null,
        membership_version: null,
        tenant_role: 'platform_owner',
        chart_access_basis: 'agency_wide',
      }),
    }));
    await expect(getAuthorizedOASISAssessment({
      agencyId: 'agency-a',
      patientId: 'patient-a',
      assessmentId: 'assessment-a',
      purpose: 'summary',
    })).resolves.toMatchObject({ purpose: 'summary' });
  });

  it('invokes only a bounded summary list and verifies the page envelope', async () => {
    invoke.mockResolvedValue({
      data: listEnvelope({
        assessments: [
          summary({ id: 'assessment-new', assessment_date: '2026-09-04' }),
          summary({ id: 'assessment-old', assessment_date: '2026-09-01' }),
        ],
        page: { limit: 2, returned: 2, has_more: true },
      }),
    });
    const result = await listAuthorizedOASISAssessments({
      agencyId: 'agency-a',
      patientId: 'patient-a',
      purpose: 'summary',
      limit: 2,
    });
    expect(invoke).toHaveBeenCalledWith('readAuthorizedOASISAssessments', {
      operation: 'list',
      agency_id: 'agency-a',
      patient_id: 'patient-a',
      purpose: 'summary',
      limit: 2,
    });
    expect(result.page.has_more).toBe(true);
  });

  it('rejects unsupported, operator-shaped, and unbounded inputs before invocation', async () => {
    const invalidCalls = [
      () => getAuthorizedOASISAssessment(null),
      () => getAuthorizedOASISAssessment({
        agencyId: '$agency', patientId: 'patient-a', assessmentId: 'assessment-a', purpose: 'summary',
      }),
      () => getAuthorizedOASISAssessment({
        agencyId: 'agency-a', patientId: ' patient-a', assessmentId: 'assessment-a', purpose: 'summary',
      }),
      () => getAuthorizedOASISAssessment({
        agencyId: 'agency-a', patientId: 'patient-a', assessmentId: '$assessment', purpose: 'summary',
      }),
      () => getAuthorizedOASISAssessment({
        agencyId: 'agency-a', patientId: 'patient-a', assessmentId: 'assessment-a', purpose: 'all_fields',
      }),
      () => getAuthorizedOASISAssessment({
        agencyId: 'agency-a', patientId: 'patient-a', assessmentId: 'assessment-a', purpose: 'summary', fields: ['oasis_items'],
      }),
      () => listAuthorizedOASISAssessments({
        agencyId: 'agency-a', patientId: 'patient-a', purpose: 'verified_responses', limit: 5,
      }),
      () => listAuthorizedOASISAssessments({
        agencyId: 'agency-a', patientId: 'patient-a', purpose: 'summary', limit: 26,
      }),
      () => listAuthorizedOASISAssessments({
        agencyId: 'agency-a', patientId: 'patient-a', purpose: 'summary', limit: 1.5,
      }),
    ];
    for (const call of invalidCalls) await expect(call()).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('rejects false-success envelope, identity, purpose, scope, and projection drift', async () => {
    const invalidEnvelopes = [
      getEnvelope({ success: false }),
      getEnvelope({ operation: 'list' }),
      getEnvelope({ purpose: 'summary' }),
      getEnvelope({ assessment: verified({ id: 'assessment-b' }) }),
      getEnvelope({ assessment: { ...verified(), clinical_summary: 'leak' } }),
      getEnvelope({ scope: creatorScope({ agency_id: 'agency-b' }) }),
      getEnvelope({ scope: creatorScope({ patient_id: 'patient-b' }) }),
      getEnvelope({ scope: creatorScope({ membership_version: null }) }),
      getEnvelope({ scope: creatorScope({ tenant_role: 'office_staff' }) }),
      getEnvelope({ scope: creatorScope({ extra: true }) }),
      { ...getEnvelope(), extra: true },
    ];
    for (const envelope of invalidEnvelopes) {
      invoke.mockResolvedValueOnce({ data: envelope });
      await expect(getAuthorizedOASISAssessment({
        agencyId: 'agency-a',
        patientId: 'patient-a',
        assessmentId: 'assessment-a',
        purpose: 'verified_responses',
      })).rejects.toThrow(/lookup failed/);
    }
  });

  it('rejects AI, legacy, mismatched selector, invalid response shape, and duplicate items', async () => {
    const invalidAssessments = [
      verified({ response_schema_id: 'pennsync-oasis-response-v1-legacy' }),
      verified({ migration_status: 'legacy_provenance_annotated' }),
      verified({ response_schema_source: 'draft-oasis-e2' }),
      verified({ oasis_items: [item({ ai_suggested: true })] }),
      verified({ oasis_items: [item({ response_origin: 'ai_generated' })] }),
      verified({ oasis_items: [item({ selected_by: 'other@agency.test' })] }),
      verified({ oasis_items: [item({ response_value: { code: 1 } })] }),
      verified({ oasis_items: [item({ response_value: { code: '01', extra: true } })] }),
      verified({ oasis_items: [item({ item_source: 'unknown' })] }),
      verified({ oasis_items: [item(), item({ item_number: 'M1831' })] }),
      verified({ oasis_items: [item({ selected_at: '2026-09-04T12:30:00.000Z' })] }),
    ];
    for (const assessment of invalidAssessments) {
      invoke.mockResolvedValueOnce({ data: getEnvelope({ assessment }) });
      await expect(getAuthorizedOASISAssessment({
        agencyId: 'agency-a',
        patientId: 'patient-a',
        assessmentId: 'assessment-a',
        purpose: 'verified_responses',
      })).rejects.toThrow(/lookup failed/);
    }
  });

  it('accepts finite multi-select, grid, and PennSync screening shapes without relabeling them', async () => {
    const assessment = verified({
      oasis_items: [
        item({
          definition_id: 'm1033_cms_e2',
          item_number: 'M1033',
          response_shape: 'multi_select',
          response_value: { codes: ['01', '03'] },
        }),
        item({
          definition_id: 'gg0130_cms_e2',
          item_number: 'GG0130',
          response_shape: 'grid',
          response_value: {
            rows: [{ row_id: 'a', code: '05' }, { row_id: 'b', code: '06' }],
          },
        }),
        item({
          definition_id: 'ps_hospitalization_risk',
          item_number: null,
          item_source: 'pennsync_screening',
          item_spec_version: null,
          response_shape: 'matrix_choice',
          response_value: { code: 'high' },
        }),
      ],
    });
    invoke.mockResolvedValue({ data: getEnvelope({ assessment }) });
    const result = await getAuthorizedOASISAssessment({
      agencyId: 'agency-a',
      patientId: 'patient-a',
      assessmentId: 'assessment-a',
      purpose: 'verified_responses',
    });
    expect(result.assessment.oasis_items.map((row) => row.item_source)).toEqual([
      'cms_item', 'cms_item', 'pennsync_screening',
    ]);
  });

  it('rejects list overflow, duplicates, unstable ordering, invalid pages, and clinical payload leakage', async () => {
    const invalidLists = [
      listEnvelope({
        assessments: [summary(), summary({ id: 'assessment-b' })],
        page: { limit: 1, returned: 2, has_more: true },
      }),
      listEnvelope({
        assessments: [summary(), summary()],
        page: { limit: 10, returned: 2, has_more: false },
      }),
      listEnvelope({
        assessments: [
          summary({ id: 'old', assessment_date: '2026-09-01' }),
          summary({ id: 'new', assessment_date: '2026-09-04' }),
        ],
        page: { limit: 10, returned: 2, has_more: false },
      }),
      listEnvelope({ assessments: [{ ...summary(), oasis_items: [] }] }),
      listEnvelope({ page: { limit: 10, returned: 2, has_more: false } }),
      listEnvelope({ page: { limit: 10, returned: 1, has_more: 'yes' } }),
      listEnvelope({ scope: creatorScope({ chart_access_basis: 'agency_wide' }) }),
      { ...listEnvelope(), extra: true },
    ];
    for (const envelope of invalidLists) {
      invoke.mockResolvedValueOnce({ data: envelope });
      await expect(listAuthorizedOASISAssessments({
        agencyId: 'agency-a',
        patientId: 'patient-a',
        purpose: 'summary',
      })).rejects.toThrow(/list failed/);
    }
  });
});
