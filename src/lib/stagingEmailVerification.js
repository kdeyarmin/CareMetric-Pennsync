const STAGING_APP_ID = '6a9881683dc68a0bd54f1ef7';
const STAGING_ORIGIN = 'https://caremetric-pennsync-staging-2026-09-d54f1ef7.base44.app';
const VERIFICATION_URL = 'https://base44.app/api/apps/6a9881683dc68a0bd54f1ef7/auth/verify-otp';

export class StagingVerificationError extends Error {}

// This redemption-only screen is confined to the staging build on its exact,
// top-level host. URL parameters, storage, and release flags cannot enable it.
export function isStagingEmailVerificationAvailable() {
  return import.meta.env.VITE_BASE44_APP_ID === STAGING_APP_ID
    && globalThis.location?.origin === STAGING_ORIGIN
    && globalThis.top === globalThis.self;
}

export async function verifyStagingEmail({ email, code, signal }) {
  if (!isStagingEmailVerificationAvailable()) {
    throw new StagingVerificationError('Email verification is only available in staging.');
  }
  const address = typeof email === 'string' ? email.trim() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
    throw new StagingVerificationError('Enter the email address and its six-digit verification code.');
  }

  // Match Base44 SDK 0.8.48 auth.verifyOtp's native payload. Use fetch to avoid
  // SDK development diagnostics or iframe messages containing the code/token.
  // No credentials, configured server URL, session mutation, or email delivery.
  const response = await fetch(VERIFICATION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-App-Id': STAGING_APP_ID },
    body: JSON.stringify({ email: address, otp_code: code }),
    credentials: 'omit',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
    redirect: 'error',
    signal,
  });
  if (response.status === 429) {
    throw new StagingVerificationError('Too many attempts. Please wait before trying again.');
  }
  if ([400, 401, 403, 422].includes(response.status)) {
    throw new StagingVerificationError('That code could not be verified. Check the email address and use the newest unexpired code.');
  }
  if (!response.ok) throw new StagingVerificationError('Verification is unavailable. Please try again later.');
  const result = await response.json();
  if (typeof result?.access_token !== 'string' || !result.access_token.trim()) {
    throw new StagingVerificationError('Verification could not be confirmed. Please try again later.');
  }
  // Native verification returns a token. Deliberately discard it: verifying
  // email ownership must not select a test actor or replace a phone's session.
}
