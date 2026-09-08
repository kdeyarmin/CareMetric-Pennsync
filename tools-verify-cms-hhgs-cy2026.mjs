#!/usr/bin/env node

/**
 * Verify the three official CMS CY 2026 HHGS distributions and run every
 * bundled normal/GRC fixture through the matching official Java 17 JAR.
 *
 * This is deliberately an offline verifier: download the three ZIPs from the
 * URLs in docs/pdgm-cy2026.md, then pass their local paths. The script never
 * downloads, uploads, deploys, or changes application data.
 */

import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { createReadStream } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { CMS_HHGS_RELEASES_CY2026 } from "./src/components/pdgm/cmsHhgsReleasesCy2026.js";

const usage = `Usage:
  node tools-verify-cms-hhgs-cy2026.mjs <v07.0.26.zip> <v07.1.26.zip> <v07.2.26.zip>

Requirements: Java 17 and unzip. ZIP order and filenames do not matter; the
authoritative package SHA-256 identifies each release.`;

const sha256File = (path) => new Promise((resolve, reject) => {
  const hash = createHash("sha256");
  const stream = createReadStream(path);
  stream.on("error", reject);
  stream.on("data", (chunk) => hash.update(chunk));
  stream.on("end", () => resolve(hash.digest("hex")));
});

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${command} exited ${result.status}${detail ? `:\n${detail}` : ""}`);
  }
  return result;
}

function linesOf(path) {
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function expectedOutcomesFromFixture(path) {
  return linesOf(path).map((line, index) => {
    // Claim_Layout.txt defines output fields at one-based columns 601-616:
    // Version Used (7), HIPPS (5), Validity Flag (2), Return Code (2).
    if (line.length < 616) {
      throw new Error(`${path}:${index + 1} is shorter than the official 616-column output boundary`);
    }
    const expected = line.slice(600, 616);
    if (!/^\d{2}\.\d\.\d{2}[A-Z0-9]{5}\d{4}$/.test(expected)) {
      throw new Error(`${path}:${index + 1} has malformed embedded expected output ${JSON.stringify(expected)}`);
    }
    return expected;
  });
}

async function verifyRelease(release, zipPath, workspace) {
  const zipBytes = statSync(zipPath).size;
  if (zipBytes !== release.packageBytes) {
    throw new Error(`${basename(zipPath)} byte count ${zipBytes} != ${release.packageBytes} for v${release.version}`);
  }

  const zipSha = await sha256File(zipPath);
  if (zipSha !== release.packageSha256) {
    throw new Error(`${basename(zipPath)} SHA-256 ${zipSha} != authoritative v${release.version} hash`);
  }

  const extractDir = join(workspace, release.version);
  run("unzip", ["-q", zipPath, "-d", extractDir]);
  const packageRoot = join(extractDir, release.archiveRoot);
  if (!existsSync(packageRoot)) {
    throw new Error(`v${release.version} archive root is missing: ${release.archiveRoot}`);
  }

  for (const [relativePath, expectedSha] of Object.entries(release.files)) {
    const artifactPath = join(packageRoot, relativePath);
    if (!existsSync(artifactPath)) {
      throw new Error(`v${release.version} artifact is missing: ${relativePath}`);
    }
    const actualSha = await sha256File(artifactPath);
    if (actualSha !== expectedSha) {
      throw new Error(`v${release.version} ${relativePath} SHA-256 ${actualSha} != ${expectedSha}`);
    }
  }

  let matched = 0;
  for (const fixture of release.fixtures) {
    const officialFixture = join(packageRoot, fixture.path);
    const fixtureCopy = join(workspace, `${release.version}-${basename(fixture.path)}`);
    copyFileSync(officialFixture, fixtureCopy);

    run(
      "java",
      ["-jar", join(packageRoot, "dist/HomeHealth.jar"), fixtureCopy],
      { cwd: join(packageRoot, "bin") },
    );

    const outputPath = fixtureCopy.replace(/\.txt$/, "_OUT.txt");
    const expected = expectedOutcomesFromFixture(officialFixture);
    const actual = linesOf(outputPath);
    if (expected.length !== fixture.expectedRecords || actual.length !== fixture.expectedRecords) {
      throw new Error(
        `v${release.version} ${fixture.path} expected ${fixture.expectedRecords} records; `
        + `fixture has ${expected.length}, Java output has ${actual.length}`,
      );
    }
    expected.forEach((expectedLine, index) => {
      if (actual[index] !== expectedLine) {
        throw new Error(
          `v${release.version} ${fixture.path}:${index + 1} expected ${expectedLine}, got ${actual[index]}`,
        );
      }
    });
    matched += actual.length;
  }

  return matched;
}

async function main(args) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(usage);
    return;
  }
  if (args.length !== CMS_HHGS_RELEASES_CY2026.length) {
    throw new Error(`${usage}\n\nExactly three official ZIP paths are required.`);
  }
  for (const path of args) {
    if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`ZIP not found: ${path}`);
  }

  const javaVersion = run("java", ["-version"]);
  const javaBanner = `${javaVersion.stdout}\n${javaVersion.stderr}`;
  if (!/version "17(?:\.|\")/.test(javaBanner)) {
    throw new Error(`CMS HHGS parity requires Java 17; found:\n${javaBanner.trim()}`);
  }
  run("unzip", ["-v"]);

  const releaseBySha = new Map(CMS_HHGS_RELEASES_CY2026.map((release) => [release.packageSha256, release]));
  const zipByVersion = new Map();
  for (const zipPath of args) {
    const sha = await sha256File(zipPath);
    const release = releaseBySha.get(sha);
    if (!release) throw new Error(`${basename(zipPath)} is not a pinned CMS CY 2026 HHGS package (${sha})`);
    if (zipByVersion.has(release.version)) throw new Error(`duplicate v${release.version} package`);
    zipByVersion.set(release.version, zipPath);
  }
  for (const release of CMS_HHGS_RELEASES_CY2026) {
    if (!zipByVersion.has(release.version)) throw new Error(`missing v${release.version} package`);
  }

  const workspace = mkdtempSync(join(tmpdir(), "cms-hhgs-cy2026-"));
  try {
    let totalMatched = 0;
    for (const release of CMS_HHGS_RELEASES_CY2026) {
      const matched = await verifyRelease(release, zipByVersion.get(release.version), workspace);
      totalMatched += matched;
      console.log(`v${release.version}: ${matched}/${matched} official outcomes matched`);
    }
    console.log(`PASS: ${totalMatched}/${totalMatched} official CMS HHGS outcomes matched on Java 17.`);
    console.log("This verifies the CMS distributions and runner only; it does not validate a PennSync grouper port.");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

main(process.argv.slice(2)).catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
});
