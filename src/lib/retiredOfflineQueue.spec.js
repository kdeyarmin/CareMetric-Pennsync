import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/api/base44Client', () => ({ base44: { entities: {}, functions: {} } }));
// The legacy localStorage sweep itself is covered by offlineMigration.spec.js.
// It's stubbed here so these tests can assert the RETIREMENT decision: what gets
// staged, and — critically — whether the legacy stores are committed (deleted) or
// left in place when the flush doesn't complete.
const mig = vi.hoisted(() => ({ actions: [], cleared: 0 }));
vi.mock('@/lib/offlineMigration', () => ({
  migrateLegacyOfflineQueues: async ({ enqueue }) => {
    for (const [action, payload] of mig.actions) await enqueue(action, payload);
    return { migrated: mig.actions.length, clearMigratedStores: () => { mig.cleared += 1; } };
  },
}));

import { flushAndRetireOfflineQueue } from './retiredOfflineQueue';

function harness(queue = [], { online = true } = {}) {
  const created = { Visit: [], Task: [], Incident: [], NoteConversion: [], ComplianceAudit: [] };
  const entities = {
    Visit: {
      create: vi.fn(async (p) => { created.Visit.push(p); return { id: 'visit-1', ...p }; }),
      update: vi.fn(async () => ({})),
      filter: vi.fn(async () => []),
    },
    Task: { create: vi.fn(async (p) => { created.Task.push(p); return p; }), filter: vi.fn(async () => []) },
    Incident: { filter: vi.fn(async () => []) },
    NoteConversion: { create: vi.fn(async (p) => { created.NoteConversion.push(p); return p; }) },
    ComplianceAudit: {
      create: vi.fn(async (p) => { created.ComplianceAudit.push(p); return { id: 'audit-1' }; }),
      update: vi.fn(async () => ({})),
      filter: vi.fn(async () => []),
    },
  };
  return {
    created,
    entities,
    functions: { invoke: vi.fn(async () => ({ data: {} })) },
    getQueue: vi.fn(async () => queue),
    deleteDatabase: vi.fn(async () => {}),
    unregisterWorker: vi.fn(async () => {}),
    isOnline: () => online,
  };
}

describe('flushAndRetireOfflineQueue', () => {
  beforeEach(() => {
    localStorage.clear();
    mig.actions = [];
    mig.cleared = 0;
  });

  it('retires immediately when the device has nothing queued', async () => {
    const h = harness([]);
    const result = await flushAndRetireOfflineQueue(h);
    expect(result).toMatchObject({ retired: true, flushed: 0 });
    expect(h.deleteDatabase).toHaveBeenCalled();
    expect(h.unregisterWorker).toHaveBeenCalled();
  });

  it('uploads a queued visit — with its audit, history and conversion — before deleting', async () => {
    const h = harness([{
      action: 'CREATE_VISIT',
      payload: {
        client_request_id: 'req-1', patient_id: 'p1', nurse_notes: 'documented in the field',
        __audit: { status: 'pending_review' },
        __history: { patient_id: 'p1', mode: 'append', clinical_notes: 'documented in the field', entry: { entry_id: 'h1' } },
        __noteConversion: { quality_score: 88 },
      },
    }]);

    const result = await flushAndRetireOfflineQueue(h);

    expect(result).toMatchObject({ retired: true, flushed: 1, pending: 0 });
    expect(h.created.Visit[0]).toMatchObject({ client_request_id: 'req-1', nurse_notes: 'documented in the field' });
    // Offline-only meta must not be written onto the Visit itself.
    expect(h.created.Visit[0].__audit).toBeUndefined();
    expect(h.created.Visit[0].__history).toBeUndefined();
    expect(h.created.NoteConversion).toHaveLength(1);
    expect(h.created.ComplianceAudit[0]).toMatchObject({ visit_id: 'visit-1', status: 'pending_review' });
    expect(h.functions.invoke).toHaveBeenCalledWith('appendPatientNoteHistory', expect.objectContaining({ patient_id: 'p1' }));
    expect(h.deleteDatabase).toHaveBeenCalled();
  });

  it('KEEPS the queue when the device is offline, so nothing is destroyed unsent', async () => {
    const h = harness([{ action: 'CREATE_VISIT', payload: { client_request_id: 'req-1' } }], { online: false });

    const result = await flushAndRetireOfflineQueue(h);

    expect(result).toMatchObject({ retired: false, pending: 1 });
    expect(h.deleteDatabase).not.toHaveBeenCalled();
    expect(h.entities.Visit.create).not.toHaveBeenCalled();
  });

  it('KEEPS the queue when an upload fails part-way', async () => {
    const h = harness([
      { action: 'CREATE_TASK', payload: { client_request_id: 't1' } },
      { action: 'CREATE_TASK', payload: { client_request_id: 't2' } },
    ]);
    h.entities.Task.create.mockImplementationOnce(async (p) => p).mockImplementationOnce(() => {
      throw new Error('server rejected');
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await flushAndRetireOfflineQueue(h);

    expect(result).toMatchObject({ retired: false, flushed: 1, pending: 1 });
    expect(h.deleteDatabase).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('does not re-create a visit a previous interrupted run already wrote', async () => {
    const h = harness([{ action: 'CREATE_VISIT', payload: { client_request_id: 'req-1', patient_id: 'p1' } }]);
    h.entities.Visit.filter.mockResolvedValue([{ id: 'visit-existing' }]);

    const result = await flushAndRetireOfflineQueue(h);

    expect(result.retired).toBe(true);
    expect(h.entities.Visit.create).not.toHaveBeenCalled();
    // The conversion row belongs to the original create, not this retry.
    expect(h.created.NoteConversion).toHaveLength(0);
  });

  it('updates — never duplicates — a visit that already exists server-side', async () => {
    const h = harness([{ action: 'UPDATE_VISIT', payload: { visit_id: 'visit-7', nurse_notes: 'edited offline' } }]);

    await flushAndRetireOfflineQueue(h);

    expect(h.entities.Visit.update).toHaveBeenCalledWith('visit-7', expect.objectContaining({ nurse_notes: 'edited offline' }));
    expect(h.entities.Visit.create).not.toHaveBeenCalled();
  });

  it('routes a queued incident through the backend, which owns that write', async () => {
    const h = harness([{ action: 'CREATE_INCIDENT', payload: { client_request_id: 'i1', description: 'fall' } }]);

    await flushAndRetireOfflineQueue(h);

    expect(h.functions.invoke).toHaveBeenCalledWith('submitIncidentReport', expect.objectContaining({ description: 'fall' }));
  });

  it('runs only once per browser', async () => {
    const first = harness([]);
    await flushAndRetireOfflineQueue(first);

    const second = harness([{ action: 'CREATE_TASK', payload: {} }]);
    const result = await flushAndRetireOfflineQueue(second);

    expect(result).toMatchObject({ retired: true, flushed: 0 });
    expect(second.getQueue).not.toHaveBeenCalled();
  });

  // ── The legacy localStorage stores are committed only after a complete flush ──
  // Regression: the migration used to delete each store the moment its items were
  // mapped. Staging is not sending, so any run that stopped short — offline, or a
  // rejected write — destroyed unsynced field documentation.

  it('does NOT clear the legacy localStorage stores when the device is offline', async () => {
    mig.actions = [['CREATE_VISIT', { client_request_id: 'legacy-1', patient_id: 'p1', nurse_notes: 'field note' }]];
    const h = harness([], { online: false });

    const result = await flushAndRetireOfflineQueue(h);

    expect(result).toMatchObject({ retired: false, pending: 1 });
    expect(mig.cleared).toBe(0);
    expect(h.deleteDatabase).not.toHaveBeenCalled();
    expect(h.entities.Visit.create).not.toHaveBeenCalled();
  });

  it('does NOT clear them when an upload fails part-way', async () => {
    mig.actions = [['CREATE_VISIT', { client_request_id: 'legacy-1', patient_id: 'p1' }]];
    const h = harness([]);
    h.entities.Visit.create.mockImplementation(() => { throw new Error('server rejected'); });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await flushAndRetireOfflineQueue(h);

    expect(result).toMatchObject({ retired: false, flushed: 0 });
    expect(mig.cleared).toBe(0);
    expect(h.deleteDatabase).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('clears them once every migrated write has reached the server', async () => {
    mig.actions = [['CREATE_VISIT', { client_request_id: 'legacy-1', patient_id: 'p1', nurse_notes: 'field note' }]];
    const h = harness([]);

    const result = await flushAndRetireOfflineQueue(h);

    expect(result).toMatchObject({ retired: true, flushed: 1, pending: 0 });
    expect(h.created.Visit[0]).toMatchObject({ client_request_id: 'legacy-1', nurse_notes: 'field note' });
    expect(mig.cleared).toBe(1);
    expect(h.deleteDatabase).toHaveBeenCalled();
  });
});
