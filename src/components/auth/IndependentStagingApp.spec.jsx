import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { stagingFixture, stagingEmails } from '@/test/independentStagingFixture';

const transport = vi.hoisted(() => ({ fetch: vi.fn(), sdk: vi.fn(), axios: vi.fn() }));
vi.mock('@base44/sdk', () => ({ createClient: transport.sdk }));
vi.mock('@/lib/base44AxiosClient', () => ({ createAxiosClient: transport.axios }));
vi.mock('@/lib/independentStagingSession', async () => {
  const { createIndependentStagingAdapter, readIndependentStagingConfig } = await import('@/lib/independentStagingAdapter');
  const { stagingEnv } = await import('@/test/independentStagingFixture');
  const adapter = createIndependentStagingAdapter(readIndependentStagingConfig(stagingEnv), { fetchImpl: transport.fetch });
  return { independentStagingAdapter: adapter, independentStagingAuth: adapter.auth };
});
// jsdom has no durable IndexedDB. Preserve the real provider/realm/query teardown;
// existing storage suites independently cover the browser persistence boundary.
vi.mock('@/lib/phiStorage', async importOriginal => ({ ...(await importOriginal()),
  purgeAuthorityBoundDrafts: vi.fn(async () => {}), purgeRefetchablePhiForAuthorityTransition: vi.fn(async () => {}),
  reconcileAuthorityBoundDrafts: vi.fn(async () => {}),
}));
import App from '@/App';
import { queryClientInstance } from '@/lib/query-client';

it('real app sign-in, agency choice and Patients list remain fenced through logout and a late response', async () => {
  const fixture = stagingFixture(); transport.fetch.mockImplementation(fixture.fetch);
  transport.sdk.mockImplementation(() => { throw new Error('BASE44_SDK_FORBIDDEN'); });
  transport.axios.mockImplementation(() => { throw new Error('BASE44_AUTH_FORBIDDEN'); });
  window.history.replaceState(null, '', '/Patients');
  const user = userEvent.setup();
  render(<App />);
  const email = await screen.findByLabelText(/^Email$/);
  await user.type(email, stagingEmails[0]);
  await user.type(screen.getByLabelText(/^Password$/), 'Synthetic-accepted-password');
  await user.click(screen.getByRole('button', { name: /^Sign in$/ }));
  await screen.findByRole('heading', { name: 'Choose the agency workspace to open' });
  expect(screen.queryByText('Synthetic Patient A1')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /Synthetic Agency A/ }));
  await screen.findByRole('heading', { name: 'Patient Management' });
  await screen.findByText('Synthetic Patient A1');
  expect(screen.queryByRole('button', { name: 'Add Patient' })).not.toBeInTheDocument();
  expect(screen.queryByText(/^active$/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'View Details' })).toBeDisabled();
  let entered, release;
  const arrival = new Promise(resolve => { entered = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  fixture.holdPatient = async () => { entered(); await held; };
  act(() => { void queryClientInstance.invalidateQueries({ queryKey: ['patients', 'authorized-list'] }); });
  await arrival;
  await user.click(screen.getByRole('button', { name: 'Sign out' }));
  await waitFor(() => expect(fixture.live.size).toBe(0));
  await act(async () => { release(); });
  await waitFor(() => expect(screen.queryByText('Synthetic Patient A1')).not.toBeInTheDocument());
  expect(transport.sdk).not.toHaveBeenCalled(); expect(transport.axios).not.toHaveBeenCalled();
  expect(fixture.requests.every(request => request.url.startsWith('http://127.0.0.1:54321/'))).toBe(true);
  expect(localStorage.getItem('base44_access_token')).toBeNull();
});
