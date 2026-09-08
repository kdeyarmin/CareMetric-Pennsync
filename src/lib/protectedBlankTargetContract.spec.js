import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function productionSourceFiles(directory = path.join(root, 'src')) {
  return readdirSync(directory).flatMap((name) => {
    const absolute = path.join(directory, name);
    if (statSync(absolute).isDirectory()) return productionSourceFiles(absolute);
    if (!/\.[cm]?[jt]sx?$/.test(name) || /\.(?:spec|test)\.[cm]?[jt]sx?$/.test(name)) return [];
    return [absolute];
  });
}

describe('protected blank-target navigation contract', () => {
  it('keeps declarative blank-target links out of production source', () => {
    const violations = productionSourceFiles()
      .filter((file) => path.relative(root, file) !== 'src/lib/authorityBoundWindows.js')
      .filter((file) => /\btarget\s*=\s*(?:["']_blank["']|\{\s*["']_blank["']\s*\})/i.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(root, file));

    expect(violations).toEqual([]);
  });
});
