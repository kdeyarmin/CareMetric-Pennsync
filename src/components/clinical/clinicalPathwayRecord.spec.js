import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import JSON5 from 'json5';
import { describe, expect, it } from 'vitest';
import {
  PATHWAY_SYSTEM_FIELDS,
  pathwayCreatePayload,
  pathwayUpdatePayload,
} from './clinicalPathwayRecord';

const schema = JSON5.parse(
  readFileSync(path.join(process.cwd(), 'base44/entities/ClinicalPathway.jsonc'), 'utf8'),
);

describe('pathwayCreatePayload', () => {
  it('supplies every field the schema requires', () => {
    const payload = pathwayCreatePayload({ pathway_name: ' CHF Management ' });
    for (const field of schema.required) expect(payload[field], field).toBeTruthy();
    expect(payload).toEqual({ pathway_name: 'CHF Management', condition: 'CHF Management' });
  });

  it('prefers an explicit condition, then the caller fallback, then the name', () => {
    expect(pathwayCreatePayload({ pathway_name: 'A', condition: 'Diabetes' }).condition).toBe('Diabetes');
    expect(pathwayCreatePayload({ pathway_name: 'A' }, { fallbackCondition: ' COPD ' }).condition).toBe('COPD');
  });

  it('drops system fields and anything the schema does not hold', () => {
    const payload = pathwayCreatePayload({
      id: 'p-1',
      created_date: 'x',
      usage_count: 4,
      pathway_name: 'A',
      is_active: true,
      trigger_conditions: [{ type: 'diagnosis_code', value: 'I50' }],
      invented_by_model: 'yes',
      description: 42,
    });
    for (const field of PATHWAY_SYSTEM_FIELDS) expect(payload).not.toHaveProperty(field);
    expect(payload).not.toHaveProperty('invented_by_model');
    expect(payload).not.toHaveProperty('description');
    expect(payload.trigger_conditions).toHaveLength(1);
    for (const field of Object.keys(payload)) expect(schema.properties, field).toHaveProperty(field);
  });

  it('refuses a pathway with no name', () => {
    expect(() => pathwayCreatePayload({ condition: 'CHF' })).toThrow(/name/);
  });
});

describe('pathwayUpdatePayload', () => {
  const stored = {
    id: 'p-1',
    created_date: '2026-01-01',
    pathway_name: 'CHF',
    condition: 'Heart failure',
    documentation_prompts: [{ prompt: 'Weigh daily' }],
  };

  it('appends arrays, replaces text, and ignores unknown keys', () => {
    const payload = pathwayUpdatePayload(stored, {
      documentation_prompts: [{ prompt: 'Check edema' }],
      description: 'Updated',
      id: 'p-2',
      dosage_override: '5mg',
    });
    expect(payload.documentation_prompts).toHaveLength(2);
    expect(payload.description).toBe('Updated');
    expect(payload).not.toHaveProperty('id');
    expect(payload).not.toHaveProperty('dosage_override');
  });

  it('never blanks the required name or condition', () => {
    const payload = pathwayUpdatePayload(stored, { pathway_name: '  ', condition: '' });
    expect(payload.pathway_name).toBe('CHF');
    expect(payload.condition).toBe('Heart failure');
  });
});
