import { fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const requestVoicemailPlaybackUrl = vi.fn();
vi.mock('@/components/voice/useNurseCallLogs', () => ({
  requestVoicemailPlaybackUrl: (...args) => requestVoicemailPlaybackUrl(...args),
}));

describe('VoicemailPlayer', () => {
  let VoicemailPlayer;
  let openTenantSdkRealm;

  beforeEach(async () => {
    localStorage.clear();
    vi.resetModules();
    requestVoicemailPlaybackUrl.mockReset();
    ({ openTenantSdkRealm } = await import('@/lib/tenantSdkRealmGate'));
    ({ default: VoicemailPlayer } = await import('./VoicemailPlayer'));
    expect(openTenantSdkRealm('voicemail-authority')).toBe(true);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it('asks the server for a signed link for a stored recording, only when play is pressed', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    requestVoicemailPlaybackUrl.mockResolvedValue('https://storage.example/signed?sig=1');
    const view = render(<VoicemailPlayer call={{ id: 'CallLog_1', has_voicemail: true, voicemail_url: 'private/voicemail/1.mp3' }} />);
    const audio = view.container.querySelector('audio');
    expect(audio.hasAttribute('src')).toBe(false);
    expect(requestVoicemailPlaybackUrl).not.toHaveBeenCalled();

    fireEvent.click(view.getByRole('button', { name: /play protected audio/i }));
    await waitFor(() => expect(view.getByText('Pause audio')).toBeTruthy());
    expect(requestVoicemailPlaybackUrl).toHaveBeenCalledWith('CallLog_1');
    expect(audio.getAttribute('src')).toBe('https://storage.example/signed?sig=1');
    expect(play).toHaveBeenCalled();
  });

  it('plays a legacy provider link directly, as before', () => {
    const view = render(<VoicemailPlayer call={{ id: 'CallLog_2', has_voicemail: true, voicemail_url: 'https://s3.amazonaws.com/rec.mp3' }} />);
    expect(view.container.querySelector('audio').getAttribute('src')).toBe('https://s3.amazonaws.com/rec.mp3');
    expect(requestVoicemailPlaybackUrl).not.toHaveBeenCalled();
  });

  it('renders nothing without a playable voicemail', () => {
    for (const call of [
      { id: 'a', has_voicemail: false, voicemail_url: 'private/voicemail/1.mp3' },
      { id: 'b', has_voicemail: true, voicemail_url: '' },
      { id: 'c', has_voicemail: true, voicemail_url: 'javascript:alert(1)' },
      null,
    ]) {
      const view = render(<VoicemailPlayer call={call} />);
      expect(view.container.querySelector('audio')).toBeNull();
      view.unmount();
    }
  });
});
