import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { logout } = vi.hoisted(() => ({ logout: vi.fn(async () => {}) }));

vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ logout }) }));
vi.mock('../utils/security', () => ({ logSecurityEvent: vi.fn(async () => {}) }));

import SessionTimeoutManager from './SessionTimeoutManager';
import { SESSION_ACTIVITY_KEY } from '@/lib/sessionActivity';

const MINUTE = 60 * 1000;
const NOW = Date.parse('2026-10-15T15:00:00.000Z');

describe('SessionTimeoutManager idle clock', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(NOW);
    localStorage.clear();
    logout.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('signs out on load when the shared stamp is already past the deadline', () => {
    // An iOS relaunch or a reopened tab after two idle hours.
    localStorage.setItem(SESSION_ACTIVITY_KEY, String(NOW - 2 * 60 * MINUTE));
    render(<SessionTimeoutManager timeoutMinutes={15} warningMinutes={2} />);
    expect(logout).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(SESSION_ACTIVITY_KEY)).toBeNull();
  });

  it('resumes the idle clock across a reload instead of restarting it', () => {
    localStorage.setItem(SESSION_ACTIVITY_KEY, String(NOW - 14 * MINUTE));
    render(<SessionTimeoutManager timeoutMinutes={15} warningMinutes={2} />);
    expect(logout).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(61 * 1000); });
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('treats a missing stamp as a fresh session and records it', () => {
    render(<SessionTimeoutManager timeoutMinutes={15} warningMinutes={2} />);
    expect(logout).not.toHaveBeenCalled();
    expect(localStorage.getItem(SESSION_ACTIVITY_KEY)).toBe(String(NOW));
  });

  it('counts activity in another tab', () => {
    render(<SessionTimeoutManager timeoutMinutes={15} warningMinutes={2} />);
    act(() => { vi.advanceTimersByTime(10 * MINUTE); });
    // Another tab of the same origin records activity.
    localStorage.setItem(SESSION_ACTIVITY_KEY, String(Date.now()));
    act(() => { vi.advanceTimersByTime(10 * MINUTE); });
    expect(logout).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(6 * MINUTE); });
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('signs out, rather than resetting, on the first touch after the deadline passed', () => {
    render(<SessionTimeoutManager timeoutMinutes={15} warningMinutes={2} />);
    // The device slept: time moved on without the interval firing.
    vi.setSystemTime(NOW + 20 * MINUTE);
    act(() => { window.dispatchEvent(new Event('touchstart')); });
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('still signs out an idle session whose stamp a clock change left in the future', () => {
    // The device clock was moved back an hour after the last activity.
    localStorage.setItem(SESSION_ACTIVITY_KEY, String(NOW + 60 * MINUTE));
    render(<SessionTimeoutManager timeoutMinutes={15} warningMinutes={2} />);
    expect(logout).not.toHaveBeenCalled();
    expect(localStorage.getItem(SESSION_ACTIVITY_KEY)).toBe(String(NOW));
    act(() => { vi.advanceTimersByTime(16 * MINUTE); });
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('records ordinary activity to the shared stamp', () => {
    render(<SessionTimeoutManager timeoutMinutes={15} warningMinutes={2} />);
    vi.setSystemTime(NOW + 5 * MINUTE);
    act(() => { window.dispatchEvent(new Event('keydown')); });
    expect(localStorage.getItem(SESSION_ACTIVITY_KEY)).toBe(String(NOW + 5 * MINUTE));
    expect(logout).not.toHaveBeenCalled();
  });
});
