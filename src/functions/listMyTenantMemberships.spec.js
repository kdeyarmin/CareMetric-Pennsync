import { beforeEach, describe, expect, it, vi } from 'vitest';

const listMemberships = vi.fn();
vi.mock('@/api/base44Client', () => ({
  tenantAuthorityClient: {
    listMyTenantMemberships: () => listMemberships(),
  },
}));

import { listMyTenantMemberships } from './listMyTenantMemberships';

const envelope = {
  subject: {
    user_id: 'user-1',
    user_email: 'member@example.test',
    is_platform_owner: false,
  },
  memberships: [{
    membership_id: 'membership-a',
    membership_key: 'agency-a:user-1',
    membership_version: 2,
    agency_id: 'agency-a',
    tenant_role: 'clinician',
    membership_status: 'active',
    agency: { id: 'agency-a', name: 'Agency A', status: 'active' },
  }],
};

function httpError(status) {
  return Object.assign(new Error(`status ${status}`), { response: { status } });
}

describe('listMyTenantMemberships wrapper', () => {
  beforeEach(() => {
    listMemberships.mockReset();
  });

  it('returns a cloned selector envelope from one call', async () => {
    listMemberships.mockResolvedValue({ data: envelope });
    const result = await listMyTenantMemberships();
    expect(listMemberships).toHaveBeenCalledTimes(1);
    expect(result.memberships[0].tenant_role).toBe('clinician');
    expect(result).not.toBe(envelope);
  });

  it('shares one in-flight request and retries transient failures before the workspace gate', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    listMemberships.mockImplementation(() => gate.then(() => ({ data: envelope })));
    const first = listMyTenantMemberships();
    const second = listMyTenantMemberships();
    expect(listMemberships).toHaveBeenCalledTimes(1);
    release();
    const [left, right] = await Promise.all([first, second]);
    expect(left.memberships[0].membership_id).toBe('membership-a');
    expect(right.memberships[0].membership_id).toBe('membership-a');

    listMemberships.mockReset();
    listMemberships
      .mockRejectedValueOnce(httpError(500))
      .mockRejectedValueOnce(httpError(503))
      .mockResolvedValueOnce({ data: envelope });
    await expect(listMyTenantMemberships()).resolves.toMatchObject({
      memberships: [{ tenant_role: 'clinician' }],
    });
    expect(listMemberships).toHaveBeenCalledTimes(3);

    listMemberships.mockReset();
    const denied = httpError(403);
    listMemberships.mockRejectedValue(denied);
    await expect(listMyTenantMemberships()).rejects.toBe(denied);
    expect(listMemberships).toHaveBeenCalledTimes(1);

    listMemberships.mockReset();
    const changed = httpError(409);
    listMemberships.mockRejectedValue(changed);
    await expect(listMyTenantMemberships()).rejects.toBe(changed);
    expect(listMemberships).toHaveBeenCalledTimes(1);
  });
});
