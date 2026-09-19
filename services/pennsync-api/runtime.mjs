// Configuration and readiness for the ported business API.
//
// Every control defaults closed. A deployment that sets nothing serves health
// and readiness only, and readiness reports itself as not ready.
import { HANDLER_NAMES } from './handlers.mjs';
import { validAuthorityKey, validAuthorityTarget } from './authority.mjs';

const DEFAULT_APP = '694ec16e72e01b60d22f7cbf';
const ALLOWED_APPS = new Set([DEFAULT_APP, '6a9881683dc68a0bd54f1ef7']);
const DEFAULT_ORIGINS = 'https://caremetricai.base44.app,https://app.caremetricai.com';

export function loadConfig(env = process.env) {
  const appId = env.PENNSYNC_API_APP_ID || DEFAULT_APP;
  if (!ALLOWED_APPS.has(appId)) throw new Error('INVALID_APP_BINDING');

  const functions = (env.PENNSYNC_API_FUNCTIONS || '').split(',').map(name => name.trim()).filter(Boolean);
  // A released name must exist in the registry, so a typo fails at startup
  // instead of silently releasing nothing or something else.
  if (functions.some(name => !HANDLER_NAMES.includes(name))
    || new Set(functions).size !== functions.length) throw new Error('INVALID_FUNCTION_RELEASE');

  const origins = (env.PENNSYNC_API_ALLOWED_ORIGINS || DEFAULT_ORIGINS).split(',').map(value => value.trim()).filter(Boolean);
  if (origins.some(origin => {
    try { const url = new URL(origin); return url.protocol !== 'https:' || url.origin !== origin; }
    catch { return true; }
  })) throw new Error('INVALID_CORS_ORIGIN');

  const authorityUrl = env.PENNSYNC_API_AUTHORITY_URL || '';
  const authorityKey = env.PENNSYNC_API_AUTHORITY_PUBLISHABLE_KEY || '';
  if (authorityUrl && !validAuthorityTarget(authorityUrl)) throw new Error('INVALID_AUTHORITY_TARGET');
  // A secret or service-role key would read past the caller's own authority.
  if (authorityKey && !validAuthorityKey(authorityKey)) throw new Error('INVALID_AUTHORITY_KEY');
  const authorityConfigured = validAuthorityTarget(authorityUrl) && validAuthorityKey(authorityKey);

  const released = env.PENNSYNC_API_RELEASE === 'enabled-v1';
  // Releasing without a usable authority would mean serving unauthorized work.
  if (released && !authorityConfigured) throw new Error('INCOMPLETE_AUTHORITY_CONFIGURATION');

  return Object.freeze({
    appId, functions: Object.freeze(functions), origins: Object.freeze(origins),
    authorityUrl, authorityKey, authorityConfigured, released,
    revision: /^[0-9a-f]{40}$/.test(env.RAILWAY_GIT_COMMIT_SHA || '') ? env.RAILWAY_GIT_COMMIT_SHA : 'unbound',
  });
}

export function publicReadiness(config) {
  return {
    ready: config.released && config.authorityConfigured && config.functions.length > 0,
    released: config.released,
    authorityConfigured: config.authorityConfigured,
    authorityMode: 'independent',
    // This service has no Base44 client, credential or call path at all.
    base44ExecutionDependency: false,
    // Implemented handlers versus the ones an operator has actually released.
    implemented: HANDLER_NAMES,
    operations: config.functions,
    // A running service is not a migration. Neither field is set by deploying.
    trafficCutoverVerified: false,
    portedFunctionCoverageComplete: false,
    revision: config.revision,
  };
}
