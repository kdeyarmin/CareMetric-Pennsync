import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { isStagingEmailVerificationAvailable, StagingVerificationError, verifyStagingEmail } from '@/lib/stagingEmailVerification';

export default function StagingEmailVerification({ initialEmail = '', onBack }) {
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [verifiedEmail, setVerifiedEmail] = useState('');
  const requestRef = useRef(null);

  useEffect(() => () => {
    requestRef.current?.abort();
    requestRef.current = null;
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    if (requestRef.current || !isStagingEmailVerificationAvailable()) return;
    const controller = new AbortController();
    requestRef.current = controller;
    const timer = setTimeout(() => controller.abort(), 20000);
    setBusy(true);
    setError('');
    setVerifiedEmail('');
    const submittedEmail = email.trim();
    try {
      await verifyStagingEmail({ email: submittedEmail, code, signal: controller.signal });
      if (requestRef.current === controller && !controller.signal.aborted) {
        setVerifiedEmail(submittedEmail);
      }
    } catch (err) {
      if (requestRef.current === controller) {
        // Transport errors and server bodies can contain sensitive values.
        // Only helper-authored messages are presented by the transport below.
        setError(err instanceof StagingVerificationError
          ? err.message
          : 'Verification could not be completed. Please check your connection and try again.');
      }
    } finally {
      clearTimeout(timer);
      if (requestRef.current === controller) {
        requestRef.current = null;
        setBusy(false);
        setCode('');
      }
    }
  };

  if (!isStagingEmailVerificationAvailable()) return null;

  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Verify a staging email</h2>
        <p className="mt-2 text-sm text-slate-600">
          Enter the exact email address shown in the verification email and its newest code.
          Codes expire after 10 minutes. Check Junk if the email is missing.
        </p>
        <p className="mt-2 text-sm text-slate-600">
          This verifies the email address only. It does not sign you in or grant agency access.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="verification-email">Email address</Label>
        <Input id="verification-email" type="email" autoComplete="email" autoCapitalize="none"
          required value={email} disabled={busy} onChange={(event) => {
            setEmail(event.target.value);
            setCode('');
            setError('');
            setVerifiedEmail('');
          }} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="verification-code">Six-digit verification code</Label>
        <Input id="verification-code" type="text" inputMode="numeric" autoComplete="one-time-code"
          pattern="[0-9]{6}" maxLength={6} required value={code} disabled={busy}
          onChange={(event) => {
            setCode(event.target.value);
            setError('');
            setVerifiedEmail('');
          }} />
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {verifiedEmail && (
        <p role="status" className="text-sm text-green-800">
          Email verified for {verifiedEmail}. You can now enter the next email address and code.
        </p>
      )}
      <Button type="submit" disabled={busy} className="h-11 w-full">
        {busy ? 'Verifying…' : 'Verify email'}
      </Button>
      <Button type="button" variant="outline" onClick={onBack} className="h-11 w-full">
        Back to sign in
      </Button>
    </form>
  );
}
