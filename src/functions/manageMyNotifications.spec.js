import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/api/base44Client', () => ({
  base44: { functions: { invoke } },
}));

import {
  dismissMyNotification,
  listMyNotifications,
  markAllMyNotificationsRead,
  markMyNotificationRead,
} from './manageMyNotifications';

const row = (overrides = {}) => ({
  id: 'notification-a',
  agency_id: 'agency-a',
  title: 'Provider follow-up request unanswered',
  message: 'A provider request has had no response for 4+ days.',
  type: 'info',
  priority: 'high',
  created_date: '2026-09-06T00:00:00.000Z',
  is_read: false,
  read_at: null,
  dismissed: false,
  dismissed_at: null,
  action_url: '/ReferralFollowUp?id=referral-a',
  action_label: null,
  version: 1,
  ...overrides,
});

const respondWith = (result) => invoke.mockResolvedValue({ data: result });

describe('manageMyNotifications browser contract', () => {
  beforeEach(() => invoke.mockReset());

  it('lists only a validated exact-agency projection', async () => {
    respondWith({
      success: true,
      action: 'list',
      agency_id: 'agency-a',
      notifications: [row()],
      complete: true,
    });
    await expect(listMyNotifications({ agencyId: 'agency-a' }))
      .resolves.toEqual([row()]);
    expect(invoke).toHaveBeenCalledWith('manageMyNotifications', {
      action: 'list',
      agency_id: 'agency-a',
    });
  });

  it('rejects cross-agency or over-projected responses', async () => {
    respondWith({
      success: true,
      action: 'list',
      agency_id: 'agency-a',
      notifications: [row({ agency_id: 'agency-b' })],
      complete: true,
    });
    await expect(listMyNotifications({ agencyId: 'agency-a' }))
      .rejects.toThrow(/integrity/i);

    respondWith({
      success: true,
      action: 'list',
      agency_id: 'agency-a',
      notifications: [{ ...row(), dedupe_key: 'secret-workflow-state' }],
      complete: true,
    });
    await expect(listMyNotifications({ agencyId: 'agency-a' }))
      .rejects.toThrow(/integrity/i);
  });

  it('binds read and dismiss mutations to the row version', async () => {
    respondWith({
      success: true,
      action: 'mark_read',
      agency_id: 'agency-a',
      idempotent: false,
      notification: row({
        is_read: true,
        read_at: '2026-09-06T01:00:00.000Z',
        version: 2,
      }),
    });
    await markMyNotificationRead({
      agencyId: 'agency-a',
      notificationId: 'notification-a',
      expectedVersion: 1,
    });
    expect(invoke).toHaveBeenCalledWith('manageMyNotifications', {
      action: 'mark_read',
      agency_id: 'agency-a',
      notification_id: 'notification-a',
      expected_version: 1,
    });

    invoke.mockReset();
    respondWith({
      success: true,
      action: 'dismiss',
      agency_id: 'agency-a',
      idempotent: false,
      notification: row({
        is_read: true,
        read_at: '2026-09-06T01:00:00.000Z',
        dismissed: true,
        dismissed_at: '2026-09-06T01:00:00.000Z',
        version: 2,
      }),
    });
    await dismissMyNotification({
      agencyId: 'agency-a',
      notificationId: 'notification-a',
      expectedVersion: 1,
    });
    expect(invoke.mock.calls[0][1].action).toBe('dismiss');
  });

  it('uses one bounded broker operation for mark-all', async () => {
    respondWith({
      success: true,
      action: 'mark_all_read',
      agency_id: 'agency-a',
      marked: 2,
      complete: true,
    });
    await expect(markAllMyNotificationsRead({ agencyId: 'agency-a' }))
      .resolves.toEqual({ marked: 2, complete: true });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('accepts a bounded partial inbox without treating it as corrupt', async () => {
    respondWith({
      success: true,
      action: 'list',
      agency_id: 'agency-a',
      notifications: [row()],
      complete: false,
    });
    await expect(listMyNotifications({ agencyId: 'agency-a' }))
      .resolves.toEqual([row()]);
  });
});
