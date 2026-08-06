import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/api/base44Client', () => ({
  base44: {
    entities: {
      AgencySettings: {
        filter: vi.fn(),
        list: vi.fn(),
      },
    },
  },
}));

import { base44 } from '@/api/base44Client';
import { fetchCallerAgencySettings } from './agencySettings.js';

describe('fetchCallerAgencySettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prefers agency_code match', async () => {
    base44.entities.AgencySettings.filter
      .mockResolvedValueOnce([{ id: 'a', agency_code: 'Acme' }]);
    const row = await fetchCallerAgencySettings('Acme');
    expect(row?.id).toBe('a');
    expect(base44.entities.AgencySettings.list).not.toHaveBeenCalled();
  });

  it('fails closed when no hint and multiple rows exist', async () => {
    base44.entities.AgencySettings.list.mockResolvedValueOnce([
      { id: '1' },
      { id: '2' },
    ]);
    const row = await fetchCallerAgencySettings(null);
    expect(row).toBeNull();
  });

  it('allows single-tenant newest-row fallback', async () => {
    base44.entities.AgencySettings.list.mockResolvedValueOnce([{ id: 'only' }]);
    const row = await fetchCallerAgencySettings(undefined);
    expect(row?.id).toBe('only');
  });
});
