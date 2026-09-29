import { createIndependentStagingAdapter, readIndependentStagingConfig } from './independentStagingAdapter';
import { getActiveTrustedTenantContext } from './roles';

// Build configuration only. URL/storage input never selects a backend or user.
const config = readIndependentStagingConfig(import.meta.env);
// The composition root is where the adapter learns which principal is bound.
// It is not imported inside the adapter because that module is also loaded
// under plain `node --test` by the browser acceptance suites, where a `@/`
// alias does not resolve and `roles.js` reaches one of its own.
export const independentStagingAdapter = config
  ? createIndependentStagingAdapter(config, { boundTenant: getActiveTrustedTenantContext })
  : null;
export const independentStagingAuth = independentStagingAdapter?.auth ?? null;
/**
 * Whether this build talks to the owned service rather than Base44.
 *
 * Exported for the one thing a screen legitimately has to know: which SHAPE a
 * capability takes. `OCRDocumentExtractor` uploads a document and then reads
 * it, and the two backends do that differently — Base44 stores the file and
 * passes a locator, while the owned path sends the bytes to the handler, which
 * mints the object under its own subject. It is not a permission and nothing
 * branches on it to decide what a caller may do.
 */
export const usesIndependentBackend = !!independentStagingAdapter;
