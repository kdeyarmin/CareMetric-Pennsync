import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ readiness: vi.fn(), auth: {} }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/functions/getTeamTrainingReadiness', () => ({ getTeamTrainingReadiness: mocks.readiness }));
vi.mock('@/components/training/EmployeeTrainingDetails', () => ({ default: () => <p>Training details</p> }));
import EmployeeTrainingProfile from './EmployeeTrainingProfile';
function openProfile(url = '/EmployeeTrainingProfile?id=employee-a') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[url]}><EmployeeTrainingProfile /></MemoryRouter></QueryClientProvider>);
  return { ...view, client };
}
beforeEach(() => {
  mocks.auth = { user: { id: 'user-a', role: 'user' }, tenantAuthorityKey: 'verified-agency-a', tenantContext: { tenant_role: 'manager' } };
  mocks.readiness.mockReset().mockResolvedValue({ data: { employee: { name: 'Test employee', email: 'employee@example.test' } } });
});
afterEach(() => vi.useRealTimers());
describe('employee training profile entry', () => {
  it('ends a hung profile read with a retry, without publishing its late response', async () => {
    vi.useFakeTimers();
    let resolve;
    mocks.readiness.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const { unmount, client } = openProfile();
    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(screen.getByRole('status')).toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(30001); });
      expect(screen.getByRole('heading', { name: 'Employee profile unavailable' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
      await act(async () => {
        screen.getByRole('button', { name: 'Try again' }).click();
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(screen.getByText('Test employee')).toBeInTheDocument();
      await act(async () => { resolve({ data: { employee: { name: 'Late employee' } } }); });
      expect(screen.queryByText('Late employee')).not.toBeInTheDocument();
    } finally { unmount(); client.clear(); }
  });
  it('gives regular users a dashboard exit without requesting another employee’s data', () => {
    mocks.auth.tenantContext.tenant_role = 'clinician';
    openProfile();
    expect(screen.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute('href', '/Dashboard');
    expect(screen.getByRole('alert')).toHaveTextContent('Manager or administrator access is required.');
    expect(mocks.readiness).not.toHaveBeenCalled();
  });
  it('prompts administrators to select an employee when the start URL has no id', () => {
    mocks.auth.user.role = 'admin';
    openProfile('/EmployeeTrainingProfile');
    expect(screen.getByText('Select an employee from the staff leaderboard to view their profile.')).toBeInTheDocument();
    expect(mocks.readiness).not.toHaveBeenCalled();
  });
});