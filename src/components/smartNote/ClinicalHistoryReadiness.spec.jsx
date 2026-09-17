import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ visits: {}, patient: {}, incidents: {}, run: vi.fn(), reset: vi.fn(), analyze: vi.fn() }));
vi.mock('@/hooks/useAuthorizedVisits', () => ({ useAuthorizedVisits: () => mocks.visits }));
vi.mock('@/hooks/useAuthorizedPatient', () => ({ useAuthorizedPatient: () => mocks.patient }));
vi.mock('@/hooks/useAICall', () => ({ useAICall: () => ({ run: mocks.run, reset: mocks.reset, loading: false }) }));
vi.mock('@/lib/invokeLLM', () => ({ invokeLLM: mocks.analyze }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ tenantContext: { agency_id: 'synthetic-agency' } }) }));
vi.mock('@/api/base44Client', () => ({ base44: {} }));
vi.mock('@/hooks/useScopedPatients', () => ({ useScopedPatients: () => ({ data: [{ id: 'patient-a', first_name: 'Synthetic' }] }) }));
vi.mock('@/components/alerts/PatientAlertsDashboard', () => ({ default: () => null }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => mocks.incidents }));
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }) => <select aria-label="Visit" value={value} onChange={event => onValueChange(event.target.value)}><option value="">Select</option>{children}</select>,
  SelectTrigger: () => null, SelectValue: () => null,
  SelectContent: ({ children }) => <>{children}</>,
  SelectItem: ({ value, children }) => <option value={value}>{children}</option>,
}));
import PatientAlertAnalyzer from '../alerts/PatientAlertAnalyzer';
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
  mocks.run.mockReset(); mocks.reset.mockReset(); mocks.analyze.mockReset();
  mocks.analyze.mockImplementation(() => new Promise(() => {}));
});
const choose = id => fireEvent.change(screen.getByRole('combobox', { name: 'Visit' }), { target: { value: id } });
const generate = () => fireEvent.click(screen.getByRole('button', { name: /Generate Visit Summary/ }));
afterEach(() => vi.unstubAllGlobals());

describe('clinical history readiness', () => {
  it.each(['pending', 'failed'])('clears the page-owned analysis summary when history becomes %s', async state => {
    mocks.analyze.mockResolvedValue({ alerts: [], analysis_summary: 'Previous patient analysis', overall_risk_level: 'low' });
    const page = <MemoryRouter initialEntries={['/PatientAlerts?patientId=patient-a']}><PatientAlerts /></MemoryRouter>;
    const view = render(page);
    fireEvent.click(screen.getByRole('button', { name: 'Analyze', exact: true }));
    expect(await screen.findByText('Previous patient analysis')).toBeVisible();
    mocks.visits = { ...ready([]), isPending: state === 'pending', isError: state === 'failed' };
    view.rerender(<MemoryRouter initialEntries={['/PatientAlerts?patientId=patient-a']}><PatientAlerts /></MemoryRouter>);
    expect(screen.queryByText('Previous patient analysis')).not.toBeInTheDocument();
    expect(screen.queryByText('Analysis Summary')).not.toBeInTheDocument();
  });

  it.each(['visits', 'patient', 'incidents'])('does not automatically analyze while %s are unavailable', field => {
    mocks[field] = { ...mocks[field], isError: true };
    render(<PatientAlertAnalyzer patientId="patient-a" autoAnalyze />);
    expect(mocks.analyze).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('could not be loaded');
  });

  it.each(['visits', 'patient', 'incidents'])('waits for %s before automatically analyzing', field => {
    mocks[field] = { ...mocks[field], isPending: true };
    const view = render(<PatientAlertAnalyzer patientId="patient-a" autoAnalyze />);
    expect(mocks.analyze).not.toHaveBeenCalled();
    mocks[field] = { ...mocks[field], isPending: false };
    view.rerender(<PatientAlertAnalyzer patientId="patient-a" autoAnalyze />);
    expect(mocks.analyze).toHaveBeenCalledTimes(1);
  });

  it('rejects a pending analysis after a required read becomes unavailable', async () => {
    let finish;
    mocks.analyze.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const completed = vi.fn();
    const view = render(<PatientAlertAnalyzer patientId="patient-a" autoAnalyze onAlertsGenerated={completed} />);
    mocks.visits = { ...ready([]), isError: true };
    view.rerender(<PatientAlertAnalyzer patientId="patient-a" autoAnalyze onAlertsGenerated={completed} />);
    await act(async () => finish({ alerts: [{ title: 'Stale alert' }] }));
    expect(completed).toHaveBeenCalledTimes(1);
    expect(completed).toHaveBeenLastCalledWith([], null);
    expect(screen.queryByText('Stale alert')).not.toBeInTheDocument();
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
