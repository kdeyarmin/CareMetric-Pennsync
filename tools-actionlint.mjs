import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createLinter } from 'actionlint';

export async function lintWorkflowDirectory(directory = '.github/workflows', { makeLinter = createLinter } = {}) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries.filter(entry => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map(entry => path.join(directory, entry.name)).sort();
  if (!files.length) throw new Error('No workflow files were available for verification.');
  const problems = [];
  for (const file of files) {
    // actionlint 2.0.6's WASM instance can trap on later inputs when reused.
    // Every file still receives full validation; isolate its WASM lifecycle
    // instead of accepting the crash or suppressing workflow diagnostics.
    const lint = await makeLinter();
    const result = lint(await readFile(file, 'utf8'), file);
    if (!Array.isArray(result)) throw new Error('Workflow linter returned an incomplete result.');
    problems.push(...result);
  }
  return { files: files.length, problems };
}

export async function main() {
  try {
    const result = await lintWorkflowDirectory();
    if (result.problems.length) {
      for (const problem of result.problems) console.error(problem.message ?? String(problem));
      return 1;
    }
    console.log(`✓ actionlint passed for ${result.files} workflow file(s).`);
    return 0;
  } catch (error) {
    console.error(`Workflow verification failed: ${error.message}`);
    return 1;
  }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) process.exitCode = await main();
