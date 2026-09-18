import { describe, it, expect, vi } from 'vitest';
import { createIndependentStagingAdapter, readIndependentStagingConfig } from './independentStagingAdapter';
import { stagingEmails, stagingEnv, stagingFixture } from '@/test/independentStagingFixture';
import { getAuthorizedVisit } from '@/functions/getAuthorizedVisit';

const boundary = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/api/base44Client', () => ({ base44: { functions: { invoke: boundary.invoke } } }));
const visitId = '30000000-0000-4000-8000-000000000001';
const visit = { id: visitId, patient_id: 'patient-0', visit_date: '2026-09-18', visit_type: 'skilled_nursing',
  status: 'completed', nurse_notes: 'Synthetic saved note.\nPreserve é 心 😀', raw_transcription: 'Synthetic rough note',
  vital_signs: { weight: 70, pain_level: 0 }, documentation_source: 'smart_note', grounding_pending: false,
  emr_handoff_status: 'not_started', emr_handoff_history: [], updated_date: '2026-09-18T12:00:00.000Z' };
function fixtureForVisit({ status = 200, beforeReturn, mutate = value => value } = {}) {
  const fixture = stagingFixture(), reads = [];
  const adapter = createIndependentStagingAdapter(readIndependentStagingConfig(stagingEnv), { fetchImpl: async (url, options) => {
    if (!url.endsWith('/pennsync_staging_visit_documentation')) return fixture.fetch(url, options);
    reads.push({ url, body: JSON.parse(options.body) });
    const contextResponse = await fixture.fetch(url.replace('/pennsync_staging_visit_documentation', '/pennsync_staging_context'), options);
    if (!contextResponse.ok) return contextResponse;
    const context = await contextResponse.json();
    if (status !== 200) return new Response('{}', { status, headers: { 'content-type': 'application/json' } });
    const scope = Object.fromEntries(['agency_id', 'membership_id', 'membership_version', 'tenant_role'].map(key => [key, context[key]]));
    const common = Object.fromEntries(['contract', 'app_id', 'auth_user_id', 'staging', 'synthetic'].map(key => [key, context[key]]));
    const result = mutate({ ...common, context, purpose: 'documentation', visit: structuredClone(visit),
      scope: { ...scope, patient_id: visit.patient_id, access_basis: 'agency_wide', assignment_id: null, assignment_version: null } });
    if (beforeReturn) await beforeReturn(adapter);
    return new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } });
  } });
  return { adapter, fixture, reads };
}

describe('independent saved Visit contract bridge', () => {
  it('satisfies the existing authorized wrapper with only its reviewed exact projection and scope', async () => {
    const { adapter, reads } = fixtureForVisit(); await adapter.auth.signIn(stagingEmails[0], 'Synthetic-accepted-password');
    boundary.invoke.mockImplementation(adapter.raw.functions.invoke);
    const result = await getAuthorizedVisit({ agencyId: 'agency-a', visitId, purpose: 'documentation' });
    expect(result).toEqual({ success: true, purpose: 'documentation', visit, scope: {
      agency_id: 'agency-a', membership_id: 'membership-0', membership_version: 1, tenant_role: 'agency_admin',
      patient_id: 'patient-0', access_basis: 'agency_wide', assignment_id: null, assignment_version: null,
    } });
    expect(reads).toHaveLength(1);
    expect(reads[0].body).toEqual({ p_app_id: '6a9881683dc68a0bd54f1ef7', p_agency_id: 'agency-a', p_visit_id: visitId });
    expect(JSON.stringify(result)).not.toContain('auth_user_id');
    await adapter.auth.signOut();
  });
  it('does not enable other Visit purposes, patient charts, history, writes or generic entity access', async () => {
    const { adapter, fixture, reads } = fixtureForVisit(); await adapter.auth.signIn(stagingEmails[0], 'Synthetic-accepted-password');
    const count = fixture.requests.length;
    for (const [name, input] of [
      ['getAuthorizedVisit', { agency_id: 'agency-a', visit_id: visitId, purpose: 'schedule' }],
      ['getAuthorizedVisit', { agency_id: 'agency-a', visit_id: visitId, purpose: 'documentation', patient_id: 'patient-0' }],
      ['getAuthorizedVisit', null], ['getAuthorizedPatient', {}], ['getAuthorizedPatientNoteHistory', {}],
      ['updateAuthorizedVisit', {}], ['pennsync_staging_visit_documentation', {}],
    ]) await expect(adapter.raw.functions.invoke(name, input)).rejects.toThrow('STAGING_OPERATION_UNAVAILABLE');
    expect(fixture.requests).toHaveLength(count); expect(reads).toHaveLength(0); expect(adapter.raw.entities).toEqual({});
    await adapter.auth.signOut();
  });
  it('withholds server denials and malformed saved records without falling back to Base44', async () => {
    for (const options of [{ status: 403 }, { status: 500 }, { mutate: result => ({ ...result, visit: { ...result.visit, patient_id: 'foreign' } }) }]) {
      const { adapter, reads } = fixtureForVisit(options); await adapter.auth.signIn(stagingEmails[0], 'Synthetic-accepted-password');
      await expect(adapter.raw.functions.invoke('getAuthorizedVisit', { agency_id: 'agency-a', visit_id: visitId, purpose: 'documentation' })).rejects.toThrow();
      expect(reads).toHaveLength(1); await adapter.auth.signOut();
    }
  });
  it('discards a saved record arriving after authority invalidation', async () => {
    const { adapter, fixture } = fixtureForVisit({ beforeReturn: active => active.raw.cleanup() });
    await adapter.auth.signIn(stagingEmails[0], 'Synthetic-accepted-password');
    await expect(adapter.raw.functions.invoke('getAuthorizedVisit', { agency_id: 'agency-a', visit_id: visitId, purpose: 'documentation' })).rejects.toThrow();
    expect(adapter.auth.hasSession()).toBe(false); await adapter.auth.signOut(); expect(fixture.live.size).toBe(0);
  });
});
