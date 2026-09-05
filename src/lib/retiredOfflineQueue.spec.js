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

function harness(queue = [], {
  online = true,
  legacyRecoveryEnabled = false,
  authenticatedUser = {
    id: 'user-1',
    email: 'nurse@example.com',
    is_active: true,
    is_verified: true,
  },
} = {}) {
  const created = { Visit: [], Task: [], Incident: [], NoteConversion: [], ComplianceAudit: [] };
  const order = [];
  const entities = {
    Visit: {
      create: vi.fn(async () => { throw new Error('direct Visit.create is disabled'); }),
      update: vi.fn(async () => ({})),
      filter: vi.fn(async () => []),
    },
    Task: { create: vi.fn(async (p) => { created.Task.push(p); return p; }), filter: vi.fn(async () => []) },
    Incident: { filter: vi.fn(async () => []) },
    NoteConversion: {
      create: vi.fn(async (p) => {
        const row = {
          id: `conversion-${created.NoteConversion.length + 1}`,
          created_by: authenticatedUser?.email,
          ...p,
        };
        created.NoteConversion.push(row);
        return row;
      }),
      filter: vi.fn(async (query, _sort, limit) => {
        const rows = created.NoteConversion.filter((row) => (
          Object.entries(query || {}).every(([key, value]) => row?.[key] === value)
        ));
        return Number.isFinite(limit) ? rows.slice(0, limit) : rows;
      }),
    },
    ComplianceAudit: {
      create: vi.fn(async (p) => { created.ComplianceAudit.push(p); return { id: 'audit-1' }; }),
      update: vi.fn(async () => ({})),
      filter: vi.fn(async () => []),
    },
  };
  const functions = {
    invoke: vi.fn(async (name, payload) => {
      if (name === 'createAuthorizedVisit') {
        const existing = payload?.client_request_id
          ? created.Visit.find((row) => row.client_request_id === payload.client_request_id)
          : null;
        if (existing) return { data: { created: false, visit: existing } };
        const visit = {
          id: `visit-${created.Visit.length + 1}`,
          ...payload,
          agency_id: payload.agency_id || 'agency-1',
          created_by_user_id: authenticatedUser?.id,
          created_by_user_email_normalized: authenticatedUser?.email?.trim().toLowerCase(),
        };
        created.Visit.push(visit);
        return { data: { created: true, visit } };
      }
      if (name === 'updateAuthorizedVisit') {
        if (payload.action === 'legacy_recovery' && !legacyRecoveryEnabled) {
          throw new Error('Legacy Visit recovery is paused');
        }
        return {
          data: {
            updated: true,
            action: payload.action,
            visit: { id: payload.visit_id, patient_id: 'p1', agency_id: 'agency-1' },
          },
        };
      }
      return { data: {} };
    }),
  };
  return {
    created,
    order,
    entities,
    functions,
    getAuthenticatedUser: vi.fn(async () => authenticatedUser),
    getQueue: vi.fn(async () => queue),
    deleteDatabase: vi.fn(async () => { order.push('delete'); }),
    unregisterWorker: vi.fn(async () => {}),
    rescueDrafts: vi.fn(async () => { order.push('rescue'); return 0; }),
    isOnline: () => online,
  };
}

const noteVisit = ({
  id = 'queue-1',
  requestId = 'req-1',
  noteConversion = { quality_score: 88 },
  ...visitOverrides
} = {}) => ({
  id,
  action: 'CREATE_VISIT',
  payload: {
    client_request_id: requestId,
    patient_id: 'p1',
    visit_date: '2026-09-03',
    visit_type: 'routine_visit',
    ...visitOverrides,
    __noteConversion: noteConversion,
  },
});

const recoveryRequestId = ({
  userId = 'user-1',
  email = 'nurse@example.com',
  sourceRecordId = 'queue-1',
  visitRequestId = 'req-1',
  visitId = 'visit-1',
  agencyId = 'agency-1',
  patientId = 'p1',
  visitDate = '2026-09-03',
  visitType = 'routine_visit',
} = {}) => JSON.stringify([
  'legacy-note-conversion-v1',
  userId,
  email,
  sourceRecordId,
  visitRequestId,
  visitId,
  agencyId,
  patientId,
  visitDate,
  visitType,
]);

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

  it('keeps every retirement artifact while unresolved conflict work exists', async () => {
    localStorage.setItem('offline_conflicts', JSON.stringify([
      { id: 'conflict-1', localData: { nurse_notes: 'local' }, serverData: {} },
    ]));
    const h = harness([]);

    const result = await flushAndRetireOfflineQueue(h);

    expect(result).toEqual({ retired: false, flushed: 0, pending: 1 });
    expect(h.getQueue).not.toHaveBeenCalled();
    expect(h.deleteDatabase).not.toHaveBeenCalled();
    expect(h.unregisterWorker).not.toHaveBeenCalled();
    expect(localStorage.getItem('pennsync_offline_retired')).toBeNull();
  });

  it('keeps unknown queued actions instead of counting them as flushed', async () => {
    const h = harness([{ action: 'UNKNOWN_CLINICAL_WRITE', payload: { note: 'only copy' } }]);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await flushAndRetireOfflineQueue(h);

    expect(result).toEqual({ retired: false, flushed: 0, pending: 1 });
    expect(h.deleteDatabase).not.toHaveBeenCalled();
    expect(localStorage.getItem('pennsync_offline_retired')).toBeNull();
    error.mockRestore();
  });

  it('does not mark retirement complete when legacy database deletion fails', async () => {
    const h = harness([]);
    h.deleteDatabase.mockRejectedValueOnce(new Error('delete blocked'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await flushAndRetireOfflineQueue(h);

    expect(result).toEqual({ retired: false, flushed: 0, pending: 0 });
    expect(mig.cleared).toBe(0);
    expect(localStorage.getItem('pennsync_offline_retired')).toBeNull();
    error.mockRestore();
  });

  it('uploads a queued visit — with its audit, history and conversion — before deleting', async () => {
    const h = harness([noteVisit({
      nurse_notes: 'documented in the field',
      __audit: { status: 'pending_review' },
      __history: { patient_id: 'p1', mode: 'append', clinical_notes: 'documented in the field', entry: { entry_id: 'h1' } },
    })]);

    const result = await flushAndRetireOfflineQueue(h);

    expect(result).toMatchObject({ retired: true, flushed: 1, pending: 0 });
    expect(h.created.Visit[0]).toMatchObject({ client_request_id: 'req-1', nurse_notes: 'documented in the field' });
    // Offline-only meta must not be written onto the Visit itself.
    expect(h.created.Visit[0].__audit).toBeUndefined();
    expect(h.created.Visit[0].__history).toBeUndefined();
    expect(h.created.NoteConversion).toHaveLength(1);
    expect(h.created.NoteConversion[0]).toMatchObject({
      nurse_email: 'nurse@example.com',
      patient_id: 'p1',
      quality_score: 88,
      recovery_request_id: recoveryRequestId(),
    });
    expect(h.entities.NoteConversion.filter).toHaveBeenCalledWith(
      { recovery_request_id: recoveryRequestId() },
      '-created_date',
      2,
    );
    expect(h.created.ComplianceAudit[0]).toMatchObject({ visit_id: 'visit-1', status: 'pending_review' });
    expect(h.functions.invoke).toHaveBeenCalledWith('appendPatientNoteHistory', expect.objectContaining({ patient_id: 'p1' }));
    expect(h.deleteDatabase).toHaveBeenCalled();
  });

  it('keeps the queue and writes nothing when a queued conversion belongs to another user', async () => {
    const h = harness([noteVisit({
      id: 'queue-other-user',
      requestId: 'req-other-user',
      noteConversion: { nurse_email: 'other@example.com', quality_score: 88 },
    })]);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await flushAndRetireOfflineQueue(h);

    expect(result).toMatchObject({ retired: false, flushed: 0, pending: 1 });
    expect(h.created.Visit).toHaveLength(0);
    expect(h.created.NoteConversion).toHaveLength(0);
    expect(h.deleteDatabase).not.toHaveBeenCalled();
    expect(localStorage.getItem('pennsync_offline_retired')).toBeNull();
    error.mockRestore();
  });

  it('keeps the queue and writes nothing without an active authenticated identity', async () => {
    const h = harness([noteVisit({
      id: 'queue-no-auth',
      requestId: 'req-no-auth',
    })], { authenticatedUser: null });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await flushAndRetireOfflineQueue(h);

    expect(result).toMatchObject({ retired: false, flushed: 0, pending: 1 });
    expect(h.created.Visit).toHaveLength(0);
    expect(h.created.NoteConversion).toHaveLength(0);
    expect(h.deleteDatabase).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('retries a protected NoteConversion create after an exact authorized Visit replay', async () => {
    const queue = [noteVisit({
      id: 'queue-protected-create',
      requestId: 'req-protected-create',
    })];
    const h = harness(queue);
    h.entities.NoteConversion.create.mockRejectedValueOnce(new Error('RLS create rejected'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const first = await flushAndRetireOfflineQueue(h);

    expect(first).toMatchObject({ retired: false, flushed: 0, pending: 1 });
    expect(h.created.Visit).toHaveLength(1);
    expect(h.deleteDatabase).not.toHaveBeenCalled();
    expect(localStorage.getItem('pennsync_offline_retired')).toBeNull();

    const second = await flushAndRetireOfflineQueue(h);

    expect(second).toMatchObject({ retired: true, flushed: 1, pending: 0 });
    expect(h.created.Visit).toHaveLength(1);
    expect(h.created.NoteConversion).toHaveLength(1);
    expect(h.entities.NoteConversion.create).toHaveBeenCalledTimes(2);
    expect(h.created.NoteConversion[0].recovery_request_id).toBe(recoveryRequestId({
      sourceRecordId: 'queue-protected-create',
      visitRequestId: 'req-protected-create',
    }));
    expect(h.deleteDatabase).toHaveBeenCalledOnce();
    error.mockRestore();
  });

  it('dedupes a NoteConversion whose create committed before its response was lost', async () => {
    const queue = [noteVisit({ id: 'queue-lost-response', requestId: 'req-lost-response' })];
    const h = harness(queue);
    h.entities.NoteConversion.create.mockImplementationOnce(async (payload) => {
      h.created.NoteConversion.push({
        id: 'conversion-lost-response',
        created_by: 'nurse@example.com',
        ...payload,
      });
      throw new Error('response lost after commit');
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const first = await flushAndRetireOfflineQueue(h);
    const second = await flushAndRetireOfflineQueue(h);

    expect(first).toMatchObject({ retired: false, flushed: 0, pending: 1 });
    expect(second).toMatchObject({ retired: true, flushed: 1, pending: 0 });
    expect(h.created.Visit).toHaveLength(1);
    expect(h.created.NoteConversion).toHaveLength(1);
    expect(h.entities.NoteConversion.create).toHaveBeenCalledOnce();
    expect(h.entities.NoteConversion.filter).toHaveBeenLastCalledWith(
      {
        recovery_request_id: recoveryRequestId({
          sourceRecordId: 'queue-lost-response',
          visitRequestId: 'req-lost-response',
        }),
      },
      '-created_date',
      2,
    );
    error.mockRestore();
  });

  it('keeps the queue when a recovery key resolves to duplicate conversions', async () => {
    const queue = [noteVisit({ id: 'queue-duplicate', requestId: 'req-duplicate' })];
    const h = harness(queue);
    const key = recoveryRequestId({
      sourceRecordId: 'queue-duplicate',
      visitRequestId: 'req-duplicate',
    });
    h.created.NoteConversion.push(
      {
        id: 'conversion-duplicate-1',
        created_by: 'nurse@example.com',
        nurse_email: 'nurse@example.com',
        patient_id: 'p1',
        recovery_request_id: key,
      },
      {
        id: 'conversion-duplicate-2',
        created_by: 'nurse@example.com',
        nurse_email: 'nurse@example.com',
        patient_id: 'p1',
        recovery_request_id: key,
      },
    );
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await flushAndRetireOfflineQueue(h);

    expect(result).toMatchObject({ retired: false, flushed: 0, pending: 1 });
    expect(h.entities.NoteConversion.create).not.toHaveBeenCalled();
    expect(h.deleteDatabase).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('keeps the queue when a recovery key resolves to a foreign conversion', async () => {
    const queue = [noteVisit({ id: 'queue-foreign', requestId: 'req-foreign' })];
    const h = harness(queue);
    h.created.NoteConversion.push({
      id: 'conversion-foreign',
      created_by: 'other@example.com',
      nurse_email: 'other@example.com',
      patient_id: 'p1',
      recovery_request_id: recoveryRequestId({
        sourceRecordId: 'queue-foreign',
        visitRequestId: 'req-foreign',
      }),
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await flushAndRetireOfflineQueue(h);

    expect(result).toMatchObject({ retired: false, flushed: 0, pending: 1 });
    expect(h.entities.NoteConversion.create).not.toHaveBeenCalled();
    expect(h.deleteDatabase).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('keeps the queue before any write when its durable source record id is missing', async () => {
    const queued = noteVisit({ id: 'queue-missing', requestId: 'req-missing-source' });
    delete queued.id;
    const h = harness([queued]);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await flushAndRetireOfflineQueue(h);

    expect(result).toMatchObject({ retired: false, flushed: 0, pending: 1 });
    expect(h.created.Visit).toHaveLength(0);
    expect(h.entities.NoteConversion.filter).not.toHaveBeenCalled();
    expect(h.entities.NoteConversion.create).not.toHaveBeenCalled();
    expect(h.deleteDatabase).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('keeps the queue when the Visit broker returns a wrong-owner replay', async () => {
    const queue = [noteVisit({ id: 'queue-wrong-owner', requestId: 'req-wrong-owner' })];
    const h = harness(queue);
    h.created.Visit.push({
      id: 'visit-foreign',
      client_request_id: 'req-wrong-owner',
      patient_id: 'p1',
      visit_date: '2026-09-03',
      visit_type: 'routine_visit',
      agency_id: 'agency-1',
      created_by_user_id: 'foreign-user',
      created_by_user_email_normalized: 'other@example.com',
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await flushAndRetireOfflineQueue(h);

    expect(result).toMatchObject({ retired: false, flushed: 0, pending: 1 });
    expect(h.created.Visit).toHaveLength(1);
    expect(h.entities.NoteConversion.filter).not.toHaveBeenCalled();
    expect(h.entities.NoteConversion.create).not.toHaveBeenCalled();
    expect(h.deleteDatabase).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('keeps the queue when the Visit broker response does not match the queued request', async () => {
    const h = harness([noteVisit({
      id: 'queue-wrong-request',
      requestId: 'req-expected',
    })]);
    h.functions.invoke.mockResolvedValueOnce({
      data: {
        created: false,
        visit: {
          id: 'visit-foreign-request',
          client_request_id: 'req-different',
          patient_id: 'p1',
          visit_date: '2026-09-03',
          visit_type: 'routine_visit',
          agency_id: 'agency-1',
          created_by_user_id: 'user-1',
          created_by_user_email_normalized: 'nurse@example.com',
        },
      },
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await flushAndRetireOfflineQueue(h);

    expect(result).toMatchObject({ retired: false, flushed: 0, pending: 1 });
    expect(h.entities.NoteConversion.filter).not.toHaveBeenCalled();
    expect(h.entities.NoteConversion.create).not.toHaveBeenCalled();
    expect(h.deleteDatabase).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('keeps the queue when the exact NoteConversion recovery lookup fails', async () => {
    const h = harness([noteVisit({ id: 'queue-filter-failure', requestId: 'req-filter-failure' })]);
    h.entities.NoteConversion.filter.mockRejectedValueOnce(new Error('RLS read rejected'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await flushAndRetireOfflineQueue(h);

    expect(result).toMatchObject({ retired: false, flushed: 0, pending: 1 });
    expect(h.created.Visit).toHaveLength(1);
    expect(h.entities.NoteConversion.create).not.toHaveBeenCalled();
    expect(h.deleteDatabase).not.toHaveBeenCalled();
    error.mockRestore();
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
    h.created.Visit.push({ id: 'visit-existing', client_request_id: 'req-1', patient_id: 'p1' });

    const result = await flushAndRetireOfflineQueue(h);

    expect(result.retired).toBe(true);
    expect(h.entities.Visit.create).not.toHaveBeenCalled();
    // The conversion row belongs to the original create, not this retry.
    expect(h.created.NoteConversion).toHaveLength(0);
  });

  it('keeps a bounded legacy update while server-side recovery is paused', async () => {
    const h = harness([{ action: 'UPDATE_VISIT', payload: { visit_id: 'visit-7', nurse_notes: 'edited offline' } }]);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await flushAndRetireOfflineQueue(h);

    expect(h.functions.invoke).toHaveBeenCalledWith('updateAuthorizedVisit', {
      visit_id: 'visit-7',
      action: 'legacy_recovery',
      nurse_notes: 'edited offline',
    });
    expect(result).toMatchObject({ retired: false, flushed: 0, pending: 1 });
    expect(h.entities.Visit.update).not.toHaveBeenCalled();
    expect(h.entities.Visit.create).not.toHaveBeenCalled();
    expect(h.deleteDatabase).not.toHaveBeenCalled();
    expect(localStorage.getItem('pennsync_offline_retired')).toBeNull();
    error.mockRestore();
  });

  it('keeps a tenant-bearing legacy update and leaves retirement incomplete', async () => {
    mig.actions = [[
      'UPDATE_VISIT',
      { visit_id: 'visit-7', patient_id: 'p1', nurse_notes: 'edited offline' },
    ]];
    const h = harness([]);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await flushAndRetireOfflineQueue(h);

    expect(result).toMatchObject({ retired: false, flushed: 0, pending: 1 });
    expect(h.functions.invoke).not.toHaveBeenCalledWith('updateAuthorizedVisit', expect.anything());
    expect(h.deleteDatabase).not.toHaveBeenCalled();
    expect(mig.cleared).toBe(0);
    expect(localStorage.getItem('pennsync_offline_retired')).toBeNull();
    error.mockRestore();
  });

  it('keeps a malformed legacy update instead of treating it as flushed', async () => {
    const h = harness([{
      action: 'UPDATE_VISIT',
      payload: { nurse_notes: 'only copy of the note' },
    }]);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await flushAndRetireOfflineQueue(h);

    expect(result).toMatchObject({ retired: false, flushed: 0, pending: 1 });
    expect(h.functions.invoke).not.toHaveBeenCalled();
    expect(h.deleteDatabase).not.toHaveBeenCalled();
    expect(localStorage.getItem('pennsync_offline_retired')).toBeNull();
    error.mockRestore();
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
    h.functions.invoke.mockImplementation((name) => {
      if (name === 'createAuthorizedVisit') throw new Error('server rejected');
      return Promise.resolve({ data: {} });
    });
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

  it('gives a migrated localStorage conversion a stable source-record binding', async () => {
    mig.actions = [['CREATE_VISIT', {
      client_request_id: 'legacy-sq:offline-note-1',
      patient_id: 'p1',
      visit_date: '2026-09-03',
      visit_type: 'routine_visit',
      status: 'completed',
      __noteConversion: { nurse_email: 'nurse@example.com', quality_score: 91 },
    }]];
    const h = harness([]);

    const result = await flushAndRetireOfflineQueue(h);

    expect(result).toMatchObject({ retired: true, flushed: 1, pending: 0 });
    expect(h.created.NoteConversion).toHaveLength(1);
    expect(h.created.NoteConversion[0].recovery_request_id).toBe(recoveryRequestId({
      sourceRecordId: 'legacy-local-storage:CREATE_VISIT:legacy-sq:offline-note-1',
      visitRequestId: 'legacy-sq:offline-note-1',
    }));
    expect(mig.cleared).toBe(1);
  });

  // ── The legacy database is only destroyed when it can be read and drained ──

  it('does NOT retire when the legacy queue cannot be read', async () => {
    // Regression: a transient IndexedDB failure used to surface as an empty
    // queue, so the retirement deleted the database and set its permanent flag —
    // discarding queued clinical work that was never even read, with no retry.
    const h = harness([]);
    h.getQueue.mockRejectedValueOnce(new Error('IndexedDB read failed'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await flushAndRetireOfflineQueue(h);

    expect(result).toMatchObject({ retired: false });
    expect(h.deleteDatabase).not.toHaveBeenCalled();
    expect(mig.cleared).toBe(0);
    error.mockRestore();
  });

  it('treats an IndexedDB open failure as a deferral, not an empty queue', async () => {
    // Drives the REAL reader (no injected getQueue) against a database that
    // errors on open. It used to resolve [], which the caller read as "nothing
    // left to save" — so it deleted the database and set the permanent flag on a
    // browser whose queued clinical work it had never managed to read.
    const originalIndexedDB = globalThis.indexedDB;
    globalThis.indexedDB = {
      open: () => {
        const request = {};
        queueMicrotask(() => {
          request.error = new Error('QuotaExceededError');
          request.onerror?.();
        });
        return request;
      },
    };
    const h = harness([]);
    delete h.getQueue; // fall through to the real readLegacyQueue
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const result = await flushAndRetireOfflineQueue(h);

      expect(result.retired).toBe(false);
      expect(h.deleteDatabase).not.toHaveBeenCalled();
      expect(mig.cleared).toBe(0);
    } finally {
      error.mockRestore();
      globalThis.indexedDB = originalIndexedDB;
    }
  });

  it('rescues the local note drafts BEFORE deleting the legacy database', async () => {
    // The drafts lived in the same database and are local-only — there is no
    // server copy to fall back on if the delete happens first.
    const h = harness([]);

    await flushAndRetireOfflineQueue(h);

    expect(h.rescueDrafts).toHaveBeenCalled();
    expect(h.order).toEqual(['rescue', 'delete']);
  });

  it('keeps the legacy database when the draft rescue fails', async () => {
    const h = harness([]);
    h.rescueDrafts.mockRejectedValueOnce(new Error('draft store unreadable'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await flushAndRetireOfflineQueue(h);

    expect(result.retired).toBe(false);
    expect(h.deleteDatabase).not.toHaveBeenCalled();
    expect(mig.cleared).toBe(0);
    error.mockRestore();
  });
});
