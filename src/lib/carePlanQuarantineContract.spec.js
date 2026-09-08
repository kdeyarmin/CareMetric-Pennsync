import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8');

const routedPages = [
  'src/pages/CarePlanManagement.jsx',
  'src/pages/CarePlanBuilder.jsx',
  'src/pages/AutomaticCarePlans.jsx',
];

const carePlanHandlers = [
  'generateCarePlanSuggestions',
  'generateCarePlanFromReferral',
  'generateCarePlansFromReferral',
  'monitorClinicalDataForCarePlanUpdates',
];

describe('care-plan quarantine contract', () => {
  it('denies every direct CarePlan and automatic-trigger entity operation', () => {
    for (const entity of ['CarePlan', 'AutomaticCarePlanTrigger']) {
      const source = read(`base44/entities/${entity}.jsonc`);
      for (const operation of ['read', 'create', 'update', 'delete']) {
        expect(source, `${entity}.rls.${operation}`).toMatch(
          new RegExp(`"${operation}"\\s*:\\s*false`),
        );
      }
    }
  });

  it('keeps every routed care-plan page static and data-free', () => {
    for (const file of routedPages) {
      const source = read(file);

      expect(source, file).toMatch(/<CarePlanUnavailable/);
      expect(source, file).not.toMatch(
        /\bbase44\b|useQuery|useMutation|useScopedPatients|entities\.|functions\.|<input|<textarea/,
      );
    }
  });

  it('keeps the retained legacy chart module inert as well as redirected', () => {
    const source = read('src/pages/ClinicalChart.jsx');

    expect(source).toMatch(/<Navigate to="\/Patients" replace \/>/);
    expect(source).not.toMatch(/\bbase44\b|CarePlanInteractive|useQuery|entities\./);
  });

  it('keeps every adjacent care-plan backend path paused before client construction', () => {
    for (const functionName of carePlanHandlers) {
      const source = read(`base44/functions/${functionName}/entry.ts`);
      const handlerIndex = source.indexOf('Deno.serve(');
      const clientIndex = source.indexOf('createClientFromRequest(req)', handlerIndex);
      const pausedReturnIndex = source.indexOf('return Response.json(', handlerIndex);

      expect(handlerIndex, functionName).toBeGreaterThanOrEqual(0);
      expect(pausedReturnIndex, functionName).toBeGreaterThan(handlerIndex);
      expect(clientIndex, functionName).toBeGreaterThan(pausedReturnIndex);
      expect(source.slice(handlerIndex, clientIndex), functionName).toMatch(
        /(?:_ENABLED\)\s*\{|SECURITY CONTAINMENT)[\s\S]*return Response\.json/,
      );
    }
  });
});
