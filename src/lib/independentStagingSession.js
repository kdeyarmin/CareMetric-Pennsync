import { createIndependentStagingAdapter, readIndependentStagingConfig } from './independentStagingAdapter';
import { createIndependentProductionAdapter, readIndependentProductionConfig } from './independentProductionAdapter';
import { getActiveTrustedTenantContext } from './roles';

// Build configuration only. URL/storage input never selects a backend or user.
const stagingConfig = readIndependentStagingConfig(import.meta.env);
const productionConfig = readIndependentProductionConfig(import.meta.env);
// The composition root is where an adapter learns which principal is bound.
// It is not imported inside either adapter because those modules are also
// loaded under plain `node --test` by the browser acceptance suites, where a
// `@/` alias does not resolve and `roles.js` reaches one of its own.
const boundTenant = getActiveTrustedTenantContext;

export const independentStagingAdapter = stagingConfig
  ? createIndependentStagingAdapter(stagingConfig, { boundTenant })
  : null;
/**
 * The SYNTHETIC STAGING mode, and only it.
 *
 * Read this export as "this build is the synthetic staging workspace", never as
 * "this build is not Base44" — those were the same question while staging was
 * the only owned mode, and they are not the same question now. Everything that
 * is true of any owned backend (the app signs itself in, a session has a lease
 * this document must revoke, there is no Base44 page to redirect to) belongs to
 * `ownedBackendAuth` below. What stays here is what is true of STAGING
 * specifically: the synthetic workspace replaces the app's own screens, the
 * public capability routes are quarantined, a single membership is not
 * auto-selected, and the sign-in screen says so.
 *
 * Splitting them is the whole of this module's change. A production build that
 * took the staging branches would render the synthetic roster instead of the
 * app, and one that took none of the owned branches would hand sign-in back to
 * Base44 — so each call site was read for which of the two it meant.
 */
export const independentStagingAuth = independentStagingAdapter?.auth ?? null;

export const independentProductionAdapter = productionConfig
  ? createIndependentProductionAdapter(productionConfig, { boundTenant })
  : null;
/** The PRODUCTION mode, and only it. Null in every other build. */
export const independentProductionAuth = independentProductionAdapter?.auth ?? null;

/**
 * Whichever owned backend this build selected, if either.
 *
 * At most one is ever non-null: the two config readers key on different exact
 * values of `VITE_PENNSYNC_BACKEND`, so a build is staging, production, or
 * Base44. Everything about authentication mechanics reads this one.
 */
export const ownedBackendAdapter = independentStagingAdapter ?? independentProductionAdapter;
export const ownedBackendAuth = ownedBackendAdapter?.auth ?? null;

/**
 * Whether this build talks to the owned service rather than Base44.
 *
 * Exported for the one thing a screen legitimately has to know: which SHAPE a
 * capability takes. `OCRDocumentExtractor` uploads a document and then reads
 * it, and the two backends do that differently — Base44 stores the file and
 * passes a locator, while the owned path sends the bytes to the handler, which
 * mints the object under its own subject. It is not a permission and nothing
 * branches on it to decide what a caller may do.
 *
 * It covers BOTH owned modes, because the upload shape is a property of the
 * owned service rather than of synthetic staging.
 */
export const usesIndependentBackend = !!ownedBackendAdapter;

/** Which owned mode this is, for the handful of labels that differ. */
export const ownedBackendMode = independentStagingAdapter ? 'staging'
  : independentProductionAdapter ? 'production' : null;
