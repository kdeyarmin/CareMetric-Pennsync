import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import ReportsAnalytics from '@/pages/ReportsAnalytics';
import NursePerformanceReport from './NursePerformanceReport';
import ReferralVolumeReport from './ReferralVolumeReport';
import FollowUpAnalytics from './FollowUpAnalytics';

const mocks = vi.hoisted(() => ({ me: vi.fn(), notes: vi.fn(), audits: vi.fn(), users: vi.fn(), referrals: vi.fn(), pdf: vi.fn(), toast: vi.fn(), auth: {} }));
vi.mock('@/api/base44Client', () => ({ base44: { auth: { me: mocks.me }, entities: {
  NoteConversion: { list: mocks.notes }, ComplianceAudit: { list: mocks.audits }, User: { list: mocks.users },
} } }));
vi.mock('@/functions/manageAuthorizedReferral', () => ({ listAuthorizedReferrals: mocks.referrals }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/lib/roles', () => ({ isAdminView: user => user?.role === 'admin' }));
vi.mock('@/lib/agencyRoster', () => ({ agencyQueryKey: user => user?.id || 'none' }));
vi.mock('@/lib/agencyScope', () => ({ filterUsersByCallerAgency: rows => rows }));
vi.mock('@/lib/agencySettings', () => ({ fetchCallerPdgmRateConfig: async () => null }));
vi.mock('@/components/utils/pdfExporter', () => ({ exportToPDF: mocks.pdf }));
vi.mock('sonner', () => ({ toast: { error: mocks.toast } }));
vi.mock('recharts', () => Object.fromEntries(['ResponsiveContainer', 'BarChart', 'Bar', 'PieChart', 'Pie', 'Cell', 'CartesianGrid', 'XAxis', 'YAxis', 'Tooltip'].map(name => [name, ({ children }) => <div>{children}</div>])));

const range = { start: '2026-09-01', end: '2026-09-17' };
const staff = { id: 'staff-a', role: 'user', email: 'staff@example.test', full_name: 'Synthetic Nurse' };
const note = { id: 'note-a', created_date: '2026-09-10T10:00:00Z', nurse_email: staff.email };
const referral = { id: 'referral-a', referral_date: '2026-09-10', referral_source: 'Synthetic Clinic', priority: 'normal', status: 'new' };
function mount(Component, props = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return { client, ...render(<MemoryRouter><QueryClientProvider client={client}><Component dateRange={range} {...props} /></QueryClientProvider></MemoryRouter>) };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.me.mockResolvedValue({ id: 'owner-a', role: 'admin', agency_name: 'Synthetic agency' });
  mocks.users.mockResolvedValue([staff]);
  mocks.notes.mockResolvedValue([note]);
  mocks.audits.mockResolvedValue([]);
  mocks.referrals.mockResolvedValue({ referrals: [referral] });
  mocks.pdf.mockResolvedValue(undefined);
  mocks.auth = { tenantContext: { agency_id: 'agency-a' } };
});

describe('nurse report read integrity', () => {
  it('keeps the reports hub in a loading state during access verification', () => {
    mocks.me.mockReturnValue(new Promise(() => {}));
    mount(ReportsAnalytics);
    expect(screen.getByText('Loading report access...')).toBeInTheDocument();
    expect(screen.queryByText(/available to administrators only/)).not.toBeInTheDocument();
  });
  it('offers retry when report-hub identity lookup fails', async () => {
    mocks.me.mockRejectedValue(new Error('Private identity details'));
    mount(ReportsAnalytics);
    expect(await screen.findByRole('alert')).toHaveTextContent('Report access is unavailable');
    mocks.me.mockResolvedValue({ id: 'owner-a', role: 'admin' });
    fireEvent.click(screen.getByRole('button', { name: 'Retry report data' }));
    await screen.findByText('Reports & Analytics');
  });
  it('waits for identity before reading report records', () => {
    mocks.me.mockReturnValue(new Promise(() => {}));
    mount(NursePerformanceReport);
    expect(screen.getByText('Loading report access...')).toBeInTheDocument();
    expect(mocks.notes).not.toHaveBeenCalled();
    expect(mocks.audits).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Export PDF' })).not.toBeInTheDocument();
  });
  it('does not fetch report sources for a non-administrator', async () => {
    mocks.me.mockResolvedValue(staff);
    mount(NursePerformanceReport);
    expect(await screen.findByText(/available to administrators only/)).toBeInTheDocument();
    expect(mocks.notes).not.toHaveBeenCalled();
  });
  it.each(['notes', 'audits', 'users'])('does not display a report after a failed %s read', async kind => {
    mocks[kind].mockRejectedValue(new Error('Private backend details'));
    mount(NursePerformanceReport);
    expect(await screen.findByRole('alert')).toHaveTextContent('Nurse performance data is unavailable');
    expect(screen.queryByText('Detailed Performance Metrics')).not.toBeInTheDocument();
    expect(screen.queryByText('Private backend details')).not.toBeInTheDocument();
  });
  it('does not export while a report source is pending', async () => {
    mocks.notes.mockReturnValue(new Promise(() => {}));
    mount(NursePerformanceReport);
    expect(await screen.findByText('Loading nurse performance data...')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export PDF' })).not.toBeInTheDocument();
  });
  it('hides a stale report after failure and supports retry', async () => {
    const { client } = mount(NursePerformanceReport);
    await screen.findByText('Detailed Performance Metrics');
    mocks.notes.mockRejectedValue(new Error('Unavailable'));
    await act(() => client.invalidateQueries({ queryKey: ['allNoteConversions'] }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Nurse performance data is unavailable');
    expect(screen.queryByText('Detailed Performance Metrics')).not.toBeInTheDocument();
    mocks.notes.mockResolvedValue([note]);
    fireEvent.click(screen.getByRole('button', { name: 'Retry report data' }));
    await screen.findByText('Detailed Performance Metrics');
  });
  it('does not grade absent measurements as poor performance', async () => {
    mount(NursePerformanceReport);
    await screen.findByText('Detailed Performance Metrics');
    expect(screen.queryByText('Needs Improvement')).not.toBeInTheDocument();
    expect(screen.getAllByText('Not measured').length).toBeGreaterThan(1);
  });
  it('averages measured scores only and retains a genuine zero', async () => {
    mocks.audits.mockResolvedValue([
      { id: 'a1', audit_date: note.created_date, nurse_email: staff.email, compliance_score: 0, status: 'critical' },
      { id: 'a2', audit_date: note.created_date, nurse_email: staff.email, compliance_score: 100, status: 'passed' },
      { id: 'a3', audit_date: note.created_date, nurse_email: staff.email, status: 'pending_review' },
    ]);
    mount(NursePerformanceReport);
    await screen.findByText('Detailed Performance Metrics');
    const row = screen.getByRole('row', { name: /Synthetic Nurse/ });
    expect(within(row).getAllByText('50.0%')).toHaveLength(2);
  });
  it('does not award top performer when no notes exist', async () => {
    mocks.notes.mockResolvedValue([]);
    mount(NursePerformanceReport);
    await screen.findByText('Detailed Performance Metrics');
    expect(screen.getByText('No activity in this period')).toBeInTheDocument();
  });
  it('labels note counts and estimated time accurately in the UI and export', async () => {
    mount(NursePerformanceReport);
    await screen.findByText('Detailed Performance Metrics');
    expect(screen.getByText('Estimated Time Saved')).toBeInTheDocument();
    expect(screen.queryByText('Total Visits')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
    await waitFor(() => expect(mocks.pdf).toHaveBeenCalledOnce());
    const table = mocks.pdf.mock.calls[0][0].content.find(item => item.type === 'table');
    expect(table.columns.map(col => col.header)).toContain('Notes Enhanced');
    expect(table.data[0].avgComplianceScore).toBe('Not measured');
  });
  it.each(['notes', 'audits', 'users'])('blocks exporting a capped %s source before filtering', async kind => {
    const template = kind === 'notes' ? { ...note, created_date: '2025-01-01' } : kind === 'audits' ? { audit_date: '2025-01-01' } : staff;
    mocks[kind].mockResolvedValue(Array.from({ length: 5000 }, (_, i) => ({ ...template, id: `row-${i}`, ...(kind === 'users' ? { email: `nurse${i}@example.test` } : {}) })));
    mount(NursePerformanceReport);
    expect(await screen.findByText(/A source reached its record limit/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export PDF' })).toBeDisabled();
  });
  it('rejects invalid date ranges without fetching or crashing', async () => {
    mount(NursePerformanceReport, { dateRange: { start: 'invalid', end: range.end } });
    expect(await screen.findByText(/valid date range/)).toBeInTheDocument();
    expect(mocks.notes).not.toHaveBeenCalled();
  });
  it('reports a failed PDF download without an unhandled rejection', async () => {
    mocks.pdf.mockRejectedValue(new Error('Private download details'));
    mount(NursePerformanceReport);
    fireEvent.click(await screen.findByRole('button', { name: 'Export PDF' }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('The report could not be downloaded. Please try again.'));
  });
  it('preserves roster refresh after existing allUsers invalidation', async () => {
    const { client } = mount(NursePerformanceReport);
    await screen.findByText('Detailed Performance Metrics');
    await act(() => client.invalidateQueries({ queryKey: ['allUsers'] }));
    expect(mocks.users).toHaveBeenCalledTimes(2);
  });
  it.each([null, {}, [{ ...note, id: '' }], [{ ...note }, { ...note }]])('rejects malformed note collections (%j)', async value => {
    mocks.notes.mockResolvedValue(value);
    mount(NursePerformanceReport);
    expect(await screen.findByRole('alert')).toHaveTextContent('Nurse performance data is unavailable');
  });
});

describe('referral report read integrity', () => {
  it.each([['volume', ReferralVolumeReport], ['follow-up', FollowUpAnalytics]])('waits for authorized referrals before showing %s totals', async (_label, Component) => {
    mocks.referrals.mockReturnValue(new Promise(() => {}));
    mount(Component);
    expect(await screen.findByText('Loading referral report data...')).toBeInTheDocument();
    expect(screen.queryByText('Total Referrals')).not.toBeInTheDocument();
    expect(screen.queryByText('No follow-up requests sent yet.')).not.toBeInTheDocument();
  });
  it.each([['volume', ReferralVolumeReport], ['follow-up', FollowUpAnalytics]])('does not show %s totals without agency access', (_label, Component) => {
    mocks.auth = { tenantContext: null };
    mount(Component);
    expect(screen.getByText(/Select an authorized agency/)).toBeInTheDocument();
    expect(mocks.referrals).not.toHaveBeenCalled();
  });
  it.each([['volume', ReferralVolumeReport], ['follow-up', FollowUpAnalytics]])('provides recovery after a failed %s read', async (_label, Component) => {
    mocks.referrals.mockRejectedValue(new Error('Private error'));
    mount(Component);
    expect(await screen.findByRole('alert')).toHaveTextContent('Referral report data is unavailable');
    mocks.referrals.mockResolvedValue({ referrals: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Retry report data' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry report data' })).not.toBeInTheDocument());
  });
  it('blocks exporting a capped referral window', async () => {
    mocks.referrals.mockResolvedValue({ referrals: Array.from({ length: 5000 }, (_, i) => ({ ...referral, id: `referral-${i}` })) });
    mount(ReferralVolumeReport);
    expect(await screen.findByText(/A source reached its record limit/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export PDF' })).toBeDisabled();
  });
  it('handles source labels that match object prototype keys', async () => {
    mocks.referrals.mockResolvedValue({ referrals: [{ ...referral, referral_source: '__proto__' }, { ...referral, id: 'referral-b', referral_source: 'constructor' }] });
    mount(ReferralVolumeReport);
    expect(await screen.findByRole('cell', { name: '__proto__' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'constructor' })).toBeInTheDocument();
  });
  it('separates generated plans from recorded responses', async () => {
    mocks.referrals.mockResolvedValue({ referrals: [
      { ...referral, extracted_data: {}, analysis_results: {}, follow_up_requests: { status: 'open', generated_at: '2026-09-01T10:00:00Z' } },
      { ...referral, id: 'referral-b', extracted_data: {}, analysis_results: {}, follow_up_requests: { status: 'resolved', generated_at: '2026-09-01T10:00:00Z' } },
      { ...referral, id: 'referral-c', extracted_data: {}, analysis_results: {}, follow_up_requests: { status: 'received', generated_at: '2026-09-01T10:00:00Z', received_at: '2026-09-02T10:00:00Z' } },
    ] });
    mount(FollowUpAnalytics);
    expect(await screen.findByText('Requests generated / responses recorded')).toBeInTheDocument();
    expect(screen.getByText('3 / 1')).toBeInTheDocument();
    expect(screen.queryByText('Requests sent / answered')).not.toBeInTheDocument();
  });
  it.each([ReferralVolumeReport, FollowUpAnalytics])('rejects malformed referral collections instead of showing zero data', async Component => {
    mocks.referrals.mockResolvedValue({ referrals: [null] });
    mount(Component);
    expect(await screen.findByRole('alert')).toHaveTextContent('Referral report data is unavailable');
  });
  it('discloses undated records and blocks exporting incomplete volume', async () => {
    mocks.referrals.mockResolvedValue({ referrals: [{ ...referral, referral_date: '' }] });
    mount(ReferralVolumeReport);
    expect(await screen.findByText(/no valid referral date/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export PDF' })).toBeDisabled();
  });
  it('retains legacy slash dates and formats the range on the local calendar', async () => {
    mocks.referrals.mockResolvedValue({ referrals: [{ ...referral, referral_date: '09/10/2026' }] });
    mount(ReferralVolumeReport);
    fireEvent.click(await screen.findByRole('button', { name: 'Export PDF' }));
    expect(mocks.pdf).toHaveBeenCalledOnce();
    expect(mocks.pdf.mock.calls[0][0].subtitle).toBe('Period: Sep 1, 2026 - Sep 17, 2026');
    expect(mocks.pdf.mock.calls[0][0].content).toContainEqual({ type: 'text', text: 'Total Referrals: 1' });
  });
  it('hides stale referral volume after a failed refresh', async () => {
    const { client } = mount(ReferralVolumeReport);
    await screen.findByRole('cell', { name: 'Synthetic Clinic' });
    mocks.referrals.mockRejectedValue(new Error('Private error'));
    await act(() => client.invalidateQueries({ queryKey: ['referrals'] }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Referral report data is unavailable');
    expect(screen.queryByRole('cell', { name: 'Synthetic Clinic' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export PDF' })).not.toBeInTheDocument();
  });
  it('retains unspecified priority as normal and discloses unknown priorities', async () => {
    mocks.referrals.mockResolvedValue({ referrals: [
      { ...referral, priority: undefined },
      { ...referral, id: 'referral-b', priority: 'unrecognized', referral_source: 'Second clinic' },
    ] });
    mount(ReferralVolumeReport);
    fireEvent.click(await screen.findByRole('button', { name: 'Export PDF' }));
    const distribution = mocks.pdf.mock.calls[0][0].content.filter(item => item.type === 'table').at(-1).data;
    expect(distribution).toContainEqual({ priority: 'Normal', count: 1 });
    expect(distribution).toContainEqual({ priority: 'Unclassified', count: 1 });
    expect(within(screen.getByRole('row', { name: /Second clinic/ })).getByText('unclassified')).toBeInTheDocument();
  });
});
