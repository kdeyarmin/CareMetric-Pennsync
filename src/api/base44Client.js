import { createClient } from '@base44/sdk';
import { appParams } from '@/lib/app-params';
import { resolvePlatformAuthBaseUrl } from '@/lib/platformAuthBaseUrl';
import { lockBase44FunctionRevision } from '@/lib/functionRevisionPolicy';
import { runPublicCapabilityOperation } from '@/lib/publicCapabilityRealmGate';
import {
  assertTenantSdkRealmLeaseCurrent, captureTenantSdkRealmLease, getTenantSdkRealmAbortSignal, wrapTenantSdkClient,
} from '@/lib/tenantSdkRealmGate';
import { getActiveTrustedTenantContext } from '@/lib/roles';
import { readExternalIntegrationConfig, routeExternalCoreOperations } from '@/lib/externalIntegrationTransport';
import { ownedBackendAdapter as independentAdapter } from '@/lib/independentStagingSession';

const { appId, serverUrl, token, functionsVersion } = appParams;

// Keep the raw client module-private. Protected browser operations are exposed
// only through exact authority membranes below. Public provider follow-up gets
// two named function calls and no entity, auth, integration, upload, or generic
// invoke escape hatch.
const rawBase44 = independentAdapter?.raw ?? lockBase44FunctionRevision(createClient({
  appId,
  serverUrl,
  // Platform auth pages (/login sign-up/OTP/captcha) and the logout endpoint
  // are served on the APP's host, which is not the shared backend host this
  // build talks to (`https://base44.app`): there a bare `/login` is a 404 and
  // logout lands on the platform's marketing site. See platformAuthBaseUrl.js
  // for the measurement.
  appBaseUrl: resolvePlatformAuthBaseUrl(typeof window === 'undefined' ? undefined : window.location, serverUrl),
  token,
  functionsVersion,
  requiresAuth: false,
  // The SDK's built-in analytics owns raw timers/visibility listeners and raw
  // auth/transport calls outside our authority membrane. Keep it disabled;
  // any future telemetry must be emitted through an epoch-bound app seam.
  analytics: { enabled: false },
}), functionsVersion);

// The external route is inside the same authority membrane as the native SDK.
// Default-off builds return the original raw client without touching auth or I/O.
const routedBase44 = independentAdapter ? rawBase44 : routeExternalCoreOperations(rawBase44, readExternalIntegrationConfig(import.meta.env, appId), {
  getSession: () => ({ token: appParams.token, context: getActiveTrustedTenantContext() }),
  captureLease: captureTenantSdkRealmLease,
  assertLeaseCurrent: assertTenantSdkRealmLeaseCurrent,
  getLeaseSignal: getTenantSdkRealmAbortSignal,
});
export const base44 = wrapTenantSdkClient(routedBase44);

export const tenantAuthorityClient = independentAdapter?.authority ?? Object.freeze({
  me: () => rawBase44.auth.me(),
  getMyTenantContext: (payload) => rawBase44.functions.invoke('getMyTenantContext', payload),
  listMyTenantMemberships: () => rawBase44.functions.invoke('listMyTenantMemberships', {}),
});

export const publicCapabilityClient = Object.freeze({
  validateFollowUpToken: (lease, payload) => runPublicCapabilityOperation(
    lease,
    () => rawBase44.functions.invoke('validateFollowUpToken', payload),
  ),
  submitFollowUpResponse: (lease, payload) => runPublicCapabilityOperation(
    lease,
    () => rawBase44.functions.invoke('submitFollowUpResponse', payload),
  ),
});
