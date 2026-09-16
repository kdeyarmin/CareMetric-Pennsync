import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

export class IntegrationError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
export const fail = (status, code) => { throw new IntegrationError(status, code); };
export const ID = /^[A-Za-z0-9_-]{1,128}$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_FILE = 8 * 1024 * 1024;
export const OPERATIONS = Object.freeze(['InvokeLLM', 'ExtractDataFromUploadedFile', 'SendEmail', 'UploadFile', 'UploadPrivateFile', 'CreateFileSignedUrl']);
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
export const hash = (key, value) => createHmac('sha256', key).update(stable(value)).digest('hex');
export function seal(key, context, value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  cipher.setAAD(Buffer.from(context));
  const bytes = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), bytes].map(part => part.toString('base64url')).join('.');
}
export function unseal(key, context, value) {
  try {
    const parts = value.split('.');
    if (parts.length !== 3) throw new Error();
    const [iv, tag, bytes] = parts.map(part => Buffer.from(part, 'base64url'));
    if (iv.length !== 12 || tag.length !== 16) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
    decipher.setAAD(Buffer.from(context)); decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(bytes), decipher.final()]).toString('utf8'));
  } catch { fail(409, 'RESULT_RECONCILIATION_REQUIRED'); }
}
export async function limitedBytes(response, maximum) {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) { await reader.cancel(); fail(413, 'RESPONSE_TOO_LARGE'); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
export async function readJson(response, maximum = 1024 * 1024) {
  const bytes = await limitedBytes(response, maximum);
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { fail(502, 'INVALID_UPSTREAM_RESPONSE'); }
}
export function fileBytes(base64, mime) {
  if (!MIME.has(mime) || typeof base64 !== 'string' || base64.length > Math.ceil(MAX_FILE / 3) * 4
    || base64.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) fail(400, 'INVALID_FILE');
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length || bytes.length > MAX_FILE) fail(413, 'INVALID_FILE_SIZE');
  const hex = bytes.subarray(0, 12).toString('hex');
  const valid = mime === 'application/pdf' ? bytes.subarray(0, 5).toString() === '%PDF-'
    : mime === 'image/png' ? hex.startsWith('89504e470d0a1a0a')
    : mime === 'image/jpeg' ? hex.startsWith('ffd8ff')
    : mime === 'image/webp' ? bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'
    : !bytes.includes(0);
  if (!valid) fail(400, 'FILE_TYPE_MISMATCH');
  return bytes;
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
  for (const [low, high, kinds] of [['minLength', 'maxLength', ['string']], ['minItems', 'maxItems', ['array']], ['minimum', 'maximum', ['number', 'integer']]]) {
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
