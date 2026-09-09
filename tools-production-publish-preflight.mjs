// Local-only preflight: NEVER invokes Base44, fetch, a browser, or device login.
// A workspace publishing key is required; expiring user sessions are not used.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBuildInventory } from './tools-live-frontend-sync.mjs';

export const PRODUCTION_APP_ID = '694ec16e72e01b60d22f7cbf';
export function checkPublishingAccess(env) {
  if (env.GITHUB_ACTIONS !== 'true'
    || env.GITHUB_REPOSITORY !== 'kdeyarmin/CareMetric-Pennsync'
    || env.GITHUB_REF !== 'refs/heads/main'
    || env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
    || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || '')) {
    return { allowed: false, code: 'MANUAL_PRODUCTION_WORKFLOW_REQUIRED' };
  }
  const key = env.BASE44_API_KEY?.trim();
  if (!key || !/^b44k_[A-Za-z0-9_-]+$/.test(key)) {
    return { allowed: false, code: 'BASE44_PUBLISH_KEY_REQUIRED' };
  }
  return { allowed: true, code: 'CREDENTIAL_INPUT_PRESENT_NOT_YET_VALIDATED' };
}

export function main(args = process.argv.slice(2), { env = process.env, log = console.log, inventory = createBuildInventory } = {}) {
  if (args.length > 1 || (args.length && args[0] !== '--artifact')) {
    log(JSON.stringify({ allowed: false, code: 'INVALID_ARGUMENTS', deployment_attempted: false }));
    return 2;
  }
  const access = checkPublishingAccess(env);
  if (!access.allowed) {
    log(JSON.stringify({ ...access, deployment_attempted: false, login_attempted: false }));
    return 2;
  }
  if (args[0] === '--artifact') {
    try {
      const build = inventory('dist');
      if (!build.entry.endsWith(`-${env.GITHUB_SHA}.js`)) throw new Error('revision mismatch');
      log(JSON.stringify({ allowed: true, code: 'EXACT_WORKFLOW_BUILD_PRESENT',
        app_id: PRODUCTION_APP_ID, entry: build.entry, entry_sha256: build.entry_sha256,
        asset_count: build.assets.length, deployment_attempted: false }));
      return 0;
    } catch {
      log(JSON.stringify({ allowed: false, code: 'EXACT_WORKFLOW_BUILD_REQUIRED', deployment_attempted: false }));
      return 2;
    }
  }
  log(JSON.stringify({ ...access, app_id: PRODUCTION_APP_ID, deployment_attempted: false, login_attempted: false }));
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
