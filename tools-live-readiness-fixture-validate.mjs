#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  createLiveReadinessFixturePlan,
  formatLiveReadinessFixtureErrors,
  validateLiveReadinessFixtureManifest,
} from "./src/lib/liveReadinessFixtureManifest.js";
import {
  createLiveReadinessSourceContract,
  formatLiveReadinessSourceContractErrors,
} from "./tools-live-readiness-source-contract.mjs";

function positionalArguments(argv) {
  return argv.slice(2).filter((arg) => arg !== "--");
}

export function runLiveReadinessFixtureValidateCli({
  argv = process.argv,
  readFile = readFileSync,
  write = console.log,
  error = console.error,
  resolveSourceContract = createLiveReadinessSourceContract,
} = {}) {
  const positional = positionalArguments(argv);
  if (positional.length !== 1) {
    error("Usage: pnpm run readiness:fixture:validate -- <fixture-manifest.json>");
    return 2;
  }

  let raw;
  try {
    raw = readFile(positional[0], "utf8");
  } catch {
    error("Unable to validate live-readiness fixture plan: manifest could not be read.");
    return 2;
  }

  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    // JSON.parse messages can include source fragments. Never echo them: a
    // malformed manifest may itself be the accidental credential exposure.
    error("Unable to validate live-readiness fixture plan: manifest must be valid JSON.");
    return 2;
  }

  const errors = validateLiveReadinessFixtureManifest(input);
  if (errors.length > 0) {
    error(`Unable to validate live-readiness fixture plan: ${formatLiveReadinessFixtureErrors(errors)}`);
    return 2;
  }

  const sourceContract = resolveSourceContract();
  if (
    !sourceContract
    || sourceContract.status !== "valid_source_authority_contract"
    || !sourceContract.source_authority_contract_sha256
  ) {
    const sourceErrors = Array.isArray(sourceContract?.errors) ? sourceContract.errors : [];
    const detail = sourceErrors.length > 0
      ? `: ${formatLiveReadinessSourceContractErrors(sourceErrors)}`
      : ".";
    error(`Unable to validate live-readiness source authority contract${detail}`);
    return 2;
  }

  write(JSON.stringify({
    ...createLiveReadinessFixturePlan(input),
    source_contract: {
      status: sourceContract.status,
      schema_version: sourceContract.schema_version,
      source_authority_contract_sha256:
        sourceContract.source_authority_contract_sha256,
      artifact_count: sourceContract.artifact_count,
      checks: sourceContract.checks,
      source_limitations: sourceContract.source_limitations,
    },
  }, null, 2));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runLiveReadinessFixtureValidateCli();
}
