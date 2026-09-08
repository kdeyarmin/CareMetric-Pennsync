import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { act, screen, waitFor } from '@testing-library/react';
import { QueryClient, onlineManager } from '@tanstack/react-query';
import { useLocation } from 'react-router';
import { renderWithProviders } from '@/test/testUtils';

const mocks = vi.hoisted(() => ({
  listAuthorizedVisits: vi.fn(),
  logActivity: vi.fn(),
  patientResult: null,
  useAuthorizedPatient: vi.fn((options) => {
    mocks.lastPatientOptions = options;
    mocks.patientOptions.push(options);
    return mocks.patientResult;
  }),
  lastPatientOptions: null,
  patientOptions: [],
  routeScopeResult: null,
  usePatientDetailsRouteScope: vi.fn((options) => {
    mocks.lastRouteScopeOptions = options;
    return mocks.routeScopeResult;
  }),
  lastRouteScopeOptions: null,
}));

vi.mock('@/functions/listAuthorizedVisits', () => ({
  listAuthorizedVisits: mocks.listAuthorizedVisits,
}));

vi.mock('@/hooks/useAuthorizedPatient', () => ({
  useAuthorizedPatient: mocks.useAuthorizedPatient,
}));

vi.mock('@/hooks/usePatientDetailsRouteScope', () => ({
  usePatientDetailsRouteScope: mocks.usePatientDetailsRouteScope,
}));

vi.mock('@/components/utils/activityLogger', () => ({
  ActivityActions: { VIEW: 'view' },
  logActivity: mocks.logActivity,
}));

const PATIENT = {
  id: 'patient-a',
  first_name: 'Ada',
  middle_name: '',
  last_name: 'Lovelace',
};
const SCOPE = {
  agency_id: 'agency-a',
  membership_id: 'membership-a',
  membership_version: 2,
  tenant_role: 'clinician',
  patient_id: 'patient-a',
  access_basis: 'care_team_assignment',
  assignment_id: 'assignment-a',
  assignment_version: 4,
};

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function queryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function visitPage(scope = SCOPE, visits = [{
  id: 'visit-a',
  patient_id: 'patient-a',
  visit_date: '2026-09-04',
  visit_type: 'skilled_nursing',
  status: 'scheduled',
  updated_date: '2026-09-04T12:00:00.000Z',
}]) {
  return {
    success: true,
    purpose: 'schedule',
    visits,
    scope,
    page: {
      page_size: 50,
      sort: 'id_asc',
      after_id: null,
      has_more: false,
      next_cursor: null,
    },
  };
}

beforeEach(() => {
  mocks.listAuthorizedVisits.mockReset();
  mocks.logActivity.mockReset();
  mocks.useAuthorizedPatient.mockClear();
  mocks.usePatientDetailsRouteScope.mockClear();
  mocks.lastPatientOptions = null;
  mocks.patientOptions = [];
  mocks.lastRouteScopeOptions = null;
  mocks.routeScopeResult = {
    agencyId: null,
    error: null,
    isError: false,
    isFetching: true,
    isPaused: false,
    isPending: true,
    isSuccess: false,
    status: 'pending',
  };
  mocks.patientResult = {
    data: PATIENT,
    error: null,
    isError: false,
    isFetchedAfterMount: true,
    isFetching: false,
    isLoading: false,
    isPaused: false,
    isSuccess: true,
    fetchStatus: 'idle',
    tenantScope: {
      user_id: 'user-a',
      agency_id: 'agency-a',
      membership_id: 'membership-a',
      membership_version: 2,
      tenant_role: 'clinician',
    },
  };
  mocks.listAuthorizedVisits.mockResolvedValue(visitPage());
});

describe('PatientDetails purpose-bound chart gate', () => {
  it('authorizes Patient and Visit reads before auditing and mounts no PHI panels', async () => {
    const qc = queryClient();
    const { default: PatientDetails } = await import('@/pages/PatientDetails');
    renderWithProviders(<PatientDetails />, {
      queryClient: qc,
      route: '/PatientDetails?id=patient-a&agencyId=agency-a',
    });

    expect(mocks.lastPatientOptions).toEqual({
      patientId: 'patient-a',
      agencyId: 'agency-a',
      purpose: 'display',
      enabled: true,
    });
    expect(mocks.lastRouteScopeOptions).toEqual({ enabled: false });
    await waitFor(() => expect(mocks.listAuthorizedVisits).toHaveBeenCalledWith({
      agencyId: 'agency-a',
      patientId: 'patient-a',
      purpose: 'schedule',
      status: null,
      sort: 'id_asc',
      pageSize: 50,
      cursor: null,
    }));
    expect(await screen.findByText('Patient details temporarily unavailable')).toBeInTheDocument();
    await waitFor(() => expect(mocks.logActivity).toHaveBeenCalledTimes(1));
    const visitAuthorizationKey = [
      'patient-details',
      'visit-authorization',
      'patient-a',
      'user-a',
      'agency-a',
      'membership-a',
      2,
      'clinician',
    ];
    expect(qc.getQueryCache().getAll().map((query) => query.queryKey))
      .toContainEqual(visitAuthorizationKey);
    const cachedAuthorization = qc.getQueryData(visitAuthorizationKey);
    expect(Object.keys(cachedAuthorization).sort()).toEqual([
      'authorityFingerprint',
      'authorizedCount',
    ]);
    expect(cachedAuthorization).not.toHaveProperty('visits');

    expect(qc.getQueryData(['patient', 'patient-a'])).toBeUndefined();
    expect(qc.getQueryData(['patientVisits', 'patient-a'])).toBeUndefined();
    expect(qc.getQueryData(['patientIncidents', 'patient-a'])).toBeUndefined();
    expect(qc.getQueryData(['patientTasks', 'patient-a'])).toBeUndefined();
    expect(qc.getQueryData(['patientActiveAlerts', 'patient-a'])).toBeUndefined();
    expect(screen.queryByText(/Ada|Lovelace/)).not.toBeInTheDocument();
    expect(screen.queryByText(/OASIS assessment/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Fax Document/i)).not.toBeInTheDocument();
  });

  it('shows verification and requests no PHI while implicit route scope is pending', async () => {
    const { default: PatientDetails } = await import('@/pages/PatientDetails');
    renderWithProviders(<PatientDetails />, {
      queryClient: queryClient(),
      route: '/PatientDetails?id=patient-a',
    });

    expect(await screen.findByText('Verifying chart access')).toBeInTheDocument();
    expect(mocks.lastRouteScopeOptions).toEqual({ enabled: true });
    expect(mocks.lastPatientOptions.enabled).toBe(false);
    expect(mocks.listAuthorizedVisits).not.toHaveBeenCalled();
    expect(mocks.logActivity).not.toHaveBeenCalled();
  });

  it('keeps scope errors and unscoped users on a no-read context-required state', async () => {
    mocks.routeScopeResult = {
      ...mocks.routeScopeResult,
      error: new Error('Tenant membership is ambiguous'),
      isError: true,
      isFetching: false,
      isPending: false,
      status: 'error',
    };
    const { default: PatientDetails } = await import('@/pages/PatientDetails');
    renderWithProviders(<PatientDetails />, {
      queryClient: queryClient(),
      route: '/PatientDetails?id=patient-a',
    });

    expect(await screen.findByText('Chart context required')).toBeInTheDocument();
    expect(mocks.lastRouteScopeOptions).toEqual({ enabled: true });
    expect(mocks.lastPatientOptions.enabled).toBe(false);
    expect(mocks.listAuthorizedVisits).not.toHaveBeenCalled();
    expect(mocks.logActivity).not.toHaveBeenCalled();
  });

  it('bypasses implicit scope resolution when an agency parameter is explicit', async () => {
    const { default: PatientDetails } = await import('@/pages/PatientDetails');
    renderWithProviders(<PatientDetails />, {
      queryClient: queryClient(),
      route: '/PatientDetails?id=patient-a&agencyId=agency-a',
    });

    expect(mocks.lastRouteScopeOptions).toEqual({ enabled: false });
    expect(mocks.lastPatientOptions).toEqual(expect.objectContaining({
      agencyId: 'agency-a',
      enabled: true,
    }));
    await waitFor(() => expect(mocks.listAuthorizedVisits).toHaveBeenCalledTimes(1));
  });

  it('encodes the singleton scope in a replace navigation before starting Patient auth', async () => {
    const patientId = 'patient /?&=one';
    const agencyId = 'agency /?&=two';
    mocks.routeScopeResult = {
      ...mocks.routeScopeResult,
      agencyId,
      isFetching: false,
      isPending: false,
      isSuccess: true,
      status: 'success',
    };
    mocks.patientResult = {
      ...mocks.patientResult,
      data: undefined,
      isFetchedAfterMount: false,
      isSuccess: false,
      tenantScope: null,
    };
    const initialSearch = new URLSearchParams({ id: patientId }).toString();
    const expectedSearch = new URLSearchParams({ id: patientId, agencyId }).toString();
    const { default: PatientDetails } = await import('@/pages/PatientDetails');
    renderWithProviders(
      <>
        <PatientDetails />
        <LocationProbe />
      </>,
      {
        queryClient: queryClient(),
        route: `/PatientDetails?${initialSearch}`,
      },
    );

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(
      `/PatientDetails?${expectedSearch}`,
    ));
    expect(mocks.patientOptions[0]).toEqual({
      patientId,
      agencyId: null,
      purpose: 'display',
      enabled: false,
    });
    expect(mocks.lastPatientOptions).toEqual({
      patientId,
      agencyId,
      purpose: 'display',
      enabled: true,
    });
    expect(mocks.listAuthorizedVisits).not.toHaveBeenCalled();
    expect(mocks.logActivity).not.toHaveBeenCalled();
  });

  it('redirects a singleton route, then freshly authorizes Patient and Visit reads', async () => {
    mocks.routeScopeResult = {
      ...mocks.routeScopeResult,
      agencyId: 'agency-a',
      isFetching: false,
      isPending: false,
      isSuccess: true,
      status: 'success',
    };
    const { default: PatientDetails } = await import('@/pages/PatientDetails');
    renderWithProviders(
      <>
        <PatientDetails />
        <LocationProbe />
      </>,
      {
        queryClient: queryClient(),
        route: '/PatientDetails?id=patient-a',
      },
    );

    expect(mocks.patientOptions[0]).toEqual({
      patientId: 'patient-a',
      agencyId: null,
      purpose: 'display',
      enabled: false,
    });
    await waitFor(() => expect(mocks.listAuthorizedVisits).toHaveBeenCalledWith({
      agencyId: 'agency-a',
      patientId: 'patient-a',
      purpose: 'schedule',
      status: null,
      sort: 'id_asc',
      pageSize: 50,
      cursor: null,
    }));
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/PatientDetails?id=patient-a&agencyId=agency-a',
    );
    expect(mocks.lastPatientOptions).toEqual({
      patientId: 'patient-a',
      agencyId: 'agency-a',
      purpose: 'display',
      enabled: true,
    });
    expect(await screen.findByText('Patient details temporarily unavailable')).toBeInTheDocument();
    await waitFor(() => expect(mocks.logActivity).toHaveBeenCalledTimes(1));
  });

  it('emits no audit when Visit authorization fails', async () => {
    mocks.listAuthorizedVisits.mockRejectedValue(new Error('Forbidden'));
    const { default: PatientDetails } = await import('@/pages/PatientDetails');
    renderWithProviders(<PatientDetails />, {
      queryClient: queryClient(),
      route: '/PatientDetails?id=patient-a&agency_id=agency-a',
    });

    expect(await screen.findByText('Patient details unavailable')).toBeInTheDocument();
    expect(mocks.logActivity).not.toHaveBeenCalled();
  });

  it('fails closed when Patient and Visit membership authority differ', async () => {
    mocks.listAuthorizedVisits.mockResolvedValue(visitPage({
      ...SCOPE,
      membership_version: 3,
    }));
    const { default: PatientDetails } = await import('@/pages/PatientDetails');
    renderWithProviders(<PatientDetails />, {
      queryClient: queryClient(),
      route: '/PatientDetails?id=patient-a&agencyId=agency-a',
    });

    expect(await screen.findByText('Patient details unavailable')).toBeInTheDocument();
    expect(mocks.logActivity).not.toHaveBeenCalled();
  });

  it('fails closed when a Visit page contains a row for another patient', async () => {
    mocks.listAuthorizedVisits.mockResolvedValue(visitPage(SCOPE, [{
      id: 'visit-cross-patient',
      patient_id: 'patient-b',
      visit_date: '2026-09-04',
      visit_type: 'skilled_nursing',
      status: 'scheduled',
      updated_date: '2026-09-04T12:00:00.000Z',
    }]));
    const { default: PatientDetails } = await import('@/pages/PatientDetails');
    renderWithProviders(<PatientDetails />, {
      queryClient: queryClient(),
      route: '/PatientDetails?id=patient-a&agencyId=agency-a',
    });

    expect(await screen.findByText('Patient details unavailable')).toBeInTheDocument();
    expect(mocks.logActivity).not.toHaveBeenCalled();
  });

  it('does not render or audit cached Visit success during its mandatory background recheck', async () => {
    const qc = queryClient();
    qc.setQueryData([
      'patient-details',
      'visit-authorization',
      'patient-a',
      'user-a',
      'agency-a',
      'membership-a',
      2,
      'clinician',
    ], {
      authorizedCount: 1,
      authorityFingerprint: 'previous-proof',
    });
    mocks.listAuthorizedVisits.mockImplementation(() => new Promise(() => {}));
    const { default: PatientDetails } = await import('@/pages/PatientDetails');
    const { unmount } = renderWithProviders(<PatientDetails />, {
      queryClient: qc,
      route: '/PatientDetails?id=patient-a&agencyId=agency-a',
    });

    try {
      await waitFor(() => expect(mocks.listAuthorizedVisits).toHaveBeenCalledTimes(1));
      expect(await screen.findByText('Verifying chart access')).toBeInTheDocument();
      expect(screen.queryByText('Patient details temporarily unavailable')).not.toBeInTheDocument();
      expect(screen.queryByText(/Ada|Lovelace/)).not.toBeInTheDocument();
      expect(mocks.logActivity).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });

  it('does not render, fetch, or audit while Visit authorization is offline-paused', async () => {
    onlineManager.setOnline(false);
    const { default: PatientDetails } = await import('@/pages/PatientDetails');
    const { unmount } = renderWithProviders(<PatientDetails />, {
      queryClient: queryClient(),
      route: '/PatientDetails?id=patient-a&agencyId=agency-a',
    });

    try {
      expect(await screen.findByText('Verifying chart access')).toBeInTheDocument();
      expect(mocks.listAuthorizedVisits).not.toHaveBeenCalled();
      expect(screen.queryByText('Patient details temporarily unavailable')).not.toBeInTheDocument();
      expect(mocks.logActivity).not.toHaveBeenCalled();
    } finally {
      unmount();
      onlineManager.setOnline(true);
    }
  });

  it('re-authorizes and records fresh UI activity when the immutable subject user changes', async () => {
    let triggerRender;
    function Harness() {
      const [, setRevision] = useState(0);
      triggerRender = () => setRevision((revision) => revision + 1);
      return <PatientDetails />;
    }
    const { default: PatientDetails } = await import('@/pages/PatientDetails');
    renderWithProviders(<Harness />, {
      queryClient: queryClient(),
      route: '/PatientDetails?id=patient-a&agencyId=agency-a',
    });
    await waitFor(() => expect(mocks.logActivity).toHaveBeenCalledTimes(1));

    mocks.patientResult = {
      ...mocks.patientResult,
      tenantScope: {
        ...mocks.patientResult.tenantScope,
        user_id: 'user-b',
      },
    };
    act(() => triggerRender());

    await waitFor(() => expect(mocks.listAuthorizedVisits).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.logActivity).toHaveBeenCalledTimes(2));
  });

  it('does not fetch a 101st page after the reviewed 5,000-Visit limit', async () => {
    let page = 0;
    mocks.listAuthorizedVisits.mockImplementation(async () => {
      page += 1;
      const result = visitPage(SCOPE, Array.from({ length: 50 }, (_, index) => ({
        id: `visit-${String((page - 1) * 50 + index).padStart(5, '0')}`,
        patient_id: 'patient-a',
        visit_date: '2026-09-04',
        visit_type: 'skilled_nursing',
        status: 'scheduled',
        updated_date: '2026-09-04T12:00:00.000Z',
      })));
      result.page = {
        page_size: 50,
        sort: 'id_asc',
        after_id: page === 1 ? null : `visit-${String((page - 1) * 50 - 1).padStart(5, '0')}`,
        has_more: true,
        next_cursor: { after_id: `visit-${String(page * 50 - 1).padStart(5, '0')}` },
      };
      return result;
    });
    const { authorizeVisitSchedule } = await import('@/pages/PatientDetails');

    await expect(authorizeVisitSchedule({
      agencyId: 'agency-a',
      patientId: 'patient-a',
      tenantScope: mocks.patientResult.tenantScope,
    })).rejects.toThrow('reviewed chart limit');
    expect(mocks.listAuthorizedVisits).toHaveBeenCalledTimes(100);
  });
});
