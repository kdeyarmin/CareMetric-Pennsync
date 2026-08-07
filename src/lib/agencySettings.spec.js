import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/api/base44Client', () => ({
  base44: {
    entities: {
      AgencySettings: {
        filter: vi.fn(),
        list: vi.fn(),
      },
      PDGMRateConfig: {
        filter: vi.fn(),
        list: vi.fn(),
      },
      FollowUpRuleConfig: {
        filter: vi.fn(),
        list: vi.fn(),
      },
    },
  },
}));

import { base44 } from '@/api/base44Client';
import {
  fetchCallerAgencySettings,
  fetchCallerPdgmRateConfig,
  fetchCallerFollowUpRuleConfig,
} from './agencySettings.js';

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

describe('fetchCallerPdgmRateConfig / FollowUpRuleConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prefers agency_name match for PDGM rates', async () => {
    base44.entities.PDGMRateConfig.filter
      .mockResolvedValueOnce([{ id: 'rate-a', agency_name: 'Acme' }]);
    const row = await fetchCallerPdgmRateConfig('Acme');
    expect(row?.id).toBe('rate-a');
    expect(base44.entities.PDGMRateConfig.list).not.toHaveBeenCalled();
  });

  it('fails closed on multi-tenant newest-row for follow-up rules', async () => {
    base44.entities.FollowUpRuleConfig.list.mockResolvedValueOnce([
      { id: '1' },
      { id: '2' },
    ]);
    const row = await fetchCallerFollowUpRuleConfig(null);
    expect(row).toBeNull();
  });
});
