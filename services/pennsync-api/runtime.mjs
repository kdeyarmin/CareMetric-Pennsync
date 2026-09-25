// Configuration and readiness for the ported business API.
//
// Every control defaults closed. A deployment that sets nothing serves health
// and readiness only, and readiness reports itself as not ready.
import { HANDLERS, HANDLER_NAMES } from './handlers.mjs';
import { validAuthorityKey, validAuthorityTarget } from './authority.mjs';
import { validIntegrationTarget } from './integrations.mjs';
import { deliveryReleased as readDeliveryRelease } from './outbound-delivery.mjs';

const DEFAULT_APP = '694ec16e72e01b60d22f7cbf';
const ALLOWED_APPS = new Set([DEFAULT_APP, '6a9881683dc68a0bd54f1ef7']);
const DEFAULT_ORIGINS = 'https://caremetricai.base44.app,https://app.caremetricai.com';
/** An inline PNG only: no remote address a document render could be pointed at. */
const DOCUMENT_LOGO = /^data:image\/png;base64,[A-Za-z0-9+/]{16,699999}={0,2}$/;

export function loadConfig(env = process.env) {
  // Kept separate from the resolved id so a release can tell a binding an operator
  // chose from one that merely defaulted. Deliberately untrimmed: a value with
  // stray whitespace still fails ALLOWED_APPS as it does today.
  const explicitApp = env.PENNSYNC_API_APP_ID || '';
  const appId = explicitApp || DEFAULT_APP;
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

  // Ported documents render a logo the operator supplies. The originals fetched
  // one from Base44's storage bucket on every request; carrying that would have
  // kept a Base44 dependency in a service that otherwise has none. Unset means
  // the document takes the branch the original took when that fetch failed.
  const documentLogoDataUrl = env.PENNSYNC_API_DOCUMENT_LOGO || '';
  if (documentLogoDataUrl && !DOCUMENT_LOGO.test(documentLogoDataUrl)) throw new Error('INVALID_DOCUMENT_LOGO');

  // The brokered Core integrations. Unset means no handler that needs one can
  // run: the capability refuses before it reaches the network, rather than the
  // service reporting ready and failing per request.
  const integrationsUrl = env.PENNSYNC_API_INTEGRATIONS_URL || '';
  if (integrationsUrl && !validIntegrationTarget(integrationsUrl)) throw new Error('INVALID_INTEGRATION_TARGET');
  const integrationsConfigured = validIntegrationTarget(integrationsUrl);

  // Outbound delivery is released separately from the service, because a
  // released capability that writes a record and a released capability that
  // sends a person a message are different decisions with different owners.
  // Unset means every sender answers `OUTBOUND_DELIVERY_RELEASE_PAUSED`, which
  // is what a deployment does today.
  const delivery = readDeliveryRelease(env);

  const released = env.PENNSYNC_API_RELEASE === 'enabled-v1';
  // Releasing without a usable authority would mean serving unauthorized work.
  if (released && !authorityConfigured) throw new Error('INCOMPLETE_AUTHORITY_CONFIGURATION');
  // This service is always independent-authority, so its app id is not a label:
  // it is the request's key into the owned store, which admits exactly the one app
  // its deployment was pinned to. The store's pin defaults to STAGING while this
  // default is PRODUCTION, so a defaulted binding is the one combination that
  // reports ready and is refused by every authorization call. A released service
  // must say which app it serves.
  if (released && !explicitApp) throw new Error('IMPLICIT_APP_BINDING');
  // Delivery reaches a person through the integration runtime, so releasing it
  // without one configured would report a channel that cannot carry anything.
  // Refused at startup rather than per send, as every other incomplete release
  // in this function is.
  if (delivery && !integrationsConfigured) throw new Error('INCOMPLETE_DELIVERY_CONFIGURATION');

  return Object.freeze({
    appId,
    // Whether the operator CHOSE the app or inherited the default. Kept on the
    // config so readiness can state it: a defaulted binding is refused for a
    // released service above, and reporting it while paused is what lets a
    // release be checked before it is attempted rather than after it throws.
    appStated: Boolean(explicitApp),
    functions: Object.freeze(functions), origins: Object.freeze(origins),
    authorityUrl, authorityKey, authorityConfigured, released, documentLogoDataUrl,
    integrationsUrl, integrationsConfigured,
    deliveryReleased: delivery,
    revision: /^[0-9a-f]{40}$/.test(env.RAILWAY_GIT_COMMIT_SHA || '') ? env.RAILWAY_GIT_COMMIT_SHA : 'unbound',
  });
}

/** Whether any RELEASED handler reaches the integration runtime. */
export const requiresIntegration = released =>
  released.some(name => HANDLERS[name]?.needsIntegration === true);

/**
 * Whether any RELEASED handler can put a message on an outbound channel.
 *
 * The same question `requiresIntegration` asks one layer down, and asked for
 * the same reason: a deployment that releases a sender without
 * `PENNSYNC_API_DELIVERY` answers `ready: true` and then refuses every send
 * with `OUTBOUND_DELIVERY_RELEASE_PAUSED`, so a rollout probe passes while the
 * released capability serves no work. Read from the registry's own flag rather
 * than from a list of names here, so there is one answer rather than two.
 */
export const requiresDelivery = released =>
  released.some(name => HANDLERS[name]?.needsDelivery === true);

export function publicReadiness(config) {
  return {
    // A released handler that reaches the integration runtime needs one
    // configured. Without this, `/readyz` answered 200 while every call to
    // `analyzeReferral*` or `generateUserGuidePDF` failed
    // `INTEGRATIONS_NOT_CONFIGURED` — a service reporting healthy and serving
    // nothing, which is the failure readiness exists to prevent.
    ready: config.released && config.authorityConfigured && config.functions.length > 0
      && (config.integrationsConfigured || !requiresIntegration(config.functions))
      // A released sender with delivery unset serves nothing, so this service
      // does not report itself ready for it. `OWNER_HELD` keeps those names out
      // of every value the ladder emits, and a hold kept only by what nobody
      // pasted is one slip from gone: this is the deployment's own half of it.
      && (config.deliveryReleased === true || !requiresDelivery(config.functions)),
    released: config.released,
    authorityConfigured: config.authorityConfigured,
    // Stated either way, so an operator can see which dependency is missing.
    integrationsRequired: requiresIntegration(config.functions),
    integrationsConfigured: config.integrationsConfigured,
    // Stated either way beside the flag itself, so an operator reading this can
    // tell a deployment that needs delivery and has it from one that needs it
    // and does not — the distinction `ready` alone collapses into a bare false.
    deliveryRequired: requiresDelivery(config.functions),
    // Published so the one thing that decides whether a message can leave this
    // service is readable from outside it. Every other release state in this
    // project is checked by probing the running deployment rather than by
    // reading a plan, and this is the state where that matters most.
    deliveryReleased: config.deliveryReleased === true,
    authorityMode: 'independent',
    // Which app this deployment keys into the owned store with, and whether
    // that was chosen. The id is not a secret — both reviewed ids are literals
    // in this file and one of them ships in the SPA bundle — while the pairing
    // is the failure the plan singles out: a store pinned to one app and a
    // service defaulted to the other reports ready and is refused by every
    // authorization call. Stating it here lets that be compared against the
    // store's own pin without releasing anything to find out.
    appId: config.appId,
    appStated: config.appStated === true,
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
