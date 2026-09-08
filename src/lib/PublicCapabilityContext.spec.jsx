import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PublicCapabilityBoundary,
  usePublicCapabilityLease,
} from '@/lib/PublicCapabilityContext';
import {
  closePublicCapabilityRealm,
  getPublicCapabilityAbortSignal,
  isPublicCapabilityLeaseCurrent,
} from '@/lib/publicCapabilityRealmGate';

vi.mock('@/lib/authorityBoundWindows', () => ({
  closeAuthorityBoundWindows: vi.fn(),
}));

let renderedLease = null;

function Probe() {
  renderedLease = usePublicCapabilityLease();
  return <span>capability active</span>;
}

function renderBoundary(snapshot = 'signer|token-a') {
  return render(
    <PublicCapabilityBoundary
      capabilitySnapshot={snapshot}
      fallback={<span>capability closed</span>}
    >
      <Probe />
    </PublicCapabilityBoundary>,
  );
}

afterEach(() => {
  cleanup();
  closePublicCapabilityRealm();
  renderedLease = null;
});

describe('PublicCapabilityBoundary storage transitions', () => {
  it.each([
    ['base44_app_id', 'app id'],
    ['base44_access_token', 'primary token'],
    ['base44_functions_version', 'function version'],
    ['base44_pending_access_token', 'pending token'],
    ['base44_server_url', 'backend origin'],
    ['token', 'SDK compatibility token'],
    ['pennsync_tenant_browser_authority_epoch_v1', 'authority epoch'],
    ['pennsync_tenant_browser_authority_revoked_v1:old', 'epoch tombstone'],
    [null, 'cleared storage'],
  ])('synchronously closes on %s (%s)', (key) => {
    renderBoundary();
    expect(screen.getByText('capability active')).toBeInTheDocument();
    const lease = renderedLease;
    const signal = getPublicCapabilityAbortSignal(lease);

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key }));
    });

    expect(signal.aborted).toBe(true);
    expect(isPublicCapabilityLeaseCurrent(lease)).toBe(false);
    expect(screen.getByText('capability closed')).toBeInTheDocument();
  });

  it('ignores unrelated storage writes', () => {
    renderBoundary();
    const lease = renderedLease;
    const signal = getPublicCapabilityAbortSignal(lease);

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'theme' }));
    });

    expect(signal.aborted).toBe(false);
    expect(isPublicCapabilityLeaseCurrent(lease)).toBe(true);
    expect(screen.getByText('capability active')).toBeInTheDocument();
  });

  it('replaces the old lease without a stale cleanup erasing the new binding', () => {
    const view = renderBoundary('signer|token-a');
    const oldLease = renderedLease;
    const oldSignal = getPublicCapabilityAbortSignal(oldLease);

    view.rerender(
      <PublicCapabilityBoundary
        capabilitySnapshot="signer|token-b"
        fallback={<span>capability closed</span>}
      >
        <Probe />
      </PublicCapabilityBoundary>,
    );

    const newLease = renderedLease;
    expect(oldSignal.aborted).toBe(true);
    expect(newLease).not.toBe(oldLease);
    expect(isPublicCapabilityLeaseCurrent(newLease)).toBe(true);
    expect(screen.getByText('capability active')).toBeInTheDocument();
  });
});
