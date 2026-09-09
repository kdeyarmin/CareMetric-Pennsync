import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { CompilerExecutionError, main, readCompilerOutput, runTsc } from './tools-typecheck-signal.mjs';

const diagnostic = "src/example.js(3,4): error TS2322: Type 'number' is not assignable to type 'string'.\n";
const signalDiagnostic = 'src/example.js(3,4): error TS2349: This expression is not callable.\n';
const result = (overrides = {}) => ({ status: 0, signal: null, error: undefined, stdout: '', stderr: '', ...overrides });

test('a completed compiler run with no diagnostics is accepted', () => {
  assert.equal(readCompilerOutput(result()), '');
});

test('a compiler diagnostic exit is accepted only with recognizable file diagnostics', () => {
  assert.equal(readCompilerOutput(result({ status: 2, stdout: diagnostic })), diagnostic);
  assert.equal(readCompilerOutput(result({ status: 1, stdout: signalDiagnostic })), signalDiagnostic);
});

for (const [name, output] of [
  ['nested npm EUSAGE', result({ status: 1, stderr: 'npm error code EUSAGE\n' })],
  ['missing executable', result({ status: null, error: { code: 'ENOENT' } })],
  ['timeout', result({ status: null, signal: 'SIGKILL', error: { code: 'ETIMEDOUT' } })],
  ['output overflow', result({ status: null, error: { code: 'ENOBUFS' } })],
  ['crash after a diagnostic', result({ status: 134, stdout: diagnostic })],
  ['signal after a diagnostic', result({ status: 2, signal: 'SIGTERM', stdout: diagnostic })],
  ['empty failure', result({ status: 2 })],
  ['no input files', result({ status: 2, stdout: 'error TS18003: No inputs were found.\n' })],
  ['invalid compiler option', result({ status: 1, stdout: 'error TS5023: Unknown compiler option.\n' })],
  ['unrecognized success banner', result({ stdout: 'compiler unavailable\n' })],
  ['inconsistent success with errors', result({ stdout: diagnostic })],
  ['mixed diagnostic and npm failure', result({ status: 1, stdout: diagnostic + 'npm error code EUSAGE\n' })],
  ['partial diagnostics followed by crash', result({ status: 2, stdout: diagnostic, stderr: 'FATAL ERROR: out of memory\n' })],
  ['missing result', undefined],
]) {
  test(`${name} can never become a successful type check`, () => {
    assert.throws(() => readCompilerOutput(output), CompilerExecutionError);
  });
}

test('local compiler uses the current Node runtime and no package-manager subprocess', () => {
  let invocation;
  runTsc('/tmp/diagnostic-config.json', {
    run(command, args, options) {
      invocation = { command, args, options };
      return result();
    },
  });
  assert.equal(invocation.command, process.execPath);
  assert.match(invocation.args[0], /[\\/]typescript[\\/]bin[\\/]tsc$/);
  assert.deepEqual(invocation.args.slice(1), ['-p', '/tmp/diagnostic-config.json', '--pretty', 'false']);
  assert.equal(invocation.options.timeout, 120_000);
  assert.equal(invocation.options.killSignal, 'SIGKILL');
  assert.deepEqual(invocation.options.stdio, ['ignore', 'pipe', 'pipe']);
});

test('a thrown subprocess startup error is a fixed compiler failure', () => {
  assert.throws(() => runTsc('/tmp/config.json', { run() { throw new Error('private process details'); } }), CompilerExecutionError);
});

test('the CLI reports infrastructure failure in normal and survey modes and removes its config', (t) => {
  const logs = [];
  t.mock.method(console, 'error', (...values) => logs.push(values.join(' ')));
  t.mock.method(console, 'log', (...values) => logs.push(values.join(' ')));
  let configPath;
  const compile = (path) => {
    configPath = path;
    const config = JSON.parse(readFileSync(path, 'utf8'));
    assert.deepEqual(config.include, ['src/**/*.js', 'src/**/*.jsx']);
    throw new CompilerExecutionError();
  };
  assert.equal(main([], { compile }), 2);
  assert.equal(existsSync(configPath), false);
  assert.equal(main(['--list'], { compile }), 2);
  assert.equal(existsSync(configPath), false);
  assert.ok(logs.every((line) => !line.includes('✓')));
});

test('signal findings remain blocking while ordinary diagnostic noise stays informational', (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'log', () => {});
  assert.equal(main([], { compile: () => diagnostic }), 0);
  assert.equal(main([], { compile: () => signalDiagnostic }), 1);
  assert.equal(main(['--list'], { compile: () => signalDiagnostic }), 0);
  assert.equal(main([], { compile: () => signalDiagnostic.replace('example.js', 'example.spec.js') }), 0);
});

test('unsupported CLI arguments fail before compilation', (t) => {
  t.mock.method(console, 'error', () => {});
  assert.equal(main(['--unknown'], { compile() { assert.fail('compiler must not run'); } }), 2);
});
