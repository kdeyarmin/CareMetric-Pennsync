// Validate the space-separated function list the ops deploy request workflow
// will hand to `gh workflow run … -f functions=…`. Same name grammar as
// tools-production-function-selection.mjs (no CLI-option smuggling).
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FUNCTION_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,99}$/;

export function validateFunctionDeployRequest(funcs) {
  const raw = String(funcs ?? '').trim();
  if (!raw) return { ok: false, code: 'OPS_FUNCTION_DEPLOY_REQUEST_EMPTY', names: [] };
  const names = [...new Set(raw.split(/[\s,]+/).filter(Boolean))];
  const invalid = names.filter((name) => !FUNCTION_NAME.test(name));
  if (invalid.length) {
    return { ok: false, code: 'OPS_FUNCTION_DEPLOY_REQUEST_INVALID', names, invalid };
  }
  return { ok: true, code: null, names };
}

export function main({ env = process.env, log = console.log } = {}) {
  const selection = validateFunctionDeployRequest(env.REQUESTED_FUNCTIONS);
  log(JSON.stringify(selection));
  return selection.ok ? 0 : 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
