import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';

const {
  authMe,
  invoke,
  visitGet,
  visitFilter,
  visitList,
} = vi.hoisted(() => ({
  authMe: vi.fn(),
  invoke: vi.fn(),
  visitGet: vi.fn(),
  visitFilter: vi.fn(),
  visitList: vi.fn(),
}));

vi.mock('@/api/base44Client', () => ({
  base44: {
    auth: { me: authMe },
    functions: { invoke },
    entities: {
      Visit: {
        get: visitGet,
        filter: visitFilter,
        list: visitList,
      },
    },
  },
  tenantAuthorityClient: {
    getMyTenantContext: (payload) => invoke('getMyTenantContext', payload),
  },
}));

const {
  authorizedVisitQueryKey,
  useAuthorizedVisit,
} = await import('./useAuthorizedVisit.js');
const {
  bindTrustedTenantContext,
  clearTrustedTenantContext,
} = await import('@/lib/roles.js');

const tenantContext = {
  user_id: 'user-a',
  user_email: 'clinician@example.com',
  membership_id: 'membership-a',
  membership_key: 'agency-a:user-a',
  membership_version: 7,
  agency_id: 'agency-a',
  tenant_role: 'clinician',
  membership_status: 'active',
  is_platform_owner: false,
  agency: { id: 'agency-a', name: 'Agency A', status: 'active' },
};
const visitScope = {
  agency_id: 'agency-a',
  membership_id: 'membership-a',
  membership_version: 7,
  tenant_role: 'clinician',
  patient_id: 'patient-a',
  access_basis: 'care_team_assignment',
  assignment_id: 'assignment-a',
  assignment_version: 3,
};
const authorizedVisit = {
  id: 'visit-a',
  patient_id: 'patient-a',
  visit_date: '2026-09-07',
  visit_type: 'routine_visit',
  status: 'completed',
  nurse_notes: 'Authorized clinical note.',
  emr_handoff_status: 'not_started',
  emr_handoff_history: [],
  documentation_review_ack: {
    acknowledged: true,
    acknowledged_by: 'clinician@example.com',
    acknowledged_at: '2026-09-07T12:00:00.000Z',
    note_hash: 'a'.repeat(64),
    note_length: 25,
    ai_assisted: true,
    nurse_edited: false,
    statement: 'Reviewed.',
    is_clinical_signature: false,
  },
  updated_date: '2026-09-07T12:00:00.000Z',
};

function tenantResponse(context = tenantContext) {
  return { data: { tenant_context: context } };
}

function visitResponse({ visit = authorizedVisit, scope = visitScope } = {}) {
  return {
    data: {
      success: true,
      purpose: 'documentation',
      visit,
      scope,
    },
  };
}

function createHarness() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
  });
  const wrapper = ({ children }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

function deferred() {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function expectNoDirectVisitRead() {
  expect(visitGet).not.toHaveBeenCalled();
  expect(visitFilter).not.toHaveBeenCalled();
  expect(visitList).not.toHaveBeenCalled();
}

describe('useAuthorizedVisit', () => {
  afterEach(() => {
    clearTrustedTenantContext();
    onlineManager.setOnline(true);
  });

  beforeEach(() => {
    clearTrustedTenantContext();
    bindTrustedTenantContext(
      { id: 'user-a', email: 'clinician@example.com' },
      tenantContext,
    );
    authMe.mockReset().mockResolvedValue({
      id: 'user-a',
      email: 'clinician@example.com',
    });
    invoke.mockReset().mockImplementation(async (name) => {
      if (name === 'getMyTenantContext') return tenantResponse();
      if (name === 'getAuthorizedVisit') return visitResponse();
      throw new Error(`Unexpected function: ${name}`);
    });
    visitGet.mockReset();
    visitFilter.mockReset();
    visitList.mockReset();
  });

  it('resolves tenant authority first and keys Visit PHI by immutable scope identity', async () => {
    const { client, wrapper } = createHarness();
    const { result } = renderHook(() => useAuthorizedVisit({
      agencyId: 'agency-a',
      visitId: 'visit-a',
      purpose: 'documentation',
    }), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual(authorizedVisit));
    expect(invoke.mock.calls.map(([name]) => name)).toEqual([
      'getMyTenantContext',
      'getAuthorizedVisit',
    ]);
    expect(client.getQueryCache().find({
      exact: true,
      queryKey: [
        'visit', 'visit-a', 'authorized-exact', 'documentation',
        'user-a', 'agency-a', 'membership-a', 7, 'clinician',
      ],
    })).toBeTruthy();

    const protectedQueries = client.getQueryCache().findAll()
      .filter((query) => (
        (query.queryKey[0] === 'tenant-context' && query.queryKey[2] === 'user-a')
        || (query.queryKey[2] === 'authorized-exact' && query.queryKey[4] === 'user-a')
      ));
    expect(protectedQueries).toHaveLength(2);
    for (const query of protectedQueries) {
      expect(query.options.refetchOnWindowFocus).toBe('always');
      expect(query.options.refetchOnReconnect).toBe('always');
    }
    expectNoDirectVisitRead();
  });

  it('fails closed on invalid input before issuing any authority or Visit read', async () => {
    const { wrapper } = createHarness();
    const { result } = renderHook(() => useAuthorizedVisit({
      agencyId: 'agency-a',
      visitId: 'visit-a',
      purpose: 'documentaiton',
    }), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toMatchObject({ message: 'purpose is invalid' });
    expect(authMe).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expectNoDirectVisitRead();
  });

  it('does not call the Visit broker when tenant resolution errors', async () => {
    invoke.mockRejectedValueOnce(new Error('tenant lookup unavailable'));
    const { wrapper } = createHarness();
    const { result } = renderHook(() => useAuthorizedVisit({
      agencyId: 'agency-a',
      visitId: 'visit-a',
      purpose: 'documentation',
    }), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toMatchObject({ message: 'tenant lookup unavailable' });
    expect(invoke).toHaveBeenCalledTimes(1);
    expectNoDirectVisitRead();
  });

  it('rejects a Visit response whose immutable membership scope drifted', async () => {
    invoke.mockImplementation(async (name) => {
      if (name === 'getMyTenantContext') return tenantResponse();
      if (name === 'getAuthorizedVisit') {
        return visitResponse({
          scope: {
            ...visitScope,
            membership_id: 'membership-b',
            membership_version: 1,
          },
        });
      }
      throw new Error(`Unexpected function: ${name}`);
    });
    const { wrapper } = createHarness();
    const { result } = renderHook(() => useAuthorizedVisit({
      agencyId: 'agency-a',
      visitId: 'visit-a',
      purpose: 'documentation',
    }), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toMatchObject({
      message: 'Visit authorization scope changed during lookup',
    });
    expectNoDirectVisitRead();
  });

  it('withholds data until identity, tenant, and exact Visit checks each settle freshly', async () => {
    const authStep = deferred();
    const tenantStep = deferred();
    const visitStep = deferred();
    authMe.mockReturnValue(authStep.promise);
    invoke.mockImplementation((name) => {
      if (name === 'getMyTenantContext') return tenantStep.promise;
      if (name === 'getAuthorizedVisit') return visitStep.promise;
      throw new Error(`Unexpected function: ${name}`);
    });
    const { wrapper } = createHarness();
    const { result } = renderHook(() => useAuthorizedVisit({
      agencyId: 'agency-a',
      visitId: 'visit-a',
      purpose: 'documentation',
    }), { wrapper });

    expect(result.current.data).toBeUndefined();
    expect(result.current.tenantScope).toBeNull();
    expect(invoke).not.toHaveBeenCalled();

    await act(async () => {
      authStep.resolve({ id: 'user-a', email: 'clinician@example.com' });
      await authStep.promise;
    });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      'getMyTenantContext',
      {
        agency_id: 'agency-a',
        expected_membership_id: 'membership-a',
        expected_membership_version: 7,
      },
    ));
    expect(result.current.data).toBeUndefined();
    expect(result.current.tenantScope).toBeNull();

    await act(async () => {
      tenantStep.resolve(tenantResponse());
      await tenantStep.promise;
    });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      'getAuthorizedVisit',
      {
        agency_id: 'agency-a',
        visit_id: 'visit-a',
        purpose: 'documentation',
      },
    ));
    expect(result.current.data).toBeUndefined();
    expect(result.current.tenantScope).toBeNull();

    await act(async () => {
      visitStep.resolve(visitResponse());
      await visitStep.promise;
    });
    await waitFor(() => expect(result.current.data).toEqual(authorizedVisit));
    expect(result.current.tenantScope).toEqual({
      user_id: 'user-a',
      agency_id: 'agency-a',
      membership_id: 'membership-a',
      membership_version: 7,
      tenant_role: 'clinician',
    });
    expectNoDirectVisitRead();
  });

  it('hides and evicts Visit PHI when an exact grant is revoked after success', async () => {
    let visitCalls = 0;
    const revoked = deferred();
    invoke.mockImplementation((name) => {
      if (name === 'getMyTenantContext') return Promise.resolve(tenantResponse());
      if (name === 'getAuthorizedVisit') {
        visitCalls += 1;
        return visitCalls === 1 ? Promise.resolve(visitResponse()) : revoked.promise;
      }
      throw new Error(`Unexpected function: ${name}`);
    });
    const { client, wrapper } = createHarness();
    const key = authorizedVisitQueryKey({
      visitId: 'visit-a',
      purpose: 'documentation',
      scope: { user_id: 'user-a', ...visitScope },
    });
    const exposedNotes = [];
    const { result } = renderHook(() => {
      const value = useAuthorizedVisit({
        agencyId: 'agency-a',
        visitId: 'visit-a',
        purpose: 'documentation',
      });
      exposedNotes.push(value.data?.nurse_notes);
      return value;
    }, { wrapper });

    await waitFor(() => expect(result.current.data).toEqual(authorizedVisit));
    act(() => {
      void client.invalidateQueries({ queryKey: key, exact: true });
    });
    await waitFor(() => expect(visitCalls).toBe(2));
    expect(result.current.data).toBeUndefined();
    expect(result.current.tenantScope).toBeNull();

    await act(async () => {
      revoked.reject(new Error('Visit grant revoked'));
      await revoked.promise.catch(() => {});
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ message: 'Visit grant revoked' });
    expect(result.current.data).toBeUndefined();
    expect(exposedNotes.slice(0, -1)).toContain('Authorized clinical note.');
    expect(exposedNotes.at(-1)).toBeUndefined();
    await waitFor(() => expect(client.getQueryData(key)).toBeUndefined());
    expectNoDirectVisitRead();
  });

  it('withholds a prior Visit during a normal recheck and restores it only after fresh success', async () => {
    let visitCalls = 0;
    const recheck = deferred();
    invoke.mockImplementation((name) => {
      if (name === 'getMyTenantContext') return Promise.resolve(tenantResponse());
      if (name === 'getAuthorizedVisit') {
        visitCalls += 1;
        return visitCalls === 1 ? Promise.resolve(visitResponse()) : recheck.promise;
      }
      throw new Error(`Unexpected function: ${name}`);
    });
    const { client, wrapper } = createHarness();
    const key = authorizedVisitQueryKey({
      visitId: 'visit-a',
      purpose: 'documentation',
      scope: { user_id: 'user-a', ...visitScope },
    });
    const { result } = renderHook(() => useAuthorizedVisit({
      agencyId: 'agency-a',
      visitId: 'visit-a',
      purpose: 'documentation',
    }), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual(authorizedVisit));
    act(() => {
      void client.invalidateQueries({ queryKey: key, exact: true });
    });
    await waitFor(() => expect(visitCalls).toBe(2));
    expect(result.current.data).toBeUndefined();
    expect(result.current.isPending).toBe(true);

    await act(async () => {
      recheck.resolve(visitResponse());
      await recheck.promise;
    });
    await waitFor(() => expect(result.current.data).toEqual(authorizedVisit));
    expect(result.current.isSuccess).toBe(true);
    expectNoDirectVisitRead();
  });

  it('withholds and evicts Visit PHI when tenant authority is revoked after success', async () => {
    let tenantCalls = 0;
    const revoked = deferred();
    invoke.mockImplementation((name) => {
      if (name === 'getMyTenantContext') {
        tenantCalls += 1;
        return tenantCalls === 1 ? Promise.resolve(tenantResponse()) : revoked.promise;
      }
      if (name === 'getAuthorizedVisit') return Promise.resolve(visitResponse());
      throw new Error(`Unexpected function: ${name}`);
    });
    const { client, wrapper } = createHarness();
    const key = authorizedVisitQueryKey({
      visitId: 'visit-a',
      purpose: 'documentation',
      scope: { user_id: 'user-a', ...visitScope },
    });
    const { result } = renderHook(() => useAuthorizedVisit({
      agencyId: 'agency-a',
      visitId: 'visit-a',
      purpose: 'documentation',
    }), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual(authorizedVisit));
    act(() => {
      void client.invalidateQueries({ queryKey: ['tenant-context', 'authorized-visit'] });
    });
    await waitFor(() => expect(tenantCalls).toBe(2));
    expect(result.current.data).toBeUndefined();
    expect(result.current.tenantScope).toBeNull();

    await act(async () => {
      revoked.reject(new Error('membership revoked'));
      await revoked.promise.catch(() => {});
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ message: 'membership revoked' });
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(client.getQueryData(key)).toBeUndefined());
    expectNoDirectVisitRead();
  });

  it('never treats paused cached Visit PHI as settled authorization', async () => {
    const { client, wrapper } = createHarness();
    const key = authorizedVisitQueryKey({
      visitId: 'visit-a',
      purpose: 'documentation',
      scope: { user_id: 'user-a', ...visitScope },
    });
    client.setQueryData(key, authorizedVisit);
    onlineManager.setOnline(false);

    const { result, unmount } = renderHook(() => useAuthorizedVisit({
      agencyId: 'agency-a',
      visitId: 'visit-a',
      purpose: 'documentation',
    }), { wrapper });

    expect(result.current.data).toBeUndefined();
    expect(result.current.tenantScope).toBeNull();
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.isPaused).toBe(true);
    expect(client.getQueryData(key)).toEqual(authorizedVisit);
    expect(authMe).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expectNoDirectVisitRead();
    unmount();
  });
});

describe('exact Visit consumers', () => {
  it.each([
    'src/pages/SmartNoteAssistant.jsx',
    'src/components/visit/AudioVisitCapture.jsx',
  ])('%s uses the fail-closed hook and clears its bound Visit state before paint', (file) => {
    const source = readFileSync(resolve(process.cwd(), file), 'utf8');
    expect(source).toMatch(/useAuthorizedVisit\s*\(\s*\{[\s\S]*?purpose:\s*'documentation'/);
    expect(source).not.toMatch(/\bgetAuthorizedVisit\s*\(/);
    expect(source).toMatch(/useLayoutEffect\s*\(\s*\(\)\s*=>\s*\{[\s\S]*?boundVisitLocalRef\.current\s*=\s*null/);
    expect(source).toMatch(/setExistingVisitId\(null\)/);
    expect(source).toMatch(/setPatientId\(\(current\)\s*=>/);
    expect(source).toMatch(/setVisitType\(\(current\)\s*=>/);
    expect(source).toMatch(/visitAuthorizationWithheld/);
    expect(source).toMatch(/noteHistoryQuery\.isFetchedAfterMount[\s\S]*?noteHistoryQuery\.fetchStatus\s*===\s*'idle'/);
    expect(source).not.toMatch(/patientDetail\s*\|\|\s*patient/);
    expect(source).not.toMatch(/patient\?\.primary_diagnosis/);
  });

  it('guards Smart Note draft persistence while a normal Visit recheck is withholding authority', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/pages/SmartNoteAssistant.jsx'),
      'utf8',
    );
    expect(source).toMatch(/useEffect\(\(\)\s*=>\s*\{\s*if \(visitAuthorizationWithheld\) return;[\s\S]*?const prev = prevPatientRef\.current/);
    expect(source).toMatch(/useEffect\(\(\)\s*=>\s*\{\s*if \(visitAuthorizationWithheld\) return;[\s\S]*?const pid = patientIdRef\.current/);
  });
});
