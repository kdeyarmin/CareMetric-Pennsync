import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

/**
 * Contract tests for dashboard alert wiring — RealTimePatientAlerts needs
 * historical completed visits + care plans, which getDashboardData must supply
 * and Dashboard.jsx must pass through.
 */
describe('dashboard alert data contract', () => {
  const dashboard = readFileSync(join(process.cwd(), 'src/pages/Dashboard.jsx'), 'utf8');
  const getDashboard = readFileSync(
    join(process.cwd(), 'base44/functions/getDashboardData/entry.ts'),
    'utf8',
  );
  const incidentsPage = readFileSync(join(process.cwd(), 'src/pages/Incidents.jsx'), 'utf8');
  const layout = readFileSync(join(process.cwd(), 'src/components/Layout.jsx'), 'utf8');
  const aiSummary = readFileSync(
    join(process.cwd(), 'src/components/patient/AIPatientDashboardSummary.jsx'),
    'utf8',
  );

  it('getDashboardData exposes recentCompletedVisits and carePlans', () => {
    expect(getDashboard).toMatch(/recentCompletedVisits/);
    expect(getDashboard).toMatch(/carePlans/);
    expect(getDashboard).toMatch(/status:\s*'completed'/);
  });

  it('Dashboard merges alert visits and passes carePlans to RealTimePatientAlerts', () => {
    expect(dashboard).toMatch(/alertVisits/);
    expect(dashboard).toMatch(/carePlans=\{carePlans\}/);
    expect(dashboard).toMatch(/visits=\{alertVisits\}/);
  });

  it('a failed alert read reaches the priority builder as an error', () => {
    // getScopedPatientAlerts and getDashboardData are two reads. If only the
    // first fails, an empty alert list is indistinguishable from no high-risk
    // patients once it reaches buildTodayPriorities, so the tile would report
    // all clear rather than saying it could not tell. The builder's error input
    // therefore has to carry both.
    expect(dashboard).toMatch(/error:\s*patientAlertsError/);
    expect(dashboard).toMatch(/hasDataError\s*=\s*visitsError\s*\|\|\s*patientsError\s*\|\|\s*patientAlertsError/);
    expect(dashboard).toMatch(/dashboardError=\{hasDataError\}/);
  });

  it('Incidents list uses a high limit before agency post-filter', () => {
    expect(incidentsPage).toMatch(/Incident\.list\("-created_date",\s*5000\)/);
    expect(incidentsPage).not.toMatch(/Incident\.list\("-created_date",\s*10\)/);
    expect(incidentsPage).not.toMatch(/Incident\.list\("-created_date",\s*500\)/);
  });

  it('Layout does not preload patient alerts outside a purpose-bound tenant broker', () => {
    expect(layout).not.toMatch(/getScopedPatientAlerts/);
    expect(layout).not.toMatch(/entities\.PatientAlert/);
    expect(layout).not.toMatch(/PatientAlert\.filter\(\{\s*status:\s*'active'\s*\},\s*'-created_date',\s*50\)/);
  });

  it('AIPatientDashboardSummary does not auto-fire AI on mount', () => {
    // Must keep a Generate button path, but must not call generateSummary from a
    // patient-driven useEffect (that re-fired on every visits/tasks settle).
    expect(aiSummary).toMatch(/Generate AI Summary/);
    expect(aiSummary).not.toMatch(/useEffect\(\s*\(\)\s*=>\s*\{\s*if\s*\(patient\)\s*\{\s*generateSummary\(\)/);
  });
});
