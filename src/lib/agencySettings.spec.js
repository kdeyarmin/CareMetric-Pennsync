import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/api/base44Client', () => ({
  base44: {
    functions: {
      invoke: vi.fn(),
    },
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
import * as agencySettings from './agencySettings.js';

const { fetchCallerAgencySettings, fetchCallerFollowUpRuleConfig } = agencySettings;

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

  it('fails closed on keyed agency miss (never adopts a foreign sole row)', async () => {
    base44.entities.AgencySettings.filter
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const row = await fetchCallerAgencySettings('Acme');
    expect(row).toBeNull();
    expect(base44.entities.AgencySettings.list).not.toHaveBeenCalled();
  });
});

describe('PDGM payment configuration helpers (removed) / FollowUpRuleConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes no PDGM rate or payer-rate configuration reader', () => {
    // Both were removed with the PDGM payment features: the rate-settings and
    // payer-rate editors that read them no longer exist.
    expect(agencySettings.fetchCallerPdgmRateConfig).toBeUndefined();
    expect(agencySettings.fetchCallerPayerRateConfig).toBeUndefined();
    expect(base44.functions.invoke).not.toHaveBeenCalled();
    expect(base44.entities.PDGMRateConfig.filter).not.toHaveBeenCalled();
    expect(base44.entities.PDGMRateConfig.list).not.toHaveBeenCalled();
  });

  it('refuses a payer-rate lookup through the generic config reader', async () => {
    await expect(agencySettings.fetchCallerScopedConfig('PayerRateConfig', 'Acme')).resolves.toBeNull();
    await expect(agencySettings.fetchCallerScopedConfig('PDGMRateConfig', 'Acme')).resolves.toBeNull();
    expect(base44.entities.PDGMRateConfig.filter).not.toHaveBeenCalled();
  });

  it('reads follow-up rules through the membership-scoped function, never the entity', async () => {
    base44.functions.invoke.mockResolvedValueOnce({
      data: {
        config: {
          disabled_rules: ['f2f_missing', 7],
          severity_overrides: { orders_missing: 'critical' },
          custom_items: [{ title: 'Ask', question: 'Q?' }, null],
          updated_by_email: 'admin@example.test',
        },
      },
    });
    const row = await fetchCallerFollowUpRuleConfig('Acme');
    expect(base44.functions.invoke).toHaveBeenCalledWith('saveFollowUpRuleConfig', { action: 'get' });
    expect(row).toEqual({
      disabled_rules: ['f2f_missing'],
      severity_overrides: { orders_missing: 'critical' },
      custom_items: [{ title: 'Ask', question: 'Q?' }],
    });
    expect(base44.entities.FollowUpRuleConfig.filter).not.toHaveBeenCalled();
    expect(base44.entities.FollowUpRuleConfig.list).not.toHaveBeenCalled();
  });

  it('ignores the caller agency hint and falls back to built-in rules on any failure', async () => {
    base44.functions.invoke.mockRejectedValueOnce(new Error('denied'));
    expect(await fetchCallerFollowUpRuleConfig('other-tenant')).toBeNull();
    expect(base44.functions.invoke).toHaveBeenCalledWith('saveFollowUpRuleConfig', { action: 'get' });
    base44.functions.invoke.mockResolvedValueOnce({ data: { config: null } });
    expect(await fetchCallerFollowUpRuleConfig()).toBeNull();
  });

});
