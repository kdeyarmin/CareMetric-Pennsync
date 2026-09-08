#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createLiveReadinessReleaseLedger } from "./src/lib/liveReadinessReleaseLedger.js";
import { createLiveReadinessCiReport } from "./src/lib/liveReadinessCiReport.js";
import { formatLiveReadinessInputErrors, validateLiveReadinessInput } from "./src/lib/liveReadinessInputValidation.js";
import { createLiveReadinessSourceContract } from "./tools-live-readiness-source-contract.mjs";

export function resolveCheckoutIdentity({ execFile = execFileSync } = {}) {
  const options = {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  };
  const commit = execFile("git", ["rev-parse", "HEAD"], options).trim();
  const tree = execFile("git", ["rev-parse", "HEAD^{tree}"], options).trim();
  const status = execFile(
    "git",
    ["status", "--porcelain", "--untracked-files=normal"],
    options,
  ).trim();
  if (!/^[0-9a-f]{40}$/.test(commit) || !/^[0-9a-f]{40}$/.test(tree)) {
    throw new Error("Checked-out Git revision identity is unavailable.");
  }
  if (status) {
    throw new Error("Readiness reports require a clean Git checkout.");
  }
  return { commit, tree };
}

export function resolveSourceAuthorityContractIdentity({
  createSourceContract = createLiveReadinessSourceContract,
} = {}) {
  const contract = createSourceContract();
  if (
    !contract
    || contract.status !== "valid_source_authority_contract"
    || !/^[0-9a-f]{64}$/.test(contract.source_authority_contract_sha256)
  ) {
    throw new Error("Checked-out readiness source authority contract is invalid.");
  }
  return contract.source_authority_contract_sha256;
}

function parseInput(raw, expected) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // JSON.parse messages can include a fragment of the source text. Evidence
    // files are private and may contain identifiers, so expose no parse detail.
    throw new Error("Readiness input must be valid JSON.");
  }
  const validationErrors = validateLiveReadinessInput(parsed, {
    ...expected,
  });
  if (validationErrors.length > 0) {
    throw new Error(`Invalid readiness input: ${formatLiveReadinessInputErrors(validationErrors)}`);
  }
  return {
    release: parsed.release || {},
    evidence: parsed.evidence || {},
    matrix: parsed.matrix,
  };
}

export function buildLiveReadinessReportFromJson(
  raw,
  options = {},
) {
  const env = options.env ?? process.env;
  let {
    expectedSourceCommit,
    expectedSourceTree,
    expectedSourceAuthorityContractSha256,
  } = options;
  if (!expectedSourceCommit || !expectedSourceTree) {
    const checkout = resolveCheckoutIdentity();
    expectedSourceCommit ||= checkout.commit;
    expectedSourceTree ||= checkout.tree;
  }
  expectedSourceAuthorityContractSha256 ||=
    resolveSourceAuthorityContractIdentity();
  const expectedBackendOrigin = options.expectedBackendOrigin
    || env.READINESS_STAGING_BACKEND_ORIGIN
    || env.B44_ORIGIN
    || env.VITE_BASE44_BACKEND_URL;
  const expected = {
    expectedSourceCommit,
    expectedSourceTree,
    expectedSourceAuthorityContractSha256,
    expectedBackendOrigin,
    expectedHostedRuntimeCommit: options.expectedHostedRuntimeCommit
      || env.READINESS_HOSTED_RUNTIME_COMMIT_SHA,
    expectedHostedRuntimeTree: options.expectedHostedRuntimeTree
      || env.READINESS_HOSTED_RUNTIME_TREE_SHA,
    expectedHostedDeploymentId: options.expectedHostedDeploymentId
      || env.READINESS_HOSTED_DEPLOYMENT_ID,
    expectedCandidateDeployableManifestSha256:
      options.expectedCandidateDeployableManifestSha256
      || env.READINESS_CANDIDATE_DEPLOYABLE_MANIFEST_SHA256,
    expectedHostedResourceManifestSha256: options.expectedHostedResourceManifestSha256
      || env.READINESS_HOSTED_RESOURCE_MANIFEST_SHA256,
  };
  const { release, evidence, matrix } = parseInput(raw, expected);
  const ledger = createLiveReadinessReleaseLedger(release, evidence, matrix);
  return createLiveReadinessCiReport(ledger, {
    evidencePacketSha256: createHash("sha256").update(raw, "utf8").digest("hex"),
  });
}

export function runLiveReadinessReportCli({
  argv = process.argv,
  readFile = readFileSync,
  write = console.log,
  error = console.error,
  resolveCheckout = resolveCheckoutIdentity,
  resolveSourceAuthorityContract = resolveSourceAuthorityContractIdentity,
  env = process.env,
  expectedBackendOrigin = env.READINESS_STAGING_BACKEND_ORIGIN
    || env.B44_ORIGIN
    || env.VITE_BASE44_BACKEND_URL,
  expectedHostedRuntimeCommit = env.READINESS_HOSTED_RUNTIME_COMMIT_SHA,
  expectedHostedRuntimeTree = env.READINESS_HOSTED_RUNTIME_TREE_SHA,
  expectedHostedDeploymentId = env.READINESS_HOSTED_DEPLOYMENT_ID,
  expectedCandidateDeployableManifestSha256 =
    env.READINESS_CANDIDATE_DEPLOYABLE_MANIFEST_SHA256,
  expectedHostedResourceManifestSha256 =
    env.READINESS_HOSTED_RESOURCE_MANIFEST_SHA256,
  expectedSourceAuthorityContractSha256,
} = {}) {
  // pnpm 11 preserves the conventional `--` separator in the child argv.
  // Accept both documented forms without ever treating the separator as a
  // filename, and reject extra positional inputs instead of silently ignoring
  // them.
  const positional = argv.slice(2).filter((arg) => arg !== "--");
  if (positional.length !== 1) {
    error("Usage: pnpm run readiness:report -- <evidence.json>");
    return 2;
  }
  const [inputPath] = positional;

  let raw;
  try {
    raw = readFile(inputPath, "utf8");
  } catch {
    error("Unable to create live-readiness report: input could not be read.");
    return 2;
  }

  try {
    const checkout = resolveCheckout();
    const sourceAuthorityContractSha256 =
      expectedSourceAuthorityContractSha256 || resolveSourceAuthorityContract();
    const report = buildLiveReadinessReportFromJson(raw, {
      env,
      expectedSourceCommit: checkout.commit,
      expectedSourceTree: checkout.tree,
      expectedSourceAuthorityContractSha256: sourceAuthorityContractSha256,
      expectedBackendOrigin,
      expectedHostedRuntimeCommit,
      expectedHostedRuntimeTree,
      expectedHostedDeploymentId,
      expectedCandidateDeployableManifestSha256,
      expectedHostedResourceManifestSha256,
    });
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
