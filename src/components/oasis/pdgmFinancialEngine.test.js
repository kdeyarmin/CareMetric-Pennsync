import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_AGENCY_COSTS, resolveAgencyCosts } from "./pdgmFinancialEngine.js";

test("resolveAgencyCosts returns defaults when settings are missing", () => {
  assert.deepEqual(resolveAgencyCosts(null), DEFAULT_AGENCY_COSTS);
  assert.deepEqual(resolveAgencyCosts(undefined), DEFAULT_AGENCY_COSTS);
  assert.equal(resolveAgencyCosts(null).avg_staff_hourly_rate, 45);
});

test("resolveAgencyCosts prefers the fetched settings row", () => {
  const fetched = { avg_staff_hourly_rate: 60, wage_index: 1.1 };
  assert.equal(resolveAgencyCosts(fetched), fetched);
  assert.equal(resolveAgencyCosts(fetched).avg_staff_hourly_rate, 60);
});

test("resolveAgencyCosts honors a custom defaults argument", () => {
  const custom = { avg_staff_hourly_rate: 75 };
  assert.equal(resolveAgencyCosts(null, custom), custom);
});

test("DEFAULT_AGENCY_COSTS exposes the expected cost keys", () => {
  assert.deepEqual(Object.keys(DEFAULT_AGENCY_COSTS).sort(), [
    "audit_staff_hourly_rate",
    "avg_episodes_per_year",
    "avg_staff_hourly_rate",
    "documentation_time_per_episode",
    "training_cost_per_hour",
    "wage_index",
  ]);
});
