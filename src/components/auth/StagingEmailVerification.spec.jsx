// @vitest-environment-options {"url":"https://caremetric-pennsync-staging-2026-09-d54f1ef7.base44.app"}
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import StagingEmailVerification from './StagingEmailVerification';
import SignInScreen from './SignInScreen';

const mocks = vi.hoisted(() => ({ setToken: vi.fn(), post: vi.fn(), navigateToLogin: vi.fn() }));
vi.mock('@/api/base44Client', () => ({ base44: { auth: { setToken: mocks.setToken } } }));
vi.mock('@/lib/base44AxiosClient', () => ({ createAxiosClient: () => ({ post: mocks.post }) }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ navigateToLogin: mocks.navigateToLogin }) }));
vi.mock('@/lib/app-params', () => ({
  appParams: { appId: '6a9881683dc68a0bd54f1ef7', serverUrl: 'https://base44.app' },
  peekPendingAccessToken: () => null, confirmPendingAccessToken: vi.fn(), declinePendingAccessToken: vi.fn(),
}));
const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VITE_BASE44_APP_ID', '6a9881683dc68a0bd54f1ef7');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function fill(user) {
  await user.type(screen.getByLabelText('Email address'), 'test@example.com');
  await user.type(screen.getByLabelText('Six-digit verification code'), '123456');
}

describe('staging email code form', () => {
  it('guides an unverified staging sign-in to the code form and carries only its email', async () => {
    mocks.post.mockRejectedValueOnce(Object.assign(new Error('Please verify your email'), { status: 400 }));
    const user = userEvent.setup();
    render(<MemoryRouter><SignInScreen onAuthenticated={vi.fn()} /></MemoryRouter>);
    await user.type(screen.getByLabelText('Email'), 'test@example.com');
    await user.type(screen.getByLabelText('Password'), 'test-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Use Enter email verification code below');
    await user.click(screen.getByRole('button', { name: 'Enter email verification code' }));
    expect(screen.getByLabelText('Email address')).toHaveValue('test@example.com');
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Six-digit verification code')).toHaveValue('');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('provides the staging entry without changing the signed-in session', async () => {
    const user = userEvent.setup();
    const authenticated = vi.fn();
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ access_token: 'discarded-token' }) });
    render(<MemoryRouter><SignInScreen onAuthenticated={authenticated} /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: 'Enter email verification code' }));
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Verify email' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Email verified for test@example.com');
    expect(screen.getByLabelText('Six-digit verification code')).toHaveValue('');
    expect(mocks.setToken).not.toHaveBeenCalled();
    expect(mocks.post).not.toHaveBeenCalled();
    expect(authenticated).not.toHaveBeenCalled();
    expect(mocks.navigateToLogin).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Email address'), '.other');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('omits the entry and the form in a production build', () => {
    vi.stubEnv('VITE_BASE44_APP_ID', '694ec16e72e01b60d22f7cbf');
    render(<MemoryRouter><SignInScreen /></MemoryRouter>);
    expect(screen.queryByRole('button', { name: 'Enter email verification code' })).not.toBeInTheDocument();
    const { container } = render(<StagingEmailVerification onBack={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('clears rejected codes, explains expiry, and never renders a server error body', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ message: 'private-response' }) });
    render(<StagingEmailVerification onBack={vi.fn()} />);
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Verify email' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('newest unexpired code');
    expect(screen.getByLabelText('Six-digit verification code')).toHaveValue('');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText('private-response')).not.toBeInTheDocument();
  });

  it('suppresses arbitrary transport errors', async () => {
    const user = userEvent.setup();
    fetchMock.mockRejectedValue(new Error('sensitive transport payload'));
    render(<StagingEmailVerification onBack={vi.fn()} />);
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Verify email' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('check your connection');
    expect(screen.getByRole('alert')).not.toHaveTextContent('sensitive');
  });

  it('blocks duplicate submissions and aborts a departed form without retaining a late result', async () => {
    let resolve;
    fetchMock.mockReturnValue(new Promise((done) => { resolve = done; }));
    const user = userEvent.setup();
    const { unmount } = render(<StagingEmailVerification onBack={vi.fn()} />);
    await fill(user);
    const submit = screen.getByRole('button', { name: 'Verify email' });
    fireEvent.submit(submit.closest('form'));
    fireEvent.submit(submit.closest('form'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Email address')).toBeDisabled();
    expect(screen.getByLabelText('Six-digit verification code')).toBeDisabled();
    const signal = fetchMock.mock.calls[0][1].signal;
    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => resolve({ ok: true, status: 200, json: async () => ({ access_token: 'late-token' }) }));
    expect(mocks.setToken).not.toHaveBeenCalled();
  });

  it('bounds a stalled request and clears its code', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    render(<StagingEmailVerification onBack={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText('Six-digit verification code'), { target: { value: '123456' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Verify email' }).closest('form'));
    await act(async () => vi.advanceTimersByTimeAsync(20000));
    expect(screen.getByRole('alert')).toHaveTextContent('could not be completed');
    expect(screen.getByLabelText('Six-digit verification code')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Verify email' })).toBeEnabled();
  });

  it('does not show success for an incomplete verification response', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    const user = userEvent.setup();
    render(<StagingEmailVerification onBack={vi.fn()} />);
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Verify email' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('could not be confirmed'));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
