import { describe, it, expect, vi } from 'vitest';

const { create } = vi.hoisted(() => ({ create: vi.fn(async (x) => x) }));
vi.mock('@/api/base44Client', () => ({
  base44: { entities: { Notification: { create: (...a) => create(...a) } } },
}));

import { validateNotification, NOTIFICATION_TYPES, sendInAppNotification } from './notify.js';

describe('validateNotification', () => {
  const base = { user_email: 'a@b.com', title: 'T', message: 'M', type: 'info' };

  it('accepts a well-formed notification', () => {
    const r = validateNotification(base);
    expect(r.valid).toBe(true);
    expect(r.safePriority).toBe('medium');
  });

  it('requires the core fields', () => {
    expect(validateNotification({ ...base, user_email: '' }).valid).toBe(false);
    expect(validateNotification({ ...base, title: '' }).valid).toBe(false);
    expect(validateNotification({ ...base, type: '' }).valid).toBe(false);
  });

  it('rejects an unknown type but accepts every enum value', () => {
    expect(validateNotification({ ...base, type: 'totally_made_up' }).valid).toBe(false);
    for (const type of NOTIFICATION_TYPES) {
      expect(validateNotification({ ...base, type }).valid).toBe(true);
    }
  });

  it('normalizes an out-of-range priority to medium', () => {
    expect(validateNotification({ ...base, priority: 'ultra' }).safePriority).toBe('medium');
    expect(validateNotification({ ...base, priority: 'critical' }).safePriority).toBe('critical');
  });

  it('rejects external / protocol-relative action_url, allows relative', () => {
    expect(validateNotification({ ...base, action_url: 'https://evil.example/x' }).valid).toBe(false);
    expect(validateNotification({ ...base, action_url: '//evil.example' }).valid).toBe(false);
    expect(validateNotification({ ...base, action_url: '/PatientDetails?id=1' }).valid).toBe(true);
  });
});

describe('sendInAppNotification', () => {
  it('persists the NORMALIZED priority, not the caller\'s out-of-range value', async () => {
    // Regression: an out-of-range priority left in `...rest` overwrote safePriority.
    create.mockClear();
    await sendInAppNotification({ user_email: 'a@b.com', title: 'T', message: 'M', type: 'info', priority: 'urgent' });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].priority).toBe('medium');
  });

  it('throws (and does not create) on invalid input', async () => {
    create.mockClear();
    await expect(sendInAppNotification({ user_email: 'a@b.com', title: 'T', message: 'M', type: 'bogus' })).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });
});
