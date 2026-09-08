import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { act, fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/testUtils';

const authorization = vi.hoisted(() => ({
  patientQuery: null,
  visitQuery: null,
  forceRender: null,
  rosterFilterRenders: [],
  dashboardFilterRenders: [],
  emptyStateRenders: [],
}));

vi.mock('@/api/base44Client', () => ({
  base44: {
    auth: {
      me: vi.fn(async () => ({ id: 'user-a', email: 'clinician@example.com' })),
    },
    functions: {
      invoke: vi.fn(async () => ({ data: { alerts: [] } })),
    },
  },
}));

vi.mock('@/hooks/useScopedPatients', () => ({
  excludeArchived: (patients) => patients,
  invalidateAuthorizedPatientLists: vi.fn(),
  useScopedPatients: () => authorization.patientQuery,
}));

vi.mock('@/hooks/useAuthorizedVisits', () => ({
  invalidateAuthorizedVisitLists: vi.fn(),
  useAuthorizedVisits: () => authorization.visitQuery,
}));

vi.mock('@/hooks/usePatientDetailsRouteScope', () => ({
  usePatientDetailsRouteScope: () => ({ agencyId: 'agency-a' }),
}));

vi.mock('@/components/ui/PageContainer', () => ({
  default: ({ children }) => <main>{children}</main>,
}));

vi.mock('@/components/ui/PageHeader', () => ({
  default: ({ title, actions }) => (
    <header>
      <h1>{title}</h1>
      {actions}
    </header>
  ),
}));

vi.mock('@/components/ui/stat-card', () => ({
  default: ({ label, value, description }) => (
    <div data-testid={`stat-${label}`}>
      {label}: {String(value)} {description || ''}
    </div>
  ),
}));

vi.mock('@/components/ui/empty-state', () => ({
  default: ({ title, description }) => {
    authorization.emptyStateRenders.push(title);
    return (
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    );
  },
}));

vi.mock('@/components/ui/LoadingState', () => ({
  default: ({ label }) => <div>{label}</div>,
}));

vi.mock('@/components/ui/VirtualList', () => ({
  default: () => null,
}));

vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children }) => <div>{children}</div>,
}));

vi.mock('../components/utils/activityLogger', () => ({
  ActivityActions: { PAGE_VISIT: 'page_visit' },
  logActivity: vi.fn(),
}));

vi.mock('../components/patient/PatientForm', () => ({
  default: ({ patient }) => (
    <div data-testid="patient-form">
      {patient ? `Editing ${patient.first_name} ${patient.last_name}` : 'New patient form'}
    </div>
  ),
}));

vi.mock('../components/patient/AdvancedPatientFilters', () => ({
  default: ({ activeFilters = {}, onFilterChange }) => {
    authorization.rosterFilterRenders.push({
      search: activeFilters.search || '',
      diagnosis: activeFilters.diagnosis || '',
    });
    return (
      <div>
        <label>
          Roster search
          <input
            aria-label="Roster search"
            value={activeFilters.search || ''}
            onChange={(event) => onFilterChange({
              ...activeFilters,
              search: event.target.value,
            })}
          />
        </label>
        <label>
          Roster diagnosis
          <input
            aria-label="Roster diagnosis"
            value={activeFilters.diagnosis || ''}
            onChange={(event) => onFilterChange({
              ...activeFilters,
              diagnosis: event.target.value,
            })}
          />
        </label>
      </div>
    );
  },
  patientMatchesSearch: (patient, search) => {
    if (!search) return true;
    return [
      patient.first_name,
      patient.last_name,
      patient.medical_record_number,
      patient.phone,
      patient.primary_diagnosis,
    ].filter(Boolean).join(' ').toLowerCase().includes(search.toLowerCase());
  },
}));

vi.mock('../components/patient/BulkPatientActions', () => ({
  default: ({ selectedPatients }) => (
    <div data-testid="bulk-patients">
      {selectedPatients.map((patient) => `${patient.first_name} ${patient.last_name}`).join('|')}
    </div>
  ),
}));

vi.mock('../components/patient/PatientMergeDialog', () => ({
  default: ({ open, patient1, patient2 }) => (
    open && patient1 && patient2
      ? <div data-testid="merge-dialog">Merge {patient1.first_name} and {patient2.first_name}</div>
      : null
  ),
}));

vi.mock('../components/patient/PaginatedPatientList', () => ({
  default: ({ patients, onPatientSelect, onSelectionChange }) => (
    <div>
      {patients.map((patient) => (
        <span key={patient.id}>{patient.first_name} {patient.last_name}</span>
      ))}
      {patients[0] && (
        <button type="button" onClick={() => onPatientSelect(patients[0].id)}>
          Edit first patient
        </button>
      )}
      {patients.length >= 2 && (
        <button
          type="button"
          onClick={() => onSelectionChange(patients.slice(0, 2).map((patient) => patient.id))}
        >
          Select first two patients
        </button>
      )}
    </div>
  ),
}));

vi.mock('../components/loading/PatientCardSkeleton', () => ({
  default: () => <div>Patient skeleton</div>,
}));

vi.mock('../components/mobile/SwipeablePatientCard', () => ({
  default: () => null,
}));

vi.mock('../components/dashboard/PatientQuickActions', () => ({
  default: () => <div>Quick actions</div>,
}));

vi.mock('../components/dashboard/PatientSearchBar', () => ({
  default: ({ searchQuery, onSearchChange, filters, onFiltersChange, resultCount }) => {
    authorization.dashboardFilterRenders.push({
      search: searchQuery,
      diagnosis: filters.diagnosis,
    });
    return (
      <div>
        <label>
          Dashboard search
          <input
            aria-label="Dashboard search"
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </label>
        <label>
          Dashboard diagnosis
          <input
            aria-label="Dashboard diagnosis"
            value={filters.diagnosis}
            onChange={(event) => onFiltersChange({
              ...filters,
              diagnosis: event.target.value,
            })}
          />
        </label>
        <div>{resultCount} authorized results</div>
      </div>
    );
  },
}));

vi.mock('../components/dashboard/PatientOverviewCard', () => ({
  default: ({ patient, visits, onSelect }) => (
    <button type="button" onClick={onSelect}>
      Select {patient.first_name} {patient.last_name}; {visits.length} authorized visits
    </button>
  ),
}));

vi.mock('../components/dashboard/RecentActivityFeed', () => ({
  default: ({ visits }) => <div>{visits.length} recent authorized visits</div>,
}));

import Patients from './Patients';
import PatientRecordDashboard from './PatientRecordDashboard';

function AuthorizationHarness({ page: Page }) {
  const [, setRevision] = useState(0);
  authorization.forceRender = () => setRevision((revision) => revision + 1);
  return <Page />;
}

function refreshAuthorization() {
  act(() => authorization.forceRender());
}

const SCOPE_A = Object.freeze({
  user_id: 'user-a',
  agency_id: 'agency-a',
  membership_id: 'membership-a',
  membership_version: 1,
  tenant_role: 'clinician',
});

const SCOPE_B = Object.freeze({
  user_id: 'user-a',
  agency_id: 'agency-b',
  membership_id: 'membership-b',
  membership_version: 2,
  tenant_role: 'clinician',
});

const PATIENTS_A = Object.freeze([
  {
    id: 'patient-a',
    first_name: 'Ada',
    last_name: 'Restricted',
    medical_record_number: 'MRN-SECRET-A',
    primary_diagnosis: 'Confidential diagnosis A',
    status: 'active',
    created_date: '2026-08-03T12:00:00Z',
  },
  {
    id: 'patient-b',
    first_name: 'Grace',
    last_name: 'Confidential',
    medical_record_number: 'MRN-SECRET-B',
    status: 'active',
    created_date: '2026-08-02T12:00:00Z',
  },
]);

function successfulPatientQuery(data = PATIENTS_A, tenantScope = SCOPE_A) {
  return {
    data,
    isLoading: false,
    isPending: false,
    isError: false,
    isSuccess: true,
    tenantScope,
  };
}

function successfulVisitQuery(data = [], tenantScope = SCOPE_A) {
  return {
    data,
    isPending: false,
    isError: false,
    isSuccess: true,
    tenantScope,
  };
}

describe('Patient page authorization revocation', () => {
  beforeEach(() => {
    authorization.rosterFilterRenders = [];
    authorization.dashboardFilterRenders = [];
    authorization.emptyStateRenders = [];
    authorization.patientQuery = successfulPatientQuery();
    authorization.visitQuery = successfulVisitQuery([
      {
        id: 'visit-a',
        patient_id: 'patient-a',
        visit_date: '2026-09-06',
        created_date: '2026-09-06T12:00:00Z',
      },
    ]);
  });

  it('drops edit, bulk-selection, and merge PHI as soon as patient access becomes pending', () => {
    renderWithProviders(<AuthorizationHarness page={Patients} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit first patient' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select first two patients' }));
    fireEvent.click(screen.getByRole('button', { name: 'Merge Selected Patients' }));

    expect(screen.getByTestId('patient-form')).toHaveTextContent('Editing Ada Restricted');
    expect(screen.getByTestId('bulk-patients')).toHaveTextContent('Ada Restricted');
    expect(screen.getByTestId('merge-dialog')).toHaveTextContent('Merge Ada and Grace');

    // Deliberately leave stale rows on the mocked hook. The page must gate on
    // isSuccess rather than trusting a cached data property during revalidation.
    authorization.patientQuery = {
      ...successfulPatientQuery(),
      isLoading: true,
      isPending: true,
      isSuccess: false,
      tenantScope: null,
    };
    refreshAuthorization();

    expect(screen.queryByText(/Ada Restricted/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Grace Confidential/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('patient-form')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bulk-patients')).not.toBeInTheDocument();
    expect(screen.queryByTestId('merge-dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Patient count unavailable')).toBeInTheDocument();
  });

  it('does not carry selected Patient detail across a direct tenant-scope change', () => {
    renderWithProviders(<AuthorizationHarness page={PatientRecordDashboard} />);
    fireEvent.click(screen.getByRole('button', { name: /Select Ada Restricted/ }));
    expect(screen.getByText('Selected Patient')).toBeInTheDocument();

    authorization.patientQuery = successfulPatientQuery([
      {
        id: 'patient-c',
        first_name: 'Katherine',
        last_name: 'Authorized',
        medical_record_number: 'MRN-C',
        status: 'active',
      },
    ], SCOPE_B);
    authorization.visitQuery = successfulVisitQuery([], SCOPE_B);
    refreshAuthorization();

    expect(screen.queryByText(/Ada Restricted/)).not.toBeInTheDocument();
    expect(screen.queryByText('Selected Patient')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Select Katherine Authorized/ })).toBeInTheDocument();
  });

  it('never paints tenant A search or diagnosis text during direct successful A-to-B switches', () => {
    const patientB = [{
      id: 'patient-c',
      first_name: 'Katherine',
      last_name: 'Authorized',
      medical_record_number: 'MRN-C',
      primary_diagnosis: 'Tenant B diagnosis',
      status: 'active',
      created_date: '2026-09-01T12:00:00Z',
    }];

    const roster = renderWithProviders(<AuthorizationHarness page={Patients} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Roster search' }), {
      target: { value: 'MRN-SECRET-A' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Roster diagnosis' }), {
      target: { value: 'Confidential diagnosis A' },
    });
    expect(screen.getByDisplayValue('MRN-SECRET-A')).toBeInTheDocument();

    authorization.rosterFilterRenders = [];
    authorization.emptyStateRenders = [];
    authorization.patientQuery = successfulPatientQuery(patientB, SCOPE_B);
    authorization.visitQuery = successfulVisitQuery([], SCOPE_B);
    refreshAuthorization();

    expect(screen.queryByDisplayValue('MRN-SECRET-A')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('Confidential diagnosis A')).not.toBeInTheDocument();
    expect(screen.getByText('Katherine Authorized')).toBeInTheDocument();
    expect(authorization.rosterFilterRenders).not.toContainEqual(expect.objectContaining({
      search: 'MRN-SECRET-A',
    }));
    expect(authorization.rosterFilterRenders).not.toContainEqual(expect.objectContaining({
      diagnosis: 'Confidential diagnosis A',
    }));
    expect(authorization.emptyStateRenders).not.toContain('No patients found');
    roster.unmount();

    authorization.patientQuery = successfulPatientQuery();
    authorization.visitQuery = successfulVisitQuery();
    authorization.dashboardFilterRenders = [];
    renderWithProviders(<AuthorizationHarness page={PatientRecordDashboard} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Dashboard search' }), {
      target: { value: 'MRN-SECRET-A' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Dashboard diagnosis' }), {
      target: { value: 'Confidential diagnosis A' },
    });

    authorization.dashboardFilterRenders = [];
    authorization.patientQuery = successfulPatientQuery(patientB, SCOPE_B);
    authorization.visitQuery = successfulVisitQuery([], SCOPE_B);
    refreshAuthorization();

    expect(screen.queryByDisplayValue('MRN-SECRET-A')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('Confidential diagnosis A')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Select Katherine Authorized/ })).toBeInTheDocument();
    expect(authorization.dashboardFilterRenders).not.toContainEqual(expect.objectContaining({
      search: 'MRN-SECRET-A',
    }));
    expect(authorization.dashboardFilterRenders).not.toContainEqual(expect.objectContaining({
      diagnosis: 'Confidential diagnosis A',
    }));
  });

  it('removes dashboard Patient PHI immediately on success-to-denial', () => {
    renderWithProviders(<AuthorizationHarness page={PatientRecordDashboard} />);
    fireEvent.click(screen.getByRole('button', { name: /Select Ada Restricted/ }));

    authorization.patientQuery = {
      ...successfulPatientQuery(),
      isError: true,
      isSuccess: false,
      tenantScope: null,
    };
    refreshAuthorization();

    expect(screen.getByText('Patient records unavailable')).toBeInTheDocument();
    expect(screen.queryByText(/Ada Restricted/)).not.toBeInTheDocument();
    expect(screen.queryByText('Selected Patient')).not.toBeInTheDocument();
  });

  it('labels denied global Visit metrics as unavailable instead of zero', () => {
    authorization.visitQuery = {
      data: [{ id: 'stale-visit', patient_id: 'patient-a', visit_date: '2026-09-06' }],
      isPending: false,
      isError: true,
      isSuccess: false,
    };

    renderWithProviders(<PatientRecordDashboard />);

    expect(screen.getByTestId('stat-Visits (7 days)')).toHaveTextContent('Visits (7 days): —');
    expect(screen.getByText(/Agency-wide Visit metrics are unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/no zero-activity conclusion is being inferred/i)).toBeInTheDocument();
    expect(screen.getAllByText('Unavailable')).toHaveLength(PATIENTS_A.length);
    expect(screen.queryByText(/0 authorized visits/)).not.toBeInTheDocument();
    expect(screen.queryByText(/0 recent authorized visits/)).not.toBeInTheDocument();
  });

  it('keeps the roster visible but gates denied global Visit filters and sorting', () => {
    authorization.visitQuery = {
      data: [{ id: 'stale-visit', patient_id: 'patient-a', visit_date: '2026-09-06' }],
      isPending: false,
      isError: true,
      isSuccess: false,
      tenantScope: null,
    };

    renderWithProviders(<Patients />);

    expect(screen.getByText(/Global visit metrics are unavailable/i)).toBeInTheDocument();
    expect(screen.getByText('Ada Restricted')).toBeInTheDocument();
    expect(screen.queryByText(/0 visits/i)).not.toBeInTheDocument();
  });
});
