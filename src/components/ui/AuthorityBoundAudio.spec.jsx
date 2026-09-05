import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('AuthorityBoundAudio', () => {
  let AuthorityBoundAudio;
  let closeTenantSdkRealm;
  let openTenantSdkRealm;

  beforeEach(async () => {
    localStorage.clear();
    vi.resetModules();
    ({ closeTenantSdkRealm, openTenantSdkRealm } = await import('@/lib/tenantSdkRealmGate'));
    ({ default: AuthorityBoundAudio } = await import('./AuthorityBoundAudio'));
    expect(openTenantSdkRealm('audio-authority')).toBe(true);
  });

  afterEach(() => vi.restoreAllMocks());

  it('pauses and detaches the captured media element on unmount', () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    const view = render(<AuthorityBoundAudio src="https://safe.example/voicemail" controls />);
    const audio = view.container.querySelector('audio');

    view.unmount();

    expect(pause).toHaveBeenCalled();
    expect(load).toHaveBeenCalled();
    expect(audio.hasAttribute('src')).toBe(false);
  });

  it('synchronously stops and detaches playing media when authority closes', async () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const view = render(<AuthorityBoundAudio src="https://safe.example/voicemail" />);
    const audio = view.container.querySelector('audio');

    fireEvent.click(view.getByRole('button', { name: /play protected audio/i }));
    await waitFor(() => expect(view.getByText('Pause audio')).toBeTruthy());
    act(() => closeTenantSdkRealm());

    expect(pause).toHaveBeenCalled();
    expect(load).toHaveBeenCalled();
    expect(audio.hasAttribute('src')).toBe(false);
    expect(view.getByText('Play audio')).toBeTruthy();
  });
});
