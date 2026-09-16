import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectJavaScript, inspectBuild, parseDiagnosticArguments, main } from './tools-check-production-diagnostics.mjs';
import { stripProductionDiagnostics, productionDiagnosticsPlugin } from './scripts/production-diagnostics-plugin.mjs';

for (const source of [
  'console.log("synthetic diagnostic")',
  'console["warn"]({ fixture: true })',
  'console?.error?.("fixture")',
  'window.console.info("fixture")',
  'globalThis.console.debug("fixture")',
  'self["console"]["trace"]("fixture")',
  'console.error.call(console, "fixture")',
  'const logger = console.warn.bind(console)',
]) {
  test(`rejects executable diagnostic form: ${source.split('(')[0]}`, () => {
    const findings = inspectJavaScript(source);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].code, 'CONSOLE_CALL');
    assert.ok(!JSON.stringify(findings).includes('fixture'));
  });
}

test('rejects debugger statements', () => {
  assert.equal(inspectJavaScript('debugger;')[0].code, 'DEBUGGER_STATEMENT');
});

test('ignores comments, strings, regexes, and unrelated methods', () => {
  assert.deepEqual(inspectJavaScript(`
    // console.error('not executed')
    const text = 'console.log("documentation")';
    const pattern = /console\\.warn/;
    logger.info(text, pattern);
  `), []);
});

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'production-diagnostics-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<script type="module" src="./assets/app.js"></script>');
  return dir;
}

test('inspects nested emitted chunks, not only the entry', (t) => {
  const dir = fixture(t);
  writeFileSync(join(dir, 'assets', 'app.js'), 'export const answer = 42;');
  mkdirSync(join(dir, 'assets', 'lazy'));
  writeFileSync(join(dir, 'assets', 'lazy', 'route.js'), 'console.error("synthetic-only");');
  const result = inspectBuild(dir);
  assert.equal(result.passed, false);
  assert.equal(result.filesChecked, 2);
  assert.equal(result.findings[0].file, 'assets/lazy/route.js');
  assert.ok(!JSON.stringify(result).includes('synthetic-only'));
});

test('accepts clean built code', (t) => {
  const dir = fixture(t);
  writeFileSync(join(dir, 'assets', 'app.js'), 'export const answer = 42;');
  assert.equal(inspectBuild(dir).passed, true);
});

test('missing and empty builds cannot pass', (t) => {
  const dir = fixture(t);
  assert.equal(inspectBuild(dir).passed, false);
  assert.equal(inspectBuild(join(dir, 'missing')).passed, false);
});

test('malformed JavaScript fails without exposing source text', (t) => {
  const dir = fixture(t);
  writeFileSync(join(dir, 'assets', 'app.js'), 'const x = "SYNTHETIC_PRIVATE_CANARY');
  const result = inspectBuild(dir);
  assert.equal(result.passed, false);
  assert.equal(result.errors[0].code, 'JAVASCRIPT_INSPECTION_FAILED');
  assert.ok(!JSON.stringify(result).includes('SYNTHETIC_PRIVATE_CANARY'));
});

test('the build transform removes calls, argument evaluation, and conditional debuggers', async () => {
  const source = `console.log(sensitiveDiagnostic()); console.error.apply(console, [sensitiveDiagnostic()]); if (flag) debugger; export const answer = 42;`;
  const output = await stripProductionDiagnostics(source);
  assert.deepEqual(inspectJavaScript(output.code), []);
  assert.ok(!output.code.includes('sensitiveDiagnostic'));
  assert.match(output.code, /42/);
});

test('unsupported global console calls fail closed without exposing arguments', async () => {
  await assert.rejects(
    stripProductionDiagnostics('window.console.log("SYNTHETIC_PRIVATE_ARGUMENT");'),
    (error) => error.message === 'PRODUCTION_DIAGNOSTIC_REMOVAL_INCOMPLETE',
  );
});

test('the plugin only changes builds, not development diagnostic behavior', () => {
  const plugin = productionDiagnosticsPlugin();
  assert.equal(plugin.apply, 'build');
  assert.equal(plugin.enforce, 'post');
  assert.equal(plugin.renderChunk.order, 'post');
  assert.equal(plugin.renderChunk.handler, stripProductionDiagnostics);
});

test('CLI returns a failing exit code rather than accepting missing artifacts', (t) => {
  const dir = fixture(t);
  assert.equal(main([dir], { log() {} }), 1);
  assert.equal(main([dir, 'extra'], { log() {} }), 2);
});

for (const [args, directory] of [
  [[], 'dist'],
  [['dist'], 'dist'],
  [['--mode', 'production'], 'dist'],
  [['--mode=production'], 'dist'],
  [['release', '--mode', 'production'], 'release'],
  [['--mode', 'production', 'release'], 'release'],
  [['release', '--mode=production'], 'release'],
  [['--mode=production', 'release'], 'release'],
]) {
  test(`hosted argument compatibility preserves the inspection target: ${JSON.stringify(args)}`, () => {
    assert.deepEqual(parseDiagnosticArguments(args), { directory });
  });
}

for (const args of [
  ['--mode'], ['--mode='], ['--mode', 'development'], ['--mode=staging'],
  ['--skip'], ['--force'], ['--mode=production', '--mode', 'production'],
  ['dist', 'other'], [''], [null],
]) {
  test(`rejects malformed, non-production, or bypass arguments: ${JSON.stringify(args)}`, () => {
    let output;
    assert.equal(main(args, { log(value) { output = JSON.parse(value); } }), 2);
    assert.equal(output.passed, false);
    assert.equal(output.errors[0].code, 'INVALID_ARGUMENTS');
  });
}

for (const flags of [['--mode', 'production'], ['--mode=production']]) {
  test(`hosted flags still reject dirty, empty, and missing artifacts: ${flags.join(' ')}`, (t) => {
    const dir = fixture(t);
    assert.equal(main([dir, ...flags], { log() {} }), 1);
    writeFileSync(join(dir, 'assets', 'app.js'), 'export const answer = 42;');
    assert.equal(main([dir, ...flags], { log() {} }), 0);
    assert.equal(main([...flags, dir], { log() {} }), 0);
    writeFileSync(join(dir, 'assets', 'app.js'), 'console.error("synthetic-only"); debugger;');
    assert.equal(main([dir, ...flags], { log() {} }), 1);
    assert.equal(main([join(dir, 'missing'), ...flags], { log() {} }), 1);
  });
}
