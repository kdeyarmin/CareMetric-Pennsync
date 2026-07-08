import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import process from 'node:process';

const readRepoFile = (filePath) => readFileSync(`${process.cwd()}/${filePath}`, 'utf8');

describe('hosted deployment path guards', () => {
  it('builds with a relative Vite base for arbitrary hosted mount paths', () => {
    const viteConfig = readRepoFile('vite.config.js');
    expect(viteConfig).toContain("base: command === 'build' ? './' : '/',");
  });

  it('registers the service worker from the Vite base URL', () => {
    expect(readRepoFile('src/main.jsx')).toContain('navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`)');
  });

  it('keeps service-worker offline shell paths scoped to its registration path', () => {
    const sw = readRepoFile('public/sw.js');
    expect(sw).toContain("const OFFLINE_URL = scopedPath('offline.html')");
    expect(sw).toContain("const SHELL_KEY = scopedPath('index.html')");
    expect(sw).toContain("pathname.startsWith(scopedPath('assets/'))");
    expect(sw).not.toContain("const OFFLINE_URL = '/offline.html'");
    expect(sw).not.toContain("const SHELL_KEY = '/index.html'");
    expect(sw).not.toContain("pathname.startsWith('/assets/')");
  });

  it('does not hard-code root reloads in the static offline page', () => {
    const offline = readRepoFile('public/offline.html');
    expect(offline).toContain("window.location.replace('./')");
    expect(offline).not.toContain("window.location.replace('/')");
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
