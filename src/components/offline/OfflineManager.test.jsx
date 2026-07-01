import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import OfflineManager from './OfflineManager';
import { AI_CONTENT_AGREEMENT_VERSION } from '@/lib/aiContentAgreement';

// Controllable auth state for each test.
let authState = { isAuthenticated: false, user: null };
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => authState }));

const patientFilter = vi.fn(() => Promise.resolve([]));
vi.mock('@/api/base44Client', () => ({
  base44: { entities: { Patient: { filter: (...a) => patientFilter(...a) } } },
}));

const savePatients = vi.fn();
vi.mock('@/lib/indexedDB', () => ({ savePatients: (...a) => savePatients(...a) }));

const drainSyncQueue = vi.fn(() => Promise.resolve({ synced: 0 }));
vi.mock('@/lib/offlineSync', () => ({ drainSyncQueue: (...a) => drainSyncQueue(...a) }));

const migrateLegacyOfflineQueues = vi.fn(() => Promise.resolve());
vi.mock('@/lib/offlineMigration', () => ({
  migrateLegacyOfflineQueues: (...a) => migrateLegacyOfflineQueues(...a),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const acceptedUser = {
  ai_content_agreement_accepted: true,
  ai_content_agreement_version: AI_CONTENT_AGREEMENT_VERSION,
};

describe('OfflineManager agreement gating', () => {
  beforeEach(() => {
    patientFilter.mockClear();
    savePatients.mockClear();
    drainSyncQueue.mockClear();
    migrateLegacyOfflineQueues.mockClear();
  });

  it('does not migrate, drain, or fetch PHI when authenticated but agreement not yet accepted', async () => {
    authState = { isAuthenticated: true, user: { email: 'nurse@example.com' } };
    render(<OfflineManager />);
    // Give any (incorrectly) fired async effects a tick to run.
    await Promise.resolve();
    expect(migrateLegacyOfflineQueues).not.toHaveBeenCalled();
    expect(drainSyncQueue).not.toHaveBeenCalled();
    expect(patientFilter).not.toHaveBeenCalled();
  });

  it('does nothing when the acceptance is for an older agreement version', async () => {
    authState = {
      isAuthenticated: true,
      user: { ai_content_agreement_accepted: true, ai_content_agreement_version: '0.0' },
    };
    render(<OfflineManager />);
    await Promise.resolve();
    expect(migrateLegacyOfflineQueues).not.toHaveBeenCalled();
    expect(patientFilter).not.toHaveBeenCalled();
  });

  it('migrates/drains and caches active patients once the agreement is accepted', async () => {
    authState = { isAuthenticated: true, user: acceptedUser };
    render(<OfflineManager />);
    await waitFor(() => expect(migrateLegacyOfflineQueues).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(patientFilter).toHaveBeenCalledWith({ status: 'active' }, 'first_name', 200));
    await waitFor(() => expect(drainSyncQueue).toHaveBeenCalled());
  });
});
