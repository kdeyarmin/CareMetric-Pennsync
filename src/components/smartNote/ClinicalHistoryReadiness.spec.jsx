import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ visits: {}, patient: {}, incidents: {}, run: vi.fn(), reset: vi.fn(), analyze: vi.fn(), dashboardProps: null }));
vi.mock('@/hooks/useAuthorizedVisits', () => ({ useAuthorizedVisits: () => mocks.visits }));
vi.mock('@/hooks/useAuthorizedPatient', () => ({ useAuthorizedPatient: () => mocks.patient }));
vi.mock('@/hooks/useAICall', () => ({ useAICall: () => ({ run: mocks.run, reset: mocks.reset, loading: false }) }));
vi.mock('@/lib/invokeLLM', () => ({ invokeLLM: mocks.analyze }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ tenantContext: { agency_id: 'synthetic-agency' } }) }));
vi.mock('@/api/base44Client', () => ({ base44: {} }));
vi.mock('@/hooks/useScopedPatients', () => ({ useScopedPatients: () => ({ data: [{ id: 'patient-a', first_name: 'Synthetic' }] }) }));
vi.mock('@/components/alerts/PatientAlertsDashboard', () => ({ default: (props) => { mocks.dashboardProps = props; return null; } }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => mocks.incidents }));
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }) => <select aria-label="Visit" value={value} onChange={event => onValueChange(event.target.value)}><option value="">Select</option>{children}</select>,
  SelectTrigger: () => null, SelectValue: () => null,
  SelectContent: ({ children }) => <>{children}</>,
  SelectItem: ({ value, children }) => <option value={value}>{children}</option>,
}));
import VisitSummaryGenerator from './VisitSummaryGenerator';
import PatientAlerts from '@/pages/PatientAlerts';

const ready = data => ({ data, isPending: false, isFetching: false, isPaused: false, isError: false });
const visits = [
  { id: 'visit-a', visit_date: '2026-09-16', nurse_notes: 'Synthetic note A.', visit_type: 'routine' },
  { id: 'visit-b', visit_date: '2026-09-17', nurse_notes: 'Synthetic note B.', visit_type: 'routine' },
];
beforeEach(() => {
  mocks.visits = ready(visits);
  mocks.patient = ready({ id: 'patient-a', first_name: 'Synthetic', last_name: 'Example' });
  mocks.incidents = ready([]);
  mocks.run.mockReset(); mocks.reset.mockReset(); mocks.analyze.mockReset(); mocks.dashboardProps = null;
  mocks.analyze.mockImplementation(() => new Promise(() => {}));
});
const choose = id => fireEvent.change(screen.getByRole('combobox', { name: 'Visit' }), { target: { value: id } });
const generate = () => fireEvent.click(screen.getByRole('button', { name: /Generate Visit Summary/ }));
afterEach(() => vi.unstubAllGlobals());

// The AI "Analyze Patient" risk scorer (PatientAlertAnalyzer) was removed with
// the clinical risk-prediction features. The page keeps the stored-alert list
// and its patient filter; nothing on it may call a model.
describe('patient alerts page', () => {
  it('filters the stored-alert list by patient and runs no AI risk analysis', () => {
    render(<MemoryRouter initialEntries={['/PatientAlerts?patientId=patient-a']}><PatientAlerts /></MemoryRouter>);
    expect(screen.getByText('Filter by Patient')).toBeInTheDocument();
    expect(mocks.dashboardProps?.patientId).toBe('patient-a');
    expect(screen.queryByText('Analyze Patient')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Analyze', exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText('Analysis Summary')).not.toBeInTheDocument();
    expect(screen.queryByText(/Overall Risk/)).not.toBeInTheDocument();
    expect(mocks.analyze).not.toHaveBeenCalled();
  });
});

describe('visit summary selection', () => {
  it('does not mark the next summary copied when a previous visit copy finishes', async () => {
    let finishCopy;
    const writeText = vi.fn(() => new Promise(resolve => { finishCopy = resolve; }));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    mocks.run.mockResolvedValueOnce({ chief_concern: 'Summary for visit A' });
    render(<VisitSummaryGenerator patientId="patient-a" />);
    choose('visit-a'); generate();
    expect(await screen.findByText('Summary for visit A')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy Selected' }));
    expect(writeText).toHaveBeenCalledWith('Chief Concern:\nSummary for visit A');
    choose('visit-b');
    mocks.run.mockResolvedValueOnce({ chief_concern: 'Summary for visit B' });
    generate();
    expect(await screen.findByText('Summary for visit B')).toBeInTheDocument();
    await act(async () => finishCopy());
    expect(screen.getByRole('button', { name: 'Copy Selected' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copied!' })).not.toBeInTheDocument();
  });

  it('clears a completed summary when another visit is selected', async () => {
    mocks.run.mockResolvedValue({ chief_concern: 'Summary for visit A' });
    render(<VisitSummaryGenerator patientId="patient-a" />);
    choose('visit-a'); generate();
    expect(await screen.findByText('Summary for visit A')).toBeInTheDocument();
    choose('visit-b');
    expect(screen.queryByText('Summary for visit A')).not.toBeInTheDocument();
  });

  it('drops a late result after switching visits and returning to the first visit', async () => {
    let finish;
    mocks.run.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<VisitSummaryGenerator patientId="patient-a" />);
    choose('visit-a'); generate(); choose('visit-b'); choose('visit-a');
    await act(async () => finish({ chief_concern: 'Late visit A summary' }));
    expect(screen.queryByText('Late visit A summary')).not.toBeInTheDocument();
    mocks.run.mockResolvedValueOnce({ chief_concern: 'Current visit A summary' });
    generate();
    expect(await screen.findByText('Current visit A summary')).toBeInTheDocument();
  });

  it('drops a late result after changing patients', async () => {
    let finish;
    mocks.run.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<VisitSummaryGenerator patientId="patient-a" />);
    choose('visit-a'); generate();
    mocks.patient = ready({ id: 'patient-b', first_name: 'Other', last_name: 'Example' });
    view.rerender(<VisitSummaryGenerator patientId="patient-b" />);
    await act(async () => finish({ chief_concern: 'Late patient A summary' }));
    expect(screen.queryByText('Late patient A summary')).not.toBeInTheDocument();
  });

  it('withholds an old summary when history becomes unavailable', async () => {
    mocks.run.mockResolvedValue({ chief_concern: 'Previous summary' });
    const view = render(<VisitSummaryGenerator patientId="patient-a" />);
    choose('visit-a'); generate();
    expect(await screen.findByText('Previous summary')).toBeInTheDocument();
    mocks.visits = { ...ready([]), isError: true };
    view.rerender(<VisitSummaryGenerator patientId="patient-a" />);
    expect(screen.queryByText('Previous summary')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('could not be loaded');
  });
});
