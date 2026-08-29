import { describe, it, expect, vi, beforeEach } from 'vitest';

const track = vi.fn();
const base44 = { analytics: { track } };

vi.mock('@/api/base44Client', () => ({ get base44() { return base44; } }));

const { trackEvent } = await import('./trackEvent.js');

describe('trackEvent', () => {
  beforeEach(() => {
    track.mockReset();
    base44.analytics = { track };
  });

  it('forwards the event name and properties to the SDK', () => {
    trackEvent('page_viewed', { page: 'DocumentAuditLogs' });
    expect(track).toHaveBeenCalledWith({
      eventName: 'page_viewed',
      properties: { page: 'DocumentAuditLogs' },
    });
  });

  it('defaults properties to an empty object', () => {
    trackEvent('page_viewed');
    expect(track).toHaveBeenCalledWith({ eventName: 'page_viewed', properties: {} });
  });

  it('does not throw when the SDK has no analytics module', () => {
    // The bare `base44.analytics.track(...)` this replaces threw here — and in a
    // mount effect that throw reaches the ErrorBoundary and blanks the tab.
    base44.analytics = undefined;
    expect(() => trackEvent('page_viewed')).not.toThrow();
  });

  it('does not throw when the SDK transport throws', () => {
    base44.analytics = { track: () => { throw new Error('network down'); } };
    expect(() => trackEvent('page_viewed')).not.toThrow();
  });

  it('swallows a rejected promise from a future async track()', async () => {
    base44.analytics = { track: () => Promise.reject(new Error('network down')) };
    expect(() => trackEvent('page_viewed')).not.toThrow();
    // An unhandled rejection would surface after the microtask queue drains.
    await new Promise((resolve) => { setTimeout(resolve, 0); });
  });
});
