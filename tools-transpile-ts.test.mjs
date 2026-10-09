import { test } from "node:test";
import assert from "node:assert/strict";
import { isModernFunctionEntry, transpileTs, transpileTsCollectErrors } from "./tools-transpile-ts.mjs";

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

// The Base44 editor's newer function format (2026-10-09). Every contract
// harness loads entries through transpileTs and captures Deno.serve, so a
// newer-format entry must arrive in the same shape an older one does.
test('a newer-format entry bundles base44/shared, reads secrets through Deno.env and registers its handler', async () => {
  const source = [
    "import { secrets } from 'base44:runtime';",
    "import { isPlatformOwner } from '../../shared/securityAccess.ts';",
    "export default async function(req) {",
    "  return Response.json({ owner: isPlatformOwner({ role: 'admin', email: 'owner@example.test' }), switch: secrets.get('SWITCH') ?? null });",
    "}",
  ].join('\n');
  assert.equal(isModernFunctionEntry(source), true);
  const { outputText } = transpileTs(source, { fileName: 'probe/entry.ts' });
  assert.doesNotMatch(outputText, /base44:runtime|\.\.\/\.\.\/shared/);
  let handler;
  const env = { SUPER_ADMIN_EMAIL: 'owner@example.test', SWITCH: 'on' };
  const previous = globalThis.Deno;
  globalThis.Deno = { serve: (candidate) => { handler = candidate; }, env: { get: (key) => env[key] } };
  try {
    const module = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
    assert.equal(typeof handler, 'function', 'registered through Deno.serve');
    assert.equal(module.default, handler, 'and still the module default');
    assert.deepEqual(await (await handler(new Request('https://x.invalid'))).json(), { owner: true, switch: 'on' });
  } finally {
    if (previous === undefined) delete globalThis.Deno; else globalThis.Deno = previous;
  }
});

test('an older-format entry transpiles exactly as before', () => {
  const source = "import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';\nDeno.serve(async (req) => Response.json({ ok: Boolean(createClientFromRequest(req)) }));\n";
  assert.equal(isModernFunctionEntry(source), false);
  assert.match(transpileTs(source).outputText, /^import \{ createClientFromRequest \} from "npm:@base44\/sdk@0\.8\.31";/);
});
