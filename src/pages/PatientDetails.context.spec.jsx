import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitFor } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { renderWithProviders } from '@/test/testUtils';

const PATIENT = { id: 'p1', first_name: 'Jane', last_name: 'Doe', status: 'active', assigned_nurses: ['nurse@x.com'] };
const CTX = {
  patient: PATIENT,
  visits: [{ id: 'v1', patient_id: 'p1', status: 'completed', visit_date: '2026-06-01' }],
  carePlans: [{ id: 'cp1', patient_id: 'p1', status: 'active' }],
  incidents: [],
  tasks: [],
  activeAlerts: [],
};

const { invoke, state } = vi.hoisted(() => ({ invoke: vi.fn(), state: { ctx: null } }));

vi.mock('@/api/base44Client', () => {
  // Self-contained broad stub (factory is hoisted, so no outer imports): every
  // entity call resolves to []/{} so the page's many child components mount
  // harmlessly; functions.invoke is the hoisted spy serving getPatientContext.
  const arr = async () => [];
  const obj = async () => ({});
  const entityStub = new Proxy({}, {
    get: (_t, p) => {
      if (p === 'then') return undefined;
      if (p === 'get' || p === 'create' || p === 'update') return obj;
      return arr;
    },
  });
  const entities = new Proxy({}, { get: () => entityStub });
  const integrations = new Proxy({}, { get: () => new Proxy({}, { get: () => async () => ({}) }) });
  const functions = { invoke };
  return {
    base44: {
      entities,
      functions,
      integrations,
      auth: { me: async () => ({ email: 'nurse@x.com', role: 'nurse' }), logout: () => {}, redirectToLogin: () => {} },
      asServiceRole: { entities, functions, integrations },
    },
  };
});

beforeEach(() => {
  invoke.mockReset();
  state.ctx = CTX;
  invoke.mockImplementation(async (name) => (name === 'getPatientContext' ? { data: state.ctx } : { data: {} }));
  window.history.pushState({}, '', '/PatientDetails?id=p1');
});

describe('PatientDetails — getPatientContext seeding', () => {
  it('fetches getPatientContext once and seeds the per-entity child caches', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    // Import lazily so the vi.mock factory is in place first.
    const { default: PatientDetails } = await import('@/pages/PatientDetails');
    renderWithProviders(<PatientDetails />, { queryClient: qc });

    // The single consolidated fetch ran with the URL's patient id.
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('getPatientContext', { patientId: 'p1' }));

    // Seeding: a child reading ['patientVisits','p1'] (or ['patient','p1']) finds
    // the payload already in cache — no second request.
    await waitFor(() => expect(qc.getQueryData(['patientVisits', 'p1'])).toEqual(CTX.visits));
    expect(qc.getQueryData(['patient', 'p1'])).toEqual([PATIENT]);
    expect(qc.getQueryData(['patientCarePlans', 'p1'])).toEqual(CTX.carePlans);
    expect(qc.getQueryData(['patientActiveAlerts', 'p1'])).toEqual(CTX.activeAlerts);

    // getPatientContext was the only patient-data round-trip the page issued.
    const contextCalls = invoke.mock.calls.filter((c) => c[0] === 'getPatientContext');
    expect(contextCalls).toHaveLength(1);
  });

  // Deterministic stand-in for the live staging smoke test (no Base44 backend is
  // reachable here): exercises the exact post-mutation cycle the page relies on —
  // invalidate(['patientContext', id]) → refetch → queryFn re-seeds the per-entity
  // mirrors with the fresh payload. This is the "invalidation drift" risk flagged
  // for getPatientContext.
  it('re-seeds child caches after a context invalidation (post-mutation cycle)', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const { default: PatientDetails } = await import('@/pages/PatientDetails');
    renderWithProviders(<PatientDetails />, { queryClient: qc });

    await waitFor(() => expect(qc.getQueryData(['patientVisits', 'p1'])).toEqual(CTX.visits), { timeout: 5000 });
    const callsAfterLoad = invoke.mock.calls.filter((c) => c[0] === 'getPatientContext').length;

    // Simulate the server now returning a newly-created visit, then do exactly what
    // the page's create-visit/care-plan/alert mutations do on success.
    const updated = {
      ...CTX,
      visits: [...CTX.visits, { id: 'v2', patient_id: 'p1', status: 'scheduled', visit_date: '2026-07-01' }],
    };
    state.ctx = updated;
    qc.invalidateQueries({ queryKey: ['patientContext', 'p1'] });

    // The mirror the children render from is refreshed with the new visit...
    await waitFor(() => expect(qc.getQueryData(['patientVisits', 'p1'])).toEqual(updated.visits), { timeout: 5000 });
    // ...via exactly one refetch (no loop).
    const callsAfterInvalidate = invoke.mock.calls.filter((c) => c[0] === 'getPatientContext').length;
    expect(callsAfterInvalidate).toBe(callsAfterLoad + 1);
  });
});
