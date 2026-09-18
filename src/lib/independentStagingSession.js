import { createIndependentStagingAdapter, readIndependentStagingConfig } from './independentStagingAdapter';

// Build configuration only. URL/storage input never selects a backend or user.
const config = readIndependentStagingConfig(import.meta.env);
export const independentStagingAdapter = config ? createIndependentStagingAdapter(config) : null;
export const independentStagingAuth = independentStagingAdapter?.auth ?? null;
