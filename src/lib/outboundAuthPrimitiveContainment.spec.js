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

describe('browser outbound-auth primitive containment', () => {
  it('keeps direct reset, OTP resend, and invitation delivery out of production source', () => {
    const offenders = productionSourceFiles()
      .filter((file) => {
        const source = readFileSync(file, 'utf8');
        return deliveryPrimitiveReference.test(source) || rawAuthDeliveryRoute.test(source);
      })
      .map((file) => path.relative(root, file))
      .sort();

    expect(offenders).toEqual([]);
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
