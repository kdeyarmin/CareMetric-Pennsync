import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { describe, expect, it, vi } from 'vitest';
import {
  AUTHORIZED_PATIENT_LIST_QUERY_KEY,
  invalidateAuthorizedPatientLists,
} from './useScopedPatients';
import {
  AUTHORIZED_VISIT_LIST_QUERY_KEY,
  invalidateAuthorizedVisitLists,
} from './useAuthorizedVisits';

describe('authorized Patient/Visit list invalidation', () => {
  it('invalidates the canonical broker cache prefixes', async () => {
    const queryClient = { invalidateQueries: vi.fn().mockResolvedValue(undefined) };
    await invalidateAuthorizedPatientLists(queryClient);
    await invalidateAuthorizedVisitLists(queryClient);
    expect(queryClient.invalidateQueries.mock.calls).toEqual([
      [{ queryKey: AUTHORIZED_PATIENT_LIST_QUERY_KEY }],
      [{ queryKey: AUTHORIZED_VISIT_LIST_QUERY_KEY }],
    ]);
    expect(AUTHORIZED_PATIENT_LIST_QUERY_KEY).toEqual(['patients', 'authorized-list']);
    expect(AUTHORIZED_VISIT_LIST_QUERY_KEY).toEqual(['visits', 'authorized-list']);
  });

  it('connects create/update mutation success paths to the canonical refresh helpers', () => {
    const read = (relative) => readFileSync(path.join(process.cwd(), relative), 'utf8');
    const quickActions = read('src/components/dashboard/PatientQuickActions.jsx');
    expect(quickActions.match(/invalidateAuthorizedPatientLists\(queryClient\)/g)).toHaveLength(2);
    expect(quickActions.match(/invalidateAuthorizedVisitLists\(queryClient\)/g)).toHaveLength(1);

    const dashboard = read('src/pages/PatientRecordDashboard.jsx');
    expect(dashboard).toMatch(/refreshDashboard[\s\S]*?invalidateAuthorizedPatientLists\(queryClient\)[\s\S]*?invalidateAuthorizedVisitLists\(queryClient\)/);

    const patients = read('src/pages/Patients.jsx');
    expect(patients).toMatch(/<PatientForm[\s\S]*?onSuccess=\{\(\) => \{[\s\S]*?invalidateAuthorizedPatientLists\(queryClient\)/);
  });
});
