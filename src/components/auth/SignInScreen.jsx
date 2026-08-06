import { useState } from 'react';
import { Link } from 'react-router';
import { base44 } from '@/api/base44Client';
import {
  appParams,
  peekPendingAccessToken,
  confirmPendingAccessToken,
  declinePendingAccessToken,
} from '@/lib/app-params';
import { createAxiosClient } from '@/lib/base44AxiosClient';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Eye, EyeOff, Loader2, MailCheck, ShieldAlert } from 'lucide-react';
import { BRAND_LOGO_URL, APP_NAME, PLATFORM_NAME } from '@/lib/brand';

/**
 * Branded in-app sign-in screen: PennSync by CareMetric.
 *
 * Rendered by App.jsx in place of the old redirect to the platform-hosted
 * /login page, whose branding (app name, logo mask that cropped the logo) is
 * configured outside this repo. Rendering in place also preserves deep links:
 * the URL never changes, so after sign-in the user lands exactly where they
 * were headed.
 *
 * Flows handled here: email/password sign-in and the password-reset request.
 * Everything else (sign-up for invited users, OTP verification, captcha
 * challenges) falls back to the platform-hosted page via navigateToLogin().
 *
 * Also handles a pending `?access_token=` handoff that arrived without a
 * trusted referrer or planted auth_state (email-style magic links). Those are
 * stashed by app-params and require an explicit confirm before becoming a
 * session — closes silent logged-out login CSRF in-repo.
 */

/** Default post-auth behavior: reload so the app bootstraps with the stored
 * token (app-params reads `base44_access_token` from localStorage on load). */
const reloadApp = () => window.location.reload();

const SignInScreen = ({ onAuthenticated = reloadApp }) => {
  const { navigateToLogin } = useAuth();
  const [mode, setMode] = useState('signin'); // 'signin' | 'reset' | 'reset-sent'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pendingToken, setPendingToken] = useState(() => peekPendingAccessToken());

  const switchMode = (nextMode) => {
    setMode(nextMode);
    setError('');
  };

  const handleConfirmPending = () => {
    if (busy) return;
    setError('');
    if (!confirmPendingAccessToken()) {
      setPendingToken(null);
      setError('That sign-in link is no longer available. Please sign in with email and password.');
      return;
    }
    setBusy(true);
    onAuthenticated();
  };

  const handleDeclinePending = () => {
    declinePendingAccessToken();
    setPendingToken(null);
    setError('');
  };

  const handleSignIn = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      // Call the login endpoint directly rather than through
      // base44.auth.loginViaEmailPassword: the SDK helper reacts to a 401
      // (i.e. a wrong password) by running the full logout redirect, which
      // reloads the page and eats the inline "incorrect password" error.
      const authClient = createAxiosClient({
        baseURL: `${appParams.serverUrl}/api`,
        headers: { 'X-App-Id': appParams.appId },
        interceptResponses: true,
      });
      const result = await authClient.post(`/apps/${appParams.appId}/auth/login`, {
        email: email.trim(),
        password,
      });
      if (!result?.access_token) {
        // e.g. the account still needs OTP/email verification — that flow
        // lives on the hosted page.
        setError('This account needs an extra verification step. Please continue on the standard sign-in page (link below).');
        return;
      }
      // Password login wins over any stashed magic-link handoff.
      declinePendingAccessToken();
      setPendingToken(null);
      base44.auth.setToken(result.access_token);
      onAuthenticated();
    } catch (err) {
      const status = err?.status;
      if (/turnstile|captcha/i.test(String(err?.message || ''))) {
        setError('Additional verification is required. Please continue on the standard sign-in page (link below).');
      } else if (status === 400 || status === 401) {
        setError('Incorrect email or password. Please try again.');
      } else if (status === 429) {
        setError('Too many sign-in attempts. Please wait a moment and try again.');
      } else {
        // Base44Error carries clean server messages worth showing; raw axios
        // transport boilerplate ("Request failed with status code 502") isn't
        // user-facing — swap it for a friendly generic.
        const msg = String(err?.message || '');
        setError(!msg || /^request failed/i.test(msg) || /network error/i.test(msg)
          ? 'Something went wrong signing you in. Please try again, or use the standard sign-in page (link below).'
          : msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleResetRequest = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      await base44.auth.resetPasswordRequest(email.trim());
      setMode('reset-sent');
    } catch {
      setError('Couldn’t send the reset email. Please try again, or use the standard sign-in page (link below).');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-navy-50 via-white to-navy-100 p-4">
      <div className="w-full max-w-md">
        {/* Brand hero: logo shown whole (object-contain in a padded tile — never
            masked/cropped) above the PennSync lockup. */}
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-24 w-24 items-center justify-center rounded-3xl bg-white p-2.5 shadow-xl ring-1 ring-slate-200/70">
            <img
              src={BRAND_LOGO_URL}
              alt={`${APP_NAME} logo`}
              className="h-full w-full rounded-2xl object-contain"
            />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-navy-900">
            Welcome to Penn<span className="text-gold-600">Sync</span>
          </h1>
          <p className="mt-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">
            by {PLATFORM_NAME}
          </p>
          <p className="mt-3 text-sm text-slate-500">
            {pendingToken
              ? 'Confirm sign-in link'
              : mode === 'signin'
                ? 'Sign in to continue'
                : 'Password reset'}
          </p>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-navy-600 via-navy-500 to-gold-400" />
          <div className="p-8">
            {pendingToken && (
              <div className="space-y-5">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 ring-1 ring-inset ring-amber-200/70">
                  <ShieldAlert className="h-7 w-7 text-amber-700" aria-hidden />
                </div>
                <div className="text-center">
                  <h2 className="text-lg font-semibold text-slate-900">Continue with this sign-in link?</h2>
                  <p className="mt-2 text-sm text-slate-600">
                    A sign-in link opened this page. Confirm only if you expected it
                    (for example from your email). Decline if you did not request it.
                  </p>
                </div>
                {error && (
                  <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {error}
                  </p>
                )}
                <Button type="button" disabled={busy} onClick={handleConfirmPending} className="h-11 w-full">
                  {busy ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Continuing…</>) : 'Continue'}
                </Button>
                <Button type="button" variant="outline" disabled={busy} onClick={handleDeclinePending} className="h-11 w-full">
                  Decline
                </Button>
                <p className="text-center text-xs text-slate-500">
                  Or sign in with email and password below after declining.
                </p>
              </div>
            )}

            {!pendingToken && mode === 'signin' && (
              <form onSubmit={handleSignIn} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="signin-email" className="text-slate-700">Email</Label>
                  <Input
                    id="signin-email"
                    type="email"
                    autoComplete="email"
                    required
                    placeholder="you@agency.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={busy}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="signin-password" className="text-slate-700">Password</Label>
                    <button
                      type="button"
                      onClick={() => switchMode('reset')}
                      className="text-xs font-medium text-navy-600 hover:text-navy-800"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <Input
                      id="signin-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      required
                      placeholder="Your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={busy}
                      className="pr-11"
                    />
                    <button
                      type="button"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-400 hover:text-slate-600"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                {error && (
                  <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {error}
                  </p>
                )}
                <Button type="submit" disabled={busy} className="h-11 w-full">
                  {busy ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Signing in…</>) : 'Sign in'}
                </Button>
                <p className="text-center text-sm text-slate-500">
                  Need an account?{' '}
                  <button
                    type="button"
                    onClick={() => navigateToLogin()}
                    className="font-semibold text-navy-700 hover:text-navy-900"
                  >
                    Sign up
                  </button>
                </p>
              </form>
            )}

            {!pendingToken && mode === 'reset' && (
              <form onSubmit={handleResetRequest} className="space-y-5">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Reset your password</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Enter your email and we’ll send you a link to reset it.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reset-email" className="text-slate-700">Email</Label>
                  <Input
                    id="reset-email"
                    type="email"
                    autoComplete="email"
                    required
                    placeholder="you@agency.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={busy}
                  />
                </div>
                {error && (
                  <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {error}
                  </p>
                )}
                <Button type="submit" disabled={busy} className="h-11 w-full">
                  {busy ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending…</>) : 'Send reset link'}
                </Button>
                <button
                  type="button"
                  onClick={() => switchMode('signin')}
                  className="mx-auto flex items-center gap-1.5 text-sm font-medium text-navy-600 hover:text-navy-800"
                >
                  <ArrowLeft className="h-4 w-4" /> Back to sign in
                </button>
              </form>
            )}

            {!pendingToken && mode === 'reset-sent' && (
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-navy-50 ring-1 ring-inset ring-navy-200/60">
                  <MailCheck className="h-7 w-7 text-navy-600" />
                </div>
                <h2 className="text-lg font-semibold text-slate-900">Check your email</h2>
                <p className="mt-2 text-sm text-slate-600">
                  If an account exists for <span className="font-medium text-slate-800">{email}</span>,
                  a password-reset link is on its way.
                </p>
                <Button variant="outline" onClick={() => switchMode('signin')} className="mt-6 w-full">
                  <ArrowLeft className="mr-2 h-4 w-4" /> Back to sign in
                </Button>
              </div>
            )}
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-slate-400">
          Trouble signing in?{' '}
          <button
            type="button"
            onClick={() => navigateToLogin()}
            className="font-medium text-navy-600 underline-offset-2 hover:underline"
          >
            Use the standard sign-in page
          </button>
        </p>
        <p className="mt-2 text-center text-xs text-slate-400">
          Secure clinical platform · HIPAA compliant ·{' '}
          <Link to="/privacy" className="underline-offset-2 hover:underline">
            Privacy Policy
          </Link>
        </p>
      </div>
    </div>
  );
};

export default SignInScreen;
