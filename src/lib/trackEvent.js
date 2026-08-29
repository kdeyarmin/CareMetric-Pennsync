import { base44 } from '@/api/base44Client';
import { logger } from '@/lib/logger';

/**
 * Fire a product-analytics event without ever taking the page down with it.
 *
 * `base44.analytics.track()` was called bare from three components. Two of those
 * calls sit in a mount `useEffect`, where a throw propagates to the nearest
 * ErrorBoundary — so if the SDK's analytics module is ever absent or its
 * transport throws, an optional page-view ping blanks a clinical tab (Document
 * Hub's audit and bulk-signature tabs) instead of quietly doing nothing. The
 * app's other telemetry seam (`logActivity`) already swallows its own failures;
 * this gives the analytics seam the same contract.
 *
 * Never throws, never rejects.
 *
 * @param {string} eventName
 * @param {object} [properties]
 */
export function trackEvent(eventName, properties = {}) {
  try {
    const result = base44?.analytics?.track?.({ eventName, properties });
    // The SDK's track() is fire-and-forget, but guard against a future version
    // returning a promise whose rejection would otherwise be unhandled.
    if (result && typeof result.catch === 'function') {
      result.catch((error) => logger.debug('[analytics] track failed', error));
    }
  } catch (error) {
    logger.debug('[analytics] track failed', error);
  }
}

export default trackEvent;
