import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mediaRealm = vi.hoisted(() => {
  let controller;
  let current;
  let lease;
  let scopes;

  const stale = () => Object.assign(new Error('expired'), {
    code: 'STALE_TENANT_SDK_OPERATION',
  });

  const create = vi.fn((...args) => {
    const candidate = args.length === 0 ? lease : args[0];
    if (!current || candidate !== lease) throw stale();
    let active = true;
    const scopeController = new AbortController();
    const teardowns = new Set();
    const scope = {
      addTeardown(teardown) {
        if (!active) {
          teardown();
          return () => {};
        }
        teardowns.add(teardown);
        return () => teardowns.delete(teardown);
      },
      assertCurrent() {
        if (!active || !current || controller.signal.aborted) throw stale();
        return candidate;
      },
      dispose() {
        if (!active) return;
        active = false;
        scopeController.abort();
        scopes.delete(scope);
        for (const teardown of [...teardowns].reverse()) teardown();
        teardowns.clear();
      },
      isCurrent: () => active && current && !controller.signal.aborted,
      realmLease: candidate,
      signal: scopeController.signal,
    };
    scopes.add(scope);
    return Object.freeze(scope);
  });

  return {
    abort() {
      current = false;
      controller.abort();
      for (const scope of [...scopes]) scope.dispose();
    },
    create,
    lease: () => lease,
    reset() {
      controller = new AbortController();
      current = true;
      lease = Object.freeze({});
      scopes = new Set();
      create.mockClear();
    },
  };
});

const sdk = vi.hoisted(() => ({
  invoke: vi.fn(),
  upload: vi.fn(),
}));

const camera = vi.hoisted(() => ({
  acquire: vi.fn(),
  stop: vi.fn((stream) => {
    for (const track of stream?.getTracks?.() || []) track.stop();
  }),
}));

const fax = vi.hoisted(() => ({ send: vi.fn() }));
const notifications = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock('@/lib/authorityBoundMediaProcessing', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createAuthorityBoundMediaOperation: mediaRealm.create,
    loadAuthorityBoundImage: vi.fn(async (operation) => {
      operation.assertCurrent();
      return { height: 200, width: 100 };
    }),
    readAuthorityBoundDataUrl: vi.fn(async (operation) => {
      operation.assertCurrent();
      return 'data:image/jpeg;base64,ZmF4';
    }),
  };
});

vi.mock('@/api/base44Client', () => ({
  base44: {
    functions: { invoke: sdk.invoke },
    integrations: { Core: { UploadFile: sdk.upload } },
  },
}));

vi.mock('@/lib/tenantMediaDevices', () => ({
  getAuthorityBoundUserMedia: camera.acquire,
  stopMediaStream: camera.stop,
}));

vi.mock('@/functions/sendFax', () => ({ sendFax: fax.send }));
vi.mock('sonner', () => ({ toast: notifications }));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('@/components/fax/FaxAddressBook', () => ({ default: () => null }));
vi.mock('@/components/fax/FaxSignaturePanel', () => ({ default: () => null }));
vi.mock('@/components/fax/FaxCoverSheetGenerator', () => ({ default: () => null }));

vi.mock('jspdf', () => {
  class MockPdf {
    constructor() {
      this.internal = {
        pageSize: {
          getHeight: () => 297,
          getWidth: () => 210,
        },
      };
    }

    addImage() {}
    addPage() {}
    output() { return new Blob(['pdf'], { type: 'application/pdf' }); }
  }
  return { default: MockPdf, jsPDF: MockPdf };
});

import EnhancedCameraFaxSender from '@/components/fax/EnhancedCameraFaxSender';
import PhotoUploadFaxSender from '@/components/fax/PhotoUploadFaxSender';

describe('fax sender exact media authority integration', () => {
  beforeEach(() => {
    mediaRealm.reset();
    sdk.invoke.mockReset();
    sdk.upload.mockReset();
    camera.acquire.mockReset();
    camera.stop.mockClear();
    fax.send.mockReset();
    notifications.error.mockClear();
    notifications.success.mockClear();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('detaches an exact-lease camera preview and blocks native escape surfaces on abort', async () => {
    const stopTrack = vi.fn();
    const stream = { getTracks: () => [{ stop: stopTrack }] };
    camera.acquire.mockResolvedValue({ realmLease: mediaRealm.lease(), stream });
    const { container } = render(<EnhancedCameraFaxSender />);

    fireEvent.click(await screen.findByRole('button', { name: /start camera/i }));
    const video = await waitFor(() => {
      const candidate = container.querySelector('video');
      expect(candidate).not.toBeNull();
      expect(candidate.srcObject).toBe(stream);
      return candidate;
    });
    expect(video.controls).toBe(false);
    expect(video).toHaveAttribute('controlslist', 'nodownload nofullscreen noremoteplayback');
    expect(video).toHaveAttribute('disablepictureinpicture');
    expect(video).toHaveAttribute('disableremoteplayback');
    expect(video).toHaveAttribute('x-webkit-airplay', 'deny');
    const contextMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    video.dispatchEvent(contextMenu);
    expect(contextMenu.defaultPrevented).toBe(true);
    video.onended = vi.fn();

    act(() => mediaRealm.abort());

    expect(stopTrack).toHaveBeenCalled();
    expect(video.srcObject).toBeNull();
    expect(video.onended).toBeNull();
    expect(screen.getByRole('button', { name: /start camera/i })).toBeDisabled();
  });

  it('does not begin PDF upload or fax send after authority aborts during image fetch', async () => {
    sdk.upload.mockResolvedValueOnce({ file_url: 'https://files.test/uploaded-image.jpg' });
    let resolveFetch;
    const responseBlob = vi.fn().mockResolvedValue(new Blob(['image'], { type: 'image/jpeg' }));
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; })));
    const { container } = render(<PhotoUploadFaxSender />);
    const fileInput = container.querySelector('input[type="file"]');
    const imageFile = new File(['image'], 'visit.jpg', { type: 'image/jpeg' });

    fireEvent.change(fileInput, { target: { files: [imageFile] } });
    await waitFor(() => expect(container.querySelector('img')).toHaveAttribute(
      'src',
      'https://files.test/uploaded-image.jpg',
    ));
    fireEvent.change(screen.getByPlaceholderText('+1234567890'), {
      target: { value: '+15555550123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send fax/i }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    act(() => mediaRealm.abort());
    await act(async () => {
      resolveFetch({ blob: responseBlob });
      await Promise.resolve();
    });

    expect(responseBlob).not.toHaveBeenCalled();
    expect(sdk.upload).toHaveBeenCalledTimes(1);
    expect(sdk.invoke).not.toHaveBeenCalled();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('button', { name: /select photos/i })).toBeDisabled();
  });

  it('does not expose a prefilled recipient when the component cannot capture authority', () => {
    mediaRealm.abort();
    render(<PhotoUploadFaxSender prefilledData={{ recipient_fax_number: '+15555550123' }} />);

    expect(screen.getByPlaceholderText('+1234567890')).toHaveValue('');
    expect(screen.getByPlaceholderText('+1234567890')).toBeDisabled();
    expect(sdk.upload).not.toHaveBeenCalled();
    expect(sdk.invoke).not.toHaveBeenCalled();
  });

  it('aborts an in-flight PDF fetch when the photo sender unmounts', async () => {
    sdk.upload.mockResolvedValueOnce({ file_url: 'https://files.test/uploaded-image.jpg' });
    let fetchSignal;
    vi.stubGlobal('fetch', vi.fn((_url, options) => {
      fetchSignal = options.signal;
      return new Promise((_resolve, reject) => {
        fetchSignal.addEventListener('abort', () => reject(
          Object.assign(new Error('aborted'), { name: 'AbortError' }),
        ), { once: true });
      });
    }));
    const { container, unmount } = render(<PhotoUploadFaxSender />);
    const imageFile = new File(['image'], 'visit.jpg', { type: 'image/jpeg' });

    fireEvent.change(container.querySelector('input[type="file"]'), {
      target: { files: [imageFile] },
    });
    await waitFor(() => expect(container.querySelector('img')).not.toBeNull());
    fireEvent.change(screen.getByPlaceholderText('+1234567890'), {
      target: { value: '+15555550123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send fax/i }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    unmount();

    expect(fetchSignal.aborted).toBe(true);
    await waitFor(() => expect(sdk.invoke).not.toHaveBeenCalled());
    expect(sdk.upload).toHaveBeenCalledTimes(1);
  });
});
