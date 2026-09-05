import { createClient } from '@base44/sdk';
import { appParams } from '@/lib/app-params';
import { lockBase44FunctionRevision } from '@/lib/functionRevisionPolicy';
import { wrapTenantSdkClient } from '@/lib/tenantSdkRealmGate';

const { appId, serverUrl, token, functionsVersion } = appParams;

// Keep the raw client module-private. Protected browser operations are exposed
// only through the single-authority realm membrane below. The current public
// capability workflows are hard-paused server-side, so this module deliberately
// exports no raw/public function or upload escape hatch.
const rawBase44 = lockBase44FunctionRevision(createClient({
  appId,
  serverUrl,
  // Platform auth pages (/login sign-up/OTP/captcha) and the logout endpoint are
  // served by the backend origin, not by this SPA's static hosting. Without
  // appBaseUrl the SDK builds those URLs origin-relative ("" + "/login"), which
  // the SPA fallback serves back as the SPA — hosted sign-up becomes unreachable
  // and logout never hits the server-side session.
  appBaseUrl: serverUrl,
  token,
  functionsVersion,
  requiresAuth: false,
  // The SDK's built-in analytics owns raw timers/visibility listeners and raw
  // auth/transport calls outside our authority membrane. Keep it disabled;
  // any future telemetry must be emitted through an epoch-bound app seam.
  analytics: { enabled: false },
}), functionsVersion);

export const base44 = wrapTenantSdkClient(rawBase44);

export const tenantAuthorityClient = Object.freeze({
  me: () => rawBase44.auth.me(),
  getMyTenantContext: (payload) => rawBase44.functions.invoke('getMyTenantContext', payload),
  listMyTenantMemberships: () => rawBase44.functions.invoke('listMyTenantMemberships', {}),
});
