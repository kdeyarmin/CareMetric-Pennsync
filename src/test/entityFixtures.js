/**
 * Synthetic entity rows generated from the real Base44 schemas.
 *
 * The routed-page smoke test (navPages.test.jsx) mounts every page against an
 * SDK that answers every read with `[]`, which proves a page renders its EMPTY
 * state. That leaves the loaded state — the branch users actually spend their
 * time in — completely uncovered: a `rows.map(r => r.scores.overall)` only
 * explodes once a row exists.
 *
 * Hand-written fixtures would drift from the schemas, so rows are derived from
 * `base44/entities/*.jsonc` instead: every declared property gets a value of the
 * declared type (enums use a declared member, so a status/severity switch takes
 * a real branch), and the platform-managed fields every row carries in
 * production (`id`, `created_date`, `created_by`, …) are stamped on top.
 *
 * Entity files are JSONC — comments, and `//` inside description URLs — so they
 * parse with JSON5, matching base44/schemaContract.test.js.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSON5 from 'json5';

const ENTITIES_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../base44/entities');

/** The caller every fixture is attributed to, so agency scoping keeps the rows. */
export const TEST_AGENCY = 'Test Agency';
export const TEST_USER = {
  id: 'u1',
  email: 'test@example.com',
  full_name: 'Test User',
  role: 'admin',
  account_type: 'agency_admin',
  agency_id: 'agency-1',
  agency_name: TEST_AGENCY,
  is_approved: true,
  is_active: true,
  is_manager: true,
};

const schemas = {};
for (const file of readdirSync(ENTITIES_DIR)) {
  if (!file.endsWith('.jsonc')) continue;
  try {
    schemas[file.replace(/\.jsonc$/, '')] = JSON5.parse(readFileSync(join(ENTITIES_DIR, file), 'utf8'));
  } catch {
    // A malformed schema is base44/schemaContract.test.js's failure to report,
    // not this fixture builder's — skip it rather than failing every page.
  }
}

function valueFor(name, prop, i) {
  if (!prop || typeof prop !== 'object') return `${name}-${i}`;
  if (Array.isArray(prop.enum) && prop.enum.length) return prop.enum[i % prop.enum.length];
  switch (prop.type) {
    case 'number':
    case 'integer':
      return 3 + i;
    case 'boolean':
      return i % 2 === 0;
    case 'array':
      return [itemFor(prop.items, i), itemFor(prop.items, i + 1)];
    case 'object':
      return objectFor(prop, i);
    default:
      if (prop.format === 'date') return `2026-06-1${i % 9}`;
      if (prop.format === 'date-time') return `2026-06-1${i % 9}T10:00:00.000Z`;
      if (prop.format === 'email') return `person${i}@example.com`;
      if (/url$|_url|link/i.test(name)) return 'https://example.com/document.pdf';
      return `${name}-${i}`;
  }
}

function itemFor(items, i) {
  if (!items || typeof items !== 'object') return `item-${i}`;
  if (items.type === 'object') return objectFor(items, i);
  return valueFor('item', items, i);
}

function objectFor(schema, i) {
  const out = {};
  for (const [key, prop] of Object.entries(schema?.properties || {})) out[key] = valueFor(key, prop, i);
  return out;
}

const cache = new Map();

/** `count` synthetic rows for an entity (stable across calls, so keys are stable). */
export function rowsFor(entity, count = 3) {
  const key = `${entity}:${count}`;
  if (cache.has(key)) return cache.get(key);

  const rows = [];
  for (let i = 0; i < count; i += 1) {
    if (entity === 'User') {
      // The roster decides agency scoping, so these are real-shaped, not synthetic:
      // the caller must appear in it or every scoped read fails closed to [].
      rows.push(
        i === 0
          ? { ...TEST_USER, created_date: '2026-06-01T10:00:00.000Z' }
          : {
              id: `User-${i}`,
              email: `nurse${i}@example.com`,
              full_name: `Nurse ${i}`,
              role: 'user',
              account_type: 'nurse',
              agency_id: 'agency-1',
              agency_name: TEST_AGENCY,
              is_approved: true,
              is_active: true,
              created_date: '2026-06-01T10:00:00.000Z',
            },
      );
      continue;
    }
    rows.push({
      ...objectFor(schemas[entity], i),
      id: `${entity}-${i}`,
      created_date: `2026-06-1${i % 9}T10:00:00.000Z`,
      updated_date: `2026-06-1${i % 9}T11:00:00.000Z`,
      created_by: TEST_USER.email,
      agency_id: TEST_USER.agency_id,
      agency_name: TEST_AGENCY,
    });
  }
  cache.set(key, rows);
  return rows;
}

/**
 * A best-effort response body for `base44.functions.invoke(name)`. Pages read
 * `res.data.<something>`; the collection keys below are the ones the app's
 * server-scoped reads actually return, so those pages reach their loaded state
 * instead of rendering an empty shell.
 */
export function functionResponseFor(name) {
  const body = {
    success: true,
    status: 'ok',
    count: 3,
    total: 3,
    results: rowsFor('Patient'),
    items: rowsFor('Patient'),
    patients: rowsFor('Patient'),
    visits: rowsFor('Visit'),
    recentCompletedVisits: rowsFor('Visit'),
    incidents: rowsFor('Incident'),
    carePlans: rowsFor('CarePlan'),
    alerts: rowsFor('PatientAlert'),
    documents: rowsFor('Document'),
    users: rowsFor('User'),
    // Singular subjects for the "one record plus its context" functions
    // (getPatientContext, getVisitDetail, …) that detail pages read.
    patient: rowsFor('Patient')[0],
    visit: rowsFor('Visit')[0],
    carePlan: rowsFor('CarePlan')[0],
    logs: [],
    jobs: [],
    errors: [],
    warnings: [],
    insights: [],
    recommendations: [],
  };
  // getFooBars() → { fooBars: [...] } for whatever entity the name mentions.
  const entity = String(name).replace(/^(get|list)/, '');
  if (schemas[entity]) body[entity.charAt(0).toLowerCase() + entity.slice(1)] = rowsFor(entity);
  return body;
}

