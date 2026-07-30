import { describe, it, expect, vi, beforeEach } from 'vitest';

// The module imports the SDK + IndexedDB helpers at top level; stub them so the
// import is side-effect-free. drainSyncQueue takes injectable deps, so the tests
// drive fakes directly rather than through these mocks.
vi.mock('@/api/base44Client', () => ({ base44: { entities: {}, functions: {} } }));
vi.mock('@/lib/indexedDB', () => ({
  getSyncQueue: vi.fn(async () => []),
  removeFromSyncQueue: vi.fn(async () => {}),
}));

import { drainSyncQueue } from './offlineSync';

// A fake queue that removeItem mutates, plus fake entities that record calls.
function harness(items, entityOverrides = {}, functionOverrides = {}) {
  let queue = [...items];
  const removeItem = vi.fn(async (id) => { queue = queue.filter((i) => i.id !== id); });
  const getQueue = async () => queue;

  const entities = {
    Visit: {
      create: vi.fn(async (p) => ({ id: 'visit-new', ...p })),
      update: vi.fn(async () => ({})),
      filter: vi.fn(async () => []),
      ...entityOverrides.Visit,
    },
    ComplianceAudit: {
      create: vi.fn(async () => ({ id: 'audit-new' })),
      update: vi.fn(async () => ({})),
      filter: vi.fn(async () => []),
      ...entityOverrides.ComplianceAudit,
    },
    NoteConversion: {
      create: vi.fn(async () => ({ id: 'nc-new' })),
      ...entityOverrides.NoteConversion,
    },
    Task: { create: vi.fn(async () => ({ id: 'task-new' })), filter: vi.fn(async () => []), ...entityOverrides.Task },
    Incident: { create: vi.fn(async () => ({ id: 'inc-new' })), filter: vi.fn(async () => []), ...entityOverrides.Incident },
  };

  const functions = {
    invoke: vi.fn(async () => ({ data: { success: true } })),
    ...functionOverrides,
  };

  return { entities, functions, getQueue, removeItem, remaining: () => queue };
}

describe('drainSyncQueue', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a Visit + ComplianceAudit for a CREATE_VISIT and clears the item', async () => {
    const h = harness([
      { id: 1, action: 'CREATE_VISIT', payload: { client_request_id: 'rq-1', patient_id: 'p1', nurse_notes: 'n', __audit: { nurse_email: 'x@y.z' } } },
    ]);
    const res = await drainSyncQueue(h);
    expect(res.synced).toBe(1);
    expect(h.entities.Visit.create).toHaveBeenCalledTimes(1);
    // __audit is peeled off the Visit payload.
    expect(h.entities.Visit.create.mock.calls[0][0]).not.toHaveProperty('__audit');
    expect(h.entities.ComplianceAudit.create).toHaveBeenCalledTimes(1);
    expect(h.removeItem).toHaveBeenCalledWith(1);
    expect(h.remaining()).toHaveLength(0);
  });

  it('appends patient note history and NoteConversion on CREATE_VISIT when meta is present', async () => {
    const h = harness([
      {
        id: 10,
        action: 'CREATE_VISIT',
        payload: {
          client_request_id: 'rq-hist',
          patient_id: 'p1',
          nurse_notes: 'final',
          __audit: { nurse_email: 'n@e.com' },
          __history: {
            mode: 'append',
            patient_id: 'p1',
            clinical_notes: 'final',
            entry: { entry_id: 'e1', note: 'final', compliance_score: 90 },
          },
          __noteConversion: { quality_score: 90, patient_id: 'p1' },
        },
      },
    ]);
    const res = await drainSyncQueue(h);
    expect(res.synced).toBe(1);
    expect(h.functions.invoke).toHaveBeenCalledWith('appendPatientNoteHistory', expect.objectContaining({
      patient_id: 'p1', mode: 'append',
      entry: expect.objectContaining({ entry_id: 'e1', visit_id: 'visit-new', note: 'final' }),
    }));
    expect(h.entities.NoteConversion.create).toHaveBeenCalledWith({ quality_score: 90, patient_id: 'p1' });
    // Meta keys never reach Visit.create.
    expect(h.entities.Visit.create.mock.calls[0][0]).not.toHaveProperty('__history');
    expect(h.entities.Visit.create.mock.calls[0][0]).not.toHaveProperty('__noteConversion');
  });

  it('reuses an existing Visit (idempotency) and still applies history, skips NoteConversion', async () => {
    const h = harness(
      [{
        id: 1,
        action: 'CREATE_VISIT',
        payload: {
          client_request_id: 'rq-1',
          patient_id: 'p1',
          __audit: { a: 1 },
          __history: { mode: 'append', patient_id: 'p1', entry: { entry_id: 'e2', note: 'n' } },
          __noteConversion: { quality_score: 1 },
        },
      }],
      {
        Visit: { filter: vi.fn(async () => [{ id: 'existing-visit' }]) },
        ComplianceAudit: { filter: vi.fn(async () => [{ id: 'a1' }]) },
      },
    );
    const res = await drainSyncQueue(h);
    expect(res.synced).toBe(1);
    expect(h.entities.Visit.filter).toHaveBeenCalledWith({ client_request_id: 'rq-1' });
    expect(h.entities.Visit.create).not.toHaveBeenCalled();
    expect(h.entities.ComplianceAudit.create).not.toHaveBeenCalled();
    expect(h.functions.invoke).toHaveBeenCalledWith('appendPatientNoteHistory', expect.objectContaining({
      entry: expect.objectContaining({ visit_id: 'existing-visit', entry_id: 'e2' }),
    }));
    // NoteConversion only on first create — reuse path already had a chance.
    expect(h.entities.NoteConversion.create).not.toHaveBeenCalled();
  });

  it('updates the Visit in place for UPDATE_VISIT and reconciles the audit + history', async () => {
    const h = harness(
      [{
        id: 2,
        action: 'UPDATE_VISIT',
        payload: {
          visit_id: 'v9',
          nurse_notes: 'edited',
          __audit: { status: 'passed' },
          __history: { mode: 'update', patient_id: 'p1', entry: { visit_id: 'v9', note: 'edited' } },
        },
      }],
      { ComplianceAudit: { filter: vi.fn(async () => [{ id: 'a9' }]) } },
    );
    const res = await drainSyncQueue(h);
    expect(res.synced).toBe(1);
    expect(h.entities.Visit.update).toHaveBeenCalledWith('v9', expect.objectContaining({ nurse_notes: 'edited' }));
    expect(h.entities.Visit.update.mock.calls[0][1]).not.toHaveProperty('__audit');
    expect(h.entities.ComplianceAudit.update).toHaveBeenCalledWith('a9', expect.objectContaining({ status: 'passed' }));
    expect(h.entities.Visit.create).not.toHaveBeenCalled();
    expect(h.functions.invoke).toHaveBeenCalledWith('appendPatientNoteHistory', expect.objectContaining({
      mode: 'update', entry: expect.objectContaining({ visit_id: 'v9' }),
    }));
  });

  it('drops a malformed UPDATE_VISIT with no visit_id (never processable)', async () => {
    const h = harness([{ id: 3, action: 'UPDATE_VISIT', payload: { nurse_notes: 'orphan' } }]);
    const res = await drainSyncQueue(h);
    expect(res.synced).toBe(0);
    expect(h.entities.Visit.update).not.toHaveBeenCalled();
    expect(h.removeItem).toHaveBeenCalledWith(3);
    expect(h.remaining()).toHaveLength(0);
  });

  it('creates a Task for CREATE_TASK', async () => {
    const h = harness([{ id: 4, action: 'CREATE_TASK', payload: { patient_id: 'p1', task_type: 'follow_up' } }]);
    const res = await drainSyncQueue(h);
    expect(res.synced).toBe(1);
    expect(h.entities.Task.create).toHaveBeenCalledWith({ patient_id: 'p1', task_type: 'follow_up' });
    expect(h.removeItem).toHaveBeenCalledWith(4);
  });

  it('creates an Incident for CREATE_INCIDENT and strips local created_offline flag', async () => {
    const h = harness([{ id: 5, action: 'CREATE_INCIDENT', payload: { patient_id: 'p1', incident_type: 'fall', created_offline: true } }]);
    const res = await drainSyncQueue(h);
    expect(res.synced).toBe(1);
    expect(h.entities.Incident.create).toHaveBeenCalledTimes(1);
    expect(h.entities.Incident.create.mock.calls[0][0]).not.toHaveProperty('created_offline');
    expect(h.entities.Incident.create.mock.calls[0][0]).toMatchObject({ patient_id: 'p1', incident_type: 'fall' });
    expect(h.removeItem).toHaveBeenCalledWith(5);
  });

  it('dedupes CREATE_TASK on client_request_id (interrupted/multi-tab retry does not double-create)', async () => {
    const h = harness(
      [{ id: 40, action: 'CREATE_TASK', payload: { client_request_id: 'tk-1', title: 't' } }],
      { Task: { filter: vi.fn(async () => [{ id: 'existing-task' }]) } },
    );
    const res = await drainSyncQueue(h);
    expect(res.synced).toBe(1);
    expect(h.entities.Task.filter).toHaveBeenCalledWith({ client_request_id: 'tk-1' });
    expect(h.entities.Task.create).not.toHaveBeenCalled();
    expect(h.removeItem).toHaveBeenCalledWith(40);
  });

  it('creates CREATE_TASK with a client_request_id when none exists yet (filter empty)', async () => {
    const h = harness([{ id: 41, action: 'CREATE_TASK', payload: { client_request_id: 'tk-2', title: 't' } }]);
    const res = await drainSyncQueue(h);
    expect(res.synced).toBe(1);
    expect(h.entities.Task.filter).toHaveBeenCalledWith({ client_request_id: 'tk-2' });
    expect(h.entities.Task.create).toHaveBeenCalledTimes(1);
  });

  it('dedupes CREATE_INCIDENT on client_request_id (no duplicate safety event)', async () => {
    const h = harness(
      [{ id: 42, action: 'CREATE_INCIDENT', payload: { client_request_id: 'ic-1', incident_type: 'fall' } }],
      { Incident: { filter: vi.fn(async () => [{ id: 'existing-inc' }]) } },
    );
    const res = await drainSyncQueue(h);
    expect(res.synced).toBe(1);
    expect(h.entities.Incident.filter).toHaveBeenCalledWith({ client_request_id: 'ic-1' });
    expect(h.entities.Incident.create).not.toHaveBeenCalled();
    expect(h.removeItem).toHaveBeenCalledWith(42);
  });

  it('leaves an unknown action in the queue for inspection (no handler)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = harness([{ id: 6, action: 'DELETE_UNIVERSE', payload: {} }]);
    const res = await drainSyncQueue(h);
    expect(res.synced).toBe(0);
    expect(h.removeItem).not.toHaveBeenCalled();
    expect(h.remaining()).toHaveLength(1);
    warn.mockRestore();
  });

  it('aborts the pass on a failing item, keeping it and everything after it queued', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = harness(
      [
        { id: 7, action: 'CREATE_TASK', payload: { a: 1 } },
        { id: 8, action: 'CREATE_TASK', payload: { b: 2 } },
      ],
      { Task: { create: vi.fn().mockRejectedValueOnce(new Error('boom')) } },
    );
    const res = await drainSyncQueue(h);
    expect(res.error).toBeInstanceOf(Error);
    expect(res.synced).toBe(0);
    expect(h.removeItem).not.toHaveBeenCalled();
    expect(h.remaining()).toHaveLength(2);
    err.mockRestore();
  });

  it('coalesces concurrent callers onto a single in-flight drain (no double-processing)', async () => {
    const h = harness([{ id: 9, action: 'CREATE_TASK', payload: { a: 1 } }]);
    const [r1, r2] = await Promise.all([drainSyncQueue(h), drainSyncQueue(h)]);
    expect(h.entities.Task.create).toHaveBeenCalledTimes(1);
    expect(h.removeItem).toHaveBeenCalledTimes(1);
    expect(r1.synced).toBe(1);
    expect(r2.synced).toBe(1);
    expect(r1.coalesced).toBeFalsy();
    expect(r2.coalesced).toBe(true);
  });
});
