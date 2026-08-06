/**
 * Branded sign-in screen (SignInScreen) behavior tests.
 *
 * The screen replaces the redirect to the platform-hosted /login page, so
 * these tests pin down what that swap must deliver: the PennSync brand is
 * visible with the logo rendered whole (object-contain, never a cropping
 * mask), credentials sign the user in via the direct auth endpoint (NOT the
 * SDK helper whose 401 path forces a logout redirect), a wrong password shows
 * an inline error instead of navigating away, and the password-reset +
 * hosted-page fallbacks work.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import userEvent from '@testing-library/user-event';
import SignInScreen from './SignInScreen';
import { BRAND_LOGO_URL } from '@/lib/brand';

// The screen links to /privacy with a router <Link>, so it must mount inside a Router.
const render = (ui) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>);

const mocks = vi.hoisted(() => ({
  navigateToLogin: vi.fn(),
  setToken: vi.fn(),
  resetPasswordRequest: vi.fn(async () => ({})),
  post: vi.fn(),
  peekPendingAccessToken: vi.fn(() => null),
  confirmPendingAccessToken: vi.fn(() => false),
  declinePendingAccessToken: vi.fn(),
}));

vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ navigateToLogin: mocks.navigateToLogin }),
}));

vi.mock('@/api/base44Client', () => ({
  base44: {
    auth: {
      setToken: mocks.setToken,
      resetPasswordRequest: mocks.resetPasswordRequest,
    },
  },
}));

vi.mock('@/lib/app-params', () => ({
  appParams: { appId: 'app-1', serverUrl: 'https://server.test' },
  peekPendingAccessToken: () => mocks.peekPendingAccessToken(),
  confirmPendingAccessToken: () => mocks.confirmPendingAccessToken(),
  declinePendingAccessToken: () => mocks.declinePendingAccessToken(),
}));

vi.mock('@base44/sdk/dist/utils/axios-client', () => ({
  createAxiosClient: () => ({ post: mocks.post }),
}));

vi.mock('@/lib/base44AxiosClient', () => ({
  createAxiosClient: () => ({ post: mocks.post }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.peekPendingAccessToken.mockReturnValue(null);
  mocks.confirmPendingAccessToken.mockReturnValue(false);
});

const fillCredentials = async (user, email = 'nurse@agency.com', password = 'hunter22') => {
  await user.type(screen.getByLabelText(/email/i), email);
  await user.type(screen.getByLabelText(/^password$/i), password);
};

describe('SignInScreen', () => {
  it('renders the PennSync brand with the logo un-cropped', () => {
    render(<SignInScreen onAuthenticated={vi.fn()} />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Welcome to PennSync');
    expect(screen.getByText(/by caremetric/i)).toBeInTheDocument();
    expect(screen.getByText(/sign in to continue/i)).toBeInTheDocument();

    const logo = screen.getByAltText(/pennsync logo/i);
    expect(logo).toHaveAttribute('src', BRAND_LOGO_URL);
    // object-contain scales the whole image into the tile; a cropping mask
    // (object-cover / tight overflow-hidden circle) is what cut the logo off
    // on the hosted page.
    expect(logo.className).toContain('object-contain');
  });

  it('signs in with email/password, stores the token and hands off to the app', async () => {
    mocks.post.mockResolvedValueOnce({ access_token: 'tok-123' });
    const onAuthenticated = vi.fn();
    const user = userEvent.setup();
    render(<SignInScreen onAuthenticated={onAuthenticated} />);

    await fillCredentials(user);
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalled());
    expect(mocks.post).toHaveBeenCalledWith('/apps/app-1/auth/login', {
      email: 'nurse@agency.com',
      password: 'hunter22',
    });
    expect(mocks.setToken).toHaveBeenCalledWith('tok-123');
  });

  it('shows an inline error on wrong credentials instead of redirecting', async () => {
    mocks.post.mockRejectedValueOnce(Object.assign(new Error('Invalid credentials'), { status: 401 }));
    const onAuthenticated = vi.fn();
    const user = userEvent.setup();
    render(<SignInScreen onAuthenticated={onAuthenticated} />);

    await fillCredentials(user, 'nurse@agency.com', 'wrong-pass');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/incorrect email or password/i);
    expect(onAuthenticated).not.toHaveBeenCalled();
    expect(mocks.setToken).not.toHaveBeenCalled();
    expect(mocks.navigateToLogin).not.toHaveBeenCalled();
  });

  it('sends a password-reset email from the forgot-password flow', async () => {
    const user = userEvent.setup();
    render(<SignInScreen onAuthenticated={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /forgot password/i }));
    expect(screen.getByRole('heading', { name: /reset your password/i })).toBeInTheDocument();

    await user.type(screen.getByLabelText(/email/i), 'nurse@agency.com');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));

    await waitFor(() =>
      expect(mocks.resetPasswordRequest).toHaveBeenCalledWith('nurse@agency.com')
    );
    expect(await screen.findByText(/check your email/i)).toBeInTheDocument();

    // And the path back to the sign-in form works.
    await user.click(screen.getByRole('button', { name: /back to sign in/i }));
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeInTheDocument();
  });

  it('falls back to the platform-hosted page for sign-up and trouble signing in', async () => {
    const user = userEvent.setup();
    render(<SignInScreen onAuthenticated={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /sign up/i }));
    await user.click(screen.getByRole('button', { name: /standard sign-in page/i }));
    expect(mocks.navigateToLogin).toHaveBeenCalledTimes(2);
  });

  it('requires confirm before accepting a pending magic-link token', async () => {
    mocks.peekPendingAccessToken.mockReturnValue('pending-tok');
    mocks.confirmPendingAccessToken.mockReturnValue(true);
    const onAuthenticated = vi.fn();
    const user = userEvent.setup();
    render(<SignInScreen onAuthenticated={onAuthenticated} />);

    expect(screen.getByRole('heading', { name: /continue with this sign-in link/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^sign in$/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^continue$/i }));
    expect(mocks.confirmPendingAccessToken).toHaveBeenCalled();
    expect(onAuthenticated).toHaveBeenCalled();
  });

  it('decline clears a pending magic-link token and shows the password form', async () => {
    mocks.peekPendingAccessToken.mockReturnValue('pending-tok');
    const user = userEvent.setup();
    render(<SignInScreen onAuthenticated={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /^decline$/i }));
    expect(mocks.declinePendingAccessToken).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeInTheDocument();
  });
});
