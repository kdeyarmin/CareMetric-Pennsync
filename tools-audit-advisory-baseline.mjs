#!/usr/bin/env node
// Turn `pnpm audit --prod` from a report nobody reads into a check that fails on
// something new.
//
// The CI step that runs `audit:prod` carries `continue-on-error: true`, so it
// prints its findings and can never fail a build. That is the right shape for a
// report and the wrong shape for a detector: on 2026-09-30 the production audit
// went from one low advisory to fourteen, seven of them high, and every CI run
// in between was green. Removing `continue-on-error` instead would turn `main`
// red on the advisories already known, which gets reverted rather than fixed.
//
// So this compares the advisories found now against a committed baseline of the
// ones already known, each with the reason it is accepted and the date it was
// recorded. A known advisory passes; anything new, anything that escalated in
// severity, anything that reached a new dependency path, and any baseline entry
// whose advisory is gone all fail. The last of those is deliberate: a baseline
// nobody has to maintain stops describing the repository, so a resolved entry
// fails until it is removed.
//
// Two things about the audit itself drive the design.
//
// `pnpm audit --audit-level <level>` filters what it PRINTS; its footer counts
// everything. Reading the tables at `--audit-level high` on this repository
// shows twelve axios findings as seven, because the five moderate ones are
// hidden while still being counted. So this always runs at `low` and takes the
// finding set from `--json`, never from the tables.
//
// The advisory database is remote and moves on its own, so a run is a reading
// of a moment and not a property of the tree. An audit that cannot be run is
// reported as unmeasured and fails; it is never read as nothing found.
//
// Usage:
//   node tools-audit-advisory-baseline.mjs            # check (exit 1 on findings)
//   node tools-audit-advisory-baseline.mjs --summary  # same, one-line summary first
//   node tools-audit-advisory-baseline.mjs --json     # machine-readable report
//   node tools-audit-advisory-baseline.mjs --write    # re-record the baseline
//
// `--write` keeps each existing entry's `reason` and `recordedAt`, so re-pinning
// after a dependency moves does not silently drop the explanations. A new entry
// is written with an empty reason and the check fails until one is supplied: an
// accepted advisory with no stated reason is not a baseline, it is a mute.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BASELINE_PATH = path.join(HERE, 'audit-advisory-baseline.json');

// Ordered weakest to strongest. A severity the audit reports that is absent from
// this list is a refusal rather than a default: ranking it wrongly would let a
// real escalation read as unchanged.
export const SEVERITY_ORDER = ['info', 'low', 'moderate', 'high', 'critical'];

export function severityRank(severity) {
  const rank = SEVERITY_ORDER.indexOf(severity);
  if (rank === -1) {
    throw new Error(
      `unknown severity ${JSON.stringify(severity)}; expected one of ${SEVERITY_ORDER.join(', ')}`,
    );
  }
  return rank;
}

// An advisory's identity is its GHSA id plus the package it is against. The
// numeric `id` in pnpm's output is a registry key rather than the advisory's own
// name, and one GHSA can be reported against more than one package.
export function advisoryKey({ ghsa, module }) {
  return `${ghsa} ${module}`;
}

/**
 * Normalise `pnpm audit --json` into the finding set this tool compares.
 *
 * Throws rather than returning an empty set when the payload is not an audit
 * report: a parse that quietly yields nothing would read exactly like a clean
 * audit, which is the failure this whole tool exists to stop.
 */
export function parseAudit(payload) {
  const report = typeof payload === 'string' ? JSON.parse(payload) : payload;
  if (!report || typeof report !== 'object' || !report.advisories || typeof report.advisories !== 'object') {
    throw new Error('audit payload has no `advisories` object; refusing to read it as no findings');
  }
  const found = [];
  for (const entry of Object.values(report.advisories)) {
    const ghsa = entry.github_advisory_id || (entry.id != null ? `pnpm-${entry.id}` : null);
    if (!ghsa) throw new Error(`advisory with no github_advisory_id or id: ${JSON.stringify(entry).slice(0, 200)}`);
    const paths = [];
    for (const finding of entry.findings || []) {
      for (const p of finding.paths || []) if (!paths.includes(p)) paths.push(p);
    }
    found.push({
      ghsa,
      module: entry.module_name,
      severity: entry.severity,
      title: entry.title || '',
      patchedVersions: entry.patched_versions || null,
      paths: paths.sort(),
    });
    severityRank(entry.severity);
  }
  return found.sort((a, b) => advisoryKey(a).localeCompare(advisoryKey(b)));
}

export function readBaseline(file = BASELINE_PATH) {
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(parsed.advisories)) {
    throw new Error(`${file} has no \`advisories\` array`);
  }
  return parsed;
}

/**
 * Compare a finding set against a baseline. Pure: no network, no filesystem.
 *
 * Every finding kind here fails. There is no "warn" level on purpose — a kind
 * that only warns is the `continue-on-error` step again, one layer in.
 */
export function diffAgainstBaseline(found, baseline) {
  const baselined = new Map();
  for (const entry of baseline.advisories) baselined.set(advisoryKey(entry), entry);

  const findings = [];
  const seen = new Set();

  for (const advisory of found) {
    const key = advisoryKey(advisory);
    seen.add(key);
    const known = baselined.get(key);
    if (!known) {
      findings.push({
        kind: 'new',
        key,
        advisory,
        detail: `${advisory.severity} advisory against ${advisory.module} is not in the baseline`,
      });
      continue;
    }
    if (severityRank(advisory.severity) > severityRank(known.severity)) {
      findings.push({
        kind: 'escalated',
        key,
        advisory,
        detail: `severity rose from ${known.severity} to ${advisory.severity}`,
      });
    }
    const widened = advisory.paths.filter((p) => !(known.paths || []).includes(p));
    if (widened.length > 0) {
      findings.push({
        kind: 'widened',
        key,
        advisory,
        detail: `reaches ${widened.length} dependency path(s) the baseline does not record: ${widened.join(', ')}`,
      });
    }
    const gone = (known.paths || []).filter((p) => !advisory.paths.includes(p));
    if (gone.length > 0) {
      findings.push({
        kind: 'stale_path',
        key,
        advisory,
        detail: `baseline records ${gone.length} dependency path(s) the audit no longer reports: ${gone.join(', ')}`,
      });
    }
    if (!known.reason || String(known.reason).trim().length < 20) {
      findings.push({
        kind: 'unexplained',
        key,
        advisory,
        detail: 'baseline entry has no reason of at least 20 characters',
      });
    }
  }

  for (const [key, entry] of baselined) {
    if (!seen.has(key)) {
      findings.push({
        kind: 'stale',
        key,
        advisory: entry,
        detail: 'baseline records this advisory and the audit no longer reports it; remove the entry',
      });
    }
  }

  return {
    found: found.length,
    baselined: baselined.size,
    findings: findings.sort((a, b) => a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key)),
    passed: findings.length === 0,
  };
}

/** Rebuild baseline entries from a finding set, carrying forward existing prose. */
export function rebuildBaseline(found, baseline, today) {
  const existing = new Map();
  for (const entry of baseline.advisories || []) existing.set(advisoryKey(entry), entry);
  return {
    ...baseline,
    recordedAt: today,
    advisories: found.map((advisory) => {
      const known = existing.get(advisoryKey(advisory));
      return {
        ghsa: advisory.ghsa,
        module: advisory.module,
        severity: advisory.severity,
        title: advisory.title,
        patchedVersions: advisory.patchedVersions,
        paths: advisory.paths,
        reason: known?.reason || '',
        recordedAt: known?.recordedAt || today,
      };
    }),
  };
}

export function runAudit({ cwd = HERE } = {}) {
  // pnpm audit exits non-zero when it finds anything at or above the level, so
  // a non-zero exit is expected and the payload is on stdout either way. Only an
  // unparseable payload is an error.
  let stdout;
  try {
    stdout = execFileSync('pnpm', ['audit', '--prod', '--audit-level', 'low', '--json'], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    stdout = error.stdout;
    if (!stdout || !String(stdout).trim()) {
      throw new Error(
        `pnpm audit produced no report, so the advisory set is UNMEASURED rather than empty: ${
          error.stderr || error.message
        }`,
      );
    }
  }
  return parseAudit(stdout);
}

function formatReport(report) {
  const lines = [];
  for (const finding of report.findings) {
    lines.push(`${finding.kind.toUpperCase().padEnd(11)} ${finding.key}`);
    lines.push(`            ${finding.detail}`);
    if (finding.advisory.title) lines.push(`            ${finding.advisory.title}`);
    if (finding.advisory.patchedVersions) {
      lines.push(`            patched in ${finding.advisory.patchedVersions}`);
    }
  }
  return lines.join('\n');
}

function main(argv) {
  const wantsJson = argv.includes('--json');
  const wantsWrite = argv.includes('--write');
  const baseline = readBaseline();
  const found = runAudit();

  if (wantsWrite) {
    const today = new Date().toISOString().slice(0, 10);
    const next = rebuildBaseline(found, baseline, today);
    writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`);
    process.stdout.write(
      `Re-recorded ${next.advisories.length} advisory baseline entr${
        next.advisories.length === 1 ? 'y' : 'ies'
      } in ${path.basename(BASELINE_PATH)}.\n`,
    );
    const blank = next.advisories.filter((a) => !a.reason || a.reason.trim().length < 20);
    if (blank.length > 0) {
      process.stdout.write(
        `${blank.length} entr${blank.length === 1 ? 'y needs' : 'ies need'} a reason of at least 20 characters: ${blank
          .map((a) => advisoryKey(a))
          .join(', ')}\n`,
      );
      process.exitCode = 1;
    }
    return;
  }

  const report = diffAgainstBaseline(found, baseline);

  if (wantsJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      `audit advisory baseline: ${report.found} advisor${
        report.found === 1 ? 'y' : 'ies'
      } found, ${report.baselined} baselined, ${report.findings.length} finding${
        report.findings.length === 1 ? '' : 's'
      }\n`,
    );
    if (report.findings.length > 0) {
      process.stdout.write(`${formatReport(report)}\n`);
      process.stdout.write(
        '\nA new or escalated advisory is a bug report: fix it, or record it in ' +
          `${path.basename(BASELINE_PATH)} with a reason. ` +
          'A stale entry means the advisory is gone; remove it. ' +
          `Re-record with: node ${path.basename(fileURLToPath(import.meta.url))} --write\n`,
      );
    }
  }

  if (!report.passed) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
