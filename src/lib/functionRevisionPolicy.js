export const BASE44_FUNCTIONS_VERSION_HEADER = 'Base44-Functions-Version';

const MAX_EXACT_REVISION_LENGTH = 200;
const EXACT_REVISION = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const FLOATING_REVISION_SELECTORS = new Set([
  'default',
  'dev',
  'development',
  'draft',
  'latest',
  'main',
  'prod',
  'production',
]);

/**
 * Accept an optional, immutable build-time function revision.
 *
 * A revision sent in Base44-Functions-Version changes which deployed backend
 * code handles a request. Only an exact opaque identifier baked into this
 * frontend build may do that. Floating aliases would silently change meaning
 * after the frontend was reviewed, so they intentionally fall back to the
 * platform's published/default revision instead.
 */
export function normalizeBuildPinnedFunctionsVersion(value) {
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_EXACT_REVISION_LENGTH
    || value.trim() !== value
    || !EXACT_REVISION.test(value)
    || FLOATING_REVISION_SELECTORS.has(value.toLowerCase())) {
    return null;
  }
  return value;
}

export class FunctionsVersionOverrideError extends Error {
  constructor() {
    super('Runtime function revision overrides are not permitted');
    this.name = 'FunctionsVersionOverrideError';
    this.code = 'FUNCTIONS_VERSION_OVERRIDE_BLOCKED';
  }
}

/**
 * Close the SDK's direct functions.fetch header escape hatch.
 *
 * @base44/sdk applies its configured functionsVersion to functions.invoke and
 * actors, but its direct functions.fetch implementation builds a fresh Headers
 * object from caller input. Lock that path to the same build pin (or to no
 * revision header when the build is unpinned) before the raw client is exposed
 * through the tenant authority membrane.
 */
export function lockBase44FunctionRevision(client, functionsVersion) {
  const exactBuildRevision = normalizeBuildPinnedFunctionsVersion(functionsVersion);
  if (functionsVersion != null && exactBuildRevision !== functionsVersion) {
    throw new TypeError('A valid exact build-pinned function revision is required');
  }

  const functionsModule = client?.functions;
  const rawFetch = functionsModule?.fetch;
  if (!functionsModule || typeof rawFetch !== 'function') {
    throw new TypeError('A Base44 functions module with fetch is required');
  }

  const lockedFetch = async function revisionLockedFunctionFetch(path, init = {}) {
    const headers = new Headers(init?.headers);
    const callerRevision = headers.get(BASE44_FUNCTIONS_VERSION_HEADER);
    if (callerRevision !== null && callerRevision !== exactBuildRevision) {
      throw new FunctionsVersionOverrideError();
    }

    if (exactBuildRevision) {
      headers.set(BASE44_FUNCTIONS_VERSION_HEADER, exactBuildRevision);
    } else {
      headers.delete(BASE44_FUNCTIONS_VERSION_HEADER);
    }

    return Reflect.apply(rawFetch, functionsModule, [path, {
      ...(init ?? {}),
      headers,
    }]);
  };

  Object.defineProperty(functionsModule, 'fetch', {
    configurable: false,
    enumerable: true,
    writable: false,
    value: lockedFetch,
  });

  return client;
}
