import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  canonicalSha256,
  createBase44CandidateManifest,
  runBase44CandidateManifestCli,
} from "./tools-base44-candidate-manifest.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "base44-candidate-manifest-"));
  const write = (path, value) => {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, value);
  };
  write("base44/config.jsonc", `{
    // Formatting and comments do not affect semantic hashes.
    name: 'Fixture',
    site: { outputDirectory: './dist', buildCommand: 'pnpm run build' },
  }`);
  write("base44/auth/config.jsonc", "{\n  password_login_enabled: true\n}\n");
  write("base44/entities/Patient.jsonc", `{
    name: 'Patient', type: 'object', properties: { name: { type: 'string' } },
    rls: { read: false, create: false, update: false, delete: false },
  }`);
  write("base44/entities/Reference.jsonc", "{ name: 'Reference', type: 'object', properties: {} }");
  write("base44/functions/example/entry.ts", `
    const RELEASE_ENV = 'EXAMPLE_RELEASE';
    const ignored = 'never-expose-this-value';
    Deno.env.get(RELEASE_ENV);
    Deno.env.get('API_KEY');
    Deno.env.get(ignored);
  `);
  write("base44/functions/example/function.jsonc", "{ runtime: 'deno', timeout: 30 }");
  write("base44/functions/example/helper.test.js", "Deno.env.get('TEST_ONLY_SECRET')");
  write("base44/workflows/Example.jsonc", `{
    name: 'Example schedule',
    definition: { do: [{ run_function: { with: { function_name: 'example' } } }] },
  }`);
  write("base44/agents/assistant.jsonc", "{ name: 'assistant', description: 'fixture', instructions: 'fixture' }");
  write("base44/connectors/slack.jsonc", "{ type: 'slack', scopes: [] }");
  write("dist/index.html", "<main>fixture</main>\n");
  write("dist/assets/app.js", Buffer.from([0, 1, 2, 3, 255]));
  return root;
}

test("candidate manifest is deterministic, local-only, and names-only for secrets", () => {
  const root = fixture();
  const first = createBase44CandidateManifest({ rootDir: root });
  const second = createBase44CandidateManifest({ rootDir: root });
  assert.deepEqual(first, second);
  assert.equal(first.format, "base44-candidate-deployment-manifest");
  assert.deepEqual(first.attestation, {
    immutableHostedReceipt: false,
    includesHostedState: false,
    includesSecretValues: false,
    scope: "candidate-side-local-resources",
  });
  assert.deepEqual(first.summary, {
    agents: 1,
    authFiles: 1,
    connectors: 1,
    declaredSecretNames: 2,
    entityRlsDeclarations: 1,
    entitySchemas: 2,
    functions: 1,
    siteFiles: 2,
    workflows: 1,
  });
  assert.deepEqual(first.resources.secrets.declaredSecretNames, ["API_KEY", "EXAMPLE_RELEASE"]);
  assert.equal(JSON.stringify(first).includes("never-expose-this-value"), false);
  assert.equal(JSON.stringify(first).includes("TEST_ONLY_SECRET"), false);
  assert.deepEqual(first.resources.workflows.resources[0].targetFunctionNames, ["example"]);

  const { manifestSha256, ...unsigned } = first;
  assert.equal(manifestSha256, canonicalSha256(unsigned));
});

test("resource ordering uses locale-independent code-unit order", () => {
  const root = fixture();
  const entities = ["AIConfiguration", "AdrAuditCase", "Agency"];
  for (const name of entities) {
    writeFileSync(
      join(root, "base44/entities", `${name}.jsonc`),
      `{ name: ${JSON.stringify(name)}, type: 'object', properties: {} }`,
    );
  }

  const manifest = createBase44CandidateManifest({ rootDir: root });
  assert.deepEqual(
    manifest.resources.entities.resources.map((entry) => entry.name),
    ["AIConfiguration", "AdrAuditCase", "Agency", "Patient", "Reference"],
  );
});

test("manifest separates JSONC source bytes, semantic bytes, schema, and RLS", () => {
  const manifest = createBase44CandidateManifest({ rootDir: fixture() });
  const patient = manifest.resources.entities.resources.find((entry) => entry.name === "Patient");
  const reference = manifest.resources.entities.resources.find((entry) => entry.name === "Reference");
  assert.notEqual(patient.source.sha256, patient.semantic.sha256);
  assert.equal(patient.rls.present, true);
  assert.deepEqual(patient.rls.operationNames, ["create", "delete", "read", "update"]);
  assert.notEqual(patient.schema.sha256, patient.semantic.sha256);
  assert.deepEqual(reference.rls, {
    canonicalBytes: 0,
    operationNames: [],
    present: false,
    sha256: null,
  });
  assert.equal(reference.schema.sha256, reference.semantic.sha256);
});

test("function inventory excludes non-deployable helper and test files", () => {
  const manifest = createBase44CandidateManifest({ rootDir: fixture() });
  const resource = manifest.resources.functions.resources[0];
  assert.deepEqual(resource.files.map((file) => file.path), [
    "base44/functions/example/entry.ts",
    "base44/functions/example/function.jsonc",
  ]);
  assert.equal(resource.files.some((file) => file.path.includes("helper.test")), false);
});

test("CLI emits one parseable manifest and rejects arguments", () => {
  const writes = [];
  const errors = [];
  assert.equal(runBase44CandidateManifestCli({
    argv: ["node", "tool"],
    rootDir: fixture(),
    write: (message) => writes.push(message),
    error: (message) => errors.push(message),
  }), 0);
  assert.equal(errors.length, 0);
  assert.equal(JSON.parse(writes[0]).formatVersion, 1);
  assert.equal(runBase44CandidateManifestCli({
    argv: ["node", "tool", "unexpected"],
    rootDir: fixture(),
    write: () => {},
    error: (message) => errors.push(message),
  }), 2);
  assert.match(errors.at(-1), /Usage/);
});

test("configured site inventory fails closed when the build output is absent", () => {
  const root = fixture();
  const missing = join(root, "dist-missing");
  const config = `{
    name: 'Fixture',
    site: { outputDirectory: ${JSON.stringify(missing)}, buildCommand: 'pnpm run build' },
  }`;
  writeFileSync(join(root, "base44/config.jsonc"), config);
  assert.throws(
    () => createBase44CandidateManifest({ rootDir: root }),
    /inside the repository|output directory is missing/,
  );
});
