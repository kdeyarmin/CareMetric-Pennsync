// Resolve the function names a production function deployment may deploy.
// Local only: reads REQUESTED_FUNCTIONS and the tree, never Base44.
//
// "all" (or an empty request) deploys every function in base44/functions; the
// CLI then skips the ones whose deployed code is unchanged. Anything else must
// be a space- or comma-separated list of names that each exist in the tree, so
// a typo refuses the run instead of silently deploying nothing, and a name can
// never smuggle a CLI option such as `--force` into the deploy command.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const NAME = /^[A-Za-z][A-Za-z0-9_-]{0,99}$/;

export function selectFunctions(requested, { root = process.cwd(), exists = existsSync } = {}) {
  const raw = String(requested ?? '').trim();
  if (raw === '' || raw.toLowerCase() === 'all') return { ok: true, mode: 'all', names: [] };
  const names = [...new Set(raw.split(/[\s,]+/).filter(Boolean))];
  const invalid = names.filter((name) => !NAME.test(name));
  if (invalid.length) return { ok: false, code: 'INVALID_FUNCTION_NAME', invalid };
  const missing = names.filter((name) => !exists(resolve(root, 'base44/functions', name, 'entry.ts')));
  if (missing.length) return { ok: false, code: 'UNKNOWN_FUNCTION', missing };
  return { ok: true, mode: 'named', names };
}

export function main({ env = process.env, log = console.log, root = process.cwd() } = {}) {
  const selection = selectFunctions(env.REQUESTED_FUNCTIONS, { root });
  log(JSON.stringify(selection));
  return selection.ok ? 0 : 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
