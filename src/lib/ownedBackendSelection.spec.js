// The COMPOSITION ROOT, evaluated the way a build evaluates it.
//
// Why this file exists rather than more cases in the two adapter suites: every
// production test calls `readIndependentProductionConfig` directly, so nothing
// ever loaded `independentStagingSession` with `VITE_PENNSYNC_BACKEND` set to
// `independent`. That module calls the STAGING reader first and
// unconditionally, and that reader used to throw for any value it did not
// serve, so a production build died during module evaluation and the mode could
// not boot at all. Twelve green checks passed over it, because asserting that
// the production reader refuses the staging environment is not the same
// assertion as its mirror, and the asymmetry was the bug.
//
// So the subject here is the MODULE, loaded under each mode's real environment,
// rather than either reader in isolation. A reader that refuses a sibling mode
// fails this file on import, before any expectation runs.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { productionEnv } from '@/test/independentProductionFixture';
import { stagingEnv } from '@/test/independentStagingFixture';

const KEYS = [...new Set([...Object.keys(productionEnv), ...Object.keys(stagingEnv)])];

const loadRoot = async env => {
  vi.resetModules();
  // Every key either mode reads is stubbed on every load, so a value left over
  // from the previous case cannot select a backend.
  for (const key of KEYS) vi.stubEnv(key, env[key] ?? '');
  return import('@/lib/independentStagingSession');
};

describe('which owned backend a build selects', () => {
  beforeEach(() => { vi.unstubAllEnvs(); });
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it('boots the production mode, with the staging exports null', async () => {
    const root = await loadRoot(productionEnv);
    expect(root.independentProductionAdapter).not.toBeNull();
    expect(root.independentProductionAuth).not.toBeNull();
    // The split this module exists for: production is an owned backend, and is
    // NOT the synthetic staging workspace. A build that took the staging
    // branches would render the synthetic roster instead of the app.
    expect(root.independentStagingAdapter).toBeNull();
    expect(root.independentStagingAuth).toBeNull();
    expect(root.ownedBackendAdapter).toBe(root.independentProductionAdapter);
    expect(root.ownedBackendAuth).toBe(root.independentProductionAuth);
    expect(root.usesIndependentBackend).toBe(true);
    expect(root.ownedBackendMode).toBe('production');
  });

  it('boots the staging mode unchanged, with the production exports null', async () => {
    const root = await loadRoot(stagingEnv);
    expect(root.independentStagingAdapter).not.toBeNull();
    expect(root.independentProductionAdapter).toBeNull();
    expect(root.independentProductionAuth).toBeNull();
    expect(root.ownedBackendAdapter).toBe(root.independentStagingAdapter);
    expect(root.ownedBackendMode).toBe('staging');
  });

  it('selects no owned backend on the Base44 path', async () => {
    for (const env of [{}, { VITE_PENNSYNC_BACKEND: 'base44' }]) {
      const root = await loadRoot(env);
      expect(root.ownedBackendAdapter).toBeNull();
      expect(root.ownedBackendAuth).toBeNull();
      expect(root.usesIndependentBackend).toBe(false);
      expect(root.ownedBackendMode).toBeNull();
    }
  });

  it('still refuses a mode name that is neither, rather than falling back to Base44', async () => {
    // The reason the staging reader answers `null` for `independent` rather
    // than for anything it does not recognise: a typo must not quietly hand
    // sign-in back to Base44. `independent` is a known sibling; `independant`
    // is a misconfiguration.
    await expect(loadRoot({ ...stagingEnv, VITE_PENNSYNC_BACKEND: 'independant' }))
      .rejects.toThrow('INVALID_STAGING_CONFIGURATION');
  });
});
