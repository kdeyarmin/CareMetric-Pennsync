// Which screen a staff member sees when the page was opened with an invitation or
// recovery link, and what happens after they use it.
//
// In its own file because it needs an owned backend and a pending link, and the
// rest of `SignInScreen.spec.jsx` is the Base44 path with neither.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render as rtlRender, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import userEvent from '@testing-library/user-event';
import SignInScreen from './SignInScreen';

const render = (ui) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>);

const mocks = vi.hoisted(() => ({
  setPasswordFromLink: vi.fn(),
  signIn: vi.fn(),
  checkAppState: vi.fn(),
  link: { type: 'invite', token: 'invitetoken-aaaaaa' },
}));

vi.mock('@/lib/independentStagingSession', () => ({
  // Production mode: an owned backend that is not the synthetic staging one.
  get ownedBackendAuth() {
    return { signIn: mocks.signIn, setPasswordFromLink: mocks.setPasswordFromLink, hasSession: () => false };
  },
  get independentStagingAuth() { return null; },
}));
vi.mock('@/lib/ownedBackendLinkParams', () => ({
  get pendingLink() { return mocks.link; },
  LINK_TYPES: ['invite', 'recovery'],
  readLinkParams: () => mocks.link,
}));
vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ navigateToLogin: vi.fn(), checkAppState: mocks.checkAppState }),
}));
vi.mock('@/api/base44Client', () => ({ base44: { auth: { setToken: vi.fn() } } }));
vi.mock('@/lib/app-params', () => ({
  appParams: { appId: 'app-1', serverUrl: 'https://server.test' },
  peekPendingAccessToken: () => null,
  confirmPendingAccessToken: () => false,
  declinePendingAccessToken: () => {},
}));
vi.mock('@/lib/base44AxiosClient', () => ({ createAxiosClient: () => ({ post: vi.fn() }) }));

describe('arriving on an invitation or recovery link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.link = { type: 'invite', token: 'invitetoken-aaaaaa' };
    mocks.setPasswordFromLink.mockResolvedValue({ email: 'nurse@agency.example' });
    mocks.signIn.mockResolvedValue(undefined);
  });

  it('asks for a password instead of offering a sign-in form', () => {
    render(<SignInScreen />);
    // Somebody arriving on an invitation has no password yet, so offering them one
    // to type would be the wrong question.
    expect(screen.getByRole('button', { name: 'Accept invitation' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  });

  it('says what a recovery link is for, in its own words', () => {
    mocks.link = { type: 'recovery', token: 'recoverytoken-bbbbbb' };
    render(<SignInScreen />);
    expect(screen.getByRole('button', { name: 'Set password' })).toBeInTheDocument();
  });

  it('hands over to the sign-in form with the address filled in, and signs nobody in', async () => {
    const user = userEvent.setup();
    render(<SignInScreen />);
    await user.type(screen.getByLabelText('Work email'), 'Nurse@Agency.Example');
    await user.type(screen.getByLabelText('New password'), 'a-new-long-password');
    await user.type(screen.getByLabelText('Repeat new password'), 'a-new-long-password');
    await user.click(screen.getByRole('button', { name: 'Accept invitation' }));
    await user.click(await screen.findByRole('button', { name: 'Go to sign in' }));
    // A LINK NEVER BECOMES A SESSION: the handover is to the form, not past it, so
    // the person signs in with the password they just set.
    const address = await screen.findByLabelText('Email');
    expect(address).toHaveValue('nurse@agency.example');
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(mocks.checkAppState).not.toHaveBeenCalled();
    await waitFor(() => expect(mocks.setPasswordFromLink).toHaveBeenCalledWith(
      'Nurse@Agency.Example', 'invite', 'invitetoken-aaaaaa', 'a-new-long-password'));
  });

  it('shows the ordinary form when the page carries no link', () => {
    mocks.link = null;
    render(<SignInScreen />);
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept invitation' })).not.toBeInTheDocument();
  });
});
