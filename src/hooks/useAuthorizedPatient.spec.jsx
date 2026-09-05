import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';

const {
  authMe,
  invoke,
  patientGet,
  patientFilter,
  patientList,
} = vi.hoisted(() => ({
  authMe: vi.fn(),
  invoke: vi.fn(),
  patientGet: vi.fn(),
  patientFilter: vi.fn(),
  patientList: vi.fn(),
}));

vi.mock('@/api/base44Client', () => ({
  base44: {
    auth: { me: authMe },
    functions: { invoke },
    entities: {
      Patient: {
        get: patientGet,
        filter: patientFilter,
        list: patientList,
      },
    },
  },
  tenantAuthorityClient: {
    getMyTenantContext: (payload) => invoke('getMyTenantContext', payload),
  },
}));

const {
  authorizedPatientQueryKey,
  useAuthorizedPatient,
} = await import('./useAuthorizedPatient.js');
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
const patientScope = {
  agency_id: 'agency-a',
  membership_id: 'membership-a',
  membership_version: 7,
  tenant_role: 'clinician',
};
const alertPatient = {
  id: 'patient-a',
  first_name: 'Ada',
  last_name: 'Lovelace',
  status: 'active',
  primary_diagnosis: 'I10',
};

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
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function expectNoDirectPatientRead() {
  expect(patientGet).not.toHaveBeenCalled();
  expect(patientFilter).not.toHaveBeenCalled();
  expect(patientList).not.toHaveBeenCalled();
}

describe('useAuthorizedPatient', () => {
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
      if (name === 'getMyTenantContext') {
        return { data: { tenant_context: tenantContext } };
      }
      if (name === 'getAuthorizedPatient') {
        return {
          data: {
            success: true,
            purpose: 'alert_analysis',
            patient: alertPatient,
            scope: patientScope,
          },
        };
      }
      throw new Error(`Unexpected function: ${name}`);
    });
    patientGet.mockReset();
    patientFilter.mockReset();
    patientList.mockReset();
  });

  it('resolves tenant authority first and keys PHI by immutable scope identity', async () => {
    const { client, wrapper } = createHarness();
    const { result } = renderHook(() => useAuthorizedPatient({
      agencyId: 'agency-a',
      patientId: 'patient-a',
      purpose: 'alert_analysis',
    }), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual(alertPatient));
    expect(invoke.mock.calls.map(([name]) => name)).toEqual([
      'getMyTenantContext',
      'getAuthorizedPatient',
    ]);
    expect(client.getQueryCache().find({
      exact: true,
      queryKey: [
        'patient', 'patient-a', 'authorized-exact', 'alert_analysis',
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

    await act(async () => {
      await client.invalidateQueries({
        queryKey: ['patient', 'patient-a'],
        refetchType: 'none',
      });
    });
    expect(client.getQueryCache().find({
      exact: true,
      queryKey: [
        'patient', 'patient-a', 'authorized-exact', 'alert_analysis',
        'user-a', 'agency-a', 'membership-a', 7, 'clinician',
      ],
    })?.state.isInvalidated).toBe(true);
    expectNoDirectPatientRead();
  });

  it('fails closed on a purpose typo without issuing any Patient read', async () => {
    const { wrapper } = createHarness();
    const { result } = renderHook(() => useAuthorizedPatient({
      agencyId: 'agency-a',
      patientId: 'patient-a',
      purpose: 'alert_analaysis',
    }), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ message: 'purpose is invalid' });
    expect(authMe).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expectNoDirectPatientRead();
  });

  it('does not call the Patient broker when tenant resolution errors', async () => {
    invoke.mockRejectedValueOnce(new Error('tenant lookup unavailable'));
    const { wrapper } = createHarness();
    const { result } = renderHook(() => useAuthorizedPatient({
      agencyId: 'agency-a',
      patientId: 'patient-a',
      purpose: 'alert_analysis',
    }), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ message: 'tenant lookup unavailable' });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('getMyTenantContext', {
      agency_id: 'agency-a',
      expected_membership_id: 'membership-a',
      expected_membership_version: 7,
    });
    expectNoDirectPatientRead();
  });

  it('rejects a Patient response whose membership scope drifted', async () => {
    invoke.mockImplementation(async (name) => {
      if (name === 'getMyTenantContext') {
        return { data: { tenant_context: tenantContext } };
      }
      return {
        data: {
          success: true,
          purpose: 'alert_analysis',
          patient: alertPatient,
          scope: { ...patientScope, membership_id: 'membership-b' },
        },
      };
    });
    const { wrapper } = createHarness();
    const { result } = renderHook(() => useAuthorizedPatient({
      agencyId: 'agency-a',
      patientId: 'patient-a',
      purpose: 'alert_analysis',
    }), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({
      message: 'Patient authorization scope changed during lookup',
    });
    expect(invoke.mock.calls.map(([name]) => name)).toEqual([
      'getMyTenantContext',
      'getAuthorizedPatient',
    ]);
    expectNoDirectPatientRead();
  });

  it('rejects a cached tenant context for a different immutable user', async () => {
    invoke.mockResolvedValueOnce({
      data: {
        tenant_context: {
          ...tenantContext,
          user_id: 'user-b',
          membership_key: 'agency-a:user-b',
        },
      },
    });
    const { wrapper } = createHarness();
    const { result } = renderHook(() => useAuthorizedPatient({
      agencyId: 'agency-a',
      patientId: 'patient-a',
      purpose: 'alert_analysis',
    }), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error.message).toMatch(/integrity validation/);
    expect(invoke).toHaveBeenCalledTimes(1);
    expectNoDirectPatientRead();
  });

  it('requires an explicit agency selection before resolving any authority', async () => {
    const { wrapper } = createHarness();
    const { result } = renderHook(() => useAuthorizedPatient({
      patientId: 'patient-a',
      purpose: 'alert_analysis',
    }), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(result.current.tenantScope).toBeNull();
    expect(result.current.error).toMatchObject({
      message: 'agencyId is required; select an agency before loading patient data',
    });
    expect(authMe).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expectNoDirectPatientRead();
  });

  it('withholds data until identity, tenant, and Patient checks settle freshly', async () => {
    const authStep = deferred();
    const tenantStep = deferred();
    const patientStep = deferred();
    authMe.mockReturnValue(authStep.promise);
    invoke.mockImplementation((name) => {
      if (name === 'getMyTenantContext') return tenantStep.promise;
      if (name === 'getAuthorizedPatient') return patientStep.promise;
      throw new Error(`Unexpected function: ${name}`);
    });

    const { wrapper } = createHarness();
    const { result } = renderHook(() => useAuthorizedPatient({
      agencyId: 'agency-a',
      patientId: 'patient-a',
      purpose: 'alert_analysis',
    }), { wrapper });

    expect(result.current.data).toBeUndefined();
    expect(result.current.tenantScope).toBeNull();
    expect(result.current.isFetching).toBe(true);
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
    expect(invoke).toHaveBeenCalledTimes(1);

    await act(async () => {
      tenantStep.resolve({ data: { tenant_context: tenantContext } });
      await tenantStep.promise;
    });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      'getAuthorizedPatient',
      {
        agency_id: 'agency-a',
        patient_id: 'patient-a',
        purpose: 'alert_analysis',
      },
    ));
    expect(result.current.data).toBeUndefined();
    expect(result.current.tenantScope).toBeNull();
    expect(result.current.isFetching).toBe(true);

    await act(async () => {
      patientStep.resolve({
        data: {
          success: true,
          purpose: 'alert_analysis',
          patient: alertPatient,
          scope: patientScope,
        },
      });
      await patientStep.promise;
    });
    await waitFor(() => expect(result.current.data).toEqual(alertPatient));
    expect(result.current.isFetching).toBe(false);
    expect(result.current.isSuccess).toBe(true);
    expect(result.current.tenantScope).toEqual({
      user_id: 'user-a',
      ...patientScope,
    });
    expectNoDirectPatientRead();
  });

  it('hides and evicts seeded PHI when a background Patient grant recheck is denied', async () => {
    const { client, wrapper } = createHarness();
    const patientKey = authorizedPatientQueryKey({
      patientId: 'patient-a',
      purpose: 'alert_analysis',
      scope: { user_id: 'user-a', ...patientScope },
    });
    client.setQueryData(['currentUser'], { id: 'user-a' });
    client.setQueryData(
      ['tenant-context', 'authorized-patient', 'user-a', 'agency-a'],
      { tenant_context: tenantContext },
    );
    client.setQueryData(patientKey, alertPatient);
    invoke.mockImplementation(async (name) => {
      if (name === 'getMyTenantContext') {
        return { data: { tenant_context: tenantContext } };
      }
      if (name === 'getAuthorizedPatient') throw new Error('Patient grant revoked');
      throw new Error(`Unexpected function: ${name}`);
    });

    const exposedPatients = [];
    const { result } = renderHook(() => {
      const value = useAuthorizedPatient({
        agencyId: 'agency-a',
        patientId: 'patient-a',
        purpose: 'alert_analysis',
      });
      exposedPatients.push(value.data);
      return value;
    }, { wrapper });

    // The stale cache is hidden on the first render, before effects can run.
    expect(result.current.data).toBeUndefined();
    expect(result.current.tenantScope).toBeNull();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ message: 'Patient grant revoked' });
    expect(result.current.data).toBeUndefined();
    expect(exposedPatients.every((patient) => patient === undefined)).toBe(true);
    await waitFor(() => expect(client.getQueryData(patientKey)).toBeUndefined());
    expectNoDirectPatientRead();
  });

  it('does not treat a paused seeded-cache recheck as settled authorization', () => {
    const { client, wrapper } = createHarness();
    const patientKey = authorizedPatientQueryKey({
      patientId: 'patient-a',
      purpose: 'alert_analysis',
      scope: { user_id: 'user-a', ...patientScope },
    });
    client.setQueryData(['currentUser'], { id: 'user-a' });
    client.setQueryData(
      ['tenant-context', 'authorized-patient', 'user-a', 'agency-a'],
      { tenant_context: tenantContext },
    );
    client.setQueryData(patientKey, alertPatient);
    onlineManager.setOnline(false);

    const { result, unmount } = renderHook(() => useAuthorizedPatient({
      agencyId: 'agency-a',
      patientId: 'patient-a',
      purpose: 'alert_analysis',
    }), { wrapper });

    expect(result.current.isPaused).toBe(true);
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(result.current.tenantScope).toBeNull();
    expect(authMe).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(client.getQueryData(patientKey)).toEqual(alertPatient);
    expectNoDirectPatientRead();
    unmount();
  });

  it('never exposes prior-session PHI and clears it after identity transition', async () => {
    const { client, wrapper } = createHarness();
    const oldPatientKey = authorizedPatientQueryKey({
      patientId: 'patient-a',
      purpose: 'alert_analysis',
      scope: { user_id: 'user-a', ...patientScope },
    });
    const tenantContextB = {
      ...tenantContext,
      user_id: 'user-b',
      user_email: 'clinician-b@example.com',
      membership_id: 'membership-b',
      membership_key: 'agency-a:user-b',
      membership_version: 1,
    };
    const patientScopeB = {
      ...patientScope,
      membership_id: 'membership-b',
      membership_version: 1,
    };
    const patientB = {
      ...alertPatient,
      first_name: 'Grace',
      last_name: 'Hopper',
    };

    client.setQueryData(['currentUser'], { id: 'user-a' });
    client.setQueryData(
      ['tenant-context', 'authorized-patient', 'user-a', 'agency-a'],
      { tenant_context: tenantContext },
    );
    client.setQueryData(oldPatientKey, alertPatient);
    clearTrustedTenantContext();
    bindTrustedTenantContext(
      { id: 'user-b', email: 'clinician-b@example.com' },
      tenantContextB,
    );
    authMe.mockResolvedValue({ id: 'user-b', email: 'clinician-b@example.com' });
    invoke.mockImplementation(async (name) => {
      if (name === 'getMyTenantContext') {
        return { data: { tenant_context: tenantContextB } };
      }
      if (name === 'getAuthorizedPatient') {
        return {
          data: {
            success: true,
            purpose: 'alert_analysis',
            patient: patientB,
            scope: patientScopeB,
          },
        };
      }
      throw new Error(`Unexpected function: ${name}`);
    });

    const exposedNames = [];
    const { result } = renderHook(() => {
      const value = useAuthorizedPatient({
        agencyId: 'agency-a',
        patientId: 'patient-a',
        purpose: 'alert_analysis',
      });
      exposedNames.push(value.data?.first_name);
      return value;
    }, { wrapper });

    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.data).toEqual(patientB));
    expect(exposedNames).not.toContain('Ada');
    await waitFor(() => expect(client.getQueryData(oldPatientKey)).toBeUndefined());
    expect(client.getQueryData(authorizedPatientQueryKey({
      patientId: 'patient-a',
      purpose: 'alert_analysis',
      scope: { user_id: 'user-b', ...patientScopeB },
    }))).toEqual(patientB);
    expectNoDirectPatientRead();
  });
});
