import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import JSON5 from 'json5';

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

const ADMIN = { user_condition: { role: 'admin' } };
const CREATOR_OR_ADMIN = { $or: [{ created_by: '{{user.email}}' }, ADMIN] };

// Released by the owner on 2026-10-08 ("approve everything"). The pages work
// again; what stays pinned is who may touch the rows and how patient data
// reaches the pages.
describe('care-plan access contract', () => {
  it('limits care plans to their creator or a protected admin, and triggers to protected admins', () => {
    const carePlan = JSON5.parse(read('base44/entities/CarePlan.jsonc')).rls;
    const trigger = JSON5.parse(read('base44/entities/AutomaticCarePlanTrigger.jsonc')).rls;
    for (const operation of ['read', 'create', 'update', 'delete']) {
      expect(carePlan[operation], `CarePlan.rls.${operation}`).toEqual(CREATOR_OR_ADMIN);
      expect(trigger[operation], `AutomaticCarePlanTrigger.rls.${operation}`).toEqual(ADMIN);
    }
  });

  it('reads patients and visits only through the authorized brokers', () => {
    for (const file of routedPages) {
      const source = read(file);
      // Patient and Visit deny every direct client operation; a direct read here
      // would fail for every user, so the pages must use the purpose brokers.
      expect(source, file).not.toMatch(/entities\.(?:Patient|Visit)\b/);
      expect(source, file).not.toMatch(/<CarePlanUnavailable/);
    }
    expect(read('src/pages/CarePlanManagement.jsx')).toMatch(/useScopedPatients\(\{\s*purpose: 'roster'/);
    expect(read('src/pages/CarePlanManagement.jsx')).toMatch(/useAuthorizedVisits\(\{[\s\S]{0,80}purpose: 'documentation'/);
    expect(read('src/pages/CarePlanBuilder.jsx')).toMatch(/useScopedPatients\(\{ purpose: 'roster'/);
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
      const clientIndex = source.indexOf('createClientFromRequest(', handlerIndex);
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
