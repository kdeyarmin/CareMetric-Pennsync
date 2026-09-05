import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import process from 'node:process';

const readRepoFile = (filePath) => readFileSync(`${process.cwd()}/${filePath}`, 'utf8');

const productionSourceFiles = (directory = `${process.cwd()}/src`) => readdirSync(
  directory,
  { withFileTypes: true },
).flatMap((entry) => {
  const path = `${directory}/${entry.name}`;
  if (entry.isDirectory()) return productionSourceFiles(path);
  if (!/\.(?:js|jsx|ts|tsx)$/.test(entry.name)) return [];
  if (/\.(?:spec|test)\.[^.]+$/.test(entry.name)) return [];
  return [path];
});

describe('hosted deployment path guards', () => {
  it('builds with a relative Vite base for arbitrary hosted mount paths', () => {
    const viteConfig = readRepoFile('vite.config.js');
    expect(viteConfig).toContain("base: command === 'build' ? './' : '/',");
  });

  it('registers no service worker', () => {
    // Offline mode was removed along with public/sw.js. A worker registered here
    // would control the page and serve a cached shell with nothing to update it.
    expect(readRepoFile('src/main.jsx')).not.toMatch(/serviceWorker\s*\.\s*register\s*\(/);
    expect(readRepoFile('index.html')).not.toContain('service-worker');
    expect(() => readRepoFile('public/sw.js')).toThrow();
    expect(() => readRepoFile('public/service-worker.js')).toThrow();
    expect(() => readRepoFile('public/offline.html')).toThrow();
  });

  it('invokes browser-only retirement without reconnecting clinical queue replay', () => {
    const main = readRepoFile('src/main.jsx');
    const cleanup = readRepoFile('src/lib/retiredBrowserCacheCleanup.js');
    expect(main).toMatch(
      /import\(['"]@\/lib\/retiredBrowserCacheCleanup['"]\)[\s\S]*retireLegacyBrowserCaches\(\)/,
    );
    expect(cleanup).toContain('registration.unregister()');
    expect(cleanup).toContain('cachesRef.delete(key)');

    const importers = productionSourceFiles()
      .filter((path) => !path.endsWith('/retiredOfflineQueue.js'))
      .filter((path) => /(?:from\s+|import\s*\()(['"])[^'"]*retiredOfflineQueue(?:\.js)?\1/.test(
        readFileSync(path, 'utf8'),
      ));
    expect(importers).toEqual([]);
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
