import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
// Exact source allowlists use repository paths on every host platform.
const relativeSourcePath = (file) => path.relative(root, file).split(path.sep).join('/');

function productionSourceFiles(directory = path.join(root, 'src')) {
  return readdirSync(directory).flatMap((name) => {
    const absolute = path.join(directory, name);
    if (statSync(absolute).isDirectory()) return productionSourceFiles(absolute);
    if (!/\.[cm]?[jt]sx?$/.test(name) || /\.(?:spec|test)\.[cm]?[jt]sx?$/.test(name)) return [];
    return [absolute];
  });
}

describe('protected blank-target navigation contract', () => {
  it('keeps declarative blank-target links out of clinical application source', () => {
    // The inert pre-bootstrap launcher below is not a clinical popup: it is
    // rendered only after the embedded document's authority is closed, opens
    // the same origin root without any URL state, and severs the opener.
    // Its narrow exception is checked separately and by real browser tests.
    const boundaryFiles = new Set([
      'src/lib/authorityBoundWindows.js',
      'src/lib/secureBootstrapUi.js',
    ]);
    const violations = productionSourceFiles()
      .filter((file) => !boundaryFiles.has(relativeSourcePath(file)))
      .filter((file) => /\btarget\s*=\s*(?:["']_blank["']|\{\s*["']_blank["']\s*\})/i.test(readFileSync(file, 'utf8')))
      .map(relativeSourcePath);

    expect(violations).toEqual([]);
  });

  it('confines the token-free preview launcher to the closed pre-bootstrap document', () => {
    const uiPath = 'src/lib/secureBootstrapUi.js';
    const ui = readFileSync(path.join(root, uiPath), 'utf8');
    const main = readFileSync(path.join(root, 'src/main.jsx'), 'utf8');
    const callers = productionSourceFiles()
      .filter((file) => relativeSourcePath(file) !== uiPath)
      .filter((file) => /secureBootstrapUi/.test(readFileSync(file, 'utf8')))
      .map(relativeSourcePath);
    expect(callers).toEqual(['src/main.jsx']);
    expect(ui).not.toMatch(/^import\s/m);
    expect(ui).not.toMatch(/base44\.|fetch\(|postMessage|localStorage|sessionStorage|window\.open/);
    expect(ui).toContain('return `${url.origin}/`');
    expect(ui).toMatch(/if \(embedded\) \{\s*const href = detachedPreviewUrl\(locationObject.href\)/);
    expect(ui.match(/link\.target = '_blank'/g)).toHaveLength(1);
    expect(ui).toContain("link.rel = 'noopener noreferrer'");
    expect(ui).toContain("link.referrerPolicy = 'no-referrer'");
    expect(main).toMatch(/if \(!currentFrameMayBootstrap\(\)\) \{\s*terminallyCloseDocumentAuthority\(\)\s*renderSecureBootstrapBlocked\(\)/);
    expect(main).toMatch(/if \(documentAuthorityReady\) \{\s*void bootstrapApp\(\)/);
  });
});
