// Security guardrail tests — prevent regression of the fixes from the 2026-06-28
// security review (docs/CODE_REVIEW_2026-06-28_DEFERRED.md and the security
// pass). Style mirrors schemaContract.test.js: cheap, near-zero-maintenance
// invariants that turn a re-introduced vulnerability into a failing build rather
// than an invisible production exposure.
//
// Each assertion below pins a SPECIFIC, reviewed fix. When you intentionally
// change one of these surfaces, update the corresponding assertion/allowlist in
// the same PR so the guardrail stays meaningful.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url)); // base44/
const REPO = join(HERE, '..');
const read = (relToRepo) => readFileSync(join(REPO, relToRepo), 'utf8');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'dist') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(jsx?|tsx?)$/.test(name)) out.push(p);
  }
  return out;
}

// 1. getApprovedTimeOff is readable by EVERY authenticated user (service-role
//    read, RLS bypassed). It must expose only name/type/dates/half-day — never
//    employee_email, which would hand any user a staff name->email directory.
test('getApprovedTimeOff does not expose employee_email', () => {
  const src = read('base44/functions/getApprovedTimeOff/entry.ts');
  assert.ok(
    !/employee_email\s*:/.test(src),
    'getApprovedTimeOff must NOT return employee_email — the team time-off feed is readable by every authenticated user.',
  );
});

// 2. The referral->SmartNote handoff must pass its PHI-bearing prepopulation
//    payload via same-origin sessionStorage, NOT serialized into the iframe URL
//    query string (URLs leak into history, proxy/access logs, and Referer).
test('ReferralAdmissionNote does not serialize referral PHI into the URL', () => {
  const src = read('src/components/hub-tabs/ReferralAdmissionNote.jsx');
  assert.ok(
    !/referral_data=\$\{encodeURIComponent\(JSON\.stringify/.test(src),
    'ReferralAdmissionNote must pass the prepopulation payload via sessionStorage keyed by referral id — not a URL query param.',
  );
});

// 3. CSV exports must neutralize spreadsheet formula injection on attacker-
//    influenceable free-text. The clinical-report diagnosis cell (from patient
//    primary_diagnosis, populated via referral OCR/AI extraction) must go
//    through escapeCsvField, not be interpolated raw.
test('ReportsCenter clinical CSV escapes the diagnosis cell', () => {
  const src = read('src/components/admin/ReportsCenter.jsx');
  assert.ok(
    !/\+=\s*`\$\{diagnosis\}\s*,/.test(src),
    'ReportsCenter clinical-report CSV must wrap the diagnosis in escapeCsvField (formula-injection guard).',
  );
  assert.ok(
    /escapeCsvField\(\s*diagnosis\s*\)/.test(src),
    'Expected escapeCsvField(diagnosis) in ReportsCenter — the guarded form must be present.',
  );
});

// 4. dangerouslySetInnerHTML is an XSS sink. Confine it to a reviewed allowlist
//    of sinks that are known to sanitize/escape their input, so a NEW sink
//    forces a security review (and an explicit allowlist entry) rather than
//    slipping in unsanitized.
test('dangerouslySetInnerHTML stays within the reviewed, sanitized allowlist', () => {
  const ALLOW = new Set([
    'src/pages/SignDocument.jsx',                       // injects via sanitizeHtml() (DOMPurify)
    'src/components/documents/PDFSearchInterface.jsx',  // highlightText() HTML-escapes text + terms
    'src/components/ui/chart.jsx',                       // shadcn: emits CSS from a dev config, not user data
  ]);
  const offenders = walk(join(REPO, 'src'))
    .filter((p) => /dangerouslySetInnerHTML\s*=\s*\{/.test(readFileSync(p, 'utf8')))
    .map((p) => p.slice(REPO.length + 1).replace(/\\/g, '/'));
  const unexpected = offenders.filter((p) => !ALLOW.has(p));
  assert.deepEqual(
    unexpected,
    [],
    `Unreviewed dangerouslySetInnerHTML sink(s): ${unexpected.join(', ') || '(none)'}. ` +
      'Confirm the injected HTML is sanitized (sanitizeHtml/DOMPurify) and add the file to the allowlist in this test.',
  );
});
