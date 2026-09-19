#!/usr/bin/env node
/**
 * File-reference census over the entity schemas.
 *
 * Phase 3 of the Base44 exit has to inventory, copy and re-point every
 * uploaded file. That work cannot start from a guess about which fields hold a
 * file: the hosted inventory needs an exact list of the paths to read, and the
 * `file_url` to `cmfile:` compatibility layer needs the exact list of paths to
 * rewrite.
 *
 * This tool produces that list from the committed schemas. It is deterministic
 * and offline: it contacts no app, reads no record, downloads no object and
 * copies nothing. It is the input to a hosted inventory, not the inventory.
 *
 * A committed expectations file records the current census, so a new
 * file-bearing field cannot be added without appearing in a reviewed diff.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSON5 from 'json5';

export const FORMAT = 'pennsync-file-reference-census';
export const FORMAT_VERSION = 1;
export const EXPECTATIONS_FILE = 'tools-file-reference-census-expectations.json';
export const ENTITY_DIRECTORY = 'base44/entities';

/**
 * `locator` fields carry a retrievable address for stored bytes and must be
 * inventoried and re-pointed. `descriptor` fields describe those bytes and
 * travel with them. Everything else is not a file reference.
 */
export const KINDS = Object.freeze(['locator', 'descriptor']);
const LOCATOR = /(^|_)(url|urls|uri|uris|href|storage_path|object_path|signed_url|public_url)$/i;
const DESCRIPTOR = /(^|_)(file_name|filename|file_size|filesize|file_type|filetype|mime_type|mimetype|content_type|checksum|sha256|byte_size|page_count)$/i;
/** URL-shaped fields that address a destination rather than stored bytes. */
const NOT_A_FILE = /(^|_)(callback|webhook|redirect|return|portal|app|site|base|api|join|meeting|room|host|origin|docs|help|reference|action|external)_?(url|uri|link)$/i;
/** Only a string, a list of strings, or an untyped field can carry a locator. */
const LOCATOR_TYPES = new Set(['string', 'array', 'unknown', undefined, null]);

const MAX_DEPTH = 12;

export function classifyField(name, schema) {
  if (typeof name !== 'string' || !name) return null;
  if (DESCRIPTOR.test(name)) return 'descriptor';
  if (NOT_A_FILE.test(name)) return null;
  const type = schema && typeof schema === 'object' ? schema.type : undefined;
  // A boolean or numeric field cannot hold an address, whatever it is called.
  if (!LOCATOR_TYPES.has(type)) return null;
  if (type === 'array' && schema?.items?.type && schema.items.type !== 'string') return null;
  if (LOCATOR.test(name)) return 'locator';
  // An explicit uri format is a locator even when the name does not say so.
  if (schema && schema.format === 'uri') return 'locator';
  return null;
}

function walk(schema, path, found, depth = 0) {
  if (!schema || typeof schema !== 'object' || depth > MAX_DEPTH) return;
  if (schema.type === 'array' && schema.items) {
    walk(schema.items, `${path}[]`, found, depth + 1);
    return;
  }
  const properties = schema.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return;
  for (const name of Object.keys(properties).sort()) {
    const child = properties[name];
    const childPath = path ? `${path}.${name}` : name;
    const kind = classifyField(name, child);
    if (kind) found.push({ path: childPath, kind, type: child?.type ?? 'unknown' });
    walk(child, childPath, found, depth + 1);
  }
}

export function censusEntity(name, raw) {
  let schema;
  // JSON5 handles the schemas' comments and trailing commas without the
  // silent corruption a regex stripper causes on a URL inside a description.
  try { schema = JSON5.parse(raw); }
  catch { return { entity: name, unreadable: true, fields: [] }; }
  const fields = [];
  walk(schema, '', fields);
  fields.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { entity: name, unreadable: false, fields };
}

export function buildCensus(repository) {
  const directory = join(repository, ENTITY_DIRECTORY);
  const entities = readdirSync(directory).filter(file => /\.jsonc?$/.test(file)).sort();
  const results = entities.map(file => censusEntity(file.replace(/\.jsonc?$/, ''), readFileSync(join(directory, file), 'utf8')));
  const withFiles = results.filter(result => result.fields.length > 0);
  const totals = { entities: results.length, unreadable: results.filter(r => r.unreadable).length, entities_with_file_fields: withFiles.length };
  for (const kind of KINDS) {
    totals[`${kind}_fields`] = withFiles.reduce((sum, entity) => sum + entity.fields.filter(field => field.kind === kind).length, 0);
  }
  return {
    format: FORMAT,
    schema_version: FORMAT_VERSION,
    totals,
    // Exactly the paths a hosted inventory must read and a rewrite must touch.
    entities: Object.fromEntries(withFiles.map(entity => [entity.entity, entity.fields])),
    // This census is schema-derived. It cannot see a locator hidden inside an
    // untyped object, embedded markup or free text, and it proves nothing
    // about which objects actually exist.
    hosted_inventory_performed: false,
    object_bytes_read: 0,
    files_copied: 0,
  };
}

export function compareCensus(census, expectations) {
  const current = new Map();
  for (const [entity, fields] of Object.entries(census.entities)) {
    for (const field of fields) current.set(`${entity}.${field.path}`, field.kind);
  }
  const recorded = new Map();
  for (const [entity, fields] of Object.entries(expectations.entities)) {
    for (const field of fields) recorded.set(`${entity}.${field.path}`, field.kind);
  }
  const added = [...current.keys()].filter(key => !recorded.has(key)).sort();
  const removed = [...recorded.keys()].filter(key => !current.has(key)).sort();
  const reclassified = [...current.entries()]
    .filter(([key, kind]) => recorded.has(key) && recorded.get(key) !== kind)
    .map(([key, kind]) => ({ reference: key, was: recorded.get(key), now: kind }))
    .sort((a, b) => (a.reference < b.reference ? -1 : 1));
  return {
    totals: census.totals,
    added, removed, reclassified,
    matches_expectations: added.length === 0 && removed.length === 0 && reclassified.length === 0,
  };
}

export function parseExpectations(raw) {
  let expectations;
  try { expectations = JSON.parse(raw); } catch { throw new Error('EXPECTATIONS_INVALID_JSON'); }
  if (!expectations || typeof expectations !== 'object' || Array.isArray(expectations)) throw new Error('EXPECTATIONS_INVALID_SHAPE');
  if (expectations.format !== FORMAT || expectations.schema_version !== FORMAT_VERSION) throw new Error('EXPECTATIONS_UNSUPPORTED_FORMAT');
  if (!expectations.entities || typeof expectations.entities !== 'object' || Array.isArray(expectations.entities)) throw new Error('EXPECTATIONS_INVALID_ENTITIES');
  for (const fields of Object.values(expectations.entities)) {
    if (!Array.isArray(fields) || fields.some(field => typeof field?.path !== 'string' || !KINDS.includes(field?.kind))) {
      throw new Error('EXPECTATIONS_INVALID_ENTITIES');
    }
  }
  return expectations;
}

export function main(args = process.argv.slice(2), { repository = resolve(dirname(fileURLToPath(import.meta.url))), log = console.log, write = writeFileSync } = {}) {
  if (args.some(argument => !['--json', '--summary', '--update'].includes(argument))) {
    log(JSON.stringify({ error: 'INVALID_ARGUMENTS' }));
    return 2;
  }
  let census;
  try { census = buildCensus(repository); }
  catch { log(JSON.stringify({ error: 'ENTITY_SCHEMAS_UNAVAILABLE' })); return 2; }
  const expectationsPath = join(repository, EXPECTATIONS_FILE);
  if (args.includes('--update')) {
    write(expectationsPath, JSON.stringify(census, null, 2) + '\n');
    log(JSON.stringify({ updated: EXPECTATIONS_FILE, totals: census.totals }, null, 2));
    return 0;
  }
  let expectations;
  try { expectations = parseExpectations(readFileSync(expectationsPath, 'utf8')); }
  catch (error) { log(JSON.stringify({ error: error?.message || 'EXPECTATIONS_UNAVAILABLE' })); return 2; }
  const report = compareCensus(census, expectations);
  if (args.includes('--summary')) {
    log(`file references ${report.matches_expectations ? 'unchanged' : 'CHANGED'}: `
      + `${census.totals.locator_fields} locator and ${census.totals.descriptor_fields} descriptor fields across `
      + `${census.totals.entities_with_file_fields} of ${census.totals.entities} entities; `
      + `added=${report.added.length} removed=${report.removed.length} reclassified=${report.reclassified.length}`);
  } else {
    log(JSON.stringify({ ...report, census }, null, 2));
  }
  return report.matches_expectations ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main();
}
