import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runLiveReadinessFixtureValidateCli } from "./tools-live-readiness-fixture-validate.mjs";

const templateUrl = new URL("./docs/audits/live-readiness-fixture-manifest.template.json", import.meta.url);
const validManifest = readFileSync(templateUrl, "utf8");

test("fixture CLI accepts the documented pnpm separator and reports no hosted action", () => {
  const writes = [];
  const reads = [];
  const code = runLiveReadinessFixtureValidateCli({
    argv: ["node", "tool", "--", "fixture.json"],
    readFile: (path) => {
      reads.push(path);
      return validManifest;
    },
    write: (message) => writes.push(message),
    error: () => {},
  });
  assert.equal(code, 0);
  assert.deepEqual(reads, ["fixture.json"]);
  const report = JSON.parse(writes[0]);
  assert.equal(report.status, "valid_fixture_plan");
  assert.equal(report.readiness_status, "blocked_until_hosted_identities_and_evidence_exist");
  assert.equal(report.safeguards.network_access, false);
  assert.equal(report.safeguards.hosted_writes, false);
});

test("fixture CLI rejects missing and extra positional paths", () => {
  assert.equal(runLiveReadinessFixtureValidateCli({ argv: ["node", "tool"], write: () => {}, error: () => {} }), 2);
  assert.equal(runLiveReadinessFixtureValidateCli({ argv: ["node", "tool", "a.json", "b.json"], write: () => {}, error: () => {} }), 2);
});

test("fixture CLI rejects unsafe input without echoing credential values", () => {
  const errors = [];
  const unsafe = JSON.parse(validManifest);
  unsafe.target.app_id = "694ec16e72e01b60d22f7cbf";
  unsafe.actors.admin_a.access_token = "never-print-this-token";
  const code = runLiveReadinessFixtureValidateCli({
    argv: ["node", "tool", "fixture.json"],
    readFile: () => JSON.stringify(unsafe),
    write: () => {},
    error: (message) => errors.push(message),
  });
  assert.equal(code, 2);
  assert.match(errors[0], /target\.app_id/);
  assert.match(errors[0], /actors\.admin_a/);
  assert.equal(errors[0].includes("access_token"), false);
  assert.equal(errors[0].includes("never-print-this-token"), false);
});

test("fixture CLI does not echo malformed manifest contents", () => {
  const errors = [];
  const code = runLiveReadinessFixtureValidateCli({
    argv: ["node", "tool", "fixture.json"],
    readFile: () => '{"password":"never-print-this-password",}',
    write: () => {},
    error: (message) => errors.push(message),
  });
  assert.equal(code, 2);
  assert.match(errors[0], /valid JSON/);
  assert.equal(errors[0].includes("never-print-this-password"), false);
});
