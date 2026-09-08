import { describe, expect, it, vi } from 'vitest';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

const MALFORMED_BODY = Symbol('malformed body');

function todayEastern() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function fixtureRows() {
  const today = todayEastern();
  return {
    Patient: [
      {
        id: 'patient-owned',
        created_by: 'OWNER@example.com',
        assigned_nurses: [],
        status: 'active',
        updated_date: '2026-08-03T00:00:00Z',
      },
      {
        id: 'patient-assigned',
        created_by: 'other@example.com',
        assigned_nurses: ['Owner@Example.com'],
        status: 'active',
        updated_date: '2026-08-02T00:00:00Z',
      },
      {
        id: 'patient-foreign',
        created_by: 'foreign@example.com',
        assigned_nurses: ['foreign@example.com'],
        status: 'active',
        updated_date: '2026-08-01T00:00:00Z',
      },
      {
        id: 'patient-inactive',
        created_by: 'owner@example.com',
        assigned_nurses: [],
        status: 'discharged',
        updated_date: '2026-08-04T00:00:00Z',
      },
    ],
    Visit: [
      {
        id: 'visit-today-owned',
        patient_id: 'patient-owned',
        visit_date: today,
        status: 'scheduled',
      },
      {
        id: 'visit-wrong-day',
        patient_id: 'patient-owned',
        visit_date: '2020-01-01',
        status: 'scheduled',
      },
      {
        id: 'visit-today-foreign',
        patient_id: 'patient-foreign',
        visit_date: today,
        status: 'scheduled',
      },
      {
        id: 'visit-completed-owned',
        patient_id: 'patient-owned',
        visit_date: '2026-07-30',
        status: 'completed',
      },
      {
        id: 'visit-not-completed',
        patient_id: 'patient-assigned',
        visit_date: '2026-07-29',
        status: 'scheduled',
      },
    ],
    Incident: [
      { id: 'incident-owned', patient_id: 'patient-assigned' },
      { id: 'incident-foreign', patient_id: 'patient-foreign' },
    ],
    CarePlan: [
      { id: 'plan-owned', patient_id: 'patient-owned', status: 'active' },
      { id: 'plan-inactive', patient_id: 'patient-owned', status: 'completed' },
      { id: 'plan-foreign', patient_id: 'patient-foreign', status: 'active' },
    ],
    PatientAlert: [
      {
        id: 'alert-owned',
        patient_id: 'patient-owned',
        status: 'active',
        severity: 'high',
      },
      {
        id: 'alert-assigned',
        patient_id: 'patient-assigned',
        status: 'active',
        severity: 'critical',
      },
      {
        id: 'alert-foreign',
        patient_id: 'patient-foreign',
        status: 'active',
        severity: 'high',
      },
      {
        id: 'alert-resolved',
        patient_id: 'patient-owned',
        status: 'resolved',
        severity: 'high',
      },
      {
        id: 'alert-low',
        patient_id: 'patient-owned',
        status: 'active',
        severity: 'low',
      },
    ],
    User: [],
  };
}

async function invokeFunction(functionName, {
  user,
  rows = {},
  body = {},
  superAdminEmail = '',
  failures = [],
  updateResult,
} = {}) {
  const sourceUrl = new URL(
    '../../../base44/functions/' + functionName + '/entry.ts',
    import.meta.url,
  );
  let source = await readFile(sourceUrl, 'utf8');
  const originalSource = source;
  source = source.replace(
    /import\s+\{\s*createClientFromRequest\s*\}\s+from\s+'npm:[^']+';?/,
    'const createClientFromRequest = globalThis.__dashboardSecurityMakeClient;',
  );
  if (source === originalSource) throw new Error('Base44 SDK import was not replaced');

  const temporaryModule = join(
    process.cwd(),
    'src/components/dashboard',
    [
      'dashboard_security',
      functionName,
      process.pid,
      Date.now(),
      Math.random().toString(36).slice(2),
    ].join('_') + '.mjs',
  );
  // These handlers intentionally use JavaScript syntax in .ts files. After the
  // SDK import is replaced, Node can execute the source directly; the separate
  // backend transpile check remains the deploy-syntax gate.
  await writeFile(temporaryModule, source);

  const failureSet = new Set(failures);
  const calls = { json: 0, service: [] };
  const entities = {};
  const entityNames = ['Patient', 'Visit', 'Incident', 'CarePlan', 'PatientAlert', 'User'];
  const read = async (entity, method, args) => {
    calls.service.push({ entity, method, args });
    if (failureSet.has(entity + '.' + method)) {
      throw new Error('simulated ' + entity + '.' + method + ' failure');
    }
    return rows[entity] ?? [];
  };
  for (const entity of entityNames) {
    entities[entity] = {
      filter: (...args) => read(entity, 'filter', args),
      list: (...args) => read(entity, 'list', args),
    };
  }
  entities.PatientAlert.update = async (...args) => {
    calls.service.push({ entity: 'PatientAlert', method: 'update', args });
    if (failureSet.has('PatientAlert.update')) throw new Error('simulated update failure');
    if (typeof updateResult === 'function') return updateResult(...args);
    if (updateResult !== undefined) return updateResult;
    const stored = (rows.PatientAlert ?? []).find((alert) => alert.id === args[0]) ?? {};
    return { ...stored, ...args[1], id: args[0] };
  };

  const client = {
    auth: { me: async () => user },
    asServiceRole: { entities },
  };
  const previousClientFactory = globalThis.__dashboardSecurityMakeClient;
  const previousDeno = globalThis.Deno;
  let handler;
  globalThis.__dashboardSecurityMakeClient = () => client;
  globalThis.Deno = {
    serve: (candidate) => { handler = candidate; },
    env: {
      get: (name) => name === 'SUPER_ADMIN_EMAIL' ? superAdminEmail : undefined,
    },
  };

  try {
    await import(/* @vite-ignore */ pathToFileURL(temporaryModule).href);
    if (typeof handler !== 'function') throw new Error('Deno handler was not registered');
    const response = await handler({
      json: async () => {
        calls.json += 1;
        if (body === MALFORMED_BODY) throw new Error('malformed JSON');
        return body;
      },
    });
    return { response, json: await response.json(), calls };
  } finally {
    if (previousClientFactory === undefined) {
      delete globalThis.__dashboardSecurityMakeClient;
    } else {
      globalThis.__dashboardSecurityMakeClient = previousClientFactory;
    }
    if (previousDeno === undefined) {
      delete globalThis.Deno;
    } else {
      globalThis.Deno = previousDeno;
    }
    await unlink(temporaryModule).catch(() => {});
  }
}

const serviceCalls = (calls, entity, method) => calls.service.filter(
  (call) => call.entity === entity && call.method === method,
);
const rowIds = (rows) => rows.map((row) => row.id);

describe('dashboard and alert function authorization', () => {
  it('keeps forged custom claims and ordinary admins in direct patient scope', async () => {
    const callers = [
      {
        email: 'Owner@Example.com',
        role: 'user',
        account_type: 'super_admin',
        agency_name: 'Victim Agency',
        agency_id: 'victim-agency',
        is_active: true,
      },
      {
        email: 'Owner@Example.com',
        role: 'admin',
        account_type: 'agency_admin',
        agency_name: '',
        agency_id: 'victim-agency',
        is_active: true,
      },
    ];

    for (const user of callers) {
      const { response, json, calls } = await invokeFunction('getDashboardData', {
        user,
        rows: fixtureRows(),
        superAdminEmail: user.role === 'user'
          ? 'owner@example.com'
          : 'platform-owner@example.com',
      });

      expect(response.status).toBe(200);
      expect(rowIds(json.patients)).toEqual(['patient-owned', 'patient-assigned']);
      expect(rowIds(json.visits)).toEqual(['visit-today-owned']);
      expect(rowIds(json.incidents)).toEqual(['incident-owned']);
      expect(rowIds(json.recentCompletedVisits)).toEqual(['visit-completed-owned']);
      expect(rowIds(json.carePlans)).toEqual(['plan-owned']);
      expect(serviceCalls(calls, 'Incident', 'list')).toHaveLength(0);
      expect(serviceCalls(calls, 'User', 'list')).toHaveLength(0);
    }
  });

  it('allows platform dashboard scope only to the configured protected superadmin', async () => {
    const rows = fixtureRows();
    rows.Incident.push(null);
    const { response, json, calls } = await invokeFunction('getDashboardData', {
      user: { email: ' Platform-Owner@Example.com ', role: 'admin', is_active: true },
      rows,
      superAdminEmail: 'platform-owner@example.com',
    });

    expect(response.status).toBe(200);
    expect(rowIds(json.patients)).toEqual([
      'patient-owned',
      'patient-assigned',
      'patient-foreign',
    ]);
    expect(rowIds(json.visits)).toEqual(['visit-today-owned', 'visit-today-foreign']);
    expect(rowIds(json.incidents)).toEqual(['incident-owned', 'incident-foreign']);
    expect(rowIds(json.recentCompletedVisits)).toEqual(['visit-completed-owned']);
    expect(rowIds(json.carePlans)).toEqual(['plan-owned', 'plan-foreign']);
    expect(serviceCalls(calls, 'Incident', 'list')).toHaveLength(1);
  });

  it('re-filters bulk alerts by direct patient access, status, and severity', async () => {
    const callers = [
      {
        email: 'owner@example.com',
        role: 'user',
        account_type: 'super_admin',
        agency_name: 'Victim Agency',
        agency_id: 'victim-agency',
        is_active: true,
      },
      {
        email: 'owner@example.com',
        role: 'admin',
        account_type: 'agency_admin',
        agency_name: '',
        agency_id: 'victim-agency',
        is_active: true,
      },
    ];

    for (const user of callers) {
      const { response, json, calls } = await invokeFunction('getScopedPatientAlerts', {
        user,
        rows: fixtureRows(),
        body: { status: 'active', severity: ['high', 'critical'], limit: 500 },
        superAdminEmail: user.role === 'user'
          ? 'owner@example.com'
          : 'platform-owner@example.com',
      });

      expect(response.status).toBe(200);
      expect(rowIds(json.alerts)).toEqual(['alert-owned', 'alert-assigned']);
      expect(serviceCalls(calls, 'PatientAlert', 'list')).toHaveLength(0);
      expect(serviceCalls(calls, 'User', 'list')).toHaveLength(0);
    }
  });

  it('grants protected superadmin bulk alerts and enforces the hard output cap', async () => {
    const rows = fixtureRows();
    rows.PatientAlert = Array.from({ length: 510 }, (_, index) => ({
      id: 'global-alert-' + index,
      patient_id: index % 2 ? 'patient-foreign' : 'patient-owned',
      status: 'active',
      severity: 'high',
    }));
    rows.PatientAlert.push({
      id: 'predicate-mismatch',
      patient_id: 'patient-foreign',
      status: 'resolved',
      severity: 'low',
    });

    const { response, json, calls } = await invokeFunction('getScopedPatientAlerts', {
      user: { email: 'PLATFORM-owner@example.com', role: 'admin', is_active: true },
      rows,
      body: { status: 'active', severity: ['high'], limit: 10000 },
      superAdminEmail: 'platform-owner@example.com',
    });

    expect(response.status).toBe(200);
    expect(json.alerts).toHaveLength(500);
    expect(json.alerts.some((alert) => alert.patient_id === 'patient-foreign')).toBe(true);
    expect(json.alerts.every(
      (alert) => alert.status === 'active' && alert.severity === 'high',
    )).toBe(true);
    expect(serviceCalls(calls, 'Patient', 'filter')).toHaveLength(0);
  });

  it('rejects malformed and operator-shaped patient ids before service reads', async () => {
    const invalidBodies = [
      { patient_id: {} },
      { patient_id: [] },
      { patient_id: 42 },
      { patient_id: ' ' },
      { patient_id: 'x'.repeat(201) },
      MALFORMED_BODY,
    ];

    for (const body of invalidBodies) {
      const { response, calls } = await invokeFunction('getScopedPatientAlerts', {
        user: { email: 'owner@example.com', role: 'user', is_active: true },
        rows: fixtureRows(),
        body,
      });
      expect(response.status).toBe(400);
      expect(calls.service).toHaveLength(0);
    }
  });

  it('does not authorize a requested patient from a mismatched service row', async () => {
    const rows = fixtureRows();
    rows.Patient = [{
      id: 'different-patient',
      created_by: 'owner@example.com',
      assigned_nurses: [],
      status: 'active',
    }];

    const { response, calls } = await invokeFunction('getScopedPatientAlerts', {
      user: {
        email: 'owner@example.com',
        role: 'user',
        account_type: 'super_admin',
        agency_name: 'Victim Agency',
        is_active: true,
      },
      rows,
      body: { patient_id: 'patient-foreign' },
      superAdminEmail: 'platform-owner@example.com',
    });

    expect(response.status).toBe(403);
    expect(serviceCalls(calls, 'PatientAlert', 'filter')).toHaveLength(0);
  });

  it('preserves exact single-patient owner and assignment access', async () => {
    const { response, json } = await invokeFunction('getScopedPatientAlerts', {
      user: { email: 'OWNER@example.com', role: 'user', is_active: true },
      rows: fixtureRows(),
      body: {
        patient_id: 'patient-assigned',
        status: 'active',
        severity: ['critical'],
      },
    });

    expect(response.status).toBe(200);
    expect(rowIds(json.alerts)).toEqual(['alert-assigned']);
  });

  it('turns scoped read failures into errors rather than reassuring empty data', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const dashboard = await invokeFunction('getDashboardData', {
        user: { email: 'owner@example.com', role: 'user', is_active: true },
        rows: fixtureRows(),
        failures: ['Patient.filter'],
      });
      expect(dashboard.response.status).toBe(500);
      expect(dashboard.json).toEqual({ error: 'Failed to load dashboard data' });

      const alerts = await invokeFunction('getScopedPatientAlerts', {
        user: { email: 'owner@example.com', role: 'user', is_active: true },
        rows: fixtureRows(),
        body: {},
        failures: ['Patient.filter'],
      });
      expect(alerts.response.status).toBe(500);
      expect(alerts.json).toEqual({ error: 'Failed to load alerts' });
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('fails closed before parsing or service-role access without caller email', async () => {
    for (const functionName of [
      'getDashboardData',
      'getScopedPatientAlerts',
      'updateScopedPatientAlert',
    ]) {
      const { response, calls } = await invokeFunction(functionName, {
        user: {
          role: 'admin',
          account_type: 'super_admin',
          agency_name: '',
          agency_id: 'victim-agency',
          is_active: true,
        },
        rows: fixtureRows(),
        body: { alert_id: 'alert-owned', action: 'dismiss' },
        superAdminEmail: 'platform-owner@example.com',
      });

      expect(response.status).toBe(403);
      expect(calls.json).toBe(0);
      expect(calls.service).toHaveLength(0);
    }
  });

  it('updates alerts only through an exact directly accessible patient', async () => {
    const rows = fixtureRows();
    rows.PatientAlert = [
      { id: 'decoy-alert', patient_id: 'patient-owned', flagged_urgent: false },
      { id: 'target-alert', patient_id: 'patient-assigned', flagged_urgent: false },
    ];
    const { response, json, calls } = await invokeFunction('updateScopedPatientAlert', {
      user: { email: 'OWNER@example.com', role: 'user', is_active: true },
      rows,
      body: { alert_id: 'target-alert', action: 'toggle_flagged_urgent' },
    });

    expect(response.status).toBe(200);
    expect(json.alert.id).toBe('target-alert');
    expect(json.alert.flagged_urgent).toBe(true);
    expect(serviceCalls(calls, 'PatientAlert', 'update')[0].args).toEqual([
      'target-alert',
      { flagged_urgent: true },
    ]);
  });

  it('denies forged and ordinary-admin alert updates for foreign patients', async () => {
    const callers = [
      {
        email: 'attacker@example.com',
        role: 'user',
        account_type: 'super_admin',
        agency_name: 'Victim Agency',
        agency_id: 'victim-agency',
        is_active: true,
      },
      {
        email: 'attacker@example.com',
        role: 'admin',
        account_type: 'agency_admin',
        agency_name: '',
        agency_id: 'victim-agency',
        is_active: true,
      },
    ];

    for (const user of callers) {
      const rows = fixtureRows();
      rows.PatientAlert = [{
        id: 'foreign-alert',
        patient_id: 'patient-foreign',
        created_by: 'attacker@example.com',
      }];
      const { response, calls } = await invokeFunction('updateScopedPatientAlert', {
        user,
        rows,
        body: { alert_id: 'foreign-alert', action: 'dismiss' },
        superAdminEmail: 'platform-owner@example.com',
      });

      expect(response.status).toBe(403);
      expect(serviceCalls(calls, 'PatientAlert', 'update')).toHaveLength(0);
      expect(serviceCalls(calls, 'User', 'list')).toHaveLength(0);
    }
  });

  it('allows protected-superadmin alert updates but never returns a mismatched update row', async () => {
    const rows = fixtureRows();
    rows.PatientAlert = [{
      id: 'foreign-alert',
      patient_id: 'patient-foreign',
      status: 'active',
    }];
    const user = { email: 'platform-owner@example.com', role: 'admin', is_active: true };

    const allowed = await invokeFunction('updateScopedPatientAlert', {
      user,
      rows,
      body: { alert_id: 'foreign-alert', action: 'dismiss' },
      superAdminEmail: 'PLATFORM-OWNER@example.com',
    });
    expect(allowed.response.status).toBe(200);
    expect(allowed.json.alert.id).toBe('foreign-alert');
    expect(serviceCalls(allowed.calls, 'Patient', 'filter')).toHaveLength(0);

    const mismatched = await invokeFunction('updateScopedPatientAlert', {
      user,
      rows,
      body: { alert_id: 'foreign-alert', action: 'dismiss' },
      superAdminEmail: 'platform-owner@example.com',
      updateResult: { id: 'other-alert', title: 'foreign PHI' },
    });
    expect(mismatched.response.status).toBe(502);
    expect(mismatched.json).toEqual({ error: 'Failed to verify updated alert' });
  });

  it('requires the exact alert row before attempting patient authorization or update', async () => {
    const rows = fixtureRows();
    rows.PatientAlert = [{ id: 'different-alert', patient_id: 'patient-owned' }];
    const { response, calls } = await invokeFunction('updateScopedPatientAlert', {
      user: { email: 'owner@example.com', role: 'user', is_active: true },
      rows,
      body: { alert_id: 'requested-alert', action: 'acknowledge' },
    });

    expect(response.status).toBe(404);
    expect(serviceCalls(calls, 'Patient', 'filter')).toHaveLength(0);
    expect(serviceCalls(calls, 'PatientAlert', 'update')).toHaveLength(0);
  });
});
