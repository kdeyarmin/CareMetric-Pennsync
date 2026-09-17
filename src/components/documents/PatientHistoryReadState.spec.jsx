import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ visits: {}, incidents: {}, run: vi.fn(), panelMounts: 0 }));
vi.mock('@/hooks/useAuthorizedVisits', async () => {
  const { useEffect } = await import('react');
  return { useAuthorizedVisits: ({ limit }) => {
    useEffect(() => { if (limit === 20) mocks.panelMounts += 1; }, [limit]);
    return mocks.visits;
  } };
});
vi.mock('@/hooks/useAICall', () => ({ useAICall: () => ({ run: mocks.run, loading: false }) }));
vi.mock('@/api/base44Client', () => ({ base44: {} }));
vi.mock('@tanstack/react-query', () => ({ useQuery: ({ queryKey }) => queryKey[0] === 'patientIncidents' ? mocks.incidents : { data: { full_name: 'Synthetic Clinician' } } }));
import VitalsChart from '../clinical/VitalsChart';
import VitalsTrendAnalysis from '../smartNote/VitalsTrendAnalysis';
import VitalSignsTrendDashboard from '../patient/VitalSignsTrendDashboard';
import SmartNotesContextPanel from './SmartNotesContextPanel';
import ReferralLetterGenerator from './ReferralLetterGenerator';
import ProgressReportGenerator from './ProgressReportGenerator';

const patient = { id: 'synthetic-patient', first_name: 'Synthetic', last_name: 'Example' };
const ready = () => ({ data: [], isPending: false, isLoading: false, isFetching: false, isError: false });
beforeEach(() => {
  mocks.visits = ready();
  mocks.incidents = ready();
  mocks.run.mockReset();
  mocks.panelMounts = 0;
});

describe.each([
  ['vitals chart', VitalsChart], ['vitals analysis', VitalsTrendAnalysis],
  ['vitals dashboard', VitalSignsTrendDashboard], ['note context', SmartNotesContextPanel],
  ['referral letter', ReferralLetterGenerator], ['progress report', ProgressReportGenerator],
])('%s unavailable history', (_name, Component) => {
  it('distinguishes a failed authorized read from an empty history', () => {
    mocks.visits = { ...ready(), isError: true, error: new Error('Synthetic private error') };
    render(<Component patientId={patient.id} patient={patient} />);
    expect(screen.getAllByRole('alert').some(el => /could not be loaded/i.test(el.textContent))).toBe(true);
    expect(screen.queryByText(/No (?:completed )?visits|No vital signs recorded|No visit notes available/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Generate (?:Referral Letter|Progress Report)$/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Synthetic private error')).not.toBeInTheDocument();
    expect(mocks.run).not.toHaveBeenCalled();
  });
});

describe.each([['referral letter', ReferralLetterGenerator], ['progress report', ProgressReportGenerator]])('%s readiness', (_name, Component) => {
  it('keeps the history reader mounted across loading and error recovery', () => {
    mocks.visits = { ...ready(), isPending: true, isLoading: true };
    const view = render(<Component patientId={patient.id} patient={patient} />);
    expect(mocks.panelMounts).toBe(1);
    for (const state of [ready(), { ...ready(), isError: true }, ready()]) {
      mocks.visits = state;
      view.rerender(<Component patientId={patient.id} patient={patient} />);
      expect(mocks.panelMounts).toBe(1);
    }
  });

  it('waits for visit history instead of generating from a pending read', () => {
    mocks.visits = { ...ready(), isPending: true, isLoading: true };
    render(<Component patientId={patient.id} patient={patient} />);
    expect(screen.getAllByRole('status').some(el => /Loading patient history/i.test(el.textContent))).toBe(true);
    expect(screen.queryByRole('button', { name: /^Generate (?:Referral Letter|Progress Report)$/ })).not.toBeInTheDocument();
    expect(mocks.run).not.toHaveBeenCalled();
  });
});

describe('progress report incident context', () => {
  it.each(['pending', 'error', 'refreshing', 'paused'])('blocks generation while incidents are %s', state => {
    mocks.incidents = { ...ready(), isPending: state === 'pending', isFetching: state === 'refreshing', isPaused: state === 'paused', isError: state === 'error' };
    render(<ProgressReportGenerator patientId={patient.id} patient={patient} />);
    expect(screen.queryByRole('button', { name: /^Generate Progress Report$/ })).not.toBeInTheDocument();
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('allows a confirmed empty history to be used without fabricating visits', () => {
    mocks.run.mockImplementation(() => new Promise(() => {}));
    render(<ProgressReportGenerator patientId={patient.id} patient={patient} />);
    fireEvent.click(screen.getByRole('button', { name: /^Generate Progress Report$/ }));
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(mocks.run.mock.calls[0][0].prompt).toContain('Total Visits in Period: 0');
  });
});
