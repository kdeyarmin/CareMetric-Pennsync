/**
 * Remove only browser runtime artifacts from the retired offline feature.
 *
 * This helper deliberately has no access to queued clinical work or draft
 * storage. It is safe to invoke before authentication: service-worker
 * registrations for this app origin are no longer supported, and only caches
 * carrying the retired offline prefix are deleted. Failures are reported in
 * the result so startup can remain available without claiming cleanup occurred.
 */

const LEGACY_CACHE_PREFIX = 'base44-offline';

export async function retireLegacyBrowserCaches({
  navigatorRef = typeof navigator === 'undefined' ? null : navigator,
  cachesRef = typeof caches === 'undefined' ? null : caches,
} = {}) {
  const result = {
    registrationsFound: 0,
    registrationsRemoved: 0,
    cachesFound: 0,
    cachesRemoved: 0,
    errors: [],
  };

  try {
    if (navigatorRef?.serviceWorker?.getRegistrations) {
      const registrations = await navigatorRef.serviceWorker.getRegistrations();
      const safeRegistrations = Array.isArray(registrations) ? registrations : [];
      result.registrationsFound = safeRegistrations.length;
      const removals = await Promise.allSettled(
        safeRegistrations.map((registration) => registration.unregister()),
      );
      removals.forEach((removal) => {
        if (removal.status === 'fulfilled' && removal.value !== false) {
          result.registrationsRemoved += 1;
        } else if (removal.status === 'rejected') {
          result.errors.push(removal.reason);
        }
      });
    }
  } catch (error) {
    result.errors.push(error);
  }

  try {
    if (cachesRef?.keys) {
      const keys = await cachesRef.keys();
      const legacyKeys = (Array.isArray(keys) ? keys : [])
        .filter((key) => String(key).startsWith(LEGACY_CACHE_PREFIX));
      result.cachesFound = legacyKeys.length;
      const removals = await Promise.allSettled(
        legacyKeys.map((key) => cachesRef.delete(key)),
      );
      removals.forEach((removal) => {
        if (removal.status === 'fulfilled' && removal.value !== false) {
          result.cachesRemoved += 1;
        } else if (removal.status === 'rejected') {
          result.errors.push(removal.reason);
        }
      });
    }
  } catch (error) {
    result.errors.push(error);
  }

  return Object.freeze({
    ...result,
    errors: Object.freeze([...result.errors]),
  });
}
