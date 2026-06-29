import { describe, it, expect, beforeEach, vi } from 'vitest';
import offlineStorage from './OfflineStorage';

describe('OfflineStorage.parseChangeType', () => {
  it('maps change types to entity name and action', () => {
    expect(offlineStorage.parseChangeType('visit_create')).toEqual({ entityName: 'Visit', action: 'create' });
    expect(offlineStorage.parseChangeType('incident_create')).toEqual({ entityName: 'Incident', action: 'create' });
    expect(offlineStorage.parseChangeType('care_plan_update')).toEqual({ entityName: 'CarePlan', action: 'update' });
  });
});

describe('OfflineStorage.syncPendingChanges', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const makeBase44 = (overrides = {}) => ({
    entities: {
      Visit: { create: vi.fn().mockResolvedValue({ id: 'v1' }), update: vi.fn().mockResolvedValue({}) },
      Incident: { create: vi.fn().mockResolvedValue({ id: 'i1' }), update: vi.fn().mockResolvedValue({}) },
      ...overrides,
    },
  });

  it('replays queued offline changes and drains them on success', async () => {
    // This is the regression for the data-loss bug: addPendingChange wrote to
    // offline_pending, which the sync engine never drained.
    offlineStorage.addPendingChange('visit_create', {
      patient_id: 'p1', nurse_notes: 'note', created_offline: true,
    });
    offlineStorage.addPendingChange('incident_create', {
      patient_id: 'p1', incident_type: 'fall', created_offline: true,
    });

    const base44 = makeBase44();
    const result = await offlineStorage.syncPendingChanges(base44);

    expect(result).toEqual({ success: 2, failed: 0, errors: [] });
    expect(base44.entities.Visit.create).toHaveBeenCalledTimes(1);
    expect(base44.entities.Incident.create).toHaveBeenCalledTimes(1);
    // Local-only bookkeeping must be stripped before upload.
    const visitPayload = base44.entities.Visit.create.mock.calls[0][0];
    expect(visitPayload).not.toHaveProperty('created_offline');
    expect(visitPayload.patient_id).toBe('p1');
    // Queue is emptied after a fully-successful sync.
    expect(offlineStorage.getPendingChanges()).toEqual([]);
  });

  it('retains failed changes with an incremented retryCount', async () => {
    offlineStorage.addPendingChange('visit_create', { patient_id: 'p1', nurse_notes: 'a' });
    const base44 = makeBase44({
      Visit: { create: vi.fn().mockRejectedValue(new Error('network')), update: vi.fn() },
    });

    const result = await offlineStorage.syncPendingChanges(base44);

    expect(result.success).toBe(0);
    expect(result.failed).toBe(1);
    const remaining = offlineStorage.getPendingChanges();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].retryCount).toBe(1);
  });

  it('routes update actions to Entity.update with the stored entityId', async () => {
    offlineStorage.addPendingChange('visit_update', { nurse_notes: 'edited' }, 'visit-123');
    const base44 = makeBase44();

    await offlineStorage.syncPendingChanges(base44);

    expect(base44.entities.Visit.update).toHaveBeenCalledWith('visit-123', { nurse_notes: 'edited' });
    expect(base44.entities.Visit.create).not.toHaveBeenCalled();
  });
});
