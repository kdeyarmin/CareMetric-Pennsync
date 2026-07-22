import { createClient } from '@base44/sdk';
import { appParams } from '@/lib/app-params';

const { appId, serverUrl, token, functionsVersion } = appParams;

//Create a client with authentication required
export const base44 = createClient({
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
  requiresAuth: false
});
