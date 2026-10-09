/**
 * Centralized brand identity for the app: PennSync by CareMetric.
 *
 * PennSync is the product name; CareMetric is the software platform it runs on,
 * so the brand lockup reads "PennSync by CareMetric". Keep the logo URL in one
 * place so every surface (chrome, loaders, error states) stays in sync. The
 * file is served from this app's own `public/brand/`, so it moves with the app's
 * host rather than depending on a separate storage bucket.
 */
export const BRAND_LOGO_URL = "/brand/pennsync-logo.png";

/** Product name shown in prose and titles. */
export const APP_NAME = "PennSync";

/** Underlying software platform. */
export const PLATFORM_NAME = "CareMetric";
