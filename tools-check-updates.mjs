#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const pkg = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));

const groups = [
  ['dependencies', pkg.dependencies || {}],
  ['devDependencies', pkg.devDependencies || {}],
];

const entries = groups.flatMap(([group, deps]) =>
  Object.entries(deps).map(([name, current]) => ({ group, name, current }))
);

const skipPrefixes = ['@base44/'];
const checkable = entries.filter((dep) => !skipPrefixes.some((prefix) => dep.name.startsWith(prefix)));
const skipped = entries.filter((dep) => skipPrefixes.some((prefix) => dep.name.startsWith(prefix)));

const results = [];
const failures = [];

for (const dep of checkable) {
  try {
    const { stdout } = await execFileAsync('npm', ['view', dep.name, 'version', '--json']);
    const parsed = JSON.parse(stdout.trim());
    const latest = Array.isArray(parsed) ? parsed.at(-1) : parsed;
    results.push({ ...dep, latest });
  } catch (error) {
    failures.push({
      ...dep,
      reason: (error.stderr || error.message || 'unknown error').trim(),
    });
  }
}

const normalize = (version) => String(version || '').replace(/^[~^]/, '');
const outdated = results.filter((dep) => normalize(dep.current) !== normalize(dep.latest));

console.log('=== App dependency update report ===');
console.log(`Checked: ${checkable.length}`);
console.log(`Skipped (private/vendor): ${skipped.length}`);
console.log(`Lookup failures: ${failures.length}`);
console.log(`Outdated found: ${outdated.length}`);

if (skipped.length) {
  console.log('\nSkipped packages:');
  for (const dep of skipped) {
    console.log(`- ${dep.name}@${dep.current}`);
  }
}

if (outdated.length) {
  console.log('\nOutdated packages:');
  for (const dep of outdated) {
    console.log(`- [${dep.group}] ${dep.name}: ${dep.current} -> ${dep.latest}`);
  }
}

if (failures.length) {
  console.log('\nLookup failures:');
  for (const dep of failures) {
    console.log(`- [${dep.group}] ${dep.name}@${dep.current}`);
  }
}

if (!outdated.length && !failures.length) {
  console.log('\nAll checked packages appear current.');
}
