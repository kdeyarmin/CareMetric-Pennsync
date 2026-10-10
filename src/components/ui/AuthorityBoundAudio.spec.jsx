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

  it('requests a link only when play is pressed, then plays it', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const resolveSrc = vi.fn().mockResolvedValue('https://storage.example/signed?sig=1');
    const view = render(<AuthorityBoundAudio resolveSrc={resolveSrc} />);
    const audio = view.container.querySelector('audio');
    expect(resolveSrc).not.toHaveBeenCalled();
    expect(audio.hasAttribute('src')).toBe(false);

    fireEvent.click(view.getByRole('button', { name: /play protected audio/i }));
    await waitFor(() => expect(view.getByText('Pause audio')).toBeTruthy());
    expect(resolveSrc).toHaveBeenCalledTimes(1);
    expect(audio.getAttribute('src')).toBe('https://storage.example/signed?sig=1');
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('shows the recording as unavailable when no https link comes back', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    for (const answer of [() => Promise.reject(new Error('denied')), () => Promise.resolve('http://storage.example/x'), () => Promise.resolve('private/voicemail/1.mp3')]) {
      const view = render(<AuthorityBoundAudio resolveSrc={answer} />);
      fireEvent.click(view.getByRole('button', { name: /play protected audio/i }));
      await waitFor(() => expect(view.getByText('Recording unavailable')).toBeTruthy());
      expect(view.container.querySelector('audio').hasAttribute('src')).toBe(false);
      view.unmount();
    }
    expect(play).not.toHaveBeenCalled();
  });

  it('discards a link that arrives after the tenant authority closed', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    let deliver;
    const resolveSrc = () => new Promise((resolve) => { deliver = resolve; });
    const view = render(<AuthorityBoundAudio resolveSrc={resolveSrc} />);
    fireEvent.click(view.getByRole('button', { name: /play protected audio/i }));
    await waitFor(() => expect(view.getByText('Loading audio…')).toBeTruthy());
    act(() => closeTenantSdkRealm());
    await act(async () => { deliver('https://storage.example/signed?sig=late'); });
    expect(view.container.querySelector('audio').hasAttribute('src')).toBe(false);
    expect(play).not.toHaveBeenCalled();
    expect(view.getByText('Play audio')).toBeTruthy();
  });
});
