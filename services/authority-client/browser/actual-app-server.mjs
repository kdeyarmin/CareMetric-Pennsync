import { access, mkdir, mkdtemp, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';
import { API, PROJECT } from '../../authority-store/tests/http-local-stack.mjs';
import { STAGING_APP_ID } from '../client.mjs';
import { readIndependentStagingConfig } from '../../../src/lib/independentStagingAdapter.js';

export const ACTUAL_APP_ORIGIN = 'http://127.0.0.1:4181';
const root = fileURLToPath(new URL('../../../', import.meta.url));

/** Build the real entry/App with its actual production Vite configuration. */
export async function startActualApp(configuration) {
  if (configuration.target.projectUrl !== API || configuration.target.projectRef !== PROJECT
    || configuration.target.appId !== STAGING_APP_ID) throw new Error('ACTUAL_APP_LOCAL_TARGET_REQUIRED');
  const env = {
    VITE_PENNSYNC_BACKEND: 'independent-staging',
    VITE_PENNSYNC_STAGING_PROJECT_REF: PROJECT,
    VITE_PENNSYNC_STAGING_PROJECT_URL: API,
    VITE_PENNSYNC_STAGING_PUBLISHABLE_KEY: configuration.target.publishableKey,
    VITE_PENNSYNC_STAGING_ACTORS: JSON.stringify(Object.fromEntries(configuration.actors.map(a => [a.email, a.uuid]))),
    VITE_BASE44_APP_ID: STAGING_APP_ID,
    // This mode has no Base44 business endpoint. Do not invent one for the build.
    VITE_BASE44_BACKEND_URL: '',
    VITE_SUPER_ADMIN_EMAIL: '',
  };
  readIndependentStagingConfig(env); // Exact four actors and reviewed public target; no I/O.
  if (await access('/run/base44/app.env').then(() => true, () => false)) {
    throw new Error('ACTUAL_APP_HOSTED_BUILD_ENV_FORBIDDEN');
  }
  const prior = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('VITE_')));
  const directory = join(root, 'work', 'actual-app-browser');
  await mkdir(directory, { recursive: true });
  // Only public build configuration enters this directory; never passwords or tokens.
  const output = await mkdtemp(join(directory, 'build-'));
  try {
    for (const key of Object.keys(prior)) delete process.env[key];
    Object.assign(process.env, env);
    await build({ root, envDir: false, mode: 'independent-acceptance', logLevel: 'silent',
      build: { outDir: output, emptyOutDir: false } });
    const assetPaths = new Set();
    const inventory = async (directory, prefix = '') => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = `${prefix}/${entry.name}`;
        if (entry.isDirectory()) await inventory(join(directory, entry.name), path);
        else if (entry.isFile()) assetPaths.add(path);
        else throw new Error('ACTUAL_APP_UNEXPECTED_BUILD_ENTRY');
      }
    };
    await inventory(output);
    const server = await preview({ root, envDir: false, mode: 'independent-acceptance', logLevel: 'silent',
      build: { outDir: output }, preview: { host: '127.0.0.1', port: 4181, strictPort: true,
        headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } } });
    return { assetPaths, async stop() {
      server.httpServer.closeAllConnections();
      await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(new Error('ACTUAL_APP_SERVER_STOP_FAILED')) : resolve()));
    } };
  } catch {
    throw new Error('ACTUAL_APP_BUILD_OR_SERVER_FAILED');
  } finally {
    for (const key of Object.keys(process.env)) if (key.startsWith('VITE_')) delete process.env[key];
    Object.assign(process.env, prior);
  }
}
