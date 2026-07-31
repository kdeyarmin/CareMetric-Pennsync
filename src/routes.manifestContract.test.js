import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const pagesDir = join(process.cwd(), 'src/pages');
const pageFiles = readdirSync(pagesDir)
  .filter((file) => file.endsWith('.jsx') && !/\.(test|spec)\./.test(file))
  .map((file) => file.replace(/\.jsx$/, ''))
  .sort();

const manifestSrc = readFileSync(join(process.cwd(), 'src/lib/nav.manifest.js'), 'utf8');
const routesSrc = readFileSync(join(process.cwd(), 'src/routes.jsx'), 'utf8');
const manifestPages = new Set([...manifestSrc.matchAll(/page:\s*["']([^"']+)["']/g)].map((m) => m[1]));

const PUBLIC_NON_MANIFEST_PAGES = new Set([
  'JoinTelehealth',
  'PrivacyPolicy',
  'ProviderFollowUpPortal',
  'SignerPortal',
]);

// Intentional legacy/reference pages retained for content parity while their
// paths redirect to canonical hubs. Adding to this list requires a route comment
// or redirect note in src/routes.jsx so stale screens are never accidental.
const INTENTIONAL_UNROUTED_LEGACY_PAGES = new Set([
  'AnalyticsDashboard',
  'ClinicalChart',
  'ClinicalInsightsDashboard',
  'MyLearning',
  'NurseEducationVideos',
]);

test('page files are routed, public-token pages, or intentionally allowlisted legacy pages', () => {
  const unexpected = pageFiles.filter(
    (page) => !manifestPages.has(page) && !PUBLIC_NON_MANIFEST_PAGES.has(page) && !INTENTIONAL_UNROUTED_LEGACY_PAGES.has(page),
  );
  assert.deepEqual(unexpected, [], `Unexpected unrouted page file(s): ${unexpected.join(', ') || '(none)'}`);
});

test('intentional unrouted legacy pages are documented in routes.jsx', () => {
  for (const page of INTENTIONAL_UNROUTED_LEGACY_PAGES) {
    assert.match(routesSrc, new RegExp(page), `${page} is allowlisted as unrouted but is not documented in routes.jsx`);
  }
});