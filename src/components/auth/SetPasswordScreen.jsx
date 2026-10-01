import { useRef, useState } from 'react';
import { ownedBackendAuth } from '@/lib/independentStagingSession';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { BRAND_LOGO_URL, APP_NAME, PLATFORM_NAME } from '@/lib/brand';

/**
 * Accept an invitation, or set a new password from a recovery link.
 *
 * Rendered in place of the sign-in form when the page was opened with a link, so
 * the URL never changes and a deep link survives. Both kinds of link end in the
 * same question — choose a password — so they are one screen with one sentence of
 * difference.
 *
 * THE ADDRESS IS TYPED, not read out of the link. A link therefore identifies
 * nobody, a forwarded one names nobody, and no address goes in a URL. The person
 * accepting an invitation knows their own address.
 *
 * AND A LINK NEVER BECOMES A SESSION. This screen cannot sign anybody in: the
 * adapter revokes the grant the link bought as soon as the password is written,
 * so on success it hands the person to the ordinary sign-in form with their
 * address filled in. That is the client's property and this screen is built not to
 * undo it — there is no `onAuthenticated` here, deliberately, because having one
 * would be the way it got undone. Success renders a confirmation and the person
 * leaves it by their own click, because a parent that unmounts this screen on the
 * handover would otherwise swallow the only sentence saying it worked.
 *
 * Nothing on this screen sends anything. Asking for a new link would be a message
 * to a real person, which this change does not do; somebody who needs one is told
 * to ask their administrator.
 */

/** The minimum the client will accept. Shown rather than discovered by refusal. */
export const MINIMUM_PASSWORD_LENGTH = 12;

const SetPasswordScreen = ({ link, onPasswordSet }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  // Set alongside `done` when the password was written but the client could not
  // revoke what the link bought. Nothing the person does fixes that, so the note
  // is for their administrator rather than an instruction to them.
  const [stale, setStale] = useState(false);
  const operationRef = useRef(0);
  const invite = link?.type === 'invite';

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (busy || done) return;
    setError('');
    // Checked here as well as in the client, because the client's refusal is one
    // code for a password that is too short and one for a link that is wrong, and
    // a person who typed two different passwords deserves to be told that.
    if (password !== confirmation) {
      setError('Those two passwords are different. Please retype them.');
      return;
    }
    if (password.length < MINIMUM_PASSWORD_LENGTH) {
      setError(`Please choose a password of at least ${MINIMUM_PASSWORD_LENGTH} characters.`);
      return;
    }
    setBusy(true);
    const operation = ++operationRef.current;
    const submitted = password;
    // Cleared before the request rather than after it: nothing on this screen
    // needs them again, and a failure leaves the fields empty rather than holding
    // a password through whatever the failure turns out to be.
    setPassword(''); setConfirmation('');
    try {
      await ownedBackendAuth.setPasswordFromLink(email, link.type, link.tokenHash, submitted);
      if (operation !== operationRef.current) return;
      // The handover is NOT performed here. This screen's parent takes the
      // handover as the cue to unmount it, so calling it on success would replace
      // the confirmation with the sign-in form in the same tick and the person
      // would never be told their password was set — the form would simply
      // reappear, which reads like a failure. Success renders the confirmation and
      // the person leaves it by their own click.
      setDone(true);
    } catch (caught) {
      if (operation !== operationRef.current) return;
      const code = caught?.code;
      // THE PASSWORD WAS WRITTEN. This code is raised only by the client's own
      // cleanup, after the write succeeded, so telling the person it failed is
      // false twice over: they would retry, the link is spent, and the retry's
      // answer sends them to an administrator for a new invitation to an account
      // that already has a password. A reviewer walked exactly that path. So this
      // is the done state, with the one sentence they can act on.
      if (code === 'AUTHORITY_SESSION_CLEANUP_FAILED') { setDone(true); setStale(true); return; }
      const rejected = code === 'AUTHENTICATION_FAILED' || caught?.status === 401;
      setError(
        rejected
          ? invite
            ? 'This invitation link is no longer valid, or it was issued for a different email address. Ask your administrator to send a new one.'
            : 'This password reset link is no longer valid, or it was issued for a different email address. Ask your administrator to send a new one.'
          : code === 'INVALID_PRODUCTION_CREDENTIAL'
            ? `Please choose a password of at least ${MINIMUM_PASSWORD_LENGTH} characters.`
            : code === 'INVALID_PRODUCTION_LINK'
              ? 'This link is not one this app can use. Ask your administrator to send a new one.'
              : code === 'STAGING_OPERATION_UNAVAILABLE'
                ? 'This build cannot set passwords. Its accounts are configured with the build.'
                : 'Setting your password is unavailable right now. Please retry.',
      );
    } finally {
      if (operation === operationRef.current) setBusy(false);
    }
  };

  return (
    <>
      <title>{`${invite ? 'Accept your invitation' : 'Set a new password'} | ${APP_NAME} by ${PLATFORM_NAME}`}</title>
      <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-navy-50 via-white to-navy-100 p-4">
        <div className="w-full max-w-md">
          <div className="mb-8 flex flex-col items-center text-center">
            <div className="mb-4 flex h-24 w-24 items-center justify-center rounded-3xl bg-white p-2.5 shadow-xl ring-1 ring-slate-200/70">
              <img src={BRAND_LOGO_URL} alt={`${APP_NAME} logo`} className="h-full w-full rounded-2xl object-contain" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-navy-900">
              Welcome to Penn<span className="text-gold-600">Sync</span>
            </h1>
            <p className="mt-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">
              by {PLATFORM_NAME}
            </p>
            <p className="mt-3 text-sm text-slate-500">
              {invite ? 'Accept your invitation' : 'Set a new password'}
            </p>
          </div>

          <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-navy-600 via-navy-500 to-gold-400" />
            <div className="p-8">
              {done ? (
                <div className="space-y-4">
                  <p className="text-sm text-slate-700">
                    Your password is set. Sign in with it to continue.
                  </p>
                  {stale && (
                    <p className="text-sm text-slate-500">
                      One last step did not finish. Your password is set and you can sign in now;
                      if you did not just do this yourself, tell your administrator.
                    </p>
                  )}
                  <Button type="button" className="w-full" onClick={() => onPasswordSet?.(email.trim().toLowerCase())}>
                    Go to sign in
                  </Button>
                </div>
              ) : (
                <form className="space-y-5" onSubmit={handleSubmit}>
                  <div className="space-y-2">
                    <Label htmlFor="set-password-email">Work email</Label>
                    <Input
                      id="set-password-email" type="email" autoComplete="username" required
                      value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy}
                    />
                    <p className="text-xs text-slate-500">
                      The address this {invite ? 'invitation' : 'link'} was sent to.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="set-password-new">New password</Label>
                    <div className="relative">
                      <Input
                        id="set-password-new" type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password" required minLength={MINIMUM_PASSWORD_LENGTH}
                        value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy}
                      />
                      <button
                        type="button" onClick={() => setShowPassword((shown) => !shown)}
                        className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <p className="text-xs text-slate-500">
                      At least {MINIMUM_PASSWORD_LENGTH} characters.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="set-password-confirm">Repeat new password</Label>
                    <Input
                      id="set-password-confirm" type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password" required minLength={MINIMUM_PASSWORD_LENGTH}
                      value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={busy}
                    />
                  </div>
                  {error && (
                    <p role="alert" className="text-sm text-red-600">{error}</p>
                  )}
                  <Button type="submit" className="w-full" disabled={busy}>
                    {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {invite ? 'Accept invitation' : 'Set password'}
                  </Button>
                </form>
              )}
            </div>
          </div>
        </div>
      </main>
    </>
  );
};

export default SetPasswordScreen;
