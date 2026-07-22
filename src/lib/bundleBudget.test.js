import test from "node:test";
import assert from "node:assert/strict";
import { evaluateRouteChunkBudgets } from "./bundleBudget.js";

test("route chunk budget evaluator passes chunks under configured thresholds", () => {
  const result = evaluateRouteChunkBudgets([
    { name: "index", bytes: 400 * 1024, isEntry: true },
    { name: "Patients", bytes: 200 * 1024, type: "route" },
    { name: "vendor-react", bytes: 600 * 1024 },
  ]);
  assert.equal(result.status, "pass");
  assert.deepEqual(result.failures, []);
});

test("route chunk budget evaluator reports exact overage", () => {
  const result = evaluateRouteChunkBudgets([{ name: "OASISCenter", bytes: 620 * 1024, type: "route" }], { routeKb: 500, initialKb: 900, vendorKb: 800 });
  assert.equal(result.status, "fail");
  assert.deepEqual(result.failures, [{ name: "OASISCenter", type: "route", sizeKb: 620, limitKb: 500, status: "fail", overByKb: 120 }]);
});
