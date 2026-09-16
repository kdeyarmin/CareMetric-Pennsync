// Read-only inspection of emitted JavaScript. Never executes the bundle, reads
// application data, or prints diagnostic arguments/source snippets.
import { parse } from '@babel/parser';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const isMember = (node) => node?.type === 'MemberExpression' || node?.type === 'OptionalMemberExpression';
const memberName = (node) => node.computed
  ? node.property?.type === 'StringLiteral' ? node.property.value : null
  : node.property?.name;
const isConsole = (node) => (node?.type === 'Identifier' && node.name === 'console')
  || (isMember(node) && memberName(node) === 'console'
    && node.object?.type === 'Identifier'
    && ['window', 'globalThis', 'self'].includes(node.object.name));

function callsConsole(callee) {
  for (let node = callee; isMember(node); node = node.object) {
    if (isConsole(node.object)) return true;
  }
  return false;
}

export function inspectJavaScript(source) {
  // Parsing distinguishes executable diagnostics from documentation, strings,
  // comments, and regular expressions that merely mention console.log.
  const ast = parse(source, { sourceType: 'unambiguous' });
  const findings = [];
  const stack = [ast];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node.type !== 'string') continue;
    let code = null;
    if (node.type === 'DebuggerStatement') code = 'DEBUGGER_STATEMENT';
    if (['CallExpression', 'OptionalCallExpression'].includes(node.type) && callsConsole(node.callee)) {
      code = 'CONSOLE_CALL';
    }
    if (code) findings.push({ code, line: node.loc?.start.line, column: node.loc?.start.column });
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) if (child?.type) stack.push(child);
      } else if (value?.type) stack.push(value);
    }
  }
  return findings.sort((a, b) => a.line - b.line || a.column - b.column);
}

export function inspectBuild(directory = 'dist') {
  const root = resolve(directory);
  const files = [];
  const findings = [];
  const errors = [];
  function visit(path) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const absolute = join(path, entry.name);
      if (entry.isSymbolicLink()) {
        errors.push({ file: relative(root, absolute), code: 'BUILD_SYMLINK_NOT_ALLOWED' });
      } else if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && /\.[cm]?js$/.test(entry.name)) files.push(absolute);
    }
  }
  if (!existsSync(join(root, 'index.html'))) errors.push({ code: 'BUILD_ENTRY_REQUIRED' });
  try { visit(root); } catch { errors.push({ code: 'BUILD_READ_FAILED' }); }
  if (!files.length) errors.push({ code: 'JAVASCRIPT_ASSETS_REQUIRED' });
  for (const file of files.sort()) {
    try {
      for (const finding of inspectJavaScript(readFileSync(file, 'utf8'))) {
        findings.push({ file: relative(root, file), ...finding });
      }
    } catch {
      // Parser errors can contain source text. Do not print the exception.
      errors.push({ file: relative(root, file), code: 'JAVASCRIPT_INSPECTION_FAILED' });
    }
  }
  return { passed: !findings.length && !errors.length, filesChecked: files.length, findings, errors };
}

export function parseDiagnosticArguments(args) {
  if (!Array.isArray(args)) return null;
  let directory;
  let productionModeSeen = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (typeof argument !== 'string' || !argument) return null;
    if (argument === '--mode' || argument.startsWith('--mode=')) {
      if (productionModeSeen) return null;
      const mode = argument === '--mode' ? args[++index] : argument.slice('--mode='.length);
      if (mode !== 'production') return null;
      productionModeSeen = true;
    } else {
      if (argument.startsWith('-') || directory !== undefined) return null;
      directory = argument;
    }
  }
  return { directory: directory || 'dist' };
}

export function main(args = process.argv.slice(2), { log = console.log } = {}) {
  // Base44 runs npm run build -- --mode production. npm appends that flag to
  // this final command in the build script. Accept only the production-mode
  // compatibility flag; it NEVER changes, skips, or weakens artifact inspection.
  // Vite has already built in its default production mode before this command.
  const parsed = parseDiagnosticArguments(args);
  if (!parsed) {
    log(JSON.stringify({ passed: false, errors: [{ code: 'INVALID_ARGUMENTS' }] }));
    return 2;
  }
  const result = inspectBuild(parsed.directory);
  log(JSON.stringify(result, null, 2));
  return result.passed ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
