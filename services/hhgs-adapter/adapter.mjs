// Offline, server-only boundary. Deliberately not imported by the SPA or any
// Base44/Railway endpoint. It grants no tenant authority or payment eligibility.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { CMS_HHGS_RELEASES_CY2026, resolveCmsHhgsReleaseForClaimFromDate } from '../../src/components/pdgm/cmsHhgsReleasesCy2026.js';

const bridgePath = fileURLToPath(new URL('./PennSyncHhgs.java', import.meta.url));
const supportedReturnCodes = new Set(['00', '01', '02', '03', '05', '07', '08', '09', '10', '11', '12', '13', '14']);
const fail = (code) => { throw new Error(code); };

export function validateClaims(records) {
  if (!Array.isArray(records) || records.length === 0 || records.length > 1000) fail('hhgs_invalid_batch');
  // Array.from visits holes: sparse arrays cannot silently reduce the batch.
  return Array.from(records, (record) => {
    if (typeof record !== 'string' || record.length !== 600 || !/^[\x20-\x7e]+$/.test(record)) {
      fail('hhgs_invalid_record');
    }
    // D/Y writes diagnostic details; S skips grouping. None belongs in this API.
    if (record[599] !== ' ') fail('hhgs_action_flag_forbidden');
    const date = record.slice(24, 32);
    const selected = resolveCmsHhgsReleaseForClaimFromDate(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`);
    if (!selected.resolved) fail('hhgs_unsupported_claim_date');
    return { record, release: selected.release };
  });
}

export function parseOutcome(raw, expectedVersion) {
  if (typeof raw !== 'string' || !/^\d{2}\.\d\.\d{2}[A-Z0-9]{5}\d{4}$/.test(raw)) fail('hhgs_invalid_output');
  const version = raw.slice(0, 7);
  if (!CMS_HHGS_RELEASES_CY2026.some(r => r.version === expectedVersion) || version !== expectedVersion) {
    fail('hhgs_version_mismatch');
  }
  const hipps = raw.slice(7, 12);
  const validityFlag = raw.slice(12, 14);
  const returnCode = raw.slice(14, 16);
  if (Number(validityFlag) > 15 || !supportedReturnCodes.has(returnCode)) fail('hhgs_invalid_output');
  // CMS uses 00000 for unsuccessful grouping. Never silently accept an internal
  // failure (50), malformed code, or mixed success/failure result.
  if (returnCode === '00' ? !/^[1-5][A-L][ABC][123]1$/.test(hipps) : hipps !== '00000') {
    fail('hhgs_invalid_output');
  }
  return Object.freeze({ version, hipps, validityFlag, returnCode, raw });
}

export function javaEnvironment(source = process.env) {
  // Do not inherit JAVA_TOOL_OPTIONS/JDK_JAVA_OPTIONS/_JAVA_OPTIONS, CLASSPATH,
  // preload hooks, credentials, or any operator's diagnostic agent settings.
  const allowed = new Set(['systemroot', 'windir', 'temp', 'tmp', 'lang', 'lc_all']);
  return Object.fromEntries(Object.entries(source).filter(([key]) => allowed.has(key.toLowerCase())));
}

export function readOutcomes(stdout, count, version) {
  if (typeof stdout !== 'string' || !stdout.endsWith('\n')) fail('hhgs_invalid_output');
  const lines = stdout.slice(0, -1).split(/\r?\n/).map(line => line.replace(/\r$/, ''));
  if (lines.length !== count) fail('hhgs_output_count_mismatch');
  return lines.map(line => parseOutcome(line, version));
}

/**
 * Group at most 1000 complete, 600-byte CMS inputs; preserve caller order.
 * javaExecutable and jarPaths are trusted local operator configuration, never
 * request fields. JDK 17 (including source launcher) is required. No PHI files.
 * All-or-nothing: no partial result escapes any validation or process failure.
 */
export function groupCmsClaims({ records, javaExecutable, jarPaths, timeoutMs = 60000 } = {}) {
  const claims = validateClaims(records);
  if (typeof javaExecutable !== 'string' || !isAbsolute(javaExecutable)
      || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) fail('hhgs_invalid_configuration');
  let workspace;
  try {
    workspace = mkdtempSync(join(tmpdir(), 'pennsync-hhgs-'));
    // Only reviewed bridge code and hash-verified public CMS bytes touch disk.
    const source = join(workspace, 'PennSyncHhgs.java');
    writeFileSync(source, readFileSync(bridgePath), { mode: 0o600 });
    const results = new Array(claims.length);
    for (const release of CMS_HHGS_RELEASES_CY2026) {
      const batch = claims.map((claim, index) => ({ ...claim, index })).filter(c => c.release.version === release.version);
      if (batch.length === 0) continue;
      const configuredJar = jarPaths?.[release.version];
      if (typeof configuredJar !== 'string' || !isAbsolute(configuredJar)) fail('hhgs_missing_artifact');
      const metadata = statSync(configuredJar);
      if (!metadata.isFile() || metadata.size > 64 * 1024 * 1024) fail('hhgs_invalid_artifact');
      const bytes = readFileSync(configuredJar);
      const jarSha256 = createHash('sha256').update(bytes).digest('hex');
      if (jarSha256 !== release.files['dist/HomeHealth.jar']) fail('hhgs_artifact_hash_mismatch');
      // The pinned JAR embeds its complete version tables; no loose tables or
      // extra classpath are loaded. Execute the verified snapshot, not the
      // original path which could change between hashing and JVM startup.
      const jar = join(workspace, `${release.version}.jar`);
      writeFileSync(jar, bytes, { mode: 0o600 });
      const child = spawnSync(javaExecutable, [
        '-Xmx512m', '-XX:-CreateCoredumpOnCrash', '-XX:-HeapDumpOnOutOfMemoryError',
        `-XX:ErrorFile=${join(workspace, 'jvm-error.log')}`,
        '-Dfile.encoding=UTF-8', '-Dhhgs.encoding.override=UTF-8',
        '--class-path', jar, source,
      ], {
        cwd: workspace, env: javaEnvironment(), input: `${batch.map(c => c.record).join('\n')}\n`,
        encoding: 'utf8', timeout: timeoutMs, maxBuffer: 1024 * 1024,
        windowsHide: true, shell: false,
      });
      // spawn errors may include args and stdout/stderr. Expose only fixed codes.
      if (child.error?.code === 'ETIMEDOUT') fail('hhgs_timeout');
      if (child.error || child.status !== 0 || child.signal) fail('hhgs_process_failed');
      const outcomes = readOutcomes(child.stdout, batch.length, release.version);
      batch.forEach((claim, index) => {
        results[claim.index] = Object.freeze({ ...outcomes[index], jarSha256 });
      });
    }
    return Object.freeze({ paymentAvailable: false, results: Object.freeze(results) });
  } catch (error) {
    if (/^hhgs_[a-z_]+$/.test(error?.message)) throw new Error(error.message);
    fail('hhgs_execution_failed');
  } finally {
    try {
      if (workspace) rmSync(workspace, { recursive: true, force: true });
    } catch {
      fail('hhgs_cleanup_failed');
    }
  }
}
