import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import process from 'node:process';

const readRepoFile = (filePath) => readFileSync(`${process.cwd()}/${filePath}`, 'utf8');

describe('hosted deployment path guards', () => {
  it('builds with a relative Vite base for arbitrary hosted mount paths', () => {
    const viteConfig = readRepoFile('vite.config.js');
    expect(viteConfig).toContain("base: command === 'build' ? './' : '/',");
  });

  it('registers no service worker', () => {
    // Offline mode was removed along with public/sw.js. A worker registered here
    // would control the page and serve a cached shell with nothing to update it;
    // retiredOfflineQueue.js unregisters the one previous versions installed.
    expect(readRepoFile('src/main.jsx')).not.toContain('serviceWorker.register');
    expect(() => readRepoFile('public/sw.js')).toThrow();
    expect(() => readRepoFile('public/offline.html')).toThrow();
  });

  it('unregisters the retired service worker and drops its caches', () => {
    const retire = readRepoFile('src/lib/retiredOfflineQueue.js');
    expect(retire).toContain('registration.unregister()');
    expect(retire).toContain('caches.delete(key)');
  });

  it('passes router paths when building static manual links from hosted pages', () => {
    for (const filePath of ['src/pages/Help.jsx', 'src/pages/UserGuides.jsx']) {
      const source = readRepoFile(filePath);
      expect(source).toContain("import { ROUTER_PATHS } from '@/routes';");
      expect(source).toContain('hostedAssetPath("/manuals/PennSync-User-Manual.pdf", { routerPaths: ROUTER_PATHS })');
      expect(source).toContain('hostedAssetPath("/manuals/PennSync-Facility-Admin-Manual.pdf", { routerPaths: ROUTER_PATHS })');
    }
  });

});
