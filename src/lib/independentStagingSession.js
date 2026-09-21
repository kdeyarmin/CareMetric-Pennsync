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
