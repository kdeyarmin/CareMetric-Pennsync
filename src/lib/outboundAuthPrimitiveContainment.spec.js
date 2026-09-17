import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const srcRoot = path.join(root, 'src');

function productionSourceFiles(directory = srcRoot) {
  return readdirSync(directory).flatMap((name) => {
    const absolute = path.join(directory, name);
    if (statSync(absolute).isDirectory()) return productionSourceFiles(absolute);
    if (!/\.[cm]?[jt]sx?$/.test(name) || /\.(?:spec|test)\.[cm]?[jt]sx?$/.test(name)) return [];
    return [absolute];
  });
}

const deliveryPrimitiveReference = /\b(?:resetPasswordRequest|resendOtp|inviteUser)\b/;
const rawAuthDeliveryRoute = /\/auth\/[a-z0-9_/-]*(?:resend|reset|invite|otp)[a-z0-9_/-]*/i;

function hasUncontainedAuthDelivery(source, relativeFile) {
  // Only native code redemption at the immutable staging endpoint is allowed.
  // It cannot send mail. Keep every other raw OTP/reset/invitation route banned,
  // including additional routes in the same helper and verification elsewhere.
  const inspected = relativeFile === 'lib/stagingEmailVerification.js'
    ? source.replace("'https://base44.app/api/apps/6a9881683dc68a0bd54f1ef7/auth/verify-otp'", "'staging-redemption-only'")
    : source;
  return deliveryPrimitiveReference.test(inspected) || rawAuthDeliveryRoute.test(inspected);
}

describe('browser outbound-auth primitive containment', () => {
  it('keeps direct reset, OTP resend, and invitation delivery out of production source', () => {
    const offenders = productionSourceFiles()
      .filter((file) => {
        const source = readFileSync(file, 'utf8');
        return hasUncontainedAuthDelivery(source, path.relative(srcRoot, file).split(path.sep).join('/'));
      })
      .map((file) => path.relative(root, file))
      .sort();

    expect(offenders).toEqual([]);
  });

  it('confines the redemption exception to one fixed staging URL in its guarded helper', () => {
    const allowed = "'https://base44.app/api/apps/6a9881683dc68a0bd54f1ef7/auth/verify-otp'";
    const file = 'lib/stagingEmailVerification.js';
    expect(hasUncontainedAuthDelivery(allowed, file)).toBe(false);
    expect(hasUncontainedAuthDelivery(allowed, 'components/auth/SignInScreen.jsx')).toBe(true);
    for (const addition of [allowed, '/auth/resend-otp', '/auth/verify-otp', '/auth/reset-password', 'resendOtp(email)', 'inviteUser(email)']) {
      expect(hasUncontainedAuthDelivery(`${allowed}; ${addition}`, file)).toBe(true);
    }
    expect(hasUncontainedAuthDelivery(allowed.replace('6a9881683dc68a0bd54f1ef7', '694ec16e72e01b60d22f7cbf'), file)).toBe(true);
  });

  it('keeps the in-app reset screen hard-paused with no browser release flag', () => {
    const signIn = readFileSync(
      path.join(srcRoot, 'components/auth/SignInScreen.jsx'),
      'utf8',
    );
    const containment = readFileSync(
      path.join(srcRoot, 'lib/outboundDeliveryContainment.js'),
      'utf8',
    );

    expect(signIn).toContain("from '@/lib/outboundDeliveryContainment'");
    expect(signIn).toContain('setError(OUTBOUND_DELIVERY_PAUSED_MESSAGE)');
    expect(signIn).not.toMatch(/reset-sent|password-reset link is on its way/i);
    expect(containment).not.toMatch(/import\.meta\.env|process\.env|VITE_[A-Z0-9_]+/);
  });
});
