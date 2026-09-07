#!/usr/bin/env node
/**
 * Deterministic, offline inventory of the local Base44 deployment candidate.
 *
 * This intentionally does not query Base44 and is not a hosted deployment
 * receipt. It inventories candidate-side resource definitions, emitted site
 * bytes, and statically referenced secret names. Secret values are never read.
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import JSON5 from "json5";

const FORMAT = "base44-candidate-deployment-manifest";
const FORMAT_VERSION = 1;

function isPlainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype
      || Object.getPrototypeOf(value) === null);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  );
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalSha256(value) {
  return sha256(canonicalJson(value));
}

function posixPath(value) {
  return value.split(sep).join("/");
}

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function repoPath(rootDir, absolutePath) {
  const result = posixPath(relative(rootDir, absolutePath));
  if (!result || result === ".." || result.startsWith("../")) {
    throw new Error("Candidate inventory path escaped the repository root.");
  }
  return result;
}

function fileRecord(rootDir, absolutePath) {
  const data = readFileSync(absolutePath);
  return {
    bytes: data.byteLength,
    path: repoPath(rootDir, absolutePath),
    sha256: sha256(data),
  };
}

function semanticRecord(value) {
  const canonical = canonicalJson(value);
  return {
    bytes: Buffer.byteLength(canonical),
    sha256: sha256(canonical),
  };
}

function readJsonc(absolutePath) {
  try {
    return JSON5.parse(readFileSync(absolutePath, "utf8"));
  } catch {
    throw new Error(`Invalid JSONC resource: ${basename(absolutePath)}`);
  }
}

function directoryEntries(absolutePath) {
  if (!existsSync(absolutePath)) return [];
  return readdirSync(absolutePath, { withFileTypes: true })
    .sort((left, right) => compareCodeUnits(left.name, right.name));
}

function filesRecursively(absolutePath) {
  if (!existsSync(absolutePath)) return [];
  const files = [];
  for (const entry of directoryEntries(absolutePath)) {
    const path = join(absolutePath, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Candidate inventory does not follow symbolic links: ${entry.name}`);
    }
    if (entry.isDirectory()) files.push(...filesRecursively(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function collectRawDirectory(rootDir, relativeDirectory) {
  const files = filesRecursively(resolve(rootDir, relativeDirectory))
    .map((path) => fileRecord(rootDir, path))
    .sort((left, right) => compareCodeUnits(left.path, right.path));
  return {
    aggregateSha256: canonicalSha256(files),
    count: files.length,
    directory: relativeDirectory,
    files,
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
  };
}

function collectJsoncResources(rootDir, relativeDirectory, identityKey) {
  const resources = directoryEntries(resolve(rootDir, relativeDirectory))
    .filter((entry) => entry.isFile() && extname(entry.name) === ".jsonc")
    .map((entry) => {
      const absolutePath = resolve(rootDir, relativeDirectory, entry.name);
      const parsed = readJsonc(absolutePath);
      const identity = parsed?.[identityKey];
      if (typeof identity !== "string" || !identity) {
        throw new Error(`JSONC resource lacks ${identityKey}: ${entry.name}`);
      }
      return {
        [identityKey]: identity,
        path: repoPath(rootDir, absolutePath),
        semantic: semanticRecord(parsed),
        source: fileRecord(rootDir, absolutePath),
      };
    })
    .sort((left, right) => compareCodeUnits(left[identityKey], right[identityKey]));
  return {
    aggregateSha256: canonicalSha256(resources),
    count: resources.length,
    directory: relativeDirectory,
    resources,
  };
}

function collectEntities(rootDir) {
  const relativeDirectory = "base44/entities";
  const resources = directoryEntries(resolve(rootDir, relativeDirectory))
    .filter((entry) => entry.isFile() && extname(entry.name) === ".jsonc")
    .map((entry) => {
      const absolutePath = resolve(rootDir, relativeDirectory, entry.name);
      const parsed = readJsonc(absolutePath);
      if (typeof parsed?.name !== "string" || !parsed.name) {
        throw new Error(`Entity lacks name: ${entry.name}`);
      }
      const hasRls = Object.hasOwn(parsed, "rls");
      if (hasRls && !isPlainObject(parsed.rls)) {
        throw new Error(`Entity has a malformed rls declaration: ${entry.name}`);
      }
      const schema = { ...parsed };
      delete schema.rls;
      const rlsSemantic = hasRls ? semanticRecord(parsed.rls) : null;
      return {
        name: parsed.name,
        path: repoPath(rootDir, absolutePath),
        rls: {
          canonicalBytes: rlsSemantic?.bytes ?? 0,
          operationNames: hasRls ? Object.keys(parsed.rls).sort() : [],
          present: hasRls,
          sha256: rlsSemantic?.sha256 ?? null,
        },
        schema: semanticRecord(schema),
        semantic: semanticRecord(parsed),
        source: fileRecord(rootDir, absolutePath),
      };
    })
    .sort((left, right) => compareCodeUnits(left.name, right.name));
  const rlsDeclarationCount = resources.filter((resource) => resource.rls.present).length;
  return {
    aggregateSha256: canonicalSha256(resources),
    count: resources.length,
    directory: relativeDirectory,
    missingRlsDeclarationCount: resources.length - rlsDeclarationCount,
    resources,
    rlsDeclarationCount,
  };
}

function jsoncDescriptor(rootDir, absolutePath) {
  const parsed = readJsonc(absolutePath);
  return {
    path: repoPath(rootDir, absolutePath),
    semantic: semanticRecord(parsed),
    source: fileRecord(rootDir, absolutePath),
  };
}

function collectFunctions(rootDir) {
  const relativeDirectory = "base44/functions";
  const resources = directoryEntries(resolve(rootDir, relativeDirectory))
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const directory = resolve(rootDir, relativeDirectory, entry.name);
      const entryPath = join(directory, "entry.ts");
      if (!existsSync(entryPath)) return null;
      const configPath = join(directory, "function.jsonc");
      const files = [entryPath, ...(existsSync(configPath) ? [configPath] : [])]
        .map((path) => fileRecord(rootDir, path))
        .sort((left, right) => compareCodeUnits(left.path, right.path));
      const configuration = existsSync(configPath)
        ? jsoncDescriptor(rootDir, configPath)
        : null;
      const deploymentContent = {
        configuration: configuration?.semantic ?? null,
        files,
      };
      return {
        aggregateSha256: canonicalSha256(deploymentContent),
        configuration,
        directory: repoPath(rootDir, directory),
        entry: repoPath(rootDir, entryPath),
        files,
        name: entry.name,
      };
    })
    .filter(Boolean)
    .sort((left, right) => compareCodeUnits(left.name, right.name));
  return {
    aggregateSha256: canonicalSha256(resources),
    count: resources.length,
    directory: relativeDirectory,
    resources,
  };
}

function findFunctionNames(value, result = new Set()) {
  if (Array.isArray(value)) {
    value.forEach((entry) => findFunctionNames(entry, result));
  } else if (isPlainObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (key === "function_name" && typeof entry === "string" && entry) result.add(entry);
      findFunctionNames(entry, result);
    }
  }
  return result;
}

function collectWorkflows(rootDir) {
  const relativeDirectory = "base44/workflows";
  const resources = directoryEntries(resolve(rootDir, relativeDirectory))
    .filter((entry) => entry.isFile() && extname(entry.name) === ".jsonc")
    .map((entry) => {
      const absolutePath = resolve(rootDir, relativeDirectory, entry.name);
      const parsed = readJsonc(absolutePath);
      if (typeof parsed?.name !== "string" || !parsed.name) {
        throw new Error(`Workflow lacks name: ${entry.name}`);
      }
      return {
        name: parsed.name,
        path: repoPath(rootDir, absolutePath),
        semantic: semanticRecord(parsed),
        source: fileRecord(rootDir, absolutePath),
        targetFunctionNames: [...findFunctionNames(parsed)].sort(),
      };
    })
    .sort((left, right) => compareCodeUnits(left.name, right.name));
  return {
    aggregateSha256: canonicalSha256(resources),
    count: resources.length,
    directory: relativeDirectory,
    resources,
  };
}

function staticSecretNames(entrySources) {
  const names = new Set();
  for (const source of entrySources) {
    const bindings = new Map();
    const bindingPattern = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(["'`])([A-Z][A-Z0-9_]*)\2\s*;?/g;
    for (const match of source.matchAll(bindingPattern)) bindings.set(match[1], match[3]);

    const callPattern = /\bDeno\s*\.\s*env\s*\.\s*get\s*\(\s*(?:(["'`])([A-Z][A-Z0-9_]*)\1|([A-Za-z_$][\w$]*))\s*\)/g;
    for (const match of source.matchAll(callPattern)) {
      const name = match[2] || bindings.get(match[3]);
      if (name) names.add(name);
    }
  }
  return [...names].sort();
}

function collectSecrets(rootDir, functions) {
  const entrySources = functions.resources.map((resource) => (
    readFileSync(resolve(rootDir, resource.entry), "utf8")
  ));
  const declaredSecretNames = staticSecretNames(entrySources);
  return {
    aggregateSha256: canonicalSha256(declaredSecretNames),
    count: declaredSecretNames.length,
    declaredSecretNames,
    derivation: "static Deno.env.get calls in candidate function entry sources (literal or file-local string binding)",
    exposure: "names-only",
  };
}

function collectSite(rootDir, projectConfig) {
  const site = isPlainObject(projectConfig?.site) ? projectConfig.site : null;
  const configured = typeof site?.outputDirectory === "string" && site.outputDirectory.length > 0;
  const relativeDirectory = configured
    ? posixPath(relative(rootDir, resolve(rootDir, site.outputDirectory)))
    : null;
  if (configured && (!relativeDirectory || relativeDirectory.startsWith("../"))) {
    throw new Error("Configured site output directory must remain inside the repository.");
  }
  const absoluteDirectory = configured ? resolve(rootDir, site.outputDirectory) : null;
  if (configured && (!existsSync(absoluteDirectory) || !lstatSync(absoluteDirectory).isDirectory())) {
    throw new Error("Configured site output directory is missing; build the candidate before inventorying it.");
  }
  const files = configured
    ? filesRecursively(absoluteDirectory)
      .map((path) => fileRecord(rootDir, path))
      .sort((left, right) => compareCodeUnits(left.path, right.path))
    : [];
  return {
    aggregateSha256: canonicalSha256(files),
    buildCommand: typeof site?.buildCommand === "string" ? site.buildCommand : null,
    configured,
    count: files.length,
    directory: relativeDirectory,
    files,
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
  };
}

export function createBase44CandidateManifest({ rootDir = process.cwd() } = {}) {
  const root = resolve(rootDir);
  const configPath = resolve(root, "base44/config.jsonc");
  if (!existsSync(configPath)) throw new Error("base44/config.jsonc was not found.");
  const projectConfigValue = readJsonc(configPath);
  const projectConfig = {
    path: repoPath(root, configPath),
    semantic: semanticRecord(projectConfigValue),
    source: fileRecord(root, configPath),
  };
  const agents = collectJsoncResources(root, "base44/agents", "name");
  const auth = collectRawDirectory(root, "base44/auth");
  const connectors = collectJsoncResources(root, "base44/connectors", "type");
  const entities = collectEntities(root);
  const functions = collectFunctions(root);
  const secrets = collectSecrets(root, functions);
  const site = collectSite(root, projectConfigValue);
  const workflows = collectWorkflows(root);
  const resources = {
    agents,
    auth,
    connectors,
    entities,
    functions,
    secrets,
    site,
    workflows,
  };
  const unsigned = canonicalize({
    attestation: {
      immutableHostedReceipt: false,
      includesHostedState: false,
      includesSecretValues: false,
      scope: "candidate-side-local-resources",
    },
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    projectConfig,
    resources,
    summary: {
      agents: agents.count,
      authFiles: auth.count,
      connectors: connectors.count,
      declaredSecretNames: secrets.count,
      entityRlsDeclarations: entities.rlsDeclarationCount,
      entitySchemas: entities.count,
      functions: functions.count,
      siteFiles: site.count,
      workflows: workflows.count,
    },
  });
  return canonicalize({
    ...unsigned,
    manifestSha256: canonicalSha256(unsigned),
  });
}

export function runBase44CandidateManifestCli({
  argv = process.argv,
  rootDir = process.cwd(),
  write = console.log,
  error = console.error,
} = {}) {
  if (argv.slice(2).filter((arg) => arg !== "--").length > 0) {
    error("Usage: node tools-base44-candidate-manifest.mjs");
    return 2;
  }
  try {
    write(JSON.stringify(createBase44CandidateManifest({ rootDir }), null, 2));
    return 0;
  } catch (caught) {
    error(`Unable to create Base44 candidate manifest: ${caught?.message || "unknown error"}`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runBase44CandidateManifestCli();
}
