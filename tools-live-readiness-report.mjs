#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { LIVE_CAPABILITY_MATRIX } from "./src/lib/liveReadinessGate.js";
import { createLiveReadinessReleaseLedger } from "./src/lib/liveReadinessReleaseLedger.js";
import { createLiveReadinessCiReport } from "./src/lib/liveReadinessCiReport.js";
import { formatLiveReadinessInputErrors, validateLiveReadinessInput } from "./src/lib/liveReadinessInputValidation.js";

function parseInput(raw) {
  const parsed = JSON.parse(raw);
  const validationErrors = validateLiveReadinessInput(parsed);
  if (validationErrors.length > 0) {
    throw new Error(`Invalid readiness input: ${formatLiveReadinessInputErrors(validationErrors)}`);
  }
  return {
    release: parsed.release || {},
    evidence: parsed.evidence || {},
    matrix: parsed.matrix || LIVE_CAPABILITY_MATRIX,
  };
}

export function buildLiveReadinessReportFromJson(raw) {
  const { release, evidence, matrix } = parseInput(raw);
  const ledger = createLiveReadinessReleaseLedger(release, evidence, matrix);
  return createLiveReadinessCiReport(ledger);
}

export function runLiveReadinessReportCli({ argv = process.argv, readFile = readFileSync, write = console.log, error = console.error } = {}) {
  const inputPath = argv[2];
  if (!inputPath) {
    error("Usage: pnpm run readiness:report -- <evidence.json>");
    return 2;
  }

  try {
    const report = buildLiveReadinessReportFromJson(readFile(inputPath, "utf8"));
    write(JSON.stringify(report, null, 2));
    return report.status === "pass" ? 0 : 1;
  } catch (err) {
    error(`Unable to create live-readiness report: ${err.message}`);
    return 2;
  }
}

// A hand-built `file://${process.argv[1]}` never matches import.meta.url when the
// checkout path needs percent-encoding (a space, non-ASCII), so the CLI silently
// did nothing and exited 0. The argv[1] check keeps import-only consumers safe —
// pathToFileURL(undefined) throws.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runLiveReadinessReportCli();
}
