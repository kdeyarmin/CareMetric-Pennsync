import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import userEvent from '@testing-library/user-event';
import AnalyticsDashboard from './AnalyticsDashboard';
import AdminTrainingAnalytics from './AdminTrainingAnalytics';

const mocks = vi.hoisted(() => ({ me: vi.fn(), users: vi.fn(), notes: vi.fn(), audits: vi.fn(), assignments: vi.fn(), modules: vi.fn(), recommendations: vi.fn(), pdf: vi.fn() }));
vi.mock('@/api/base44Client', () => ({ base44: { auth: { me: mocks.me }, entities: {
  User: { list: mocks.users }, NoteConversion: { list: mocks.notes }, ComplianceAudit: { list: mocks.audits },
  TrainingAssignment: { list: mocks.assignments }, TrainingModule: { list: mocks.modules },
} } }));
vi.mock('@/functions/listTenantTrainingIntegrityRecords', () => ({ listTenantTrainingIntegrityRecords: mocks.recommendations }));
vi.mock('@/lib/roles', () => ({ isAdminView: user => user?.role === 'admin' }));
vi.mock('@/lib/agencyRoster', () => ({ agencyQueryKey: user => user?.id || 'none' }));
vi.mock('@/lib/agencyScope', () => ({ filterUsersByCallerAgency: rows => rows }));
vi.mock('@/components/utils/pdfExporter', () => ({ exportToPDF: mocks.pdf }));
vi.mock('@/components/ui/PageHeader', () => ({ default: ({ title, actions }) => <header><h1>{title}</h1>{actions}</header> }));
vi.mock('@/components/ui/PageContainer', () => ({ default: ({ children }) => <main>{children}</main> }));
vi.mock('recharts', () => Object.fromEntries(['ResponsiveContainer', 'LineChart', 'Line', 'BarChart', 'Bar', 'PieChart', 'Pie', 'Cell', 'CartesianGrid', 'XAxis', 'YAxis', 'Tooltip', 'Legend'].map(name => [name, ({ children }) => <div>{children}</div>])));

const staff = { id: 'staff-a', email: 'staff@example.test', full_name: 'Synthetic Employee', role: 'user' };
const date = new Date().toISOString();
const browserMethods = ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture', 'scrollIntoView'];
const methodDescriptors = Object.fromEntries(browserMethods.map(name => [name, Object.getOwnPropertyDescriptor(Element.prototype, name)]));
beforeAll(() => {
  for (const name of browserMethods) Object.defineProperty(Element.prototype, name, { configurable: true, value: vi.fn(() => false) });
});
afterAll(() => {
  for (const name of browserMethods) {
    if (methodDescriptors[name]) Object.defineProperty(Element.prototype, name, methodDescriptors[name]);
    else delete Element.prototype[name];
  }
});
function mount(Page) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return { client, ...render(<MemoryRouter><QueryClientProvider client={client}><Page /></QueryClientProvider></MemoryRouter>) };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.me.mockResolvedValue({ id: 'owner-a', email: 'owner@example.test', role: 'admin' });
  mocks.users.mockResolvedValue([staff]);
  mocks.notes.mockResolvedValue([{ id: 'note-a', nurse_email: staff.email, created_date: date, conversion_time_ms: 60000, quality_score: 80 }]);
  mocks.audits.mockResolvedValue([{ id: 'audit-a', nurse_email: staff.email, audit_date: date, compliance_score: 90 }]);
  mocks.assignments.mockResolvedValue([{ id: 'assignment-a', assigned_to_user_id: staff.email, status: 'completed', course_id: 'course-a' }]);
  mocks.modules.mockResolvedValue([{ id: 'module-a', title: 'Synthetic module', course_id: 'course-a', category: 'Skills' }]);
  mocks.recommendations.mockResolvedValue({ data: { records: [] } });
});

describe('analytics read integrity', () => {
  it.each([['performance', AnalyticsDashboard], ['training', AdminTrainingAnalytics]])('waits for identity instead of displaying reports or premature denial (%s)', (_name, Page) => {
    mocks.me.mockReturnValue(new Promise(() => {}));
    mount(Page);
    expect(screen.getByText('Loading report access...')).toBeInTheDocument();
    expect(mocks.notes).not.toHaveBeenCalled();
    expect(mocks.assignments).not.toHaveBeenCalled();
  });
  it.each(['users', 'assignments', 'modules', 'recommendations'])('does not convert a failed training %s query into totals', async kind => {
    mocks[kind].mockRejectedValue(new Error('Private failure details'));
    mount(AdminTrainingAnalytics);
    expect(await screen.findByRole('alert', {}, { timeout: 2500 })).toHaveTextContent('Training report data is unavailable');
    expect(screen.queryByText('Total Completions')).not.toBeInTheDocument();
    expect(screen.queryByText('Private failure details')).not.toBeInTheDocument();
  });
  it('keeps an unmeasured training score distinct from a measured zero', async () => {
    const { client } = mount(AdminTrainingAnalytics);
    expect(await screen.findByText('Not measured', {}, { timeout: 2500 })).toBeInTheDocument();
    mocks.assignments.mockResolvedValue([{ id: 'assignment-a', status: 'completed', score_percentage: 0 }]);
    await act(() => client.invalidateQueries({ queryKey: ['allTrainingAssignments'] }));
    expect(await screen.findByText('0%')).toBeInTheDocument();
  });
  it.each(['notes', 'audits', 'users'])('blocks performance totals and exports when %s cannot load', async kind => {
    mocks[kind].mockRejectedValue(new Error('Unavailable'));
    mount(AnalyticsDashboard);
    expect(await screen.findByText(/Performance report data is unavailable/)).toBeInTheDocument();
    expect(screen.queryByText('Quality Score')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Export PDF/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Export JSON/ })).toBeDisabled();
    expect(mocks.pdf).not.toHaveBeenCalled();
  });
  it('hides prior performance and disables exports after refresh failure, then recovers', async () => {
    const { client } = mount(AnalyticsDashboard);
    await screen.findByText('Synthetic Employee');
    mocks.notes.mockRejectedValue(new Error('Unavailable'));
    await act(() => client.invalidateQueries({ queryKey: ['noteConversions'] }));
    expect(await screen.findByText(/Performance report data is unavailable/)).toBeInTheDocument();
    expect(screen.queryByText('Synthetic Employee')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Export PDF/ })).toBeDisabled();
    mocks.notes.mockResolvedValue([]);
    fireEvent.click(screen.getByRole('button', { name: 'Retry report data' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Export PDF/ })).toBeEnabled());
  });
  it('does not grade a person with missing compliance measurements as needing improvement', async () => {
    mocks.notes.mockResolvedValue([{ id: 'note-a', nurse_email: staff.email, created_date: date }]);
    mocks.audits.mockResolvedValue([]);
    mount(AnalyticsDashboard);
    await screen.findByText('Synthetic Employee');
    expect(screen.queryByText('Needs Improvement')).not.toBeInTheDocument();
    expect(screen.getAllByText('Not measured').length).toBeGreaterThan(0);
  });

  it('exports missing measurements explicitly while retaining measured zero scores', async () => {
    mocks.notes.mockResolvedValue([{ id: 'note-a', nurse_email: staff.email, created_date: date, quality_score: 0 }]);
    mocks.audits.mockResolvedValue([]);
    mount(AnalyticsDashboard);
    await screen.findByText('Synthetic Employee');
    fireEvent.click(screen.getByRole('button', { name: /Export PDF/ }));
    await waitFor(() => expect(mocks.pdf).toHaveBeenCalledOnce());
    const metrics = mocks.pdf.mock.calls[0][0].content.find(item => item.type === 'table').rows;
    expect(metrics).toContainEqual(['Average Documentation Time', 'Not measured']);
    expect(metrics).toContainEqual(['Average Compliance Score', 'Not measured']);
    expect(metrics).toContainEqual(['Average Quality Score', '0.0%']);
  });

  it('marks capped source reads and blocks exporting partial performance totals', async () => {
    mocks.notes.mockResolvedValue(Array.from({ length: 5000 }, (_, i) => ({ id: `note-${i}`, created_date: date })));
    mount(AnalyticsDashboard);
    expect(await screen.findByText(/A source reached its record limit/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Export PDF/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Export JSON/ })).toBeDisabled();
  });

  it('measures employee progress against assigned courses, not the size of the module catalog', async () => {
    mocks.assignments.mockResolvedValue([
      { id: 'assignment-a', assigned_to_user_id: staff.email, status: 'completed' },
      { id: 'assignment-b', assigned_to_user_id: staff.email, status: 'in_progress' },
    ]);
    mount(AdminTrainingAnalytics);
    await userEvent.click(await screen.findByRole('tab', { name: 'Nurse Performance' }));
    expect(await screen.findByRole('progressbar', { name: 'Synthetic Employee assigned training completion' })).toHaveAttribute('aria-valuenow', '50');
  });

  it.each([['performance', AnalyticsDashboard], ['training', AdminTrainingAnalytics]])('refreshes the %s roster after existing allUsers invalidation', async (_label, Page) => {
    const { client } = mount(Page);
    await waitFor(() => expect(mocks.users).toHaveBeenCalledOnce());
    await waitFor(() => expect(client.isFetching()).toBe(0));
    await act(() => client.invalidateQueries({ queryKey: ['allUsers'] }));
    await waitFor(() => expect(mocks.users).toHaveBeenCalledTimes(2));
  });

  it('blocks totals and export for an invalid custom date range and recovers after correction', async () => {
    mount(AnalyticsDashboard);
    await screen.findByText('Synthetic Employee');
    await userEvent.click(screen.getAllByRole('combobox')[0]);
    await userEvent.click(await screen.findByRole('option', { name: 'Custom Range' }));
    fireEvent.change(screen.getByLabelText('Start Date'), { target: { value: '2024-01-01' } });
    fireEvent.change(screen.getByLabelText('End Date'), { target: { value: '2026-01-01' } });
    expect(screen.getByText(/covering at most 366 calendar days/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Export PDF/ })).toBeDisabled();
    expect(screen.queryByText('Quality Score')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('End Date'), { target: { value: '2024-01-02' } });
    await waitFor(() => expect(screen.getByRole('button', { name: /Export PDF/ })).toBeEnabled());
    expect(screen.queryByText(/covering at most 366 calendar days/)).not.toBeInTheDocument();
  });

  it.each([['performance', AnalyticsDashboard, 'notes', { records: [] }], ['training', AdminTrainingAnalytics, 'recommendations', {}], ['training', AdminTrainingAnalytics, 'assignments', [{ id: 'assignment-a', completion_date: '2026-02-31' }]]])('rejects malformed %s source data from %s', async (_label, Page, source, value) => {
    mocks[source].mockResolvedValue(value);
    mount(Page);
    expect(await screen.findByRole('button', { name: 'Retry report data' })).toBeInTheDocument();
    expect(screen.queryByText('Quality Score')).not.toBeInTheDocument();
    expect(screen.queryByText('Total Completions')).not.toBeInTheDocument();
  });
});
