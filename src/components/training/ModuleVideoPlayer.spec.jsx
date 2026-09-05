import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const realm = vi.hoisted(() => {
  let lease;
  let controller;
  let current;
  let captureError;
  return {
    abort() {
      current = false;
      controller.abort();
    },
    capture: vi.fn(() => {
      if (captureError) throw captureError;
      return lease;
    }),
    failCapture(error = new Error('realm closed')) {
      captureError = error;
    },
    getSignal: vi.fn((candidate) => {
      if (candidate !== lease) throw new Error('wrong lease');
      return controller.signal;
    }),
    isCurrent: vi.fn((candidate) => candidate === lease && current && !controller.signal.aborted),
    lease: () => lease,
    reset() {
      lease = Object.freeze({});
      controller = new AbortController();
      current = true;
      captureError = null;
      this.capture.mockClear();
      this.getSignal.mockClear();
      this.isCurrent.mockClear();
    },
  };
});

vi.mock('@/lib/tenantSdkRealmGate', () => ({
  captureTenantSdkRealmLease: realm.capture,
  getTenantSdkRealmAbortSignal: realm.getSignal,
  isTenantSdkRealmLeaseCurrent: realm.isCurrent,
}));

vi.mock('@/components/utils/security', () => ({
  isSafeExternalUrl: (value) => typeof value === 'string' && /^https?:\/\//.test(value),
}));

import ModuleVideoPlayer from './ModuleVideoPlayer';

class MockSpeechSynthesisUtterance {
  constructor(text) {
    this.text = text;
    this.rate = 1;
    this.onend = null;
    this.onerror = null;
  }
}

const videoModule = (overrides = {}) => ({
  id: 'module-video',
  title: 'Safe handling',
  video_url: 'https://media.example.test/lesson.mp4',
  video_thumbnail_url: 'https://media.example.test/poster.jpg',
  ...overrides,
});

const narratedModule = {
  id: 'module-narrated',
  title: 'Narrated handling',
  content_json: {
    intro: 'Start with the verified procedure.',
  },
};

describe('ModuleVideoPlayer tenant media lifecycle', () => {
  let playSpy;
  let pauseSpy;
  let loadSpy;
  let speech;

  beforeEach(() => {
    realm.reset();
    playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    pauseSpy = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    loadSpy = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    speech = {
      cancel: vi.fn(),
      speak: vi.fn(),
    };
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: MockSpeechSynthesisUtterance,
    });
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: speech,
    });
    Object.defineProperty(document, 'pictureInPictureElement', {
      configurable: true,
      value: null,
    });
    Object.defineProperty(document, 'exitPictureInPicture', {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('withholds the source until an exact lease and uses only revocable custom controls', async () => {
    const onEnded = vi.fn();
    const { container, unmount } = render(
      <ModuleVideoPlayer module={videoModule()} onEnded={onEnded} />,
    );
    const video = container.querySelector('video');

    await waitFor(() => expect(video).toHaveAttribute(
      'src',
      'https://media.example.test/lesson.mp4',
    ));
    expect(realm.capture).toHaveBeenCalledTimes(1);
    expect(realm.getSignal).toHaveBeenCalledWith(realm.lease());
    expect(video.controls).toBe(false);
    expect(video).toHaveAttribute('controlslist', 'nodownload nofullscreen noremoteplayback');
    expect(video).toHaveAttribute('disablepictureinpicture');
    expect(video).toHaveAttribute('disableremoteplayback');
    expect(video).toHaveAttribute('x-webkit-airplay', 'deny');
    expect(video).toHaveAttribute('playsinline');
    pauseSpy.mockClear();
    loadSpy.mockClear();

    const contextMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    video.dispatchEvent(contextMenu);
    expect(contextMenu.defaultPrevented).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Play lesson video' }));
    await waitFor(() => expect(playSpy).toHaveBeenCalledTimes(1));
    await screen.findByRole('button', { name: 'Pause lesson video' });
    fireEvent.click(screen.getByRole('button', { name: 'Pause lesson video' }));
    expect(pauseSpy).toHaveBeenCalledTimes(1);
    await screen.findByRole('button', { name: 'Play lesson video' });
    fireEvent.click(screen.getByRole('button', { name: 'Play lesson video' }));
    await waitFor(() => expect(playSpy).toHaveBeenCalledTimes(2));
    await screen.findByRole('button', { name: 'Pause lesson video' });

    fireEvent.ended(video);
    expect(onEnded).toHaveBeenCalledTimes(1);
    fireEvent.ended(video);
    expect(onEnded).toHaveBeenCalledTimes(1);

    unmount();
    expect(video).not.toHaveAttribute('src');
    expect(pauseSpy).toHaveBeenCalled();
    expect(loadSpy).toHaveBeenCalled();
  });

  it('aborts playback, exits PiP, detaches the source, and drops stale ended events', async () => {
    const onEnded = vi.fn();
    const { container } = render(
      <ModuleVideoPlayer module={videoModule()} onEnded={onEnded} />,
    );
    const video = container.querySelector('video');
    await waitFor(() => expect(video).toHaveAttribute('src'));

    Object.defineProperty(document, 'pictureInPictureElement', {
      configurable: true,
      value: video,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Play lesson video' }));
    await screen.findByRole('button', { name: 'Pause lesson video' });

    act(() => realm.abort());

    expect(video).not.toHaveAttribute('src');
    expect(pauseSpy).toHaveBeenCalled();
    expect(loadSpy).toHaveBeenCalled();
    expect(document.exitPictureInPicture).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Play lesson video' })).toBeDisabled();
    expect(screen.getByText(/video unavailable while workspace authority is closed/i))
      .toBeInTheDocument();
    fireEvent.ended(video);
    expect(onEnded).not.toHaveBeenCalled();
  });

  it('detaches speech callbacks and cancels owned narration on authority abort', async () => {
    const onEnded = vi.fn();
    render(<ModuleVideoPlayer module={narratedModule} onEnded={onEnded} />);
    const play = await screen.findByRole('button', { name: 'Play lesson' });

    fireEvent.click(play);
    await waitFor(() => expect(speech.speak).toHaveBeenCalledTimes(1));
    const utterance = speech.speak.mock.calls[0][0];
    const queuedEnd = utterance.onend;
    const queuedError = utterance.onerror;
    expect(typeof queuedEnd).toBe('function');
    expect(typeof queuedError).toBe('function');

    act(() => realm.abort());

    expect(utterance.onend).toBeNull();
    expect(utterance.onerror).toBeNull();
    expect(speech.cancel).toHaveBeenCalled();
    act(() => {
      queuedEnd();
      queuedError();
    });
    expect(onEnded).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Play lesson' })).toBeDisabled();
  });

  it('detaches and cancels an active utterance on unmount', async () => {
    const onEnded = vi.fn();
    const { unmount } = render(
      <ModuleVideoPlayer module={narratedModule} onEnded={onEnded} />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Play lesson' }));
    await waitFor(() => expect(speech.speak).toHaveBeenCalledTimes(1));
    const utterance = speech.speak.mock.calls[0][0];
    const queuedEnd = utterance.onend;

    unmount();

    expect(utterance.onend).toBeNull();
    expect(utterance.onerror).toBeNull();
    expect(speech.cancel).toHaveBeenCalled();
    queuedEnd();
    expect(onEnded).not.toHaveBeenCalled();
  });

  it('never attaches a real video source when lease capture fails', () => {
    realm.failCapture();
    const { container } = render(<ModuleVideoPlayer module={videoModule()} onEnded={vi.fn()} />);
    const video = container.querySelector('video');

    expect(video).not.toHaveAttribute('src');
    expect(screen.getByRole('button', { name: 'Play lesson video' })).toBeDisabled();
    expect(playSpy).not.toHaveBeenCalled();
  });
});
