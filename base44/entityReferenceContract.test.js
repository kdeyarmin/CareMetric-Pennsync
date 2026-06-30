// Reverse entity-contract guardrail.
//
// schemaContract.test.js checks one direction (every entity SCHEMA is well-formed
// and the enum values code WRITES exist in the schema). This checks the OTHER
// direction: that no application code references a Base44 entity whose schema file
// does NOT exist in base44/entities/.
//
// WHY THIS EXISTS
// Deleting an entity's schema file while live call sites still do
// `base44.entities.<Name>.filter(...)` is invisible until runtime — Base44 has no
// such entity, so the call 500s. The CarePlan removal hit exactly this: the
// CarePlan.jsonc schema was deleted while ~30 backend + frontend call sites kept
// reading `base44.entities.CarePlan`, and nothing failed the build. This test
// turns that class of drift into a build failure.
//
// HOW
// Scan production source (backend functions + frontend src, excluding tests/specs,
// which legitimately mock entities by name) for `entities.<Name>` and assert each
// <Name> has a base44/entities/<Name>.jsonc (matched by schema.name, which in this
// repo equals the filename, with a filename fallback for any unparseable schema).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import JSON5 from 'json5';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const ENTITIES_DIR = join(HERE, 'entities');

// Known entity names: schema.name of every base44/entities/*.jsonc, plus the
// filename (without extension) as a fallback for any file that fails to parse.
const knownEntities = new Set();
for (const f of readdirSync(ENTITIES_DIR)) {
  if (!f.endsWith('.jsonc')) continue;
  knownEntities.add(f.replace(/\.jsonc$/, ''));
  try {
    const schema = JSON5.parse(readFileSync(join(ENTITIES_DIR, f), 'utf8'));
    if (schema && typeof schema.name === 'string') knownEntities.add(schema.name);
  } catch {
    // filename fallback already added above
  }
}

// Recursively collect source files under a directory.
function walk(dir, acc = []) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const name of names) {
    if (name === 'node_modules' || name === '.git' || name === 'dist') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

// Tests/specs mock entities by name (e.g. `entities: { Visit: ... }`) and may
// reference entities under test — exclude them so the guardrail only governs
// production code.
const isProductionSource = (p) => {
  if (/\.(test|spec)\.[jt]sx?$/.test(p)) return false;
  return ['.js', '.jsx', '.ts', '.tsx'].includes(extname(p));
};

const files = [
  ...walk(join(REPO, 'src')),
  ...walk(join(HERE, 'functions')),
].filter(isProductionSource);

// `base44.entities.Foo` / `base44.asServiceRole.entities.Foo` — capture the entity
// name. Dynamic access (`entities[name]`) is intentionally NOT matched: it iterates
// a runtime-provided list and can't be checked statically.
const ENTITY_REF = /\bentities\.([A-Z][A-Za-z0-9_]*)/g;

test('no production source references an entity without a schema file', () => {
  const violations = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(ENTITY_REF)) {
      const name = m[1];
      if (!knownEntities.has(name)) {
        violations.push(`${file.replace(`${REPO}/`, '')}: entities.${name}`);
      }
    }
  }
  assert.deepEqual(
    violations,
    [],
    `Production code references entities with no base44/entities/<Name>.jsonc schema ` +
      `(a deleted or renamed entity will 500 at runtime):\n  ${violations.join('\n  ')}`,
  );
});
