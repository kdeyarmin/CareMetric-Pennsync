import { buildHelpUrl } from '@caremetric/help-sdk';

export const PENNSYNC_HELP_PRODUCT = 'pennsync';
export const PENNSYNC_PRODUCTION_APP_ID = '694ec16e72e01b60d22f7cbf';

const HELP_ENVIRONMENTS = new Set(['production', 'staging', 'development']);
// Require a version-shaped value, not merely a string whose characters happen
// to be URL-safe. This excludes UUIDs, names and other identifier/free-text
// values if a deployment variable is configured incorrectly.
const SAFE_RELEASE_TOKEN = /^v?\d+(?:\.\d+){1,3}(?:-[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)?(?:\+[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)?$/;

/** The rollout flag is deliberately strict: only the exact value `true` enables it. */
export function isCentralHelpEnabled(value) {
  return value === 'true';
}

/**
 * Activate the central launcher only for PennSync's immutable production
 * Base44 identity. Base44 does not expose backend Secrets to Vite builds, so an
 * omitted flag enables the production build while an explicit non-`true`
 * value remains a fail-closed emergency override. Preview/dev and every other
 * app id stay off even if a flag is accidentally supplied.
 */
export function resolveCentralHelpActivation({ appId, flag, isDevelopment = false } = {}) {
  if (isDevelopment || appId !== PENNSYNC_PRODUCTION_APP_ID) return false;
  return flag == null || isCentralHelpEnabled(flag);
}

/**
 * Resolve a safe deployment label. Arbitrary build-time text is never sent to
 * the Hub; production is the fail-safe for non-development builds.
 */
export function resolveHelpEnvironment(value, { isDevelopment = false } = {}) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (HELP_ENVIRONMENTS.has(normalized)) return normalized;
  return isDevelopment ? 'development' : 'production';
}

/**
 * Return a release token suitable for product-overlay version matching.
 * PennSync's package version is currently 0.0.0, so that placeholder is omitted
 * rather than presented as a real release.
 */
export function sanitizeHelpAppVersion(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (
    !normalized
    || normalized.length > 48
    || normalized === '0.0.0'
    || !SAFE_RELEASE_TOKEN.test(normalized)
  ) return undefined;
  return normalized;
}

/**
 * Convert a browser pathname to one exact, static route from the app manifest.
 * Query strings, fragments, extra path segments and unknown routes fail closed.
 */
export function resolveKnownHelpRoute(pathname, knownRoutes) {
  if (typeof pathname !== 'string' || !Array.isArray(knownRoutes)) return undefined;
  const routeOnly = pathname.split(/[?#]/, 1)[0];
  if (!routeOnly) return undefined;

  return knownRoutes.find(
    (candidate) => typeof candidate === 'string' && candidate.toLowerCase() === routeOnly.toLowerCase(),
  );
}

/**
 * Build PennSync's context-only Hub URL. There is intentionally no parameter
 * for user, tenant, patient, record, token, free text, or an arbitrary base URL.
 * Omitting baseUrl makes the first-party SDK use its fixed production Hub URL,
 * preventing localhost from becoming a customer-facing link.
 */
export function buildPennSyncHelpUrl({ pathname, knownRoutes, appVersion, environment }) {
  const route = resolveKnownHelpRoute(pathname, knownRoutes);
  const safeVersion = sanitizeHelpAppVersion(appVersion);
  const safeEnvironment = resolveHelpEnvironment(environment);

  return buildHelpUrl({
    context: {
      product: PENNSYNC_HELP_PRODUCT,
      ...(route ? { route } : {}),
      ...(safeVersion ? { appVersion: safeVersion } : {}),
      locale: 'en-US',
      environment: safeEnvironment,
    },
  });
}

const viteEnv = import.meta.env || {};

export const CENTRAL_HELP_ENABLED = resolveCentralHelpActivation({
  appId: viteEnv.VITE_BASE44_APP_ID,
  flag: viteEnv.VITE_CENTRAL_HELP_ENABLED,
  isDevelopment: viteEnv.DEV === true,
});
export const PENNSYNC_HELP_APP_VERSION = sanitizeHelpAppVersion(viteEnv.VITE_APP_VERSION);
export const PENNSYNC_HELP_ENVIRONMENT = resolveHelpEnvironment(viteEnv.VITE_DEPLOY_ENV, {
  isDevelopment: viteEnv.DEV === true,
});
