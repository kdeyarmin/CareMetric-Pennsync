import { buildHelpUrl } from '@caremetric/help-sdk';

export const PENNSYNC_HELP_PRODUCT = 'pennsync';
export const PENNSYNC_PRODUCTION_APP_ID = '694ec16e72e01b60d22f7cbf';
/**
 * The owned production build's immutable identity, for a build that is no
 * longer identified to Base44. It plays exactly the part the Base44 app id
 * plays above: a value pinned in source and set only by the production
 * publication path, so a preview, a fork or a local build cannot present it.
 * It is a build label, never a tenant, an account or an origin.
 */
export const PENNSYNC_OWNED_PRODUCTION_BUILD_ID = 'caremetric-pennsync-production';

const HELP_ENVIRONMENTS = new Set(['production', 'staging', 'development']);
// Require a version-shaped value, not merely a string whose characters happen
// to be URL-safe. This excludes UUIDs, names and other identifier/free-text
// values if a deployment variable is configured incorrectly.
const SAFE_RELEASE_TOKEN = /^v?\d{1,4}(?:\.\d{1,4}){1,3}(?:[-+][A-Za-z0-9.-]{1,24})?$/;

/** The rollout flag is deliberately strict: only the exact value `true` enables it. */
export function isCentralHelpEnabled(value) {
  return value === 'true';
}

/**
 * Which verified production build this is, or `undefined` for every build that
 * is not one. Exactly one identity may be presented: a build carrying both a
 * Base44 app id and the owned build id has not established which thing it is,
 * and an ambiguous build is not a verified one.
 *
 * `base44` is the existing path, unchanged: PennSync's immutable production
 * Base44 app id. `owned` is the same question asked of a build that no longer
 * has a Base44 app id at all — without it the launcher could only ever be
 * activated by a build still identified to Base44, which is the one state the
 * exit removes. The synthetic staging backend is refused outright: it is
 * synthetic by construction, so `VITE_DEPLOY_ENV=production` on it names a
 * deployment environment rather than a production deployment.
 */
export function resolveProductionBuildIdentity({ appId, buildId, backend } = {}) {
  const hasAppId = appId != null && appId !== '';
  const hasBuildId = buildId != null && buildId !== '';
  if (hasAppId === hasBuildId) return undefined;
  if (hasAppId) return appId === PENNSYNC_PRODUCTION_APP_ID ? 'base44' : undefined;
  if (backend === 'independent-staging') return undefined;
  return buildId === PENNSYNC_OWNED_PRODUCTION_BUILD_ID ? 'owned' : undefined;
}

/**
 * Activate the central launcher only when a verified production build identity
 * and the explicit `production` deployment environment both match. Preview/dev,
 * staging, synthetic staging and every other identity stay off even if a flag
 * is accidentally supplied.
 *
 * The flag's default differs by identity, and narrows rather than widens. Base44
 * does not expose backend Secrets to Vite builds, so on that path an omitted
 * flag enables the verified production build while an explicit non-`true` value
 * remains a fail-closed emergency override. An owned build sets its own build
 * variables, so that reason does not hold there and the flag must be the exact
 * string `true`.
 */
export function resolveCentralHelpActivation({
  appId,
  buildId,
  backend,
  flag,
  environment,
  isDevelopment = false,
} = {}) {
  if (isDevelopment || environment !== 'production') return false;
  const identity = resolveProductionBuildIdentity({ appId, buildId, backend });
  if (identity === undefined) return false;
  if (identity === 'owned') return isCentralHelpEnabled(flag);
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
    routeAllowlist: Array.isArray(knownRoutes) ? knownRoutes : [],
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
  buildId: viteEnv.VITE_PENNSYNC_BUILD_ID,
  backend: viteEnv.VITE_PENNSYNC_BACKEND,
  flag: viteEnv.VITE_CENTRAL_HELP_ENABLED,
  environment: viteEnv.VITE_DEPLOY_ENV,
  isDevelopment: viteEnv.DEV === true,
});
export const PENNSYNC_HELP_APP_VERSION = sanitizeHelpAppVersion(viteEnv.VITE_APP_VERSION);
export const PENNSYNC_HELP_ENVIRONMENT = resolveHelpEnvironment(viteEnv.VITE_DEPLOY_ENV, {
  isDevelopment: viteEnv.DEV === true,
});
