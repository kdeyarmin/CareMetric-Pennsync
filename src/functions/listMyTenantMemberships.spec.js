import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

function httpError(status, headers) {
  return Object.assign(new Error(`status ${status}`), {
    response: headers === undefined ? { status } : { status, headers },
  });
}

describe('listMyTenantMemberships wrapper', () => {
  beforeEach(() => {
    listMemberships.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a cloned selector envelope from one call', async () => {
    listMemberships.mockResolvedValue({ data: envelope });
    const result = await listMyTenantMemberships();
    expect(listMemberships).toHaveBeenCalledTimes(1);
    expect(result.memberships[0].tenant_role).toBe('clinician');
    expect(result).not.toBe(envelope);
  });

  it('shares one in-flight request between overlapping callers', async () => {
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
  });

  it('retries transient failures at the server-paced floor before the workspace gate', async () => {
    vi.useFakeTimers();
    listMemberships
      .mockRejectedValueOnce(httpError(500))
      .mockRejectedValueOnce(httpError(503))
      .mockResolvedValueOnce({ data: envelope });
    const pending = listMyTenantMemberships();

    // First retry waits the full server-directed 2 s, not the old 250 ms.
    await vi.advanceTimersByTimeAsync(1_999);
    expect(listMemberships).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(listMemberships).toHaveBeenCalledTimes(2);

    // Second retry backs off further (5 s).
    await vi.advanceTimersByTimeAsync(4_999);
    expect(listMemberships).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(listMemberships).toHaveBeenCalledTimes(3);

    await expect(pending).resolves.toMatchObject({
      memberships: [{ tenant_role: 'clinician' }],
    });
    expect(listMemberships).toHaveBeenCalledTimes(3);
  });

  it('keeps the three-attempt cap: a third transient failure is thrown, not retried', async () => {
    vi.useFakeTimers();
    listMemberships.mockRejectedValue(httpError(503));
    const pending = listMyTenantMemberships();
    const rejection = expect(pending).rejects.toMatchObject({
      response: { status: 503 },
    });
    await vi.advanceTimersByTimeAsync(2_000 + 5_000);
    await rejection;
    expect(listMemberships).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(listMemberships).toHaveBeenCalledTimes(3);
  });

  it('honors a longer server Retry-After over the floor', async () => {
    vi.useFakeTimers();
    listMemberships
      .mockRejectedValueOnce(httpError(503, { 'retry-after': '7' }))
      .mockResolvedValueOnce({ data: envelope });
    const pending = listMyTenantMemberships();
    await vi.advanceTimersByTimeAsync(6_999);
    expect(listMemberships).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(listMemberships).toHaveBeenCalledTimes(2);
    await expect(pending).resolves.toMatchObject({
      memberships: [{ tenant_role: 'clinician' }],
    });
  });

  it('reads Retry-After from a Headers-like error surface and never waits under the floor', async () => {
    vi.useFakeTimers();
    const headers = {
      get: (name) => (name.toLowerCase() === 'retry-after' ? '1' : null),
    };
    listMemberships
      .mockRejectedValueOnce(httpError(503, headers))
      .mockResolvedValueOnce({ data: envelope });
    const pending = listMyTenantMemberships();
    // The server asked for 1 s; the 2 s floor still governs.
    await vi.advanceTimersByTimeAsync(1_999);
    expect(listMemberships).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(listMemberships).toHaveBeenCalledTimes(2);
    await expect(pending).resolves.toMatchObject({
      memberships: [{ tenant_role: 'clinician' }],
    });
  });

  it('does not retry 403 or 409', async () => {
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
