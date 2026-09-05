import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const read = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8');

function sourceFiles(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const absolutePath = join(directory, entry);
    if (statSync(absolutePath).isDirectory()) return sourceFiles(absolutePath);
    return /\.[cm]?[jt]sx?$/.test(entry) && !/\.(?:spec|test)\.[cm]?[jt]sx?$/.test(entry)
      ? [absolutePath]
      : [];
  });
}

describe('protected PDF annotation containment', () => {
  it('keeps the protected fax route while rendering annotation as unavailable', () => {
    const route = read('src/pages/SendFax.jsx');
    const sender = read('src/components/fax/DocumentFaxSender.jsx');

    expect(route).toMatch(/import DocumentFaxSender from ["']\.\.\/components\/fax\/DocumentFaxSender["']/);
    expect(route).toMatch(/<DocumentFaxSender\b/);
    expect(sender).toContain('Secure PDF annotation unavailable');
    expect(sender).toContain('self-hosted, authority-bound renderer');
    expect(sender).toContain('fax the original authorized document');
    expect(sender).not.toMatch(/PDFAnnotator|showAnnotator|annotatedUrl/);
  });

  it('does not mount the retired CDN-backed annotator from production code', () => {
    const productionConsumers = sourceFiles(join(repoRoot, 'src'))
      .filter((file) => !file.endsWith('/components/fax/PDFAnnotator.jsx'))
      .filter((file) => /(?:from\s+["'][^"']*PDFAnnotator|<PDFAnnotator\b)/.test(readFileSync(file, 'utf8')));

    expect(productionConsumers).toEqual([]);
  });
});
