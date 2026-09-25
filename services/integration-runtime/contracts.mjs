// Shared browser/server value contracts: no credentials, Node imports, or network access.

export class IntegrationError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
export const fail = (status, code) => { throw new IntegrationError(status, code); };
export const ID = /^[A-Za-z0-9_-]{1,128}$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_FILE = 8 * 1024 * 1024;
export const OPERATIONS = Object.freeze(['InvokeLLM', 'ExtractDataFromUploadedFile', 'SendEmail', 'UploadFile', 'UploadPrivateFile', 'CreateFileSignedUrl']);
// Operations a browser caller may never be granted, whatever the service list
// says. `runtime.mjs` only requires the browser list to be a SUBSET of the
// service list, so before `SendEmail` was released the ceiling refused a browser
// send for free; releasing the account emails turned that structural refusal
// into two unset variables. A browser send would also reach the provider
// WITHOUT the recipient binding the business API applies to its two senders,
// so the only thing bounding the recipient would be the caller's own typing.
// This is a refusal rather than a default: nothing may configure it back on.
export const BROWSER_FORBIDDEN_OPERATIONS = Object.freeze(['SendEmail']);
export const MIME = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/plain', 'text/csv']);
export function exactObject(value, allowed, code = 'INVALID_INPUT') {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !allowed.includes(key))) fail(400, code);
  return value;
}
export function text(value, max, required = true) {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(400, 'INVALID_TEXT');
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 && ![9, 10, 13].includes(code)) fail(400, 'INVALID_TEXT');
  }
  return value;
}
export function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
  if (typeof value === 'number' && !Number.isFinite(value)) fail(400, 'INVALID_NUMBER');
  if (value === undefined || typeof value === 'function') fail(400, 'INVALID_INPUT');
  return JSON.stringify(value);
}
const SCHEMA_KEYS = ['type', 'description', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems'];
export function validateSchema(schema, depth = 0, budget = { nodes: 0 }) {
  if (depth > 12 || ++budget.nodes > 200) fail(400, 'SCHEMA_TOO_COMPLEX');
  exactObject(schema, SCHEMA_KEYS, 'UNSUPPORTED_SCHEMA');
  if (!['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'].includes(schema.type)) fail(400, 'UNSUPPORTED_SCHEMA');
  if (schema.description !== undefined) text(schema.description, 2000, false);
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || !schema.enum.length || schema.enum.length > 100)) fail(400, 'UNSUPPORTED_SCHEMA');
  if (schema.type === 'object') {
    const properties = schema.properties || {};
    if (!properties || typeof properties !== 'object' || Array.isArray(properties) || Object.keys(properties).length > 100) fail(400, 'UNSUPPORTED_SCHEMA');
    if (Object.keys(properties).some(key => ['__proto__', 'constructor', 'prototype'].includes(key))) fail(400, 'UNSUPPORTED_SCHEMA');
    if (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.some(key => typeof key !== 'string' || !Object.hasOwn(properties, key)) || new Set(schema.required).size !== schema.required.length)) fail(400, 'UNSUPPORTED_SCHEMA');
    if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean') fail(400, 'UNSUPPORTED_SCHEMA');
    Object.values(properties).forEach(child => validateSchema(child, depth + 1, budget));
  } else if (['properties', 'required', 'additionalProperties'].some(key => Object.hasOwn(schema, key))) fail(400, 'UNSUPPORTED_SCHEMA');
  if (schema.type === 'array') validateSchema(schema.items, depth + 1, budget);
  else if (Object.hasOwn(schema, 'items')) fail(400, 'UNSUPPORTED_SCHEMA');
  for (const { low, high, kinds } of [
    { low: 'minLength', high: 'maxLength', kinds: ['string'] },
    { low: 'minItems', high: 'maxItems', kinds: ['array'] },
    { low: 'minimum', high: 'maximum', kinds: ['number', 'integer'] },
  ]) {
    for (const key of [low, high]) {
      if (schema[key] === undefined) continue;
      if (!kinds.includes(schema.type) || typeof schema[key] !== 'number' || !Number.isFinite(schema[key])) fail(400, 'UNSUPPORTED_SCHEMA');
      if (!['minimum', 'maximum'].includes(key) && (!Number.isSafeInteger(schema[key]) || schema[key] < 0 || schema[key] > 100000)) fail(400, 'UNSUPPORTED_SCHEMA');
    }
    if (schema[low] !== undefined && schema[high] !== undefined && schema[low] > schema[high]) fail(400, 'UNSUPPORTED_SCHEMA');
  }
  return schema;
}
export function conforms(value, schema) {
  if (schema.enum && !schema.enum.some(item => stable(item) === stable(value))) return false;
  if (schema.type === 'null') return value === null;
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const properties = schema.properties || {};
    return (schema.required || []).every(key => Object.hasOwn(value, key))
      && Object.entries(value).every(([key, child]) => !['__proto__', 'constructor', 'prototype'].includes(key)
        && (Object.hasOwn(properties, key) ? conforms(child, properties[key]) : schema.additionalProperties !== false));
  }
  if (schema.type === 'array') return Array.isArray(value) && value.length >= (schema.minItems ?? 0)
    && value.length <= (schema.maxItems ?? 100000) && value.every(child => conforms(child, schema.items));
  if (schema.type === 'string') return typeof value === 'string' && [...value].length >= (schema.minLength ?? 0) && [...value].length <= (schema.maxLength ?? 1000000);
  if (schema.type === 'boolean') return typeof value === 'boolean';
  return typeof value === 'number' && Number.isFinite(value) && (schema.type !== 'integer' || Number.isInteger(value))
    && value >= (schema.minimum ?? -Infinity) && value <= (schema.maximum ?? Infinity);
}
