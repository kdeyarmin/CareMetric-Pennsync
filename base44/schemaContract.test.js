// Schema-contract guardrail for the Base44 entity definitions.
//
// WHY THIS EXISTS
// The app's #1 systemic data risk is "entity-contract drift": code that writes a
// field name or enum value the entity schema doesn't define. Base44 silently
// drops/rejects those writes, so the bug is invisible until a record turns up
// empty in production (the historical Notification.type / FaxLog.status gaps).
// This test turns that whole class into a build failure.
//
// TWO LAYERS
//   Part 1 — automatic invariants over EVERY entity in base44/entities. Zero
//            maintenance: it just has to keep passing. Catches schema-authoring
//            mistakes (a default outside its enum, a required field that doesn't
//            exist, a malformed enum) across all entities for free.
//   Part 2 — a curated, reviewed allowlist of the enum values the CODE writes to
//            the drift-prone fields, each asserted to be a member of the schema
//            enum. This is intentionally explicit (matching the repo's parity-test
//            philosophy) rather than fuzzy auto-discovery: a naive scraper would,
//            for example, false-flag a `status: 'sent'` that belongs to a nearby
//            notification object, not the DocumentSignature being updated.
//
//   To extend Part 2 when you add a new enum value the backend writes: add the
//   value to the entity's enum in base44/entities/<Entity>.jsonc AND to the
//   matching list below. The test then guarantees the two stay in step.
//
// Entity files are JSONC (some carry // comments, and descriptions contain URLs
// with `//`), so they are parsed with JSON5 rather than JSON.parse.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import JSON5 from 'json5';

const ENTITIES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'entities');

const entityFiles = readdirSync(ENTITIES_DIR).filter((f) => f.endsWith('.jsonc'));

// Parse every file once. Parse failures are recorded (not thrown) so the parse
// test below can report exactly which files broke instead of crashing the suite.
const parsed = new Map(); // file -> schema object
const parseErrors = new Map(); // file -> message
for (const file of entityFiles) {
  try {
    parsed.set(file, JSON5.parse(readFileSync(join(ENTITIES_DIR, file), 'utf8')));
  } catch (err) {
    parseErrors.set(file, err.message);
  }
}

// Map entity logical name (schema.name) -> schema, for the Part 2 lookups.
const byName = new Map();
for (const schema of parsed.values()) {
  if (schema && typeof schema.name === 'string') byName.set(schema.name, schema);
}

const isPrimitive = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v);

// Yield [path, fieldSchema] for every property, recursing into nested object
// properties and array item properties.
function* eachField(schema, prefix = '') {
  const props = schema && schema.properties;
  if (!props || typeof props !== 'object') return;
  for (const [key, field] of Object.entries(props)) {
    yield [prefix + key, field];
    if (field && field.properties) yield* eachField(field, `${prefix}${key}.`);
    if (field && field.items && field.items.properties) {
      yield* eachField(field.items, `${prefix}${key}[].`);
    }
  }
}

// Yield every object-schema node that can carry its own `required` array.
function* eachObjectNode(schema, path = '(root)') {
  if (!schema || typeof schema !== 'object') return;
  if (schema.properties) yield [path, schema];
  const props = schema.properties || {};
  for (const [key, field] of Object.entries(props)) {
    if (field && field.properties) yield* eachObjectNode(field, `${path}.${key}`);
    if (field && field.items && field.items.properties) {
      yield* eachObjectNode(field.items, `${path}.${key}[]`);
    }
  }
}

// ---------------------------------------------------------------------------
// Part 1 — automatic invariants across all entities
// ---------------------------------------------------------------------------

test('every entity file parses as JSON5', () => {
  assert.equal(
    parseErrors.size,
    0,
    `Unparseable entity file(s):\n${[...parseErrors].map(([f, m]) => `  ${f}: ${m}`).join('\n')}`,
  );
  assert.ok(parsed.size > 0, 'expected to find entity schema files');
});

test('every enum is a non-empty array of unique primitives', () => {
  const bad = [];
  for (const [file, schema] of parsed) {
    for (const [path, field] of eachField(schema)) {
      if (!('enum' in field)) continue;
      const e = field.enum;
      if (!Array.isArray(e) || e.length === 0) {
        bad.push(`${file}: ${path} enum is not a non-empty array`);
        continue;
      }
      if (!e.every(isPrimitive)) bad.push(`${file}: ${path} enum has non-primitive members`);
      if (new Set(e).size !== e.length) bad.push(`${file}: ${path} enum has duplicate members`);
    }
  }
  assert.equal(bad.length, 0, `Malformed enum(s):\n${bad.join('\n')}`);
});

test('every field default is a member of its enum', () => {
  const bad = [];
  for (const [file, schema] of parsed) {
    for (const [path, field] of eachField(schema)) {
      if (!Array.isArray(field.enum)) continue;
      if (!('default' in field)) continue;
      const d = field.default;
      if (d === undefined || d === '') continue; // "no default" sentinels
      if (!field.enum.includes(d)) {
        bad.push(`${file}: ${path} default=${JSON5.stringify(d)} is not in its enum`);
      }
    }
  }
  assert.equal(bad.length, 0, `Default value(s) outside their enum:\n${bad.join('\n')}`);
});

test('every required field exists in its properties', () => {
  const bad = [];
  for (const [file, schema] of parsed) {
    for (const [path, node] of eachObjectNode(schema)) {
      if (!Array.isArray(node.required)) continue;
      for (const req of node.required) {
        if (!node.properties || !(req in node.properties)) {
          bad.push(`${file}: ${path} requires '${req}' but it is not a defined property`);
        }
      }
    }
  }
  assert.equal(bad.length, 0, `Required field(s) missing from properties:\n${bad.join('\n')}`);
});

// ---------------------------------------------------------------------------
// Part 2 — curated code↔schema enum cross-reference
//
// Each list is the set of enum values the application code is known to WRITE to
// that field (verified from the Notification.create / FaxLog / DocumentSignature
// .create/.update call sites). Every value must exist in the schema enum, or the
// write would be silently dropped by the platform.
// ---------------------------------------------------------------------------

const ENUM_USAGE = {
  // Notification.type — the field that actually drifted historically. Values
  // observed at Notification.create() sites across base44/functions.
  'Notification.type': [
    'admin_expiration_summary',
    'care_plan_proposal',
    'compliance_alert',
    'critical_alert',
    'fax_delivered',
    'fax_failed',
    'info',
    'sms_failed',
    'sms_received',
    'sms_urgent',
    'task_assigned',
    'task_due_soon',
    'training_due',
    'voicemail',
  ],
  // Notification.priority — webhook/alert writers map provider severities onto
  // these (the historical bug wrote 'normal'/'urgent', which were dropped).
  'Notification.priority': ['low', 'medium', 'high', 'critical'],
  // FaxLog.status — written by the send path and the Telnyx status webhook mapper.
  'FaxLog.status': ['queued', 'sending', 'sent', 'delivered', 'failed', 'retrying', 'retried'],
  // DocumentSignature.status — written by the package create + signature submit
  // pipeline. NOTE: 'signed' is a display-only normalization in
  // src/components/signature/signatureUtils.js and is never persisted here.
  'DocumentSignature.status': ['pending', 'in_progress', 'completed', 'rejected'],
  // PatientAlert.alert_type — written by monitorComplianceRisks /
  // predictiveRiskAnalysis. 'documentation_risk' was the historically-dropped value.
  'PatientAlert.alert_type': ['care_gap', 'documentation_risk', 'readmission_risk'],
  // Patient.status — 'merged' is written by deduplicatePatients' merge-archive step.
  'Patient.status': ['active', 'discharged', 'merged'],
};

// ---------------------------------------------------------------------------
// Part 3 — curated field-presence cross-reference
//
// The enum check above can't catch the OTHER drift class: code writing a flat
// FIELD the schema doesn't define (e.g. the historical DocumentSignature
// `signer_name`/`signed_at` flats, or Notification `related_entity`). Those are
// silently dropped just like a bad enum value. Each entry below is a field the
// application code is known to WRITE; the test asserts it exists in the schema
// (top-level or nested via dotted/`[]` paths), so removing the field from the
// schema while code still writes it becomes a build failure.
// ---------------------------------------------------------------------------

const FIELD_USAGE = {
  Notification: ['metadata'],
  FaxLog: ['retry_claimed_by', 'retry_claimed_at'],
  DocumentSignature: ['document_title', 'document_name', 'signers', 'last_reminder_sent_at'],
  Patient: ['merged_into_id', 'merged_at', 'merged_by', 'validation_overrides'],
  Referral: ['page_range', 'detection_confidence', 'manually_confirmed', 'rejection_date', 'rejected_by'],
  PatientAlert: ['contributing_factors', 'recommended_actions', 'risk_score'],
  // OASISFeedback is written by two paths: the patient-match writers
  // (feedback_type/extracted_name + match fields) and the AI-suggestion
  // OASISFeedbackPanel (the fields below). The panel fields were historically
  // absent from the schema, so every suggestion rating was silently dropped.
  OASISFeedback: [
    'visit_id', 'patient_id', 'suggestion_type', 'oasis_item', 'original_suggestion',
    'user_action', 'modified_text', 'feedback_reason', 'reimbursement_impact_accuracy',
    'clinical_accuracy', 'helpfulness_rating',
  ],
};

test('curated registry references existing entities and enum fields', () => {
  const problems = [];
  for (const ref of Object.keys(ENUM_USAGE)) {
    const [entity, field] = ref.split('.');
    const schema = byName.get(entity);
    if (!schema) {
      problems.push(`${ref}: no entity named '${entity}'`);
      continue;
    }
    const fieldSchema = schema.properties && schema.properties[field];
    if (!fieldSchema) problems.push(`${ref}: '${entity}' has no property '${field}'`);
    else if (!Array.isArray(fieldSchema.enum)) problems.push(`${ref}: '${field}' has no enum`);
  }
  assert.equal(problems.length, 0, `Registry is stale:\n${problems.join('\n')}`);
});

test('code-written enum values are all defined in the schema enum', () => {
  const drift = [];
  for (const [ref, usedValues] of Object.entries(ENUM_USAGE)) {
    const [entity, field] = ref.split('.');
    const fieldSchema = byName.get(entity)?.properties?.[field];
    if (!Array.isArray(fieldSchema?.enum)) continue; // reported by the test above
    const allowed = new Set(fieldSchema.enum);
    for (const value of usedValues) {
      if (!allowed.has(value)) {
        drift.push(`${ref}: code writes ${JSON5.stringify(value)} but it is not in the schema enum`);
      }
    }
  }
  assert.equal(drift.length, 0, `Entity-contract drift detected:\n${drift.join('\n')}`);
});

test('code-written fields all exist in the entity schema', () => {
  // Build the set of every field path the schema defines (top-level + nested),
  // so a write to `metadata` or `signers` resolves regardless of nesting.
  const drift = [];
  for (const [entity, fields] of Object.entries(FIELD_USAGE)) {
    const schema = byName.get(entity);
    if (!schema) {
      drift.push(`${entity}: no entity named '${entity}'`);
      continue;
    }
    const defined = new Set();
    for (const [path] of eachField(schema)) defined.add(path);
    for (const field of fields) {
      // accept the field itself, a nested child (`field.x`), or array items (`field[].x`)
      const present =
        defined.has(field) || [...defined].some((p) => p.startsWith(`${field}.`) || p.startsWith(`${field}[]`));
      if (!present) {
        drift.push(`${entity}.${field}: code writes this field but the schema has no such property`);
      }
    }
  }
  assert.equal(drift.length, 0, `Field-contract drift detected:\n${drift.join('\n')}`);
});
