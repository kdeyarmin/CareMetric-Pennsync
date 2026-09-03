import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@/api/base44Client', () => ({
  base44: { functions: { invoke: (...args) => invoke(...args) } },
}));

import { getMyTenantContext } from './getMyTenantContext';

const memberContext = (overrides = {}) => ({
  user_id: 'user-1',
  user_email: 'member@example.test',
  membership_id: 'membership-a',
  membership_key: 'agency-a:user-1',
  membership_version: 3,
  agency_id: 'agency-a',
  tenant_role: 'clinician',
  membership_status: 'active',
  is_platform_owner: false,
  agency: { id: 'agency-a', name: 'Agency A', status: 'active' },
  ...overrides,
});

describe('getMyTenantContext wrapper', () => {
  beforeEach(() => invoke.mockReset());

  it('returns a strict, versioned membership identity for query keys', async () => {
    invoke.mockResolvedValue({ data: { tenant_context: memberContext() } });
    const result = await getMyTenantContext({ agencyId: 'agency-a' });
    expect(invoke).toHaveBeenCalledWith('getMyTenantContext', { agency_id: 'agency-a' });
    expect(result.tenant_context).toMatchObject({
      user_id: 'user-1',
      agency_id: 'agency-a',
      membership_id: 'membership-a',
      membership_version: 3,
      tenant_role: 'clinician',
    });
  });

  it('accepts only a fully null membership identity for an unscoped owner', async () => {
    invoke.mockResolvedValue({
      tenant_context: {
        user_id: 'owner-1',
        user_email: 'owner@example.test',
        membership_id: null,
        membership_key: null,
        membership_version: null,
        agency_id: null,
        tenant_role: 'platform_owner',
        membership_status: null,
        is_platform_owner: true,
        agency: null,
      },
    });
    await expect(getMyTenantContext()).resolves.toMatchObject({
      tenant_context: { membership_version: null, tenant_role: 'platform_owner' },
    });
    expect(invoke).toHaveBeenCalledWith('getMyTenantContext', {});
  });

  it('rejects unsupported or operator-shaped input before invocation', async () => {
    await expect(getMyTenantContext({ agency_id: 'agency-a' })).rejects.toThrow(/unsupported/);
    await expect(getMyTenantContext({ agencyId: '$ne' })).rejects.toThrow(/agencyId/);
    await expect(getMyTenantContext([])).rejects.toThrow(/object/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('rejects authority identity drift in false-success responses', async () => {
    for (const context of [
      memberContext({ membership_version: null }),
      memberContext({ membership_key: 'agency-b:user-1' }),
      memberContext({ agency: { id: 'agency-b', name: 'Agency B', status: 'active' } }),
      memberContext({ user_email: ' Member@Example.test ' }),
      memberContext({ extra: true }),
    ]) {
      invoke.mockResolvedValueOnce({ data: { tenant_context: context } });
      await expect(getMyTenantContext({ agencyId: 'agency-a' })).rejects.toThrow(/integrity/);
    }

    invoke.mockResolvedValueOnce({
      data: {
        tenant_context: {
          user_id: 'owner-1',
          user_email: 'owner@example.test',
          membership_id: null,
          membership_key: null,
          membership_version: null,
          agency_id: 'agency-a',
          tenant_role: 'platform_owner',
          membership_status: null,
          is_platform_owner: true,
          agency: { id: 'agency-a', name: 'Agency A', status: 'active' },
        },
      },
    });
    await expect(getMyTenantContext()).rejects.toThrow(/integrity/);
  });
});
