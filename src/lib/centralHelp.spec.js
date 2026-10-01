import { describe, expect, it } from 'vitest';
import { buildHelpUrl } from '@caremetric/help-sdk';
import { version as helpSdkVersion } from '@caremetric/help-sdk/package.json';
import {
  buildPennSyncHelpUrl,
  isCentralHelpEnabled,
  PENNSYNC_OWNED_PRODUCTION_BUILD_ID,
  PENNSYNC_PRODUCTION_APP_ID,
  resolveCentralHelpActivation,
  resolveProductionBuildIdentity,
  resolveHelpEnvironment,
  resolveKnownHelpRoute,
  sanitizeHelpAppVersion,
} from './centralHelp';

const KNOWN_ROUTES = ['/', '/Dashboard', '/Help', '/PatientDetails', '/LearningCenter'];

describe('PennSync central help context', () => {
  it('uses the pinned shared SDK and its fail-closed route contract', () => {
    expect(helpSdkVersion).toBe('0.4.0');
    const url = new URL(buildHelpUrl({
      context: { product: 'pennsync', route: '/PatientDetails' },
    }));
    expect(url.searchParams.has('route')).toBe(false);
  });

  it('builds a production Hub URL with only approved context', () => {
    const url = new URL(buildPennSyncHelpUrl({
      pathname: '/patientdetails?patient_id=patient-secret#chart',
      knownRoutes: KNOWN_ROUTES,
      appVersion: '2026.09.07+7c517ec',
      environment: 'production',
    }));

    expect(url.origin).toBe('https://support-hub-web-production.up.railway.app');
    expect(url.pathname).toBe('/help');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      product: 'pennsync',
      route: '/PatientDetails',
      app_version: '2026.09.07+7c517ec',
      locale: 'en-US',
      environment: 'production',
    });
    expect(url.toString()).not.toMatch(/patient-secret|patient_id|#chart|localhost/i);
  });

  it('omits an unknown or identifier-bearing path instead of forwarding it', () => {
    const unknown = new URL(buildPennSyncHelpUrl({
      pathname: '/PatientDetails/patient-123?token=secret',
      knownRoutes: KNOWN_ROUTES,
      environment: 'production',
    }));

    expect(unknown.searchParams.has('route')).toBe(false);
    expect(unknown.toString()).not.toMatch(/patient-123|token|secret/i);
  });

  it('canonicalizes route casing only through the static allowlist', () => {
    expect(resolveKnownHelpRoute('/learningcenter', KNOWN_ROUTES)).toBe('/LearningCenter');
    expect(resolveKnownHelpRoute('/LearningCenter/assignment-9', KNOWN_ROUTES)).toBeUndefined();
    expect(resolveKnownHelpRoute('/Help?email=person@example.com#x', KNOWN_ROUTES)).toBe('/Help');
  });

  it('accepts safe release tokens and omits placeholders or free text', () => {
    expect(sanitizeHelpAppVersion(' 3.8.2+sha.abc123 ')).toBe('3.8.2+sha.abc123');
    expect(sanitizeHelpAppVersion('v3.8.2-rc.1')).toBe('v3.8.2-rc.1');
    // The shared Hub contract supports one bounded suffix; do not claim that
    // a value will be forwarded when the producer would silently omit it.
    expect(sanitizeHelpAppVersion('v3.8.2-rc.1+sha.abc123')).toBeUndefined();
    expect(sanitizeHelpAppVersion('0.0.0')).toBeUndefined();
    expect(sanitizeHelpAppVersion('release contains patient name')).toBeUndefined();
    expect(sanitizeHelpAppVersion('patient-name')).toBeUndefined();
    expect(sanitizeHelpAppVersion('1b4e28ba-2fa1-11d2-883f-0016d3cca427')).toBeUndefined();
    expect(sanitizeHelpAppVersion(`v${'1'.repeat(48)}`)).toBeUndefined();
  });

  it('allowlists deployment environments and defaults safely', () => {
    expect(resolveHelpEnvironment('STAGING')).toBe('staging');
    expect(resolveHelpEnvironment('preview')).toBe('production');
    expect(resolveHelpEnvironment(undefined, { isDevelopment: true })).toBe('development');
  });

  it('enables the rollout only for the exact true flag', () => {
    expect(isCentralHelpEnabled('true')).toBe(true);
    expect(isCentralHelpEnabled('TRUE')).toBe(false);
    expect(isCentralHelpEnabled('1')).toBe(false);
    expect(isCentralHelpEnabled(undefined)).toBe(false);
  });

  it('activates only the production Base44 build and keeps previews and staging off', () => {
    expect(resolveCentralHelpActivation({
      appId: PENNSYNC_PRODUCTION_APP_ID,
      environment: 'production',
    })).toBe(true);
    expect(resolveCentralHelpActivation({
      appId: PENNSYNC_PRODUCTION_APP_ID,
      flag: 'true',
      environment: 'production',
    })).toBe(true);
    expect(resolveCentralHelpActivation({
      appId: PENNSYNC_PRODUCTION_APP_ID,
      flag: 'false',
      environment: 'production',
    })).toBe(false);
    expect(resolveCentralHelpActivation({
      appId: PENNSYNC_PRODUCTION_APP_ID,
      environment: 'production',
      isDevelopment: true,
    })).toBe(false);
    expect(resolveCentralHelpActivation({
      appId: PENNSYNC_PRODUCTION_APP_ID,
      flag: 'true',
      environment: 'staging',
    })).toBe(false);
    expect(resolveCentralHelpActivation({
      appId: PENNSYNC_PRODUCTION_APP_ID,
      flag: 'true',
    })).toBe(false);
    expect(resolveCentralHelpActivation({
      appId: '6a9881683dc68a0bd54f1ef7',
      flag: 'true',
      environment: 'production',
    })).toBe(false);
  });

  it('activates a Base44-free production build on its own pinned identity', () => {
    const owned = {
      buildId: PENNSYNC_OWNED_PRODUCTION_BUILD_ID,
      environment: 'production',
    };
    expect(resolveCentralHelpActivation({ ...owned, flag: 'true' })).toBe(true);
    // An owned build sets its own variables, so the Base44 omitted-flag default
    // does not carry over: the launcher stays off until the flag says otherwise.
    expect(resolveCentralHelpActivation(owned)).toBe(false);
    expect(resolveCentralHelpActivation({ ...owned, flag: 'false' })).toBe(false);
    expect(resolveCentralHelpActivation({ ...owned, flag: 'TRUE' })).toBe(false);
    expect(resolveCentralHelpActivation({
      ...owned, flag: 'true', environment: 'staging',
    })).toBe(false);
    expect(resolveCentralHelpActivation({
      ...owned, flag: 'true', isDevelopment: true,
    })).toBe(false);
    expect(resolveCentralHelpActivation({
      buildId: 'caremetric-pennsync-preview', flag: 'true', environment: 'production',
    })).toBe(false);
  });

  it('refuses a build that is ambiguous, unidentified, or synthetic staging', () => {
    // Exactly one identity. A build presenting both has not established which
    // thing it is, whichever of the two is the real one.
    expect(resolveProductionBuildIdentity({
      appId: PENNSYNC_PRODUCTION_APP_ID, buildId: PENNSYNC_OWNED_PRODUCTION_BUILD_ID,
    })).toBeUndefined();
    expect(resolveProductionBuildIdentity({})).toBeUndefined();
    expect(resolveProductionBuildIdentity({ appId: '', buildId: '' })).toBeUndefined();
    // The synthetic staging backend is synthetic by construction, so a
    // `production` deployment label on it never names a production deployment.
    expect(resolveProductionBuildIdentity({
      buildId: PENNSYNC_OWNED_PRODUCTION_BUILD_ID, backend: 'independent-staging',
    })).toBeUndefined();
    expect(resolveCentralHelpActivation({
      buildId: PENNSYNC_OWNED_PRODUCTION_BUILD_ID,
      backend: 'independent-staging',
      flag: 'true',
      environment: 'production',
    })).toBe(false);
    expect(resolveProductionBuildIdentity({
      appId: PENNSYNC_PRODUCTION_APP_ID,
    })).toBe('base44');
    expect(resolveProductionBuildIdentity({
      buildId: PENNSYNC_OWNED_PRODUCTION_BUILD_ID,
    })).toBe('owned');
    // The Base44 path never consults the backend selector, so a value there
    // cannot turn the existing production build off.
    expect(resolveProductionBuildIdentity({
      appId: PENNSYNC_PRODUCTION_APP_ID, backend: 'independent-staging',
    })).toBe('base44');
  });
});
