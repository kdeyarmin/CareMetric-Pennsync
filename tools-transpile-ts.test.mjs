import { test } from "node:test";
import assert from "node:assert/strict";
import { transpileTs, transpileTsCollectErrors } from "./tools-transpile-ts.mjs";

test("transpileTs strips TypeScript types to ESM", () => {
  const { outputText } = transpileTs("export const x: number = 1 + 2;\n");
  assert.match(outputText, /export/);
  assert.match(outputText, /\bx\b/);
  assert.doesNotMatch(outputText, /:\s*number/);
  assert.match(outputText, /1\s*\+\s*2/);
});

test("transpileTsCollectErrors returns empty errors for valid source", () => {
  const { outputText, errors } = transpileTsCollectErrors("export const ok = true;\n");
  assert.equal(errors.length, 0);
  assert.ok(outputText && outputText.length > 0);
});

test("transpileTsCollectErrors reports syntax failures", () => {
  const { outputText, errors } = transpileTsCollectErrors("export const broken = {\n", {
    fileName: "broken.ts",
  });
  assert.equal(outputText, null);
  assert.ok(errors.length >= 1);
  assert.match(errors[0], /broken\.ts/);
});
