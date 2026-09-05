import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
const bootstrapInvoke = vi.fn();
vi.mock('@/api/base44Client', () => ({
  base44: {
    functions: {
      invoke: (name, payload) => invoke(name, payload),
    },
  },
  tenantAuthorityClient: {
    getMyTenantContext: (payload) => bootstrapInvoke(payload),
  },
}));

import { bootstrapMyTenantContext, getMyTenantContext } from './getMyTenantContext';

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
  beforeEach(() => {
    invoke.mockReset();
    bootstrapInvoke.mockReset();
  });

  it('uses the raw authority client only for the explicit pre-realm bootstrap seam', async () => {
    bootstrapInvoke.mockResolvedValue({ data: { tenant_context: memberContext() } });

    await expect(bootstrapMyTenantContext({ agencyId: 'agency-a' })).resolves.toMatchObject({
      tenant_context: { membership_id: 'membership-a' },
    });
    expect(bootstrapInvoke).toHaveBeenCalledWith({ agency_id: 'agency-a' });
    expect(invoke).not.toHaveBeenCalled();
  });

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

  it('binds an explicit selector choice to its observed membership id and version', async () => {
    invoke.mockResolvedValue({ data: { tenant_context: memberContext() } });
    const result = await getMyTenantContext({
      agencyId: 'agency-a',
      expectedMembershipId: 'membership-a',
      expectedMembershipVersion: 3,
    });

    expect(invoke).toHaveBeenCalledWith('getMyTenantContext', {
      agency_id: 'agency-a',
      expected_membership_id: 'membership-a',
      expected_membership_version: 3,
    });
    expect(result.tenant_context.membership_version).toBe(3);
  });

  it('rejects membership-backed context that also claims platform-owner authority', async () => {
    invoke.mockResolvedValue({
      data: { tenant_context: memberContext({ is_platform_owner: true }) },
    });

    await expect(getMyTenantContext({ agencyId: 'agency-a' })).rejects.toThrow(/integrity/);
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
    await expect(getMyTenantContext({
      agencyId: 'agency-a',
      expectedMembershipId: 'membership-a',
    })).rejects.toThrow(/provided together/);
    await expect(getMyTenantContext({
      expectedMembershipId: 'membership-a',
      expectedMembershipVersion: 3,
    })).rejects.toThrow(/agencyId/);
    await expect(getMyTenantContext({
      agencyId: 'agency-a',
      expectedMembershipId: '$ne',
      expectedMembershipVersion: 3,
    })).rejects.toThrow(/identity/);
    await expect(getMyTenantContext({
      agencyId: 'agency-a',
      expectedMembershipId: 'membership-a',
      expectedMembershipVersion: 0,
    })).rejects.toThrow(/identity/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('rejects a false-success response that does not match the expected selector identity', async () => {
    for (const context of [
      memberContext({ membership_id: 'membership-z' }),
      memberContext({ membership_version: 4 }),
      {
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
    ]) {
      invoke.mockResolvedValueOnce({ data: { tenant_context: context } });
      await expect(getMyTenantContext({
        agencyId: 'agency-a',
        expectedMembershipId: 'membership-a',
        expectedMembershipVersion: 3,
      })).rejects.toThrow(/integrity/);
    }
  });

  it('rejects unsafe or noncanonical Agency display names', async () => {
    for (const name of [
      '',
      ' Agency A ',
      'Agency\nA',
      'Agency\u202eA',
      'A'.repeat(201),
    ]) {
      invoke.mockResolvedValueOnce({
        data: {
          tenant_context: memberContext({
            agency: { id: 'agency-a', name, status: 'active' },
          }),
        },
      });
      await expect(getMyTenantContext({ agencyId: 'agency-a' })).rejects.toThrow(/integrity/);
    }
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
