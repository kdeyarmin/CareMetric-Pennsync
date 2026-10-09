// Where the platform's hosted auth endpoints live: `/login` (the sign-up, OTP,
// email-verification and captcha fallback the sign-in screen links to) and
// `/api/apps/auth/logout` (the server half of every sign-out). The SDK builds
// both from its `appBaseUrl` option and navigates the MAIN FRAME to them.
//
// They are served on the APP's own host, not on the shared API host. Measured
// 2026-10-08 against production, where the build's backend URL is the shared
// `https://base44.app`:
//
//   https://app.caremetricai.com/api/apps/auth/logout?from_url=<app>  302 → the app
//   https://app.caremetricai.com/login?from_url=<app>                 200, hosted sign-in
//   https://base44.app/api/apps/auth/logout?from_url=<app>            302 → base44.app/ → base44.com
//   https://base44.app/login?from_url=<app>                           404 "App not found"
//
// The shared host cannot tell which app a bare `/login` or `/logout` belongs
// to, so passing the backend URL here sent every sign-out to the platform's
// marketing site and made the verification fallback a dead end. In the iOS
// shell it was worse: a main-frame navigation off the app origin is handed to
// Safari, so sign-out and the idle timeout left the app entirely.
//
// The origin the SPA is being served from is the answer whenever the platform
// hosts it. Anything that is not an http(s) origin (a `file:` page reports the
// string "null") falls back to the backend URL, which is what the SDK was
// given before.
export function resolvePlatformAuthBaseUrl(location, serverUrl) {
  const origin = location?.origin;
  if (typeof origin === 'string' && /^https?:\/\/[^/]+$/i.test(origin)) return origin;
  return serverUrl;
}
