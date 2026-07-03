import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createLinter } from 'actionlint';

const workflowDir = '.github/workflows';
let entries = [];
try {
  entries = await readdir(workflowDir, { withFileTypes: true });
} catch (err) {
  if (err?.code !== 'ENOENT') throw err;
}
const workflowFiles = entries
  .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
  .map((entry) => path.join(workflowDir, entry.name))
  .sort();

if (workflowFiles.length === 0) {
  console.log('No GitHub Actions workflow files found.');
  process.exit(0);
}

const lint = await createLinter();
const allProblems = [];

for (const file of workflowFiles) {
  const content = await readFile(file, 'utf8');
  const problems = lint(content, file);
  allProblems.push(...problems);
}

if (allProblems.length > 0) {
  for (const problem of allProblems) {
    console.error(problem.message ?? String(problem));
  }
  process.exit(1);
}

console.log(`✓ actionlint passed for ${workflowFiles.length} workflow file(s).`);
